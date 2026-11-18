// AI-039.2 ChatGPT plan connection service (server-side only). An integration credential for model access;
// NOT PAC authentication: PAC identity and Owner authority stay GitHub / Auth.js. The ChatGPT subject or
// email never authorizes anything in PAC.
//
//   start(owner)     Owner authority verified by the caller AND re-verified here → fresh state / nonce /
//                    PKCE → pending attempt (local, 10 min, bound to Owner, workspace, redirect URI, host
//                    id, requested client id) → official authorization URL
//   complete(url)    request host must be the loopback callback; attempt consumed exactly once by state
//                    (no cookies trusted) → not expired → Owner re-verified → callback client id checks →
//                    code exchange (issued client id, PKCE verifier) → JWKS ID-token validation (issuer,
//                    audience, expiry, nonce) → returning-subject check → granted scope decides plan usage
//                    → credentials persisted ONLY after everything validated
//   accessToken()    serialized refresh with rotation (internal; never exposed to presentation)
//   models()         account-specific model discovery (not an entitlement proof)
//   disconnect()     official revocation of the renewable session, then local token material cleared
//
// Nothing here performs inference.
import { createHash } from "node:crypto";
import { types } from "node:util";
import type { ChatGPTCredentialStore, ChatGPTSubscriptionFacts, ChatGPTSubscriptionOwnerBinding, PendingAttempt, StoredRegistration, StoredRegistrations } from "./chatgpt-credential-store";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
export { isChatGPTSubscriptionFacts } from "./chatgpt-credential-store.ts";
export type { ChatGPTSubscriptionFacts } from "./chatgpt-credential-store";
import type { ChatGPTModel, FetchLike, IdTokenFailure, TokenExchangeDiagnostic, TokenSet } from "./chatgpt-oauth";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { chatgptOAuth, authorizationUrl, exchangeAuthorizationCode, fetchJwks, listChatGPTModels, newOAuthAttemptSecrets, parseCallback, redirectUriFor, refreshAccessToken, revokeRefreshToken, stateKey, validateIdToken } from "./chatgpt-oauth.ts";

export type ChatGPTConnectionState =
  | "not_connected"
  | "signed_out"
  | "connecting"
  | "plan_usage_enabled"
  | "plan_usage_missing"
  | "reauthorization_required"
  | "temporarily_unavailable";

// Safe projection only: no token, no ID token, no subject, no client id.
export type ChatGPTConnectionStatus = Readonly<{
  state: ChatGPTConnectionState;
  accountLabel: string | null;
  planUsageGranted: boolean;
  accessMode: "subscription_session";
  selectedModel: string | null;
  availableModels: readonly ChatGPTModel[];
  modelsCheckedAt: string | null;
}>;

export type CallbackOutcome =
  | "connected"
  | "plan_usage_missing"
  | "offline_access_missing"
  | "denied"
  | "expired"
  | "authorization_cancelled"
  | "reauthorization_required"
  | "temporarily_unavailable";

export type OwnerAuthority = Readonly<{ verify(input: Readonly<{ ownerUserId: string; domainWorkspaceId: string }>): Promise<boolean> }>;
export type ChatGPTSubscriptionAccessBinding = ChatGPTSubscriptionOwnerBinding & Readonly<{ modelId: string }>;
export type ChatGPTSubscriptionAccess = Readonly<{ ok: true; kind: "chatgpt_subscription_access" }>;
type SubscriptionLease = Readonly<{ binding: ChatGPTSubscriptionAccessBinding; token: string; expiresAt: number; now(): Date; dispatchScope?: { active: boolean } }>;
const subscriptionAccess = new WeakMap<object, SubscriptionLease>();

function sameSubscriptionBinding(left: ChatGPTSubscriptionAccessBinding, right: ChatGPTSubscriptionAccessBinding): boolean {
  return left.registration.label === right.registration.label && left.registration.clientId === right.registration.clientId
    && left.registration.subjectHash === right.registration.subjectHash && left.ownerUserId === right.ownerUserId
    && left.domainWorkspaceId === right.domainWorkspaceId && left.modelId === right.modelId;
}
function snapshotSubscriptionBinding(input: ChatGPTSubscriptionAccessBinding): ChatGPTSubscriptionAccessBinding | null {
  try {
    const registration = input.registration;
    const label = registration.label, clientId = registration.clientId, subjectHash = registration.subjectHash;
    const ownerUserId = input.ownerUserId, domainWorkspaceId = input.domainWorkspaceId, modelId = input.modelId;
    if (![label, clientId, subjectHash, ownerUserId, domainWorkspaceId, modelId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 256)) return null;
    return Object.freeze({ registration: Object.freeze({ label, clientId, subjectHash }), ownerUserId, domainWorkspaceId, modelId });
  } catch { return null; }
}
export function isChatGPTSubscriptionAccess(value: unknown, expected: ChatGPTSubscriptionAccessBinding): value is ChatGPTSubscriptionAccess {
  try {
    const lease = typeof value === "object" && value !== null ? subscriptionAccess.get(value) : undefined;
    return !!lease && lease.expiresAt > lease.now().getTime() && sameSubscriptionBinding(lease.binding, expected);
  } catch { return false; }
}
// Single-use: a copied/forged result or an API-key-shaped token can never become a subscription lease.
// The scoped executor consumes this only AFTER consuming its independently issued start capability.
function consumeSubscriptionAccess(value: unknown, expected: ChatGPTSubscriptionAccessBinding): string | null {
  const valid = isChatGPTSubscriptionAccess(value, expected);
  if (typeof value !== "object" || value === null) return null;
  const lease = subscriptionAccess.get(value);
  subscriptionAccess.delete(value);
  return valid && lease ? lease.token : null;
}
export function useChatGPTSubscriptionAccess(value: unknown, expected: ChatGPTSubscriptionAccessBinding): string | null {
  return consumeSubscriptionAccess(value, expected);
}
/** A real credential receipt alone is not dispatch authority. Only the existing credential lock's
 * callback scope can hold this lease; copied, unlocked and escaped receipts all fail closed. */
export function isChatGPTSubscriptionDispatchAccess(value: unknown, expected: ChatGPTSubscriptionAccessBinding): value is ChatGPTSubscriptionAccess {
  return isChatGPTSubscriptionAccess(value, expected) && subscriptionAccess.get(value as object)?.dispatchScope?.active === true;
}
export function consumeChatGPTSubscriptionDispatchAccess(value: unknown, expected: ChatGPTSubscriptionAccessBinding): string | null {
  if (!isChatGPTSubscriptionDispatchAccess(value, expected)) return null;
  return consumeSubscriptionAccess(value, expected);
}

// Server-only fixed enums + an explicit bounded schema projection; NEVER a callback / token / claim
// object. Each complete() owns its own context, so simultaneous callbacks cannot mix diagnostics.
export type CallbackDiagnosticStage = "callback_transport" | "callback_parsing" | "state_lookup" | "attempt_binding"
  | "owner_verification" | "issued_client_binding" | "token_exchange" | "token_response" | "id_token_presence"
  | "jwks_retrieval" | "id_token_validation" | "credential_lock" | "registration_invariants" | "credential_store_write" | "composition" | "complete";
type CallbackDiagnosticFailure = IdTokenFailure | "invalid_callback" | "unknown_state" | "attempt_expired" | "redirect_mismatch"
  | "authorization_cancelled" | "owner_denied" | "missing_issued_client" | "issued_client_mismatch" | "missing_id_token"
  | "jwks_unavailable" | "registration_mismatch" | "store_unavailable" | "plan_usage_missing" | "offline_access_missing"
  | "internal_unavailable" | TokenExchangeDiagnostic["resultClass"] | NonNullable<TokenExchangeDiagnostic["oauthError"]>;
export type CallbackDiagnostic = Readonly<{
  event: "callback_succeeded" | "callback_failed";
  outcome: CallbackOutcome;
  stage: CallbackDiagnosticStage;
  failure: CallbackDiagnosticFailure | null;
  exchange: TokenExchangeDiagnostic | null;
}>;
type CallbackTrace = { stage: CallbackDiagnosticStage; failure: CallbackDiagnosticFailure | null; exchange: TokenExchangeDiagnostic | null };

export type ChatGPTConnectionDependencies = Readonly<{
  store: ChatGPTCredentialStore;
  fetch: FetchLike;
  ownerAuthority: OwnerAuthority;
  callbackPort: number;
  now(): Date;
  onCallbackDiagnostic?(event: CallbackDiagnostic): void;
}>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const returnOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/u;

// Registration identity = the ISSUED client registration + the validated subject. Each issued client
// registration is separate (OpenAI treats them separately): the same subject under two issued client ids
// is two registrations, and one can never overwrite the other's credentials.
export function registrationLabel(clientId: string, subject: string): string {
  return `chatgpt-${createHash("sha256").update(`${clientId}\n${subject}`, "utf8").digest("hex").slice(0, 16)}`;
}

function activeRegistration(registrations: StoredRegistrations): StoredRegistration | null {
  return registrations.registrations.find((item) => item.label === registrations.active) ?? null;
}

function replace(registrations: StoredRegistrations, next: StoredRegistration): StoredRegistrations {
  const others = registrations.registrations.filter((item) => item.label !== next.label);
  return freeze({ version: 1, active: next.label, registrations: freeze([...others, next]) });
}

const expiresAt = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1_000).toISOString();

export function createChatGPTConnection(dependencies: ChatGPTConnectionDependencies) {
  const { store, fetch, ownerAuthority, callbackPort, now } = dependencies;
  const redirectUri = redirectUriFor(callbackPort);
  const allowedReturnOrigins = new Set([`http://localhost:${callbackPort}`, `http://127.0.0.1:${callbackPort}`]);
  const accessExpiries = new WeakMap<object, number>();
  const acceptedAccess = (token: string, label: string, expiration: string) => {
    const value = { ok: true as const, token, label };
    accessExpiries.set(value, Date.parse(expiration));
    return value;
  };

  async function verifyOwner(ownerUserId: string, domainWorkspaceId: string): Promise<boolean> {
    try {
      return (await ownerAuthority.verify({ ownerUserId, domainWorkspaceId })) === true;
    } catch {
      return false;
    }
  }

  // Owner authority is re-verified here (never trusted from the browser). Returns the official URL.
  async function start(input: Readonly<{ ownerUserId: string; domainWorkspaceId: string; returnOrigin: string }>):
  Promise<Readonly<{ status: "redirect"; url: string }> | Readonly<{ status: "denied" | "unavailable" }>> {
    if (!(await verifyOwner(input.ownerUserId, input.domainWorkspaceId))) return { status: "denied" };
    const returnOrigin = allowedReturnOrigins.has(input.returnOrigin) && returnOriginPattern.test(input.returnOrigin) ? input.returnOrigin : `http://127.0.0.1:${callbackPort}`;
    try {
      const hostId = await store.hostId();
      const registrations = await store.readRegistrations();
      const existing = activeRegistration(registrations);
      const secrets = newOAuthAttemptSecrets();
      const created = now();
      const attempt: PendingAttempt = freeze({
        version: 1, stateKey: stateKey(secrets.state), nonce: secrets.nonce, codeVerifier: secrets.codeVerifier, redirectUri, hostId,
        requestedClientId: existing?.clientId ?? null, registrationLabel: existing?.label ?? null,
        ownerUserId: input.ownerUserId, domainWorkspaceId: input.domainWorkspaceId, returnOrigin,
        createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + chatgptOAuth.attemptTtlMs).toISOString(),
      });
      await store.putAttempt(attempt);
      return {
        status: "redirect",
        url: authorizationUrl({
          clientId: existing?.clientId ?? null, hostId, redirectUri, state: secrets.state, nonce: secrets.nonce, codeChallenge: secrets.codeChallenge,
          idTokenHint: existing?.idToken ?? null,
        }),
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  // The callback request URL as received. Returns the outcome and the fixed internal return target.
  async function complete(requestUrl: URL): Promise<Readonly<{ outcome: CallbackOutcome; returnOrigin: string }>> {
    const trace: CallbackTrace = { stage: "callback_parsing", failure: "invalid_callback", exchange: null };
    let result: Readonly<{ outcome: CallbackOutcome; returnOrigin: string }> = freeze({ outcome: "temporarily_unavailable", returnOrigin: `http://127.0.0.1:${callbackPort}` });
    try {
      result = await completeAttempt(requestUrl, trace);
    } catch {
      // Unexpected exceptions are reduced to a fixed code; never pass the thrown value to a logger.
      trace.failure = "internal_unavailable";
    }
    try {
      dependencies.onCallbackDiagnostic?.(freeze({
        event: result.outcome === "connected" ? "callback_succeeded" : "callback_failed",
        outcome: result.outcome, stage: trace.stage, failure: trace.failure, exchange: trace.exchange,
      }));
    } catch { /* Diagnostics cannot change OAuth / persistence semantics. */ }
    return result;
  }

  async function completeAttempt(requestUrl: URL, trace: CallbackTrace): Promise<Readonly<{ outcome: CallbackOutcome; returnOrigin: string }>> {
    const fallbackOrigin = `http://127.0.0.1:${callbackPort}`;
    const deny = (outcome: CallbackOutcome, returnOrigin = fallbackOrigin) => freeze({ outcome, returnOrigin });
    // Only the exact loopback callback is served.
    if (`${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}` !== redirectUri) return deny("denied");
    const callback = parseCallback(requestUrl);
    if (callback.kind === "invalid") return deny("denied");
    if (callback.state === null) return deny("denied");
    trace.stage = "state_lookup";
    trace.failure = "unknown_state";
    let attempt: PendingAttempt | null;
    try {
      attempt = await store.consumeAttempt(stateKey(callback.state));
    } catch {
      trace.failure = "store_unavailable";
      return deny("temporarily_unavailable");
    }
    // Unknown, replayed or tampered state: nothing to consume.
    if (!attempt) return deny("denied");
    const returnOrigin = attempt.returnOrigin;
    trace.stage = "attempt_binding";
    trace.failure = "attempt_expired";
    if (Date.parse(attempt.expiresAt) <= now().getTime()) return deny("expired", returnOrigin);
    trace.failure = "redirect_mismatch";
    if (attempt.redirectUri !== redirectUri) return deny("denied", returnOrigin);
    trace.failure = "authorization_cancelled";
    if (callback.kind === "error") return deny("authorization_cancelled", returnOrigin);
    trace.stage = "owner_verification";
    trace.failure = "owner_denied";
    if (!(await verifyOwner(attempt.ownerUserId, attempt.domainWorkspaceId))) return deny("denied", returnOrigin);

    // Client id: a first registration MUST receive an issued id (never dynamic_agent_client); a returning
    // registration must get back exactly the id it asked with (or none).
    let clientId: string;
    trace.stage = "issued_client_binding";
    trace.failure = "missing_issued_client";
    if (attempt.requestedClientId === null) {
      if (callback.clientId === null || callback.clientId === chatgptOAuth.dynamicClientId) return deny("denied", returnOrigin);
      clientId = callback.clientId;
    } else {
      trace.failure = "issued_client_mismatch";
      if (callback.clientId !== null && callback.clientId !== attempt.requestedClientId) return deny("denied", returnOrigin);
      clientId = attempt.requestedClientId;
    }

    trace.stage = "token_exchange";
    const exchanged = await exchangeAuthorizationCode(fetch, { clientId, code: callback.code, codeVerifier: attempt.codeVerifier, redirectUri });
    trace.exchange = exchanged.diagnostic;
    trace.failure = exchanged.diagnostic.oauthError ?? exchanged.diagnostic.resultClass;
    if (exchanged.diagnostic.resultClass === "invalid_json" || exchanged.diagnostic.resultClass === "invalid_token_response") trace.stage = "token_response";
    if (!exchanged.ok) return deny(exchanged.failure === "temporarily_unavailable" ? "temporarily_unavailable" : "denied", returnOrigin);
    const tokens: TokenSet = exchanged.tokens;
    trace.stage = "id_token_presence";
    trace.failure = "missing_id_token";
    if (tokens.idToken === null) return deny("denied", returnOrigin);
    trace.stage = "jwks_retrieval";
    trace.failure = "jwks_unavailable";
    const jwks = await fetchJwks(fetch);
    if (!jwks) return deny("temporarily_unavailable", returnOrigin);
    trace.stage = "id_token_validation";
    trace.failure = null;
    const validated = await validateIdToken({ idToken: tokens.idToken, jwks, clientId, nonce: attempt.nonce, now: now() });
    if (!validated.ok) {
      trace.failure = validated.failure;
      return deny("denied", returnOrigin);
    }

    try {
      trace.stage = "credential_lock";
      trace.failure = "store_unavailable";
      return await store.withRefreshLock(async () => persistConnection(attempt, clientId, tokens, validated.token, returnOrigin, trace));
    } catch {
      trace.failure = "store_unavailable";
      return deny("temporarily_unavailable", returnOrigin);
    }
  }

  // Runs under the credential lock: no concurrent refresh / selection can interleave with the write.
  async function persistConnection(attempt: PendingAttempt, clientId: string, tokens: TokenSet, token: Readonly<{ subject: string; email: string | null }>, returnOrigin: string, trace: CallbackTrace):
  Promise<Readonly<{ outcome: CallbackOutcome; returnOrigin: string }>> {
    trace.stage = "registration_invariants";
    trace.failure = "store_unavailable";
    const registrations = await store.readRegistrations();
    trace.failure = "registration_mismatch";
    const label = registrationLabel(clientId, token.subject);
    if (attempt.registrationLabel !== null) {
      const selected = registrations.registrations.find((item) => item.label === attempt.registrationLabel);
      // Returning registration: BOTH the stored issued client id and the validated subject must match.
      if (!selected || selected.subject !== token.subject || selected.clientId !== clientId || label !== selected.label) return freeze({ outcome: "denied" as const, returnOrigin });
    }
    const previous = registrations.registrations.find((item) => item.label === label) ?? null;
    // A first registration must not collide with an existing different registration under the same label.
    if (previous && (previous.clientId !== clientId || previous.subject !== token.subject)) return freeze({ outcome: "denied" as const, returnOrigin });
    const planUsageGranted = tokens.grantedScopes.includes(chatgptOAuth.planScope);
    // offline_access is requested: a plan connection is only kept if it is refreshable. A grant without a
    // refresh token would silently become a one-hour connection, so nothing is persisted.
    if (planUsageGranted && tokens.refreshToken === null) {
      trace.failure = "offline_access_missing";
      return freeze({ outcome: "offline_access_missing" as const, returnOrigin });
    }
    const next: StoredRegistration = freeze({
      label, clientId, subject: token.subject, email: token.email, hostId: attempt.hostId, idToken: tokens.idToken,
      // Without the plan scope the token set cannot be used for plan inference: identity metadata only.
      accessToken: planUsageGranted ? tokens.accessToken : null,
      refreshToken: planUsageGranted ? tokens.refreshToken : null,
      accessTokenExpiresAt: planUsageGranted ? expiresAt(now(), tokens.expiresInSeconds) : null,
      earliestRefreshAt: planUsageGranted ? tokens.earliestRefreshAt : null,
      grantedScopes: tokens.grantedScopes, status: planUsageGranted ? "active" : "plan_usage_missing", savedAt: now().toISOString(),
      selectedModel: previous?.selectedModel ?? null, availableModels: previous?.availableModels ?? [], modelsCheckedAt: previous?.modelsCheckedAt ?? null,
    });
    trace.stage = "credential_store_write";
    trace.failure = "store_unavailable";
    await store.writeRegistrations(replace(registrations, next), {
      registration: { label, clientId, subjectHash: createHash("sha256").update(token.subject, "utf8").digest("hex") },
      ownerUserId: attempt.ownerUserId, domainWorkspaceId: attempt.domainWorkspaceId,
    });
    if (!planUsageGranted && tokens.refreshToken !== null) {
      // The renewable session is not kept, so it is revoked (best effort; never blocks the outcome).
      await revokeRefreshToken(fetch, { clientId, refreshToken: tokens.refreshToken }).catch(() => "unconfirmed");
    }
    trace.stage = "complete";
    trace.failure = planUsageGranted ? null : "plan_usage_missing";
    return freeze({ outcome: planUsageGranted ? "connected" as const : "plan_usage_missing" as const, returnOrigin });
  }

  async function status(): Promise<ChatGPTConnectionStatus> {
    const base = { accessMode: "subscription_session" as const };
    let registrations: StoredRegistrations;
    let connecting = false;
    try {
      registrations = await store.readRegistrations();
      connecting = await store.hasLiveAttempt(now());
    } catch {
      return freeze({ ...base, state: "temporarily_unavailable" as const, accountLabel: null, planUsageGranted: false, selectedModel: null, availableModels: [], modelsCheckedAt: null });
    }
    const active = activeRegistration(registrations);
    if (!active) {
      return freeze({ ...base, state: connecting ? "connecting" as const : "not_connected" as const, accountLabel: null, planUsageGranted: false, selectedModel: null, availableModels: [], modelsCheckedAt: null });
    }
    const state: ChatGPTConnectionState = active.status === "active" ? "plan_usage_enabled"
      : active.status === "plan_usage_missing" ? "plan_usage_missing"
        : active.status === "signed_out" ? (connecting ? "connecting" : "signed_out")
          : "reauthorization_required";
    return freeze({
      ...base, state, accountLabel: active.email, planUsageGranted: active.grantedScopes.includes(chatgptOAuth.planScope) && active.status === "active",
      selectedModel: active.selectedModel, availableModels: active.availableModels, modelsCheckedAt: active.modelsCheckedAt,
    });
  }

  async function markReauthorization(label: string): Promise<void> {
    const registrations = await store.readRegistrations();
    const current = registrations.registrations.find((item) => item.label === label);
    if (!current) return;
    // Refresh errors that require a fresh OAuth: the token material is cleared (official guidance).
    await store.writeRegistrations(replace(registrations, freeze({
      ...current, accessToken: null, refreshToken: null, accessTokenExpiresAt: null, earliestRefreshAt: null, status: "reauthorization_required" as const, savedAt: now().toISOString(),
    })));
  }

  // A usable access token for the active registration, refreshed (serialized, rotating) when needed.
  // Internal to server-side composition; never returned to presentation code.
  // Both compatibility access and scoped dispatch use this ONE refresh implementation, under the
  // existing refresh.lock. Never acquire it recursively or add a second OAuth/credential subsystem.
  async function resolveAccessTokenLocked(expected?: ChatGPTSubscriptionAccessBinding): Promise<Readonly<{ ok: true; token: string; label: string }> | Readonly<{ ok: false; reason: "not_connected" | "plan_usage_missing" | "reauthorization_required" | "temporarily_unavailable" }>> {
        if (expected) {
          const facts = await store.readSubscriptionFacts();
          if (!facts || facts.status !== "active" || !facts.planUsageGranted
            || facts.registration.label !== expected.registration.label || facts.registration.clientId !== expected.registration.clientId
            || facts.registration.subjectHash !== expected.registration.subjectHash || facts.ownerUserId !== expected.ownerUserId
            || facts.domainWorkspaceId !== expected.domainWorkspaceId || facts.selectedModel !== expected.modelId
            || !(await verifyOwner(expected.ownerUserId, expected.domainWorkspaceId))) return { ok: false as const, reason: "not_connected" as const };
        }
        // Re-read under the lock: another request may have refreshed already.
        const registrations = await store.readRegistrations();
        const active = activeRegistration(registrations);
        if (!active || active.status === "signed_out") return { ok: false as const, reason: "not_connected" as const };
        if (expected && (active.label !== expected.registration.label || active.clientId !== expected.registration.clientId
          || createHash("sha256").update(active.subject, "utf8").digest("hex") !== expected.registration.subjectHash
          || active.selectedModel !== expected.modelId || !active.availableModels.some((model) => model.slug === expected.modelId))) {
          return { ok: false as const, reason: "not_connected" as const };
        }
        if (active.status === "plan_usage_missing" || !active.grantedScopes.includes(chatgptOAuth.planScope)) return { ok: false as const, reason: "plan_usage_missing" as const };
        if (active.status !== "active" || !active.accessToken || !active.accessTokenExpiresAt) return { ok: false as const, reason: "reauthorization_required" as const };
        const remaining = Date.parse(active.accessTokenExpiresAt) - now().getTime();
        if (remaining > 60_000) return acceptedAccess(active.accessToken, active.label, active.accessTokenExpiresAt);
        if (!active.refreshToken) {
          await markReauthorization(active.label);
          return { ok: false as const, reason: "reauthorization_required" as const };
        }
        if (active.earliestRefreshAt && Date.parse(active.earliestRefreshAt) > now().getTime()) {
          return remaining > 0 ? acceptedAccess(active.accessToken, active.label, active.accessTokenExpiresAt) : { ok: false as const, reason: "temporarily_unavailable" as const };
        }
        const refreshed = await refreshAccessToken(fetch, { clientId: active.clientId, refreshToken: active.refreshToken });
        if (!refreshed.ok) {
          if (refreshed.failure === "temporarily_unavailable") return { ok: false as const, reason: "temporarily_unavailable" as const };
          await markReauthorization(active.label);
          return { ok: false as const, reason: "reauthorization_required" as const };
        }
        const tokens = refreshed.tokens;
        // A refreshed grant that lost the plan scope cannot be used for plan inference.
        if (!tokens.grantedScopes.includes(chatgptOAuth.planScope)) {
          await markReauthorization(active.label);
          return { ok: false as const, reason: "reauthorization_required" as const };
        }
        if (tokens.idToken !== null) {
          const jwks = await fetchJwks(fetch);
          const validated = jwks ? await validateIdToken({ idToken: tokens.idToken, jwks, clientId: active.clientId, nonce: null, now: now() }) : null;
          if (!validated || !validated.ok || validated.token.subject !== active.subject) return { ok: false as const, reason: "temporarily_unavailable" as const };
        }
        // Access token AND rotating refresh token replaced in ONE atomic write; the old refresh token is
        // never used again.
        const refreshedExpiresAt = expiresAt(now(), tokens.expiresInSeconds);
        await store.writeRegistrations(replace(registrations, freeze({
          ...active,
          accessToken: tokens.accessToken,
          // Guaranteed non-null and new by refreshAccessToken: the rotated token replaces the old one.
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken ?? active.idToken,
          accessTokenExpiresAt: refreshedExpiresAt,
          earliestRefreshAt: tokens.earliestRefreshAt,
          grantedScopes: tokens.grantedScopes,
          savedAt: now().toISOString(),
        })));
        return acceptedAccess(tokens.accessToken, active.label, refreshedExpiresAt);
  }
  async function resolveAccessToken(expected?: ChatGPTSubscriptionAccessBinding) {
    try {
      return await store.withRefreshLock(() => resolveAccessTokenLocked(expected));
    } catch {
      return { ok: false as const, reason: "temporarily_unavailable" as const };
    }
  }

  async function accessToken() { return resolveAccessToken(); }

  // No token-file access: safe for planning/routing only. Its facts are configuration, not admission,
  // preflight, approval or start authority. The mandatory late exact check is above, under the lock.
  async function readSubscriptionFacts(): Promise<ChatGPTSubscriptionFacts | null> {
    try { return await store.readSubscriptionFacts(); } catch { return null; }
  }

  async function subscriptionAccessToken(expected: ChatGPTSubscriptionAccessBinding) {
    // A missing binding must not accidentally select accessToken's legacy unscoped compatibility path.
    const binding = snapshotSubscriptionBinding(expected);
    if (!binding) return { ok: false as const, reason: "not_connected" as const };
    const result = await resolveAccessToken(binding);
    if (!result.ok) return result;
    return subscriptionReceipt(result, binding);
  }

  function subscriptionReceipt(result: Readonly<{ token: string }>, binding: ChatGPTSubscriptionAccessBinding, dispatchScope?: { active: boolean }) {
    const expiration = accessExpiries.get(result);
    if (expiration === undefined || !Number.isFinite(expiration) || expiration <= now().getTime()) return { ok: false as const, reason: "temporarily_unavailable" as const };
    const receipt: ChatGPTSubscriptionAccess = Object.freeze({ ok: true, kind: "chatgpt_subscription_access" });
    subscriptionAccess.set(receipt, {
      binding,
      token: result.token, expiresAt: Math.min(expiration, now().getTime() + 60_000), now, dispatchScope,
    });
    return receipt;
  }

  async function withSubscriptionAccess<T>(expected: ChatGPTSubscriptionAccessBinding,
    start: (access: ChatGPTSubscriptionAccess) => Promise<Readonly<{ pending: Promise<T> }>>) {
    const binding = snapshotSubscriptionBinding(expected);
    if (!binding || typeof start !== "function" || types.isProxy(start)) return { ok: false as const, reason: "not_connected" as const };
    try {
      return await store.withRefreshLock(async () => {
        const result = await resolveAccessTokenLocked(binding);
        if (!result.ok) return result;
        const dispatchScope = { active: true };
        const access = subscriptionReceipt(result, binding, dispatchScope);
        if (!access.ok) return access;
        try {
          // Await ONLY the trusted callback's local/DB fence. It must synchronously initiate execute()
          // and return its pending Promise as DATA, not await the provider stream under this lock.
          const wrapped = await start(access);
          const descriptor = wrapped && typeof wrapped === "object" && !types.isProxy(wrapped) ? Object.getOwnPropertyDescriptor(wrapped, "pending") : undefined;
          if (!descriptor || !("value" in descriptor) || !types.isPromise(descriptor.value)) return { ok: false as const, reason: "temporarily_unavailable" as const };
          return Object.freeze({ ok: true as const, pending: descriptor.value as Promise<T> });
        } finally {
          dispatchScope.active = false;
          subscriptionAccess.delete(access);
        }
      });
    } catch { return { ok: false as const, reason: "temporarily_unavailable" as const }; }
  }

  async function refreshModels(): Promise<"updated" | "not_connected" | "plan_usage_missing" | "reauthorization_required" | "temporarily_unavailable"> {
    const access = await accessToken();
    if (!access.ok) return access.reason;
    const listed = await listChatGPTModels(fetch, access.token);
    if (!listed.ok) return listed.failure === "reauthorization_required" ? "reauthorization_required" : "temporarily_unavailable";
    try {
      return await store.withRefreshLock(async () => {
        const registrations = await store.readRegistrations();
        const active = activeRegistration(registrations);
        if (!active || active.label !== access.label || active.status !== "active") return "temporarily_unavailable" as const;
        // A selected model that is no longer listed is cleared: the planner stays unavailable until a new choice.
        const selectedModel = active.selectedModel && listed.models.some((model) => model.slug === active.selectedModel) ? active.selectedModel : null;
        await store.writeRegistrations(replace(registrations, freeze({ ...active, availableModels: listed.models, modelsCheckedAt: now().toISOString(), selectedModel })));
        return "updated" as const;
      });
    } catch {
      return "temporarily_unavailable";
    }
  }

  async function selectModel(slug: unknown): Promise<"selected" | "invalid" | "not_connected" | "temporarily_unavailable"> {
    try {
      return await store.withRefreshLock(async () => {
        const registrations = await store.readRegistrations();
        const active = activeRegistration(registrations);
        if (!active || active.status !== "active") return "not_connected" as const;
        if (typeof slug !== "string" || !active.availableModels.some((model) => model.slug === slug)) return "invalid" as const;
        await store.writeRegistrations(replace(registrations, freeze({ ...active, selectedModel: slug })));
        return "selected" as const;
      });
    } catch {
      return "temporarily_unavailable";
    }
  }

  // Official revocation, then local token material cleared either way. PAC authentication and all PAC
  // product / runtime state are untouched.
  async function disconnect(): Promise<Readonly<{ status: "disconnected"; remoteRevocation: "confirmed" | "unconfirmed" | "not_needed" }> | Readonly<{ status: "unavailable" }>> {
    try {
      return await store.withRefreshLock(async () => {
        const registrations = await store.readRegistrations();
        const active = activeRegistration(registrations);
        if (!active || active.status === "signed_out") return freeze({ status: "disconnected" as const, remoteRevocation: "not_needed" as const });
        const remoteRevocation = active.refreshToken ? await revokeRefreshToken(fetch, { clientId: active.clientId, refreshToken: active.refreshToken }) : "not_needed" as const;
        // Sign-out clears ALL token material (access, refresh, ID token, expiries, granted session scopes)
        // and keeps the registration mapping (issued client id, validated subject, label / email, host id),
        // so the next sign-in reuses the issued registration instead of registering dynamically again.
        await store.writeRegistrations(replace(registrations, freeze({
          ...active, idToken: null, accessToken: null, refreshToken: null, accessTokenExpiresAt: null, earliestRefreshAt: null,
          grantedScopes: freeze([]) as readonly string[], status: "signed_out" as const, savedAt: now().toISOString(),
        })));
        return freeze({ status: "disconnected" as const, remoteRevocation });
      });
    } catch {
      return freeze({ status: "unavailable" as const });
    }
  }

  return Object.freeze({ redirectUri, start, complete, status, accessToken, readSubscriptionFacts, subscriptionAccessToken, withSubscriptionAccess, refreshModels, selectModel, disconnect });
}

export type ChatGPTConnection = ReturnType<typeof createChatGPTConnection>;
