/* eslint-disable @typescript-eslint/no-explicit-any -- fake transports and adversarial fixtures cross untyped boundaries */
// AI-039.2 Phase A: Sign in with ChatGPT connection — OAuth contract, local credential store, refresh,
// revocation, model discovery, Owner binding and leak guards. Deterministic: a fake OpenAI transport
// with locally generated RS256 keys (jose); no network, no real OAuth, NO inference.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import ts from "typescript";

const oauth = (await import(new URL("../lib/integrations/chatgpt/chatgpt-oauth.ts", import.meta.url).href)) as typeof import("../lib/integrations/chatgpt/chatgpt-oauth");
const storeModule = (await import(new URL("../lib/integrations/chatgpt/chatgpt-credential-store.ts", import.meta.url).href)) as typeof import("../lib/integrations/chatgpt/chatgpt-credential-store");
const connectionModule = (await import(new URL("../lib/integrations/chatgpt/chatgpt-connection.ts", import.meta.url).href)) as typeof import("../lib/integrations/chatgpt/chatgpt-connection");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'])\/\/[^\n]*/gu, "$1");

const OWNER = "00000000-0000-4000-8000-000000009001";
const WORKSPACE = "workspace-primary";
const PORT = 3000;
const ISSUED = "oaiapp_test_client_0001";
const SECRET = (kind: string, n = 1) => `FAKE_CHATGPT_${kind}_SECRET_DO_NOT_LEAK_${n}`;

const keys = await generateKeyPair("RS256", { extractable: true });
const otherKeys = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

async function idToken(claims: Record<string, unknown> = {}, options: Readonly<{ key?: any; issuer?: string; audience?: string; expiresIn?: string | number }> = {}) {
  const jwt = new SignJWT({ email: "owner@example.test", ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.issuer ?? "https://auth.openai.com").setAudience(options.audience ?? ISSUED).setSubject((claims.sub as string) ?? "user-subject-1")
    .setIssuedAt();
  jwt.setExpirationTime(options.expiresIn ?? "1h");
  return jwt.sign(options.key ?? keys.privateKey);
}

type Route = (body: URLSearchParams | null, init: any) => { status: number; json?: unknown; raw?: string; headers?: Record<string, string> } | "network";

function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; method: string; form: Record<string, string> | null; authorization: string | null }[] = [];
  const queues: Record<string, Route[]> = Object.fromEntries(Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]));
  const fetch = async (url: string, init: any) => {
    const form = init.body ? new URLSearchParams(init.body) : null;
    calls.push({ url, method: init.method, form: form ? Object.fromEntries(form) : null, authorization: init.headers?.Authorization ?? null });
    const queue = queues[url];
    if (!queue || queue.length === 0) throw new Error(`fake fetch: unexpected ${url}`);
    const route = queue.length > 1 ? queue.shift()! : queue[0];
    const result = route(form, init);
    if (result === "network") throw new TypeError("fetch failed");
    return new Response(result.raw ?? (result.json === undefined ? null : JSON.stringify(result.json)), { status: result.status, headers: { "Content-Type": "application/json", ...result.headers } });
  };
  return { fetch, calls };
}

const jwksRoute: Route = () => ({ status: 200, json: { keys: [publicJwk] } });
const tokenResponse = async (overrides: Record<string, unknown> = {}, claims: Record<string, unknown> = {}, idOptions = {}) => ({
  access_token: SECRET("ACCESS"), refresh_token: SECRET("REFRESH"), id_token: await idToken(claims, idOptions), token_type: "Bearer", expires_in: 3600,
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", ...overrides,
});

async function setup(options: Readonly<{ ownerOk?: boolean; routes?: Record<string, Route | Route[]>; now?: () => Date }> = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-test-"));
  const credentials = join(directory, "store");
  const store = storeModule.createChatGPTCredentialStore({ directory: credentials });
  const transport = fakeFetch(options.routes ?? {});
  const ownerChecks: unknown[] = [];
  let clock = options.now ?? (() => new Date("2026-10-06T12:00:00.000Z"));
  const dependencies = {
    store, fetch: transport.fetch as any, callbackPort: PORT,
    ownerAuthority: { async verify(input: unknown) { ownerChecks.push(input); return options.ownerOk ?? true; } },
    now: () => clock(),
  };
  const connection = connectionModule.createChatGPTConnection(dependencies);
  return { directory: credentials, store, transport, connection, dependencies, ownerChecks, setClock: (next: () => Date) => { clock = next; } };
}

// Exercise the REAL server composition/logging with fake infrastructure. No global console patch,
// real session, database or network. Secrets stay in this harness and never in TAP diagnostics.
function diagnosticServer(context: Awaited<ReturnType<typeof setup>>, overrides: Record<string, unknown> = {}, options: Readonly<{ failComposition?: boolean; failLogger?: boolean }> = {}) {
  const logs: unknown[][] = [];
  const serverModule = { exports: {} as any };
  const compiled = ts.transpileModule(source("lib/composition/chatgpt-integration.server.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(compiled, {
    exports: serverModule.exports, process: { env: {} }, Date,
    console: { info: (...args: unknown[]) => { logs.push(args); if (options.failLogger) throw new Error(SECRET("LOG_ERROR")); } },
    require(name: string) {
      if (name === "server-only") return {};
      if (name.includes("chatgpt-connection")) return {
        createChatGPTConnection: (deps: any) => connectionModule.createChatGPTConnection({
          ...context.dependencies, ...overrides, onCallbackDiagnostic: deps.onCallbackDiagnostic,
        } as any),
      };
      if (name.includes("chatgpt-credential-store")) return { createChatGPTCredentialStore: () => context.store, defaultCredentialDirectory: () => context.directory };
      if (name.includes("chatgpt-oauth")) return oauth;
      if (name.includes("db/postgres")) return { createWorkflowRuntimePostgresDatabase: () => {
        if (options.failComposition) throw new Error(SECRET("DATABASE_ERROR"));
        return { close: async () => undefined };
      } };
      if (name.includes("auth/") || name.includes("chatgpt-owner-authority")) return {};
      throw new Error("Unexpected diagnostic dependency.");
    },
  });
  return { logs, complete: serverModule.exports.completeChatGPTCallback, record: serverModule.exports.recordChatGPTCallbackOutcome };
}

const a4Cases = [
  ["invalid_grant", "token_exchange", "invalid_grant", "denied"],
  ["invalid_client", "token_exchange", "invalid_client", "denied"],
  ["server-error", "token_exchange", "http_error", "temporarily_unavailable"],
  ["network", "token_exchange", "network_error", "temporarily_unavailable"],
  ["invalid-json", "token_response", "invalid_json", "denied"],
  ["invalid-schema", "token_response", "invalid_token_response", "denied"],
  ["missing-id", "id_token_presence", "missing_id_token", "denied"],
  ["jwks", "jwks_retrieval", "jwks_unavailable", "temporarily_unavailable"],
  ["signature", "id_token_validation", "invalid_signature", "denied"],
  ["issuer", "id_token_validation", "invalid_claims", "denied"],
  ["audience", "id_token_validation", "invalid_claims", "denied"],
  ["nonce", "id_token_validation", "nonce_mismatch", "denied"],
  ["expiry", "id_token_validation", "expired", "denied"],
  ["owner", "owner_verification", "owner_denied", "denied"],
  ["client", "issued_client_binding", "issued_client_mismatch", "denied"],
  ["identity", "registration_invariants", "registration_mismatch", "denied"],
  ["write", "credential_store_write", "store_unavailable", "temporarily_unavailable"],
  ["success", "complete", null, "connected"],
  ["plan-scope", "complete", "plan_usage_missing", "plan_usage_missing"],
  ["refresh", "registration_invariants", "offline_access_missing", "offline_access_missing"],
] as const;

for (const [variant, stage, failure, outcome] of a4Cases) {
  test(`A-4 sanitized final server event: ${variant}`, async () => {
    let body: any = null;
    const context = await setup({ routes: {
      [oauth.chatgptOAuth.tokenEndpoint]: () => {
        if (variant === "network") return "network";
        if (variant === "invalid-json") return { status: 200, raw: SECRET("RAW_BODY"), headers: { "x-request-id": SECRET("REQUEST_ID") } };
        if (variant === "invalid_grant" || variant === "invalid_client") return { status: 400, json: { error: variant, error_description: SECRET("RAW_ERROR") }, headers: { "x-request-id": SECRET("REQUEST_ID") } };
        if (variant === "server-error") return { status: 503, json: { error: SECRET("RAW_ERROR") } };
        return { status: 200, json: body, headers: { "x-request-id": SECRET("REQUEST_ID") } };
      },
      [oauth.chatgptOAuth.jwksUri]: variant === "jwks" ? () => "network" : jwksRoute,
      [oauth.chatgptOAuth.revocationEndpoint]: () => ({ status: 200 }),
    } });
    const { state, nonce, url: authorization } = await startAndGetState(context);
    const issued = variant === "client" ? SECRET("WRONG_CLIENT") : ISSUED;
    const requestUrl = callback({ code: SECRET("CODE"), state, client_id: issued });
    const jwtOptions = variant === "signature" ? { key: otherKeys.privateKey }
      : variant === "issuer" ? { issuer: SECRET("ISSUER") }
        : variant === "audience" ? { audience: SECRET("AUDIENCE") }
          : variant === "expiry" ? { expiresIn: 1 } : {};
    body = await tokenResponse({
      ...(variant === "invalid-schema" ? { expires_in: SECRET("EXPIRES"), scope: `openid ${SECRET("SCOPE")}`, earliest_refresh_at: SECRET("EARLIEST") } : {}),
      ...(variant === "missing-id" ? { id_token: undefined } : {}),
      ...(variant === "plan-scope" ? { scope: "openid profile email offline_access resource.invoke" } : {}),
      ...(variant === "refresh" ? { refresh_token: undefined } : {}),
    }, { nonce: variant === "nonce" ? SECRET("NONCE") : nonce, sub: SECRET("SUBJECT"), email: `${SECRET("EMAIL")}@example.test` }, jwtOptions);
    const pending = JSON.parse(await fs.readFile(join(context.directory, "pending", `${oauth.stateKey(state)}.json`), "utf8"));
    const overrides: any = {};
    if (variant === "owner") overrides.ownerAuthority = { verify: async () => false };
    if (variant === "client" || variant === "identity") {
      // A returning attempt may only use its selected issued registration and verified subject.
      await context.store.consumeAttempt(oauth.stateKey(state));
      await context.store.putAttempt({ ...pending, requestedClientId: ISSUED, registrationLabel: "chatgpt-0000000000000000" });
    }
    if (variant === "write") overrides.store = { ...context.store, writeRegistrations: async () => { throw new Error(SECRET("WRITE_ERROR")); } };
    const server = diagnosticServer(context, overrides);
    const result = await server.complete(requestUrl);
    assert.equal(result.outcome, outcome);
    assert.deepEqual(Object.keys(result).sort(), ["outcome", "returnOrigin"], "diagnostics stay server-only");
    assert.equal(server.logs.length, 1, "one final event, no per-stage or raw logging");
    const [prefix, event]: any = server.logs[0];
    assert.equal(prefix, "[chatgpt-oauth]");
    assert.equal(event.stage, stage);
    assert.equal(event.failure, failure);
    assert.equal(event.outcome, outcome);
    assert.equal(event.event, outcome === "connected" ? "callback_succeeded" : "callback_failed");
    assert.ok(Object.isFrozen(event));
    if (["invalid_grant", "invalid_client", "server-error", "network", "invalid-json", "invalid-schema"].includes(variant)) {
      const expectedClass = variant === "server-error" ? "http_error" : variant === "network" ? "network_error"
        : variant === "invalid-json" ? "invalid_json" : variant === "invalid-schema" ? "invalid_token_response" : "http_error";
      assert.equal(event.exchange.resultClass, expectedClass);
      assert.equal(event.exchange.httpStatus, variant === "network" ? null : variant === "server-error" ? 503 : variant.startsWith("invalid_") ? 400 : 200);
      assert.equal(event.exchange.requestIdPresent, !["network", "server-error"].includes(variant));
      assert.ok(Object.isFrozen(event.exchange));
    }
    if (variant === "invalid-schema") {
      assert.deepEqual(event.exchange.schema.granted_scopes, ["openid"]);
      assert.equal(event.exchange.schema.expires_in_type, "string");
      assert.equal(event.exchange.schema.access_token_present, true);
      assert.ok(Object.isFrozen(event.exchange.schema));
      assert.ok(Object.isFrozen(event.exchange.schema.granted_scopes));
    }
    const serialized = JSON.stringify(server.logs);
    for (const forbidden of ["FAKE_CHATGPT_", ISSUED, issued, state, nonce, pending.codeVerifier, authorization.searchParams.get("code_challenge")!, body.id_token, authorization.href, requestUrl.href]) {
      if (forbidden) assert.ok(!serialized.includes(forbidden), "no secret or identity marker in server logs");
    }
    if (outcome === "connected" || outcome === "plan_usage_missing") assert.equal((await context.store.readRegistrations()).registrations.length, 1);
    else assert.equal((await context.store.readRegistrations()).registrations.length, 0);
  });
}

test("A-4 callback parsing, state and credential-read failures stay distinct without raw query or exception logs", async () => {
  const context = await setup();
  const server = diagnosticServer(context);
  for (const [params, stage, failure] of [
    [{ code: SECRET("CODE") }, "callback_parsing", "invalid_callback"],
    [{ code: SECRET("CODE"), state: SECRET("STATE"), client_id: ISSUED }, "state_lookup", "unknown_state"],
  ] as const) {
    assert.equal((await server.complete(callback(params))).outcome, "denied");
    const event: any = server.logs.at(-1)![1];
    assert.equal(event.stage, stage);
    assert.equal(event.failure, failure);
  }
  const broken = diagnosticServer(context, { store: { ...context.store, consumeAttempt: async () => { throw new Error(SECRET("STORE_ERROR")); } } });
  assert.equal((await broken.complete(callback({ code: SECRET("CODE"), state: SECRET("STATE"), client_id: ISSUED }))).outcome, "temporarily_unavailable");
  assert.equal((broken.logs[0][1] as any).stage, "state_lookup");
  assert.equal((broken.logs[0][1] as any).failure, "store_unavailable");
  assert.ok(!JSON.stringify([server.logs, broken.logs]).includes("FAKE_CHATGPT_"));
  assert.equal(context.transport.calls.length, 0);
});

test("A-4 malformed bounded JSON and unknown error/scope strings cannot enter exchange diagnostics", async () => {
  const transport = fakeFetch({ [oauth.chatgptOAuth.tokenEndpoint]: [
    () => ({ status: 400, json: { error: SECRET("UNKNOWN_ERROR"), detail: SECRET("DETAIL") } }),
    () => ({ status: 200, raw: "x".repeat(oauth.chatgptOAuth.maxResponseBytes + 1) }),
  ] });
  const input = { clientId: ISSUED, code: SECRET("CODE"), codeVerifier: SECRET("VERIFIER"), redirectUri: oauth.redirectUriFor(PORT) };
  const first: any = await oauth.exchangeAuthorizationCode(transport.fetch, input);
  assert.equal(first.diagnostic.oauthError, null);
  assert.equal(first.diagnostic.resultClass, "http_error");
  const second: any = await oauth.exchangeAuthorizationCode(transport.fetch, input);
  assert.equal(second.diagnostic.resultClass, "invalid_json");
  assert.ok(!JSON.stringify([first, second]).includes("FAKE_CHATGPT_"));
  assert.equal(transport.calls.length, 2);
});

test("A-4 invalid_grant recovery audit: consumes code, never activates initial identity, but loses issued client id (separate documented recovery defect)", async () => {
  const context = await setup({ routes: { [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 400, json: { error: "invalid_grant" } }) } });
  const { state } = await startAndGetState(context);
  const server = diagnosticServer(context);
  assert.equal((await server.complete(callback({ code: SECRET("CODE"), state, client_id: ISSUED }))).outcome, "denied");
  assert.deepEqual(await fs.readdir(join(context.directory, "pending")), []);
  assert.equal((await context.store.readRegistrations()).registrations.length, 0);
  assert.equal((await startAndGetState(context)).url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(context.transport.calls.length, 1);
});

test("A-4 composition failure emits exactly one sanitized final event without entering OAuth", async () => {
  const context = await setup();
  const server = diagnosticServer(context, {}, { failComposition: true });
  assert.equal((await server.complete(callback({ code: SECRET("CODE"), state: SECRET("STATE"), client_id: ISSUED }))).outcome, "temporarily_unavailable");
  assert.equal(server.logs.length, 1);
  assert.equal((server.logs[0][1] as any).stage, "composition");
  assert.equal((server.logs[0][1] as any).failure, "internal_unavailable");
  assert.ok(!JSON.stringify(server.logs).includes("FAKE_CHATGPT_"));
  assert.equal(context.transport.calls.length, 0);
});

test("A-4 safe diagnostics are fresh/deterministic; a logger failure cannot change the OAuth outcome or inputs", async () => {
  const context = await setup();
  const server = diagnosticServer(context, {}, { failLogger: true });
  const request = callback({ code: SECRET("CODE"), state: SECRET("STATE"), client_id: ISSUED });
  const before = request.href;
  const first = await server.complete(request);
  const second = await server.complete(request);
  assert.deepEqual(first, second);
  assert.deepEqual(server.logs[0], server.logs[1]);
  assert.notEqual(server.logs[0][1], server.logs[1][1]);
  assert.equal(server.logs.length, 2, "one event per callback, no logger retry");
  assert.equal(request.href, before);
  assert.equal(first.outcome, "denied");
  assert.ok(Object.isFrozen(first));
  assert.equal(context.transport.calls.length, 0);
});

test("A-4 rejected transport emits one safe event without entering the callback composition", async () => {
  const context = await setup();
  const server = diagnosticServer(context);
  const routeModule = { exports: {} as any };
  const compiled = ts.transpileModule(source("app/integrations/chatgpt/callback/route.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let entered = 0;
  runInNewContext(compiled, {
    exports: routeModule.exports, URL, Response,
    require(name: string) {
      if (name.includes("chatgpt-integration.server")) return { chatgptCallbackPort: () => PORT, recordChatGPTCallbackOutcome: server.record,
        completeChatGPTCallback: () => { entered += 1; throw new Error("Must not enter."); } };
      return oauth;
    },
  });
  const request = new Request(callback({ code: SECRET("CODE"), state: SECRET("STATE") }), { headers: { Host: "localhost:3000" } });
  const response = await routeModule.exports.GET(request);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("Location")!, /chatgpt=denied$/u);
  assert.equal(entered, 0);
  assert.equal(server.logs.length, 1);
  assert.equal((server.logs[0][1] as any).stage, "callback_transport");
  assert.ok(!JSON.stringify(server.logs).includes("FAKE_CHATGPT_"));
  assert.equal(context.transport.calls.length, 0);
});

async function startAndGetState(context: Awaited<ReturnType<typeof setup>>) {
  const started = await context.connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
  assert.equal(started.status, "redirect");
  const url = new URL((started as any).url);
  return { url, state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
}

const callback = (params: Record<string, string>) => {
  const url = new URL(`http://127.0.0.1:${PORT}/integrations/chatgpt/callback`);
  for (const [name, value] of Object.entries(params)) url.searchParams.append(name, value);
  return url;
};

// Execute the actual route with only its server composition replaced by the real domain connection
// and fake transport. No Auth.js cookie, database, OAuth network or authorization URL is involved.
function callbackHandler(connection: ReturnType<typeof connectionModule.createChatGPTConnection>) {
  const routeModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  const compiled = ts.transpileModule(source("app/integrations/chatgpt/callback/route.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(compiled, {
    exports: routeModule.exports, URL, Response,
    require(name: string) {
      if (name === "@/lib/composition/chatgpt-integration.server") {
        return { completeChatGPTCallback: (url: URL) => connection.complete(url), chatgptCallbackPort: () => PORT, recordChatGPTCallbackOutcome: () => undefined };
      }
      if (name === "@/lib/integrations/chatgpt/chatgpt-oauth") return oauth;
      throw new Error("Unexpected callback dependency.");
    },
  });
  return routeModule.exports.GET;
}

const frameworkCallbackRequest = (url: URL, host = `127.0.0.1:${PORT}`, extraHeaders: Record<string, string> = {}) => {
  const visible = new URL(url);
  visible.hostname = "localhost"; // Next.js builds initURL from its configured fetchHostname.
  return new Request(visible, { headers: { Host: host, ...extraHeaders } });
};

test("A-3 real loopback Host with localhost framework URL exchanges once, consumes pending state, and returns to the original PAC origin without a cookie", async () => {
  let body: unknown = null;
  const context = await setup({ routes: { [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }), [oauth.chatgptOAuth.jwksUri]: jwksRoute } });
  const { state, nonce } = await startAndGetState(context);
  body = await tokenResponse({}, { nonce });
  const request = frameworkCallbackRequest(callback({ code: "a3-code", state, client_id: ISSUED }));
  assert.equal(request.headers.get("cookie"), null);
  assert.equal(new URL(request.url).hostname, "localhost");
  // The A-2 route forwarded this framework URL directly: denial before exchange or state consumption.
  assert.equal((await context.connection.complete(new URL(request.url))).outcome, "denied");
  assert.equal(context.transport.calls.length, 0);
  assert.equal((await fs.readdir(join(context.directory, "pending"))).length, 1);
  const response = await callbackHandler(context.connection)(request);
  assert.equal(response.status, 303);
  assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1);
  assert.equal(response.headers.get("Location"), "http://localhost:3000/settings/integrations?chatgpt=connected");
  assert.equal(await response.text(), "", "no callback page or dev assets");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Set-Cookie"), null, "PAC session is neither copied nor replaced");
  assert.deepEqual(await fs.readdir(join(context.directory, "pending")), []);
  assert.deepEqual(context.ownerChecks, Array.from({ length: 2 }, () => ({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE })));
  assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1);
  assert.equal(context.transport.calls[0].form!.redirect_uri, oauth.redirectUriFor(PORT));
  const before = await fs.readFile(join(context.directory, "registrations.json"), "utf8");
  assert.match((await callbackHandler(context.connection)(request)).headers.get("Location")!, /chatgpt=denied$/u);
  assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1);
  assert.equal(await fs.readFile(join(context.directory, "registrations.json"), "utf8"), before);
});

test("A-3 wrong or missing Host and forwarded spoofing are rejected before pending-state consumption or exchange", async () => {
  for (const host of ["localhost:3000", "attacker.example", "127.0.0.1:3001", "127.0.0.1:03000", "127.0.0.1", "127.0.0.1:3000, attacker.example", ""]) {
    const context = await setup();
    const { state } = await startAndGetState(context);
    const url = callback({ code: "a3-code", state, client_id: ISSUED });
    // The URL itself is canonical here: trusting it instead of Host would wrongly consume state.
    const headers = new Headers({ "X-Forwarded-Host": "127.0.0.1:3000", Forwarded: "host=127.0.0.1:3000;proto=http" });
    if (host) headers.set("Host", host);
    const pendingBefore = await fs.readdir(join(context.directory, "pending"));
    const response = await callbackHandler(context.connection)(new Request(url, { headers }));
    assert.match(response.headers.get("Location")!, /chatgpt=denied$/u, "Host rejected");
    assert.deepEqual(await fs.readdir(join(context.directory, "pending")), pendingBefore, "state unconsumed");
    assert.equal(context.transport.calls.length, 0);
    assert.equal(context.ownerChecks.length, 1, "no callback Owner resolution");
  }
});

test("A-3 wrong path or scheme fails before state consumption", async () => {
  for (const [pathname, protocol] of [["/other", "http:"], ["/integrations/chatgpt/callback/", "http:"], [oauth.chatgptOAuth.callbackPath, "https:"]]) {
    const context = await setup();
    const { state } = await startAndGetState(context);
    const url = callback({ code: "a3-code", state, client_id: ISSUED });
    url.pathname = pathname;
    url.protocol = protocol;
    const pendingBefore = await fs.readdir(join(context.directory, "pending"));
    const response = await callbackHandler(context.connection)(frameworkCallbackRequest(url));
    assert.match(response.headers.get("Location")!, /chatgpt=denied$/u);
    assert.deepEqual(await fs.readdir(join(context.directory, "pending")), pendingBefore);
    assert.equal(context.transport.calls.length, 0);
  }
});

test("A-3 duplicate, tampered and oversized callback query remains fail closed after reconstruction", async () => {
  for (const mutation of ["duplicate-state", "tampered-state", "duplicate-code", "duplicate-client", "oversized-code"]) {
    const context = await setup();
    const { state } = await startAndGetState(context);
    const url = callback({ code: "a3-code", state, client_id: ISSUED });
    if (mutation === "duplicate-state") url.searchParams.append("state", state);
    if (mutation === "tampered-state") url.searchParams.set("state", "tampered");
    if (mutation === "duplicate-code") url.searchParams.append("code", "other");
    if (mutation === "duplicate-client") url.searchParams.append("client_id", "other");
    if (mutation === "oversized-code") url.searchParams.set("code", "x".repeat(2049));
    const pendingBefore = await fs.readdir(join(context.directory, "pending"));
    assert.match((await callbackHandler(context.connection)(frameworkCallbackRequest(url))).headers.get("Location")!, /chatgpt=denied$/u);
    assert.deepEqual(await fs.readdir(join(context.directory, "pending")), pendingBefore);
    assert.equal(context.transport.calls.length, 0);
  }
});

test("A-3 invalid issued client binding denies after consuming the attempt and returns to its original origin", async () => {
  for (const clientId of [null, "dynamic_agent_client"]) {
    const context = await setup();
    const { state } = await startAndGetState(context);
    const url = callback({ code: "a3-code", state, ...(clientId === null ? {} : { client_id: clientId }) });
    const response = await callbackHandler(context.connection)(frameworkCallbackRequest(url));
    assert.equal(response.headers.get("Location"), "http://localhost:3000/settings/integrations?chatgpt=denied");
    assert.deepEqual(await fs.readdir(join(context.directory, "pending")), []);
    assert.equal(context.transport.calls.length, 0);
  }
});

test("A-3 callback scope is untrusted; the token-response scope determines eligibility on the original PAC origin", async () => {
  let body: unknown = null;
  const context = await setup({ routes: {
    [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }),
    [oauth.chatgptOAuth.jwksUri]: jwksRoute, [oauth.chatgptOAuth.revocationEndpoint]: () => ({ status: 200 }),
  } });
  const { state, nonce } = await startAndGetState(context);
  body = await tokenResponse({ scope: "openid profile email offline_access resource.invoke" }, { nonce });
  const request = frameworkCallbackRequest(callback({ code: "a3-code", state, client_id: ISSUED, scope: oauth.chatgptOAuth.scopes.join(" ") }));
  const response = await callbackHandler(context.connection)(request);
  assert.equal(response.headers.get("Location"), "http://localhost:3000/settings/integrations?chatgpt=plan_usage_missing");
  assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1);
  const registration = (await context.store.readRegistrations()).registrations[0];
  assert.equal(registration.accessToken, null);
  assert.equal(registration.refreshToken, null);
});

test("A-3 returning registration rejects a different issued client before exchange and retains the original return origin", async () => {
  let body: unknown = null;
  const context = await setup({ routes: { [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }), [oauth.chatgptOAuth.jwksUri]: jwksRoute } });
  const first = await startAndGetState(context);
  body = await tokenResponse({}, { nonce: first.nonce });
  const handler = callbackHandler(context.connection);
  await handler(frameworkCallbackRequest(callback({ code: "a3-code", state: first.state, client_id: ISSUED })));
  const before = await fs.readFile(join(context.directory, "registrations.json"), "utf8");
  const next = await startAndGetState(context);
  const response = await handler(frameworkCallbackRequest(callback({ code: "a3-code", state: next.state, client_id: "oaiapp_other" })));
  assert.equal(response.headers.get("Location"), "http://localhost:3000/settings/integrations?chatgpt=denied");
  assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1);
  assert.deepEqual(await fs.readdir(join(context.directory, "pending")), []);
  assert.equal(await fs.readFile(join(context.directory, "registrations.json"), "utf8"), before);
});

test("A-3 revoked bound Owner denies a cookie-free callback before exchange on the original PAC origin", async () => {
  const context = await setup();
  const { state } = await startAndGetState(context);
  const revoked = connectionModule.createChatGPTConnection({
    store: context.store, fetch: context.transport.fetch as any, callbackPort: PORT,
    now: () => new Date("2026-10-06T12:00:00.000Z"),
    ownerAuthority: { async verify(input) { assert.deepEqual(input, { ownerUserId: OWNER, domainWorkspaceId: WORKSPACE }); return false; } },
  });
  const response = await callbackHandler(revoked)(frameworkCallbackRequest(callback({ code: "a3-code", state, client_id: ISSUED })));
  assert.equal(response.headers.get("Location"), "http://localhost:3000/settings/integrations?chatgpt=denied");
  assert.deepEqual(await fs.readdir(join(context.directory, "pending")), []);
  assert.equal(context.transport.calls.length, 0);
  assert.deepEqual(await context.store.readRegistrations(), storeModule.emptyRegistrations);
});

test("A-3 reconstruction uses the configured port, preserves query bytes and duplicates, ignores forwarding, and is bounded", () => {
  const url = "http://localhost:4321/integrations/chatgpt/callback?scope=a%20b&code=c&state=s&state=t";
  const request = new Request(url, { headers: {
    Host: "127.0.0.1:4321", "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "https", Forwarded: "host=attacker.example;proto=https",
  } });
  const before = { url: request.url, headers: [...request.headers] };
  const first = oauth.canonicalLoopbackCallbackUrl(request, 4321)!;
  const next = oauth.canonicalLoopbackCallbackUrl(request, 4321)!;
  assert.equal(first.origin, "http://127.0.0.1:4321");
  assert.equal(first.search, new URL(url).search);
  assert.equal(oauth.parseCallback(first).kind, "invalid", "duplicates not hidden by reconstruction");
  assert.notEqual(first, next, "fresh canonical URL");
  assert.equal(first.href, next.href, "deterministic");
  assert.deepEqual({ url: request.url, headers: [...request.headers] }, before);
  assert.equal(oauth.canonicalLoopbackCallbackUrl(request, PORT), null);
  assert.equal(oauth.canonicalLoopbackCallbackUrl(request, 0), null);
  assert.equal(oauth.canonicalLoopbackCallbackUrl(new Request(url, { method: "POST", headers: request.headers }), 4321), null);
  assert.equal(oauth.canonicalLoopbackCallbackUrl(new Request(`${url}${"x".repeat(16_384)}`, { headers: request.headers }), 4321), null);
});

test("authorization request: official endpoint, 127.0.0.1 loopback, exact scopes, resource, S256 PKCE, fresh state / nonce; first vs returning registration", () => {
  assert.equal(oauth.redirectUriFor(3000), "http://127.0.0.1:3000/integrations/chatgpt/callback");
  assert.throws(() => oauth.redirectUriFor(0));
  const a = oauth.newOAuthAttemptSecrets();
  const b = oauth.newOAuthAttemptSecrets();
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.codeVerifier, b.codeVerifier);
  for (const value of [a.state, a.nonce, a.codeVerifier]) assert.match(value, /^[A-Za-z0-9_-]{43}$/u, "256-bit base64url");
  assert.equal(a.codeChallenge, createHash("sha256").update(a.codeVerifier).digest("base64url"));
  const hostId = "urn:uuid:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const first = new URL(oauth.authorizationUrl({ clientId: null, hostId, redirectUri: oauth.redirectUriFor(3000), state: a.state, nonce: a.nonce, codeChallenge: a.codeChallenge, idTokenHint: "IGNORED" }));
  assert.equal(`${first.origin}${first.pathname}`, "https://auth.openai.com/api/accounts/authorize");
  assert.deepEqual(Object.fromEntries(first.searchParams), {
    client_id: "dynamic_agent_client", agent_name_hint: "Private AI Cloud", ext_agent_host_id: hostId, response_type: "code",
    redirect_uri: "http://127.0.0.1:3000/integrations/chatgpt/callback", scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1", state: a.state, nonce: a.nonce, code_challenge_method: "S256", code_challenge: a.codeChallenge,
  }, "first registration: dynamic client, agent name hint, no id_token_hint");
  const returning = new URL(oauth.authorizationUrl({ clientId: ISSUED, hostId, redirectUri: oauth.redirectUriFor(3000), state: b.state, nonce: b.nonce, codeChallenge: b.codeChallenge, idTokenHint: "HINT" }));
  assert.equal(returning.searchParams.get("client_id"), ISSUED);
  assert.equal(returning.searchParams.get("agent_name_hint"), null, "no agent name hint on reauthorization");
  assert.equal(returning.searchParams.get("id_token_hint"), "HINT", "documented hint for a returning registration only");
  assert.throws(() => oauth.authorizationUrl({ clientId: "dynamic_agent_client", hostId, redirectUri: "x", state: "s", nonce: "n", codeChallenge: "c" }), "the dynamic id is never used as an issued id");
  assert.throws(() => oauth.authorizationUrl({ clientId: null, hostId: "host-1", redirectUri: "x", state: "s", nonce: "n", codeChallenge: "c" }), "host id must be urn:uuid");
  // Callback parsing: bounded, single-valued.
  assert.equal(oauth.parseCallback(new URL("http://127.0.0.1:3000/integrations/chatgpt/callback?code=c&state=s&state=t")).kind, "invalid");
  assert.deepEqual(oauth.parseCallback(new URL("http://127.0.0.1:3000/integrations/chatgpt/callback?error=access_denied&state=s")), { kind: "error", state: "s" });
  assert.deepEqual(oauth.parseCallback(new URL(`http://127.0.0.1:3000/integrations/chatgpt/callback?code=c&state=s&client_id=${ISSUED}`)), { kind: "code", code: "c", state: "s", clientId: ISSUED });
});

test("credential store: owner-only directory and files, strict schema, symlink / mode / size abuse fails closed, atomic writes, stable host id", async () => {
  const { directory, store } = await setup();
  const hostId = await store.hostId();
  assert.match(hostId, oauth.hostIdPattern);
  assert.equal(await store.hostId(), hostId, "generated once, reused");
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, "host-id.json"))).mode & 0o777, 0o600);
  assert.deepEqual(await store.readRegistrations(), storeModule.emptyRegistrations);
  // Malformed content fails closed.
  await fs.writeFile(join(directory, "registrations.json"), "{not json", { mode: 0o600 });
  await assert.rejects(store.readRegistrations(), storeModule.CredentialStoreError);
  await fs.writeFile(join(directory, "registrations.json"), JSON.stringify({ version: 1, active: null, registrations: [], extra: 1 }), { mode: 0o600 });
  await assert.rejects(store.readRegistrations());
  // Wrong mode fails closed.
  await fs.writeFile(join(directory, "registrations.json"), JSON.stringify(storeModule.emptyRegistrations), { mode: 0o644 });
  await fs.chmod(join(directory, "registrations.json"), 0o644);
  await assert.rejects(store.readRegistrations());
  // A symlink planted as the credential file is never followed.
  await fs.unlink(join(directory, "registrations.json"));
  const outside = join(directory, "..", "outside.json");
  await fs.writeFile(outside, JSON.stringify(storeModule.emptyRegistrations), { mode: 0o600 });
  await fs.symlink(outside, join(directory, "registrations.json"));
  await assert.rejects(store.readRegistrations(), "symlink read fails closed");
  // An atomic write replaces the symlink entry itself; the outside target is untouched.
  await store.writeRegistrations(storeModule.emptyRegistrations);
  assert.equal((await fs.lstat(join(directory, "registrations.json"))).isSymbolicLink(), false);
  assert.equal(await fs.readFile(outside, "utf8"), JSON.stringify(storeModule.emptyRegistrations));
  assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")), [], "no temp files left");
  // Oversize fails closed.
  await fs.writeFile(join(directory, "registrations.json"), " ".repeat(storeModule.credentialStoreLimits.maxFileBytes + 1), { mode: 0o600 });
  await assert.rejects(store.readRegistrations());
  // A symlinked credential DIRECTORY is refused.
  const linked = join(directory, "..", "linked-store");
  await fs.symlink(directory, linked);
  await assert.rejects(storeModule.createChatGPTCredentialStore({ directory: linked }).readRegistrations());
  // A too-open directory owned by us is tightened to 0700.
  const loose = join(directory, "..", "loose");
  await fs.mkdir(loose, { mode: 0o755 });
  await fs.chmod(loose, 0o755);
  await storeModule.createChatGPTCredentialStore({ directory: loose }).hostId();
  assert.equal((await fs.stat(loose)).mode & 0o777, 0o700);
  // Invalid registrations are never written.
  await assert.rejects(store.writeRegistrations({ version: 1, active: "nope", registrations: [] } as any));
  assert.equal(storeModule.defaultCredentialDirectory({}).endsWith(join(".config", "private-ai-cloud", "chatgpt")), true);
});

test("start: Owner authority re-verified; the pending attempt is local, bound and expiring; no attempt for a non-Owner", async () => {
  const denied = await setup({ ownerOk: false });
  assert.deepEqual(await denied.connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" }), { status: "denied" });
  assert.equal(await denied.store.hasLiveAttempt(new Date("2026-10-06T12:00:00.000Z")), false);
  const context = await setup();
  const { url, state } = await startAndGetState(context);
  assert.deepEqual(context.ownerChecks, [{ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE }]);
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:3000/integrations/chatgpt/callback");
  const pendingFiles = await fs.readdir(join(context.directory, "pending"));
  assert.deepEqual(pendingFiles, [`${oauth.stateKey(state)}.json`], "keyed by the state hash; the raw state is not stored");
  const pending = JSON.parse(await fs.readFile(join(context.directory, "pending", pendingFiles[0]), "utf8"));
  assert.equal((await fs.stat(join(context.directory, "pending", pendingFiles[0]))).mode & 0o777, 0o600);
  assert.deepEqual([pending.ownerUserId, pending.domainWorkspaceId, pending.requestedClientId, pending.returnOrigin, Date.parse(pending.expiresAt) - Date.parse(pending.createdAt)],
    [OWNER, WORKSPACE, null, "http://localhost:3000", 600_000]);
  assert.ok(!JSON.stringify(pending).includes(state), "raw state not persisted");
  assert.equal((await context.connection.status()).state, "connecting");
  // An unknown return origin falls back to the loopback origin (no open redirect).
  const other = await setup();
  await other.connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "https://evil.example" });
  const file = (await fs.readdir(join(other.directory, "pending")))[0];
  assert.equal(JSON.parse(await fs.readFile(join(other.directory, "pending", file), "utf8")).returnOrigin, "http://127.0.0.1:3000");
});

test("callback success: exact exchange (issued client id, verifier, redirect, resource; no secret), JWKS-validated ID token, plan scope → connected; safe status only", async () => {
  let body: unknown = null;
  const context = await setup({ routes: { [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }), [oauth.chatgptOAuth.jwksUri]: jwksRoute } });
  const { state, nonce } = await startAndGetState(context);
  body = await tokenResponse({}, { nonce });
  const result = await context.connection.complete(callback({ code: "auth-code-1", state, client_id: ISSUED }));
  assert.deepEqual(result, { outcome: "connected", returnOrigin: "http://localhost:3000" });
  const exchange = context.transport.calls.find((call) => call.url === oauth.chatgptOAuth.tokenEndpoint)!.form!;
  assert.deepEqual(Object.keys(exchange).sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "resource"], "no client secret");
  assert.deepEqual([exchange.grant_type, exchange.client_id, exchange.code, exchange.redirect_uri, exchange.resource],
    ["authorization_code", ISSUED, "auth-code-1", "http://127.0.0.1:3000/integrations/chatgpt/callback", "https://api.openai.com/v1"]);
  assert.match(exchange.code_verifier, /^[A-Za-z0-9_-]{43}$/u);
  const stored = await context.store.readRegistrations();
  assert.equal(stored.registrations.length, 1);
  const registration = stored.registrations[0];
  assert.deepEqual([registration.clientId, registration.status, registration.email, registration.accessToken, registration.refreshToken],
    [ISSUED, "active", "owner@example.test", SECRET("ACCESS"), SECRET("REFRESH")]);
  assert.equal((await fs.stat(join(context.directory, "registrations.json"))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(join(context.directory, "pending")), [], "the attempt was consumed");
  const status = await context.connection.status();
  assert.deepEqual({ ...status }, { accessMode: "subscription_session", state: "plan_usage_enabled", accountLabel: "owner@example.test", planUsageGranted: true, selectedModel: null, availableModels: [], modelsCheckedAt: null });
  const projection = JSON.stringify(status);
  for (const secret of [SECRET("ACCESS"), SECRET("REFRESH"), registration.idToken!, registration.subject, ISSUED]) assert.ok(!projection.includes(secret), "status leaks nothing");
  // A replay of the same callback finds no attempt: denied, nothing written.
  const before = await fs.readFile(join(context.directory, "registrations.json"), "utf8");
  assert.equal((await context.connection.complete(callback({ code: "auth-code-1", state, client_id: ISSUED }))).outcome, "denied");
  assert.equal(await fs.readFile(join(context.directory, "registrations.json"), "utf8"), before);
  assert.ok(!context.transport.calls.some((call) => call.url.includes("/v1/responses")), "zero inference");
});

async function completeWith(tokenRoute: (nonce: string) => Promise<Route>, options: Readonly<{ callbackParams?: (state: string) => Record<string, string>; ownerOkAtCallback?: boolean; advanceMs?: number; jwks?: Route }> = {}) {
  let ownerOk = true;
  let nowMs = Date.parse("2026-10-06T12:00:00.000Z");
  const routes: Record<string, Route> = { [oauth.chatgptOAuth.jwksUri]: options.jwks ?? jwksRoute, [oauth.chatgptOAuth.revocationEndpoint]: () => ({ status: 200 }) };
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-case-"));
  const store = storeModule.createChatGPTCredentialStore({ directory });
  const calls: string[] = [];
  let tokenHandler: Route | null = null;
  const connection = connectionModule.createChatGPTConnection({
    store, callbackPort: PORT, now: () => new Date(nowMs),
    ownerAuthority: { async verify() { return ownerOk; } },
    fetch: (async (url: string, init: any) => {
      calls.push(url);
      const route = url === oauth.chatgptOAuth.tokenEndpoint ? tokenHandler : routes[url];
      if (!route) throw new Error(`unexpected ${url}`);
      const result = route(init.body ? new URLSearchParams(init.body) : null, init);
      if (result === "network") throw new TypeError("fetch failed");
      return new Response(result.json === undefined ? null : JSON.stringify(result.json), { status: result.status });
    }) as any,
  });
  const started = await connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
  const url = new URL((started as any).url);
  const state = url.searchParams.get("state")!;
  tokenHandler = await tokenRoute(url.searchParams.get("nonce")!);
  ownerOk = options.ownerOkAtCallback ?? true;
  nowMs += options.advanceMs ?? 0;
  const result = await connection.complete(callback(options.callbackParams ? options.callbackParams(state) : { code: "c1", state, client_id: ISSUED }));
  return { result, store, calls, connection };
}

const okRoute = async (nonce: string, overrides: Record<string, unknown> = {}, claims: Record<string, unknown> = {}, idOptions = {}): Promise<Route> => {
  const body = await tokenResponse(overrides, { nonce, ...claims }, idOptions);
  return () => ({ status: 200, json: body });
};

test("callback denials: state, expiry, replay, error, client id, PKCE, signature, issuer, audience, nonce, expiry, Owner; nothing persisted on any failure", async () => {
  const cases: [string, Parameters<typeof completeWith>[0], Parameters<typeof completeWith>[1], string][] = [
    ["state mismatch", (nonce) => okRoute(nonce), { callbackParams: () => ({ code: "c1", state: "forged-state-value", client_id: ISSUED }) }, "denied"],
    ["expired attempt", (nonce) => okRoute(nonce), { advanceMs: 600_001 }, "expired"],
    ["callback error", (nonce) => okRoute(nonce), { callbackParams: (state) => ({ error: "access_denied", state }) }, "authorization_cancelled"],
    ["first registration without issued client id", (nonce) => okRoute(nonce), { callbackParams: (state) => ({ code: "c1", state }) }, "denied"],
    ["first registration echoing dynamic_agent_client", (nonce) => okRoute(nonce), { callbackParams: (state) => ({ code: "c1", state, client_id: "dynamic_agent_client" }) }, "denied"],
    // Even a token audience matching the dynamic id cannot turn it into an issued registration.
    ["dynamic_agent_client with a matching token audience", (nonce) => okRoute(nonce, {}, {}, { audience: "dynamic_agent_client" }), { callbackParams: (state) => ({ code: "c1", state, client_id: "dynamic_agent_client" }) }, "denied"],
    ["invalid PKCE / code exchange", async () => () => ({ status: 400, json: { error: "invalid_grant" } }), {}, "denied"],
    ["token endpoint unavailable", async () => () => "network", {}, "temporarily_unavailable"],
    ["no id_token", (nonce) => okRoute(nonce, { id_token: null }), {}, "denied"],
    ["invalid signature", (nonce) => okRoute(nonce, {}, {}, { key: otherKeys.privateKey }), {}, "denied"],
    ["wrong issuer", (nonce) => okRoute(nonce, {}, {}, { issuer: "https://evil.example" }), {}, "denied"],
    ["wrong audience", (nonce) => okRoute(nonce, {}, {}, { audience: "oaiapp_other" }), {}, "denied"],
    ["wrong nonce", () => okRoute("other-nonce"), {}, "denied"],
    ["expired ID token", (nonce) => okRoute(nonce, {}, {}, { expiresIn: Math.floor(Date.parse("2026-10-06T10:00:00.000Z") / 1000) }), {}, "denied"],
    ["non-bearer token type", (nonce) => okRoute(nonce, { token_type: "mac" }), {}, "denied"],
    ["JWKS unavailable", (nonce) => okRoute(nonce), { jwks: () => "network" }, "temporarily_unavailable"],
    ["Owner revoked before callback", (nonce) => okRoute(nonce), { ownerOkAtCallback: false }, "denied"],
  ];
  for (const [label, route, options, outcome] of cases) {
    const { result, store } = await completeWith(route, options);
    assert.equal(result.outcome, outcome, label);
    assert.deepEqual(await store.readRegistrations(), storeModule.emptyRegistrations, `${label}: nothing persisted`);
  }
  // A wrong host / path is never served as the callback.
  const { connection } = await completeWith((nonce) => okRoute(nonce));
  assert.equal((await connection.complete(new URL("http://localhost:3000/integrations/chatgpt/callback?code=c&state=s"))).outcome, "denied");
  assert.equal((await connection.complete(new URL("http://127.0.0.1:3000/other?code=c&state=s"))).outcome, "denied");
});

test("missing chatgpt.tokens.use.direct → plan_usage_missing: identity kept, NO token material stored, the session revoked, zero inference", async () => {
  const { result, store, calls } = await completeWith((nonce) => okRoute(nonce, { scope: "openid profile email offline_access resource.invoke" }));
  assert.equal(result.outcome, "plan_usage_missing");
  const registration = (await store.readRegistrations()).registrations[0];
  assert.deepEqual([registration.status, registration.accessToken, registration.refreshToken, registration.clientId], ["plan_usage_missing", null, null, ISSUED]);
  assert.ok(calls.includes(oauth.chatgptOAuth.revocationEndpoint), "the unused renewable session is revoked");
  assert.ok(!calls.some((url) => url.includes("/v1/responses") || url.includes("/v1/models")), "no inference or model call");
});

test("returning registration: issued client id reused with id_token_hint; mismatched client id or subject denied and the existing credentials stay untouched", async () => {
  const first = await completeWith((nonce) => okRoute(nonce));
  assert.equal(first.result.outcome, "connected");
  const store = first.store;
  const before = JSON.stringify(await store.readRegistrations());
  const reconnect = async (claims: Record<string, unknown>, callbackClientId: string | null) => {
    const directory = store.directory;
    let tokenHandler: Route | null = null;
    const connection = connectionModule.createChatGPTConnection({
      store: storeModule.createChatGPTCredentialStore({ directory }), callbackPort: PORT, now: () => new Date("2026-10-06T12:05:00.000Z"),
      ownerAuthority: { async verify() { return true; } },
      fetch: (async (url: string, init: any) => {
        const route = url === oauth.chatgptOAuth.tokenEndpoint ? tokenHandler : url === oauth.chatgptOAuth.jwksUri ? jwksRoute : null;
        if (!route) throw new Error(`unexpected ${url}`);
        const result = route(init.body ? new URLSearchParams(init.body) : null, init) as any;
        return new Response(JSON.stringify(result.json), { status: result.status });
      }) as any,
    });
    const started = await connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
    const url = new URL((started as any).url);
    assert.equal(url.searchParams.get("client_id"), ISSUED, "issued client id reused");
    assert.equal(url.searchParams.get("agent_name_hint"), null);
    assert.ok(url.searchParams.get("id_token_hint"), "retained id token sent as the documented hint");
    tokenHandler = await okRoute(url.searchParams.get("nonce")!, { access_token: SECRET("ACCESS", 2), refresh_token: SECRET("REFRESH", 2) }, claims);
    const state = url.searchParams.get("state")!;
    return connection.complete(callback(callbackClientId === null ? { code: "c2", state } : { code: "c2", state, client_id: callbackClientId }));
  };
  assert.equal((await reconnect({ sub: "another-subject" }, ISSUED)).outcome, "denied", "subject mismatch");
  assert.equal(JSON.stringify(await store.readRegistrations()), before, "credentials not replaced");
  assert.equal((await reconnect({}, "oaiapp_other_client")).outcome, "denied", "client id mismatch");
  assert.equal(JSON.stringify(await store.readRegistrations()), before);
  assert.equal((await reconnect({}, null)).outcome, "connected", "returning callback may omit the client id");
  assert.equal((await store.readRegistrations()).registrations[0].accessToken, SECRET("ACCESS", 2));
});

async function connectedContext(routes: Record<string, Route | Route[]>, nowMs = Date.parse("2026-10-06T12:00:00.000Z")) {
  const first = await completeWith((nonce) => okRoute(nonce));
  assert.equal(first.result.outcome, "connected");
  let clock = nowMs;
  const transport = fakeFetch({ [oauth.chatgptOAuth.jwksUri]: jwksRoute, ...routes });
  const connection = connectionModule.createChatGPTConnection({
    store: storeModule.createChatGPTCredentialStore({ directory: first.store.directory }), callbackPort: PORT, now: () => new Date(clock),
    ownerAuthority: { async verify() { return true; } }, fetch: transport.fetch as any,
  });
  return { connection, transport, store: first.store, setNow: (ms: number) => { clock = ms; } };
}

test("refresh: serialized, rotating (access + refresh replaced atomically, the old refresh token never reused); invalid grant → reauthorization_required; 5xx keeps credentials", async () => {
  let refreshes = 0;
  const later = Date.parse("2026-10-06T13:30:00.000Z"); // the 1 h access token has expired
  const context = await connectedContext({
    [oauth.chatgptOAuth.tokenEndpoint]: (form) => {
      refreshes += 1;
      return { status: 200, json: { access_token: SECRET("ACCESS", 10 + refreshes), refresh_token: SECRET("REFRESH", 10 + refreshes), token_type: "Bearer", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct", seen: form!.get("refresh_token") } };
    },
  });
  context.setNow(later);
  const [a, b, c] = await Promise.all([context.connection.accessToken(), context.connection.accessToken(), context.connection.accessToken()]);
  assert.equal(refreshes, 1, "three concurrent requests → ONE refresh");
  assert.deepEqual([a, b, c].map((value: any) => value.token), [SECRET("ACCESS", 11), SECRET("ACCESS", 11), SECRET("ACCESS", 11)]);
  const refreshCall = context.transport.calls.find((call) => call.url === oauth.chatgptOAuth.tokenEndpoint)!;
  assert.deepEqual(refreshCall.form, { grant_type: "refresh_token", client_id: ISSUED, refresh_token: SECRET("REFRESH"), resource: "https://api.openai.com/v1" }, "no scope: the grant is retained");
  const stored = (await context.store.readRegistrations()).registrations[0];
  assert.deepEqual([stored.accessToken, stored.refreshToken], [SECRET("ACCESS", 11), SECRET("REFRESH", 11)], "both replaced in one write");
  context.setNow(later + 2 * 3_600_000);
  await context.connection.accessToken();
  const second = context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint)[1];
  assert.equal(second.form!.refresh_token, SECRET("REFRESH", 11), "the rotated token is used; the old one never again");

  const invalid = await connectedContext({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 400, json: { error: "refresh_token_reused" } }) });
  invalid.setNow(later);
  assert.deepEqual(await invalid.connection.accessToken(), { ok: false, reason: "reauthorization_required" });
  const cleared = (await invalid.store.readRegistrations()).registrations[0];
  assert.deepEqual([cleared.status, cleared.accessToken, cleared.refreshToken], ["reauthorization_required", null, null], "token material cleared");
  assert.equal((await invalid.connection.status()).state, "reauthorization_required");
  assert.deepEqual(await invalid.connection.accessToken(), { ok: false, reason: "reauthorization_required" }, "no automatic new OAuth, no retry");

  const outage = await connectedContext({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 503, json: {} }) });
  const before = JSON.stringify(await outage.store.readRegistrations());
  outage.setNow(later);
  assert.deepEqual(await outage.connection.accessToken(), { ok: false, reason: "temporarily_unavailable" }, "expired token never used");
  assert.equal(JSON.stringify(await outage.store.readRegistrations()), before, "credential set preserved");

  const lostScope = await connectedContext({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: { access_token: SECRET("ACCESS", 30), refresh_token: SECRET("REFRESH", 30), token_type: "Bearer", expires_in: 3600, scope: "openid" } }) });
  lostScope.setNow(later);
  assert.deepEqual(await lostScope.connection.accessToken(), { ok: false, reason: "reauthorization_required" });
});

test("models: account-specific discovery with the Bearer token; selection only from the list; a vanished model is cleared; not inference", async () => {
  const listing = { models: [{ slug: "gpt-plan-a", display_name: "Plan A", visibility: "list" }, { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" }, { slug: "bad slug", visibility: "list" }] };
  const context = await connectedContext({ [oauth.chatgptOAuth.modelsEndpoint]: [() => ({ status: 200, json: listing }), () => ({ status: 200, json: { models: [] } })] });
  assert.equal(await context.connection.refreshModels(), "updated");
  const call = context.transport.calls.find((item) => item.url === oauth.chatgptOAuth.modelsEndpoint)!;
  assert.deepEqual([call.method, call.authorization], ["GET", `Bearer ${SECRET("ACCESS")}`]);
  assert.deepEqual((await context.connection.status()).availableModels, [{ slug: "gpt-plan-a", displayName: "Plan A" }]);
  assert.equal(await context.connection.selectModel("gpt-hidden"), "invalid");
  assert.equal(await context.connection.selectModel("gpt-plan-a"), "selected");
  assert.equal((await context.connection.status()).selectedModel, "gpt-plan-a");
  assert.equal(await context.connection.refreshModels(), "updated");
  assert.equal((await context.connection.status()).selectedModel, null, "the selected model disappeared → cleared");
  assert.ok(!context.transport.calls.some((item) => item.url.includes("/v1/responses")), "no inference");
});

test("A-1 disconnect: revocation attempted, ALL token material cleared (incl. ID token), the issued registration mapping kept; reconnect reuses the issued client id", async () => {
  const confirmed = await connectedContext({ [oauth.chatgptOAuth.revocationEndpoint]: () => ({ status: 200 }) });
  const before = (await confirmed.store.readRegistrations()).registrations[0];
  assert.deepEqual(await confirmed.connection.disconnect(), { status: "disconnected", remoteRevocation: "confirmed" });
  const revoke = confirmed.transport.calls.find((call) => call.url === oauth.chatgptOAuth.revocationEndpoint)!;
  assert.deepEqual(revoke.form, { token: SECRET("REFRESH"), token_type_hint: "refresh_token", client_id: ISSUED });
  const after = await confirmed.store.readRegistrations();
  assert.equal(after.registrations.length, 1, "the registration is kept");
  const kept = after.registrations[0];
  assert.deepEqual([kept.label, kept.clientId, kept.subject, kept.email, kept.hostId], [before.label, ISSUED, before.subject, before.email, before.hostId], "mapping retained");
  assert.deepEqual([kept.status, kept.idToken, kept.accessToken, kept.refreshToken, kept.accessTokenExpiresAt, kept.earliestRefreshAt, kept.grantedScopes],
    ["signed_out", null, null, null, null, null, []], "all token material cleared");
  assert.equal(after.active, kept.label, "still the selected registration");
  const raw = await fs.readFile(join(confirmed.store.directory, "registrations.json"), "utf8");
  for (const secret of [SECRET("ACCESS"), SECRET("REFRESH"), before.idToken!]) assert.ok(!raw.includes(secret), "no token material on disk after sign-out");
  assert.equal((await confirmed.connection.status()).state, "signed_out");
  assert.deepEqual(await confirmed.connection.accessToken(), { ok: false, reason: "not_connected" }, "nothing usable after sign-out");
  // The next sign-in reuses the issued client id and the stable host id — never dynamic_agent_client.
  const started = await confirmed.connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
  const url = new URL((started as any).url);
  assert.equal(url.searchParams.get("client_id"), ISSUED);
  assert.equal(url.searchParams.get("ext_agent_host_id"), before.hostId);
  assert.equal(url.searchParams.get("agent_name_hint"), null, "no dynamic re-registration");
  assert.equal(url.searchParams.get("id_token_hint"), null, "the cleared ID token is not used as a hint");
  // A disconnect while unconfirmed still clears locally (bounded retry: 3 attempts).
  const unconfirmed = await connectedContext({ [oauth.chatgptOAuth.revocationEndpoint]: () => "network" });
  assert.deepEqual(await unconfirmed.connection.disconnect(), { status: "disconnected", remoteRevocation: "unconfirmed" });
  assert.equal(unconfirmed.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.revocationEndpoint).length, 3);
  const cleared = (await unconfirmed.store.readRegistrations()).registrations[0];
  assert.deepEqual([cleared.status, cleared.refreshToken, cleared.idToken, cleared.clientId], ["signed_out", null, null, ISSUED]);
  // The store schema itself refuses a signed-out registration that still carries an ID token.
  await assert.rejects(unconfirmed.store.writeRegistrations({ version: 1, active: cleared.label, registrations: [{ ...cleared, idToken: before.idToken }] }));
});

test("A-1 reconnect after sign-out: the returning flow re-activates THE SAME registration (issued client id + subject), never a new one", async () => {
  const context = await connectedContext({ [oauth.chatgptOAuth.revocationEndpoint]: () => ({ status: 200 }) });
  await context.connection.disconnect();
  const label = (await context.store.readRegistrations()).registrations[0].label;
  let body: unknown = null;
  const transport = fakeFetch({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }), [oauth.chatgptOAuth.jwksUri]: jwksRoute });
  const connection = connectionModule.createChatGPTConnection({
    store: storeModule.createChatGPTCredentialStore({ directory: context.store.directory }), callbackPort: PORT, now: () => new Date("2026-10-06T14:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: transport.fetch as any,
  });
  const started = await connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
  const url = new URL((started as any).url);
  body = await tokenResponse({ access_token: SECRET("ACCESS", 5), refresh_token: SECRET("REFRESH", 5) }, { nonce: url.searchParams.get("nonce") });
  assert.equal((await connection.complete(callback({ code: "c3", state: url.searchParams.get("state")! }))).outcome, "connected");
  assert.equal(transport.calls.find((call) => call.url === oauth.chatgptOAuth.tokenEndpoint)!.form!.client_id, ISSUED, "token exchange with the issued id");
  const registrations = (await context.store.readRegistrations()).registrations;
  assert.deepEqual(registrations.map((item) => [item.label, item.status, item.accessToken]), [[label, "active", SECRET("ACCESS", 5)]]);
});

test("A-1 refresh replacement invariant: a 200 without a NEW refresh token is invalid — the new access token is not stored and the old refresh token is never reused", async () => {
  const later = Date.parse("2026-10-06T13:30:00.000Z");
  for (const [label, response] of [
    ["no refresh_token", { access_token: SECRET("ACCESS", 40), token_type: "Bearer", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct" }],
    ["the old refresh_token echoed", { access_token: SECRET("ACCESS", 41), refresh_token: SECRET("REFRESH"), token_type: "Bearer", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct" }],
  ] as const) {
    const context = await connectedContext({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: response }) });
    context.setNow(later);
    assert.deepEqual(await context.connection.accessToken(), { ok: false, reason: "reauthorization_required" }, label);
    const stored = (await context.store.readRegistrations()).registrations[0];
    assert.deepEqual([stored.status, stored.accessToken, stored.refreshToken], ["reauthorization_required", null, null], `${label}: nothing usable kept`);
    const raw = await fs.readFile(join(context.store.directory, "registrations.json"), "utf8");
    assert.ok(!raw.includes(SECRET("ACCESS", 40)) && !raw.includes(SECRET("ACCESS", 41)), `${label}: the new access token was not stored`);
    assert.ok(!raw.includes(SECRET("REFRESH")), `${label}: the old refresh token is gone`);
    // No second refresh attempt with the old token.
    assert.deepEqual(await context.connection.accessToken(), { ok: false, reason: "reauthorization_required" });
    assert.equal(context.transport.calls.filter((call) => call.url === oauth.chatgptOAuth.tokenEndpoint).length, 1, `${label}: the old refresh token is used once only`);
  }
  // The contract function itself.
  const fetchNoRefresh = fakeFetch({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: { access_token: SECRET("ACCESS", 42), token_type: "Bearer", expires_in: 3600, scope: "openid" } }) });
  assert.deepEqual(await oauth.refreshAccessToken(fetchNoRefresh.fetch as any, { clientId: ISSUED, refreshToken: SECRET("REFRESH") }), { ok: false, failure: "invalid_response" });
});

test("A-1 initial exchange: a plan grant without a refresh token is NOT kept as an active connection (offline_access_missing, nothing persisted)", async () => {
  const { result, store } = await completeWith((nonce) => okRoute(nonce, { refresh_token: null }));
  assert.equal(result.outcome, "offline_access_missing");
  assert.deepEqual(await store.readRegistrations(), storeModule.emptyRegistrations);
  // The store schema refuses an active registration without a refresh token.
  const connected = await completeWith((nonce) => okRoute(nonce));
  const registration = (await connected.store.readRegistrations()).registrations[0];
  await assert.rejects(connected.store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, refreshToken: null }] }));
});

const waitForLock = async (directory: string) => {
  for (let i = 0; i < 100 && !(await fs.stat(join(directory, "refresh.lock")).catch(() => null)); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("A-2 lock A: while one process holds the lock another cannot enter; it waits a bounded time and fails closed; after release it enters", async () => {
  assert.deepEqual(Object.keys(storeModule.credentialStoreLimits).sort(), ["lockPollMs", "lockWaitMs", "maxFileBytes", "maxRegistrations"], "no stale-takeover timing exists");
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-lock-a-"));
  // Two independent store instances on one directory behave like two processes (separate in-process chains).
  const processA = storeModule.createChatGPTCredentialStore({ directory });
  const processB = storeModule.createChatGPTCredentialStore({ directory, lockTiming: { waitMs: 300, pollMs: 25 } });
  let releaseA: () => void = () => {};
  let bRan = false;
  const holder = processA.withRefreshLock(() => new Promise<void>((resolve) => { releaseA = resolve; }));
  await waitForLock(directory);
  const startedAt = Date.now();
  await assert.rejects(processB.withRefreshLock(async () => { bRan = true; }), storeModule.CredentialStoreError, "B fails closed");
  const waited = Date.now() - startedAt;
  assert.ok(waited >= 300 && waited < 5_000, `bounded wait (${waited} ms)`);
  assert.equal(bRan, false, "B never entered");
  assert.ok(await fs.stat(join(directory, "refresh.lock")), "A still holds the lock");
  releaseA();
  await holder;
  assert.equal(await fs.stat(join(directory, "refresh.lock")).catch(() => null), null, "A released its own lock");
  await processB.withRefreshLock(async () => { bRan = true; });
  assert.equal(bRan, true, "after A's release B enters");
  // A connection operation that cannot get the lock reports temporarily_unavailable (no inference, nothing written).
  const connected = await connectedContext({});
  const lockHolder = storeModule.createChatGPTCredentialStore({ directory: connected.store.directory });
  let releaseHolder: () => void = () => {};
  const held = lockHolder.withRefreshLock(() => new Promise<void>((resolve) => { releaseHolder = resolve; }));
  await waitForLock(connected.store.directory);
  const blocked = connectionModule.createChatGPTConnection({
    store: storeModule.createChatGPTCredentialStore({ directory: connected.store.directory, lockTiming: { waitMs: 200, pollMs: 25 } }),
    fetch: (async () => { throw new Error("no network expected"); }) as any, callbackPort: PORT, now: () => new Date("2026-10-06T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } },
  });
  assert.deepEqual(await blocked.accessToken(), { ok: false, reason: "temporarily_unavailable" });
  assert.deepEqual(await blocked.disconnect(), { status: "unavailable" });
  releaseHolder();
  await held;
});

test("A-2 lock B: an old mtime never grants takeover — the lock is neither deleted nor acquired, however old", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-lock-b-"));
  const processA = storeModule.createChatGPTCredentialStore({ directory });
  const processB = storeModule.createChatGPTCredentialStore({ directory, lockTiming: { waitMs: 300, pollMs: 25 } });
  let releaseA: () => void = () => {};
  const holder = processA.withRefreshLock(() => new Promise<void>((resolve) => { releaseA = resolve; }));
  await waitForLock(directory);
  const lockPath = join(directory, "refresh.lock");
  const tokenBefore = await fs.readFile(lockPath, "utf8");
  // Far beyond any former stale threshold (A-1 used 61.5 s; Phase A 30 s): one day old.
  const ancient = new Date(Date.now() - 24 * 3_600_000);
  await fs.utimes(lockPath, ancient, ancient);
  let bRan = false;
  await assert.rejects(processB.withRefreshLock(async () => { bRan = true; }), storeModule.CredentialStoreError);
  assert.equal(bRan, false, "B did not acquire");
  assert.equal(await fs.readFile(lockPath, "utf8"), tokenBefore, "the lock was not deleted or replaced");
  assert.ok(Math.abs((await fs.stat(lockPath)).mtimeMs - ancient.getTime()) < 2_000, "untouched");
  // An abandoned lock (crashed holder) keeps failing closed — no automatic recovery.
  await assert.rejects(processB.withRefreshLock(async () => { bRan = true; }));
  assert.equal(bRan, false);
  releaseA();
  await holder;
  assert.equal(await fs.stat(lockPath).catch(() => null), null);
});

test("A-2 lock C: a non-owner or late release cannot delete another holder's lock (owner token)", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-lock-c-"));
  const lockPath = join(directory, "refresh.lock");
  const processA = storeModule.createChatGPTCredentialStore({ directory });
  let releaseA: () => void = () => {};
  const holder = processA.withRefreshLock(() => new Promise<void>((resolve) => { releaseA = resolve; }));
  await waitForLock(directory);
  // Simulate another process's lock replacing A's (e.g. manual cleanup + restart of another PAC process).
  await fs.writeFile(lockPath, "another-holders-token", { mode: 0o600 });
  releaseA();
  await holder;
  assert.equal(await fs.readFile(lockPath, "utf8"), "another-holders-token", "A's late release left the other holder's lock in place");
  // While that lock exists nobody enters.
  const processB = storeModule.createChatGPTCredentialStore({ directory, lockTiming: { waitMs: 200, pollMs: 25 } });
  await assert.rejects(processB.withRefreshLock(async () => undefined));
  // Manual recovery (PAC stopped): removing only refresh.lock restores operation.
  await fs.unlink(lockPath);
  let ran = false;
  await processB.withRefreshLock(async () => { ran = true; });
  assert.equal(ran, true);
  // The lock file is never followed through a symlink.
  const outside = join(directory, "..", "outside-lock-target");
  await fs.writeFile(outside, "x", { mode: 0o600 });
  await fs.symlink(outside, lockPath);
  await assert.rejects(processB.withRefreshLock(async () => undefined), "an existing symlink is just an existing lock (EEXIST): fail closed");
  assert.equal(await fs.readFile(outside, "utf8"), "x", "the symlink target was not touched");
});

test("A-1 registration identity: same subject under two issued client ids = two registrations; returning credentials never overwrite the other", async () => {
  assert.notEqual(connectionModule.registrationLabel("oaiapp_a", "same-subject"), connectionModule.registrationLabel("oaiapp_b", "same-subject"));
  assert.equal(connectionModule.registrationLabel("oaiapp_a", "same-subject"), connectionModule.registrationLabel("oaiapp_a", "same-subject"));
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-chatgpt-multi-"));
  const store = storeModule.createChatGPTCredentialStore({ directory });
  const register = async (issued: string, n: number) => {
    let body: unknown = null;
    const transport = fakeFetch({ [oauth.chatgptOAuth.tokenEndpoint]: () => ({ status: 200, json: body }), [oauth.chatgptOAuth.jwksUri]: jwksRoute });
    const connection = connectionModule.createChatGPTConnection({ store, callbackPort: PORT, now: () => new Date("2026-10-06T12:00:00.000Z"), ownerAuthority: { async verify() { return true; } }, fetch: transport.fetch as any });
    const started = await connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
    const url = new URL((started as any).url);
    body = { ...(await tokenResponse({ access_token: SECRET("ACCESS", n), refresh_token: SECRET("REFRESH", n) }, { nonce: url.searchParams.get("nonce"), sub: "same-subject" }, { audience: issued })) };
    return connection.complete(callback({ code: `c${n}`, state: url.searchParams.get("state")!, client_id: issued }));
  };
  assert.equal((await register("oaiapp_first_client", 1)).outcome, "connected");
  // Add another account registration (no active selection → the next sign-in is a first registration).
  const current = await store.readRegistrations();
  await store.writeRegistrations({ ...current, active: null });
  assert.equal((await register("oaiapp_second_client", 2)).outcome, "connected");
  const registrations = (await store.readRegistrations()).registrations;
  assert.equal(registrations.length, 2, "two separate registration records");
  const byClient = Object.fromEntries(registrations.map((item) => [item.clientId, item]));
  assert.equal(byClient.oaiapp_first_client.accessToken, SECRET("ACCESS", 1), "the first registration's credentials are untouched");
  assert.equal(byClient.oaiapp_second_client.accessToken, SECRET("ACCESS", 2));
  assert.equal(byClient.oaiapp_first_client.subject, byClient.oaiapp_second_client.subject);
  assert.notEqual(byClient.oaiapp_first_client.label, byClient.oaiapp_second_client.label);
  assert.equal((await store.readRegistrations()).active, byClient.oaiapp_second_client.label);
});

test("boundaries: no inference, only the A-4 safe server logger, no browser storage, no DB credential path; credentials stay in the local store; the callback trusts no cookie", () => {
  const modules = ["lib/integrations/chatgpt/chatgpt-oauth.ts", "lib/integrations/chatgpt/chatgpt-credential-store.ts", "lib/integrations/chatgpt/chatgpt-connection.ts",
    "lib/integrations/chatgpt/chatgpt-owner-authority.ts", "lib/composition/chatgpt-integration.server.ts", "app/integrations/chatgpt/callback/route.ts",
    "app/settings/integrations/actions.ts", "components/domain/settings/chatgpt-plan-card.tsx", "app/settings/integrations/page.tsx"];
  for (const path of modules) {
    const text = code(path);
    assert.ok(!/\/v1\/responses|backend-api|chatgpt\.com\/backend/u.test(text), `${path} reaches inference or a private ChatGPT endpoint`);
    assert.ok(!/localStorage|sessionStorage|document\.cookie|cookies\(\)/u.test(text), `${path} uses browser / cookie storage`);
    if (path === "lib/composition/chatgpt-integration.server.ts") {
      assert.deepEqual(text.match(/console\.[^;]+;/gu), ['console.info("[chatgpt-oauth]", event);'], "exactly the reviewed safe logger, no other logging");
    } else assert.ok(!/console\./u.test(text), `${path} logs outside the A-4 server boundary`);
    assert.ok(!/ExecutorAdapter|octokit|child_process|lib\/providers|workflow-runtime-service|agent-step-runtime/u.test(text), `${path} reaches executor / provider / runtime`);
  }
  for (const path of ["lib/integrations/chatgpt/chatgpt-oauth.ts", "lib/integrations/chatgpt/chatgpt-credential-store.ts", "lib/integrations/chatgpt/chatgpt-connection.ts"]) {
    assert.ok(!/lib\/db|postgres|insert into|audit_events/iu.test(code(path)), `${path} writes credentials to the database`);
  }
  const card = code("components/domain/settings/chatgpt-plan-card.tsx");
  assert.ok(!/accessToken|refreshToken|idToken|subject|clientId/u.test(card), "the card never touches credential fields");
  assert.ok(!/^\s*["']use client["']/mu.test(card), "Server Component");
  assert.match(code("lib/composition/chatgpt-integration.server.ts"), /^import "server-only";/mu);
  const route = code("app/integrations/chatgpt/callback/route.ts");
  assert.match(route, /status: 303/u);
  assert.match(route, /\$\{origin\}\/settings\/integrations\?chatgpt=\$\{outcome\}/u, "fixed internal return route");
  assert.match(route, /"Referrer-Policy": "no-referrer"/u);
  assert.match(route, /"Cache-Control": "no-store"/u);
  // The jose dependency is direct and pinned (no undeclared transitive import).
  const pkg = JSON.parse(source("package.json"));
  assert.equal(pkg.dependencies.jose, "6.2.12");
});

test("leak scan: fake secrets never reach the status projection; the card / page can only render that projection", async () => {
  const context = await connectedContext({ [oauth.chatgptOAuth.modelsEndpoint]: () => ({ status: 200, json: { models: [{ slug: "gpt-plan-a", display_name: "Plan A", visibility: "list" }] } }) });
  await context.connection.refreshModels();
  await context.connection.selectModel("gpt-plan-a");
  const status = await context.connection.status();
  const projection = JSON.stringify(status);
  assert.deepEqual(Object.keys(status).sort(), ["accessMode", "accountLabel", "availableModels", "modelsCheckedAt", "planUsageGranted", "selectedModel", "state"]);
  for (const secret of [SECRET("ACCESS"), SECRET("REFRESH"), ISSUED, "user-subject-1", "eyJ"]) assert.ok(!projection.includes(secret), `the projection contains ${secret}`);
  // The rendered surface (Server Component card, page) receives ONLY loadChatGPTIntegration()'s view,
  // which carries this projection plus the public "Manage usage" URL; neither file can name a credential field.
  const server = code("lib/composition/chatgpt-integration.server.ts");
  assert.match(server, /return \{ state: "available" as const, status: await connection\.status\(\), manageUsageUrl: "https:\/\/chatgpt\.com\/settings\/usage" \};/u);
  for (const path of ["components/domain/settings/chatgpt-plan-card.tsx", "app/settings/integrations/page.tsx", "app/settings/integrations/actions.ts", "app/integrations/chatgpt/callback/route.ts"]) {
    assert.ok(!/accessToken|refreshToken|idToken|\.subject\b|clientId|codeVerifier|nonce/u.test(code(path)), `${path} names a credential field`);
  }
  // The credential store holds the material — and only it.
  const raw = await fs.readFile(join(context.store.directory, "registrations.json"), "utf8");
  assert.ok(raw.includes(SECRET("ACCESS")));
});
