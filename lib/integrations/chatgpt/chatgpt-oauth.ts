// AI-039.2 Sign in with ChatGPT — OAuth contract for ChatGPT plan access (server-side only).
//
// Official sources (verified 2026-10-06):
//   https://developers.openai.com/siwc/token-sharing-open-source/sign-in
//   https://developers.openai.com/siwc/token-sharing-open-source/token-reference
//   https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
//   https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
//   https://auth.openai.com/.well-known/openid-configuration
//
// Public-client Authorization Code + PKCE (S256) with dynamic client registration:
// * the first registration uses client_id=dynamic_agent_client (+ agent_name_hint, ext_agent_host_id);
//   the ISSUED client_id arrives in the callback and replaces it for the token exchange and every later
//   authorization, refresh and revocation;
// * loopback redirect on 127.0.0.1 (never localhost) with a fixed path; only the port may vary;
// * fresh state, nonce and PKCE verifier per attempt; no client secret;
// * the ID token is verified cryptographically (OpenAI JWKS, RS256, issuer, audience = issued client
//   id, expiry, nonce) with `jose`; a valid ID token alone does NOT authorize plan usage — only the
//   token response's granted scope `chatgpt.tokens.use.direct` does.
//
// This module never logs, never persists and never returns a token to presentation code. Every network
// call goes through an injected `fetch` with a timeout, and every response is size-bounded and parsed
// strictly. Nothing here performs inference.
import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";

export const chatgptOAuth = Object.freeze({
  issuer: "https://auth.openai.com",
  authorizationEndpoint: "https://auth.openai.com/api/accounts/authorize",
  tokenEndpoint: "https://auth.openai.com/api/accounts/oauth/token",
  jwksUri: "https://auth.openai.com/.well-known/jwks.json",
  revocationEndpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
  resource: "https://api.openai.com/v1",
  modelsEndpoint: "https://api.openai.com/v1/models",
  dynamicClientId: "dynamic_agent_client",
  agentNameHint: "Private AI Cloud",
  scopes: Object.freeze(["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"] as const),
  planScope: "chatgpt.tokens.use.direct",
  callbackPath: "/integrations/chatgpt/callback",
  attemptTtlMs: 10 * 60 * 1_000,
  requestTimeoutMs: 15_000,
  // Revocation: up to 3 attempts, waiting 500 ms then 1 000 ms between them (network failure / 5xx only).
  revocationAttempts: 3,
  revocationBackoffMs: Object.freeze([500, 1_000]),
  maxResponseBytes: 256 * 1024,
  manageUsageUrl: "https://chatgpt.com/settings/usage",
});

const base64url = (bytes: Buffer) => bytes.toString("base64url");
export const issuedClientIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const callbackValuePattern = /^[\x21-\x7e]{1,2048}$/u;
const scopeTokenPattern = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/u;

export type OAuthAttemptSecrets = Readonly<{ state: string; nonce: string; codeVerifier: string; codeChallenge: string }>;

// 256 bits of CSPRNG entropy for each value; the challenge is base64url(SHA-256(verifier)).
export function newOAuthAttemptSecrets(): OAuthAttemptSecrets {
  const codeVerifier = base64url(randomBytes(32));
  return Object.freeze({
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
    codeVerifier,
    codeChallenge: base64url(createHash("sha256").update(codeVerifier, "ascii").digest()),
  });
}

// The pending attempt is keyed by a hash of the state, so the raw state is never stored.
export function stateKey(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function redirectUriFor(port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid callback port.");
  return `http://127.0.0.1:${port}${chatgptOAuth.callbackPath}`;
}

// Next.js may build Request.url from its configured server hostname (localhost), while preserving
// the incoming Host header. Only the exact configured HTTP loopback Host/path authorizes this
// boundary; forwarded headers never do. Preserve the untrusted query verbatim for parseCallback.
export function canonicalLoopbackCallbackUrl(request: Request, port: number): URL | null {
  try {
    const redirectUri = redirectUriFor(port);
    if (request.method !== "GET" || request.headers.get("host") !== `127.0.0.1:${port}` || request.url.length > 16_384) return null;
    const visible = new URL(request.url);
    if (visible.protocol !== "http:" || visible.pathname !== chatgptOAuth.callbackPath
      || visible.username !== "" || visible.password !== "" || visible.hash !== "") return null;
    const canonical = new URL(redirectUri);
    canonical.search = visible.search;
    return canonical;
  } catch {
    return null;
  }
}

// A UUID-based host identity (`urn:uuid:<uuid-v4>`): stable per PAC host, not a secret, not authentication.
export const hostIdPattern = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function authorizationUrl(input: Readonly<{
  clientId: string | null; // null = first registration (dynamic_agent_client)
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  idTokenHint?: string | null;
}>): string {
  if (!hostIdPattern.test(input.hostId)) throw new Error("Invalid host id.");
  if (input.clientId !== null && (!issuedClientIdPattern.test(input.clientId) || input.clientId === chatgptOAuth.dynamicClientId)) throw new Error("Invalid issued client id.");
  const url = new URL(chatgptOAuth.authorizationEndpoint);
  const params: [string, string][] = [
    ["client_id", input.clientId ?? chatgptOAuth.dynamicClientId],
    // The agent name hint belongs to the initial dynamic registration only.
    ...(input.clientId === null ? [["agent_name_hint", chatgptOAuth.agentNameHint] as [string, string]] : []),
    ["ext_agent_host_id", input.hostId],
    // Documented authorization hint for a returning registration only.
    ...(input.clientId !== null && input.idTokenHint ? [["id_token_hint", input.idTokenHint] as [string, string]] : []),
    ["response_type", "code"],
    ["redirect_uri", input.redirectUri],
    ["scope", chatgptOAuth.scopes.join(" ")],
    ["resource", chatgptOAuth.resource],
    ["state", input.state],
    ["nonce", input.nonce],
    ["code_challenge_method", "S256"],
    ["code_challenge", input.codeChallenge],
  ];
  for (const [name, value] of params) url.searchParams.set(name, value);
  return url.toString();
}

export type ParsedCallback =
  | Readonly<{ kind: "code"; code: string; state: string; clientId: string | null }>
  | Readonly<{ kind: "error"; state: string | null }>
  | Readonly<{ kind: "invalid" }>;

// Untrusted callback query → bounded facts. Any parameter appearing twice is invalid.
export function parseCallback(url: URL): ParsedCallback {
  const single = (name: string): string | null | undefined => {
    const values = url.searchParams.getAll(name);
    if (values.length > 1) return undefined;
    return values.length === 0 ? null : values[0];
  };
  const state = single("state");
  const code = single("code");
  const error = single("error");
  const clientId = single("client_id");
  if (state === undefined || code === undefined || error === undefined || clientId === undefined) return { kind: "invalid" };
  if (state !== null && !callbackValuePattern.test(state)) return { kind: "invalid" };
  if (error !== null) return { kind: "error", state };
  if (state === null || code === null || !callbackValuePattern.test(code)) return { kind: "invalid" };
  if (clientId !== null && !issuedClientIdPattern.test(clientId)) return { kind: "invalid" };
  return { kind: "code", code, state, clientId };
}

export type FetchLike = (input: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }>) => Promise<Response>;

export type TokenSet = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: "Bearer";
  expiresInSeconds: number;
  grantedScopes: readonly string[];
  earliestRefreshAt: string | null;
}>;

export type TokenEndpointFailure = "reauthorization_required" | "invalid_client" | "temporarily_unavailable" | "invalid_response";

const diagnosticOAuthErrors = ["invalid_grant", "invalid_client", "invalid_request", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "access_denied", "server_error", "temporarily_unavailable", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"] as const;
type DiagnosticOAuthError = typeof diagnosticOAuthErrors[number];
type SchemaValueType = "missing" | "null" | "array" | "object" | "string" | "number" | "boolean";
export type TokenResponseSchema = Readonly<{
  access_token_present: boolean; refresh_token_present: boolean; id_token_present: boolean;
  token_type_present: boolean; expires_in_type: SchemaValueType; scope_present: boolean;
  granted_scopes: readonly string[]; earliest_refresh_at_type: SchemaValueType;
}>;
export type TokenExchangeDiagnostic = Readonly<{
  resultClass: "network_error" | "http_error" | "invalid_json" | "invalid_token_response" | "success";
  httpStatus: number | null;
  // Header VALUE is deliberately never retained: it could itself contain secret / identity material.
  requestIdPresent: boolean;
  oauthError: DiagnosticOAuthError | null;
  schema: TokenResponseSchema | null;
}>;

function tokenResponseSchema(body: unknown): TokenResponseSchema {
  const value = plainRecord(body) ? body : {};
  const present = (name: string) => value[name] !== undefined && value[name] !== null;
  const valueType = (item: unknown): SchemaValueType => item === undefined ? "missing" : item === null ? "null"
    : Array.isArray(item) ? "array" : typeof item === "string" ? "string" : typeof item === "number" ? "number"
      : typeof item === "boolean" ? "boolean" : "object";
  // Only documented scope names can cross the log boundary. Unknown scope strings are not safe text.
  const scopes = typeof value.scope === "string" && value.scope.length <= 2048 ? new Set(value.scope.split(" ")) : new Set<string>();
  return Object.freeze({
    access_token_present: present("access_token"), refresh_token_present: present("refresh_token"), id_token_present: present("id_token"),
    token_type_present: present("token_type"), expires_in_type: valueType(value.expires_in), scope_present: present("scope"),
    granted_scopes: Object.freeze(chatgptOAuth.scopes.filter((scope) => scopes.has(scope))), earliest_refresh_at_type: valueType(value.earliest_refresh_at),
  });
}

const reauthorizationErrors = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > chatgptOAuth.maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Response too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const plainRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype;
const boundedToken = (input: unknown, max = 16_384): input is string => typeof input === "string" && input.length >= 1 && input.length <= max && callbackValuePattern.test(input.slice(0, 2048));

export function parseTokenResponse(input: unknown): TokenSet | null {
  if (!plainRecord(input)) return null;
  const { access_token: accessToken, refresh_token: refreshToken, id_token: idToken, token_type: tokenType, expires_in: expiresIn, scope, earliest_refresh_at: earliestRefreshAt } = input;
  if (!boundedToken(accessToken) || (refreshToken !== undefined && refreshToken !== null && !boundedToken(refreshToken))
    || (idToken !== undefined && idToken !== null && !boundedToken(idToken))) return null;
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") return null;
  if (typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 86_400) return null;
  if (typeof scope !== "string" || scope.length > 2048) return null;
  const grantedScopes = scope.split(" ").filter((item) => item.length > 0);
  if (!grantedScopes.every((item) => scopeTokenPattern.test(item))) return null;
  let earliest: string | null = null;
  if (earliestRefreshAt !== undefined && earliestRefreshAt !== null) {
    const millis = typeof earliestRefreshAt === "number" ? earliestRefreshAt * 1_000 : typeof earliestRefreshAt === "string" ? Date.parse(earliestRefreshAt) : Number.NaN;
    if (!Number.isFinite(millis)) return null;
    earliest = new Date(millis).toISOString();
  }
  return Object.freeze({
    accessToken, refreshToken: (refreshToken as string | undefined) ?? null, idToken: (idToken as string | undefined) ?? null,
    tokenType: "Bearer" as const, expiresInSeconds: expiresIn, grantedScopes: Object.freeze([...new Set(grantedScopes)]), earliestRefreshAt: earliest,
  });
}

async function postForm(fetch: FetchLike, url: string, form: Record<string, string>): Promise<Readonly<{ status: number; body: unknown; invalidJson: boolean; requestIdPresent: boolean }> | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(chatgptOAuth.requestTimeoutMs),
    });
    let body: unknown = null;
    let invalidJson = false;
    try {
      body = await boundedJson(response);
    } catch {
      body = null;
      invalidJson = true;
    }
    return { status: response.status, body, invalidJson, requestIdPresent: response.headers.has("x-request-id") };
  } catch {
    return null; // network failure / timeout: no response body is ever surfaced
  }
}

function classifyTokenError(result: Readonly<{ status: number; body: unknown }> | null): TokenEndpointFailure {
  if (!result || result.status >= 500) return "temporarily_unavailable";
  const error = plainRecord(result.body) && typeof result.body.error === "string" ? result.body.error : null;
  if (error === "invalid_client") return "invalid_client";
  if (error !== null && reauthorizationErrors.has(error)) return "reauthorization_required";
  return result.status === 400 || result.status === 401 ? "reauthorization_required" : "invalid_response";
}

export async function exchangeAuthorizationCode(fetch: FetchLike, input: Readonly<{ clientId: string; code: string; codeVerifier: string; redirectUri: string }>):
Promise<Readonly<{ ok: true; tokens: TokenSet; diagnostic: TokenExchangeDiagnostic }> | Readonly<{ ok: false; failure: TokenEndpointFailure; diagnostic: TokenExchangeDiagnostic }>> {
  const result = await postForm(fetch, chatgptOAuth.tokenEndpoint, {
    grant_type: "authorization_code", client_id: input.clientId, code: input.code, code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri, resource: chatgptOAuth.resource,
  });
  const tokens = result?.status === 200 && !result.invalidJson ? parseTokenResponse(result.body) : null;
  const rawError = result && plainRecord(result.body) ? result.body.error : null;
  const oauthError = diagnosticOAuthErrors.find((code) => code === rawError) ?? null;
  const diagnostic: TokenExchangeDiagnostic = Object.freeze({
    resultClass: !result ? "network_error" : result.status !== 200 ? "http_error" : result.invalidJson ? "invalid_json" : !tokens ? "invalid_token_response" : "success",
    httpStatus: result?.status ?? null, requestIdPresent: result?.requestIdPresent ?? false, oauthError,
    schema: result?.status === 200 && !result.invalidJson && !tokens ? tokenResponseSchema(result.body) : null,
  });
  if (!result || result.status !== 200) return { ok: false, failure: classifyTokenError(result), diagnostic };
  return tokens ? { ok: true, tokens, diagnostic } : { ok: false, failure: "invalid_response", diagnostic };
}

// Refresh: the issued client id, the saved (rotating) refresh token, the resource; scope omitted to
// retain the grant. Never retried here: the caller serializes refreshes per registration.
// Refresh tokens rotate: a 200 is valid ONLY with a new replacement refresh token. Without one the
// response is invalid (the old token may already be invalidated by the rotation and is never reused).
export async function refreshAccessToken(fetch: FetchLike, input: Readonly<{ clientId: string; refreshToken: string }>):
Promise<Readonly<{ ok: true; tokens: TokenSet }> | Readonly<{ ok: false; failure: TokenEndpointFailure }>> {
  const result = await postForm(fetch, chatgptOAuth.tokenEndpoint, {
    grant_type: "refresh_token", client_id: input.clientId, refresh_token: input.refreshToken, resource: chatgptOAuth.resource,
  });
  if (!result || result.status !== 200) return { ok: false, failure: classifyTokenError(result) };
  const tokens = parseTokenResponse(result.body);
  return tokens && tokens.refreshToken !== null && tokens.refreshToken !== input.refreshToken ? { ok: true, tokens } : { ok: false, failure: "invalid_response" };
}

// Revocation of the renewable session: an empty 200 (also for already-invalid tokens) is confirmation.
// Network failure / 5xx: bounded retry with backoff while the refresh token is available.
export async function revokeRefreshToken(fetch: FetchLike, input: Readonly<{ clientId: string; refreshToken: string }>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<"confirmed" | "unconfirmed"> {
  for (let attempt = 0; attempt < chatgptOAuth.revocationAttempts; attempt += 1) {
    const result = await postForm(fetch, chatgptOAuth.revocationEndpoint, { token: input.refreshToken, token_type_hint: "refresh_token", client_id: input.clientId });
    if (result && result.status === 200) return "confirmed";
    if (result && result.status < 500) return "unconfirmed";
    if (attempt < chatgptOAuth.revocationAttempts - 1) await sleep(chatgptOAuth.revocationBackoffMs[attempt]);
  }
  return "unconfirmed";
}

export async function fetchJwks(fetch: FetchLike): Promise<Readonly<{ keys: unknown[] }> | null> {
  try {
    const response = await fetch(chatgptOAuth.jwksUri, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(chatgptOAuth.requestTimeoutMs) });
    if (response.status !== 200) return null;
    const body = await boundedJson(response);
    if (!plainRecord(body) || !Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 32) return null;
    return { keys: body.keys };
  } catch {
    return null;
  }
}

export type ValidatedIdToken = Readonly<{ subject: string; email: string | null; expiresAt: string }>;
export type IdTokenFailure = "invalid_signature" | "invalid_claims" | "nonce_mismatch" | "expired";

// Cryptographic ID-token validation: RS256 signature against the OpenAI JWKS, issuer, audience =
// the issued client id, expiry (60 s clock tolerance) and — for an authorization response — the nonce.
export async function validateIdToken(input: Readonly<{ idToken: string; jwks: Readonly<{ keys: unknown[] }>; clientId: string; nonce: string | null; now: Date }>):
Promise<Readonly<{ ok: true; token: ValidatedIdToken }> | Readonly<{ ok: false; failure: IdTokenFailure }>> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(input.idToken, createLocalJWKSet(input.jwks as never), {
      issuer: chatgptOAuth.issuer,
      audience: input.clientId,
      algorithms: ["RS256"],
      clockTolerance: 60,
      currentDate: input.now,
      requiredClaims: ["sub", "exp", "iat"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") return { ok: false, failure: "expired" };
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") return { ok: false, failure: "invalid_claims" };
    return { ok: false, failure: "invalid_signature" };
  }
  if (input.nonce !== null && payload.nonce !== input.nonce) return { ok: false, failure: "nonce_mismatch" };
  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 256) return { ok: false, failure: "invalid_claims" };
  const email = typeof payload.email === "string" && payload.email.length <= 320 && /^[^\s@]+@[^\s@]+$/u.test(payload.email) ? payload.email : null;
  return { ok: true, token: Object.freeze({ subject, email, expiresAt: new Date((payload.exp as number) * 1_000).toISOString() }) };
}

export type ChatGPTModel = Readonly<{ slug: string; displayName: string }>;
const modelSlugPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

// Account-specific model discovery. A listed model is NOT proof of inference entitlement.
export async function listChatGPTModels(fetch: FetchLike, accessToken: string):
Promise<Readonly<{ ok: true; models: readonly ChatGPTModel[] }> | Readonly<{ ok: false; failure: "reauthorization_required" | "temporarily_unavailable" | "invalid_response" }>> {
  let response: Response;
  try {
    response = await fetch(chatgptOAuth.modelsEndpoint, {
      method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(chatgptOAuth.requestTimeoutMs),
    });
  } catch {
    return { ok: false, failure: "temporarily_unavailable" };
  }
  if (response.status === 401) return { ok: false, failure: "reauthorization_required" };
  if (response.status !== 200) return { ok: false, failure: response.status >= 500 || response.status === 429 ? "temporarily_unavailable" : "invalid_response" };
  let body: unknown;
  try {
    body = await boundedJson(response);
  } catch {
    return { ok: false, failure: "invalid_response" };
  }
  const items = plainRecord(body) ? (Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : null) : null;
  if (!items || items.length > 512) return { ok: false, failure: "invalid_response" };
  const models: ChatGPTModel[] = [];
  for (const item of items) {
    if (!plainRecord(item) || item.visibility !== "list" || typeof item.slug !== "string" || !modelSlugPattern.test(item.slug)) continue;
    const displayName = typeof item.display_name === "string" && item.display_name.length > 0 && item.display_name.length <= 128 ? item.display_name : item.slug;
    if (!models.some((model) => model.slug === item.slug)) models.push(Object.freeze({ slug: item.slug, displayName }));
  }
  return { ok: true, models: Object.freeze(models.slice(0, 64)) };
}
