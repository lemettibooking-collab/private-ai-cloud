/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.2a Auth.js + GitHub session adapter. No network, no real OAuth, no real credentials: the
// verified Auth.js session is faked BELOW the adapter; AI-038.1 is not mocked.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const config = (await import(new URL("../lib/auth/auth-config.ts", import.meta.url).href)) as typeof import("../lib/auth/auth-config");
const adapter = (await import(new URL("../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../lib/auth/github-session-identity-source");
const composed = (await import(new URL("../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../lib/composition/github-owner-read-runtime");
const env = (await import("@auth/core")) as any; // public export: setEnvDefaults(envObject, config)

const SUBJECT = "1234567";
const USER = "00000000-0000-4000-8000-000000000101";
const WORKSPACE = "workspace-primary";
const WORKSPACE_UUID = "00000000-0000-4000-8000-0000000000a1";
const SECRETS = {
  access: "gho_SYNTHETIC_ACCESS_TOKEN_SENTINEL",
  refresh: "ghr_SYNTHETIC_REFRESH_TOKEN_SENTINEL",
  id: "SYNTHETIC_ID_TOKEN_SENTINEL",
  code: "SYNTHETIC_OAUTH_CODE_SENTINEL",
  clientSecret: "SYNTHETIC_CLIENT_SECRET_SENTINEL",
  authSecret: "SYNTHETIC_AUTH_SECRET_SENTINEL",
};
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value) ?? "";
  for (const secret of Object.values(SECRETS)) assert.equal(text.includes(secret), false, secret);
};

// A fake database answering the three statements of this path from small tables.
function fakeDatabase(options: { mappings?: Record<string, { userId: string; status: string }>; owners?: string[]; failMapping?: boolean } = {}) {
  const mappings = options.mappings ?? { [`github:${SUBJECT}`]: { userId: USER, status: "active" } };
  const owners = new Set(options.owners ?? [`${WORKSPACE_UUID}:${USER}`]);
  const calls = { mapping: [] as unknown[][], verify: [] as unknown[][], resolveTenant: 0, released: [] as unknown[] };
  const database = {
    async connect() {
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? "";
          if (tag === "auth-identity:resolve") {
            calls.mapping.push([...values]);
            if (options.failMapping) throw new Error(`driver: postgres://u:${SECRETS.clientSecret}@h/db select * from auth_identities`);
            const row = mappings[`${values[0]}:${values[1]}`];
            return row && row.status === "active" && text.includes("status = 'active'")
              ? { rows: [{ user_id: row.userId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (tag === "workflow-runtime-tenant:resolve") {
            calls.resolveTenant += 1;
            return values[0] === WORKSPACE
              ? { rows: [{ workspace_database_id: WORKSPACE_UUID, domain_workspace_id: WORKSPACE, status: "active" }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (tag === "owner-principal:verify") {
            calls.verify.push([...values]);
            return { rows: [{ is_owner: owners.has(`${values[0]}:${values[1]}`) }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release(destroy?: boolean) { calls.released.push(destroy); },
      };
    },
  };
  return { database, calls };
}

const session = (pacIdentity: unknown = { provider: "github", providerSubject: SUBJECT }, extra: Record<string, unknown> = {}) =>
  ({ expires: "2099-01-01T00:00:00.000Z", pacIdentity, ...extra });

async function resolveWith(sessionValue: unknown, dbOptions: Parameters<typeof fakeDatabase>[0] = {}) {
  const db = fakeDatabase(dbOptions);
  const source = adapter.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => sessionValue }, database: db.database });
  return { db, result: await source.resolve() };
}

// ---------------------------------------------------------------------------------------------
// Auth.js configuration.
// ---------------------------------------------------------------------------------------------

test("config: GitHub is the only provider, stateless JWT, no adapter, no debug, no email linking, credentials only from env", () => {
  const authConfig: any = config.createPacAuthConfig();
  assert.deepEqual(Object.keys(authConfig).sort(), ["callbacks", "debug", "logger", "providers", "session"]);
  assert.equal("adapter" in authConfig, false, "no Auth.js database adapter");
  assert.deepEqual(authConfig.session, { strategy: "jwt" });
  assert.equal(authConfig.debug, false);
  assert.equal(authConfig.providers.length, 1);
  const provider = authConfig.providers[0]({});
  assert.equal(provider.id, "github");
  assert.equal(provider.type, "oauth");
  assert.notEqual(provider.allowDangerousEmailAccountLinking, true);
  assert.equal(provider.clientId, undefined, "no hard-coded client id");
  assert.equal(provider.clientSecret, undefined, "no hard-coded client secret");
  assert.equal("secret" in authConfig, false, "no fallback AUTH_SECRET constant");
  // Auth.js' own env defaults supply the credentials; nothing from the config leaks them.
  const withEnv: any = { ...config.createPacAuthConfig() };
  env.setEnvDefaults({ AUTH_SECRET: SECRETS.authSecret, AUTH_GITHUB_ID: "synthetic-client-id", AUTH_GITHUB_SECRET: SECRETS.clientSecret, NODE_ENV: "test" }, withEnv);
  assert.equal(withEnv.providers[0].clientId, "synthetic-client-id");
  assert.equal(withEnv.providers[0].clientSecret, SECRETS.clientSecret);
  assert.deepEqual(withEnv.secret, [SECRETS.authSecret]);
  const missing: any = { ...config.createPacAuthConfig() };
  env.setEnvDefaults({ NODE_ENV: "test" }, missing);
  assert.equal(missing.providers[0].clientId, undefined, "missing credentials stay missing — no fallback");
  assert.deepEqual(missing.secret, []);
});

test("config: the jwt callback keeps only { provider, providerSubject } from the OAuth account — never tokens, email, login or user id", () => {
  const account = {
    provider: "github", type: "oauth", providerAccountId: SUBJECT,
    access_token: SECRETS.access, refresh_token: SECRETS.refresh, id_token: SECRETS.id, code: SECRETS.code,
    token_type: "bearer", scope: "read:user user:email",
  };
  const token = { name: "Octo Cat", email: "owner@example.com", picture: "https://avatars/x", sub: "random-auth-js-user-id" };
  const signedIn = config.pacJwtCallback({ token, account });
  assert.deepEqual(signedIn, { pacIdentity: { provider: "github", providerSubject: SUBJECT } });
  noSecret(signedIn);
  assert.equal(JSON.stringify(signedIn).includes("owner@example.com"), false);
  // Later requests keep exactly the projection; anything else is dropped.
  assert.deepEqual(config.pacJwtCallback({ token: { ...signedIn, email: "x@y", role: "owner" } }), signedIn);
  // Non-GitHub or malformed identities end the session (null).
  for (const bad of [
    { ...account, provider: "google" }, { ...account, providerAccountId: "octocat" }, { ...account, providerAccountId: "0123" },
    { ...account, providerAccountId: 1234567 }, { ...account, providerAccountId: "1".repeat(21) }, { ...account, providerAccountId: "owner@example.com" },
  ]) {
    assert.equal(config.pacJwtCallback({ token, account: bad }), null);
  }
  assert.equal(config.pacJwtCallback({ token: {} }), null);
  assert.equal(config.pacJwtCallback({ token: { pacIdentity: { provider: "github", providerSubject: SUBJECT, role: "owner" } } }), null);
});

test("config: the session callback exposes only expiry + the PAC identity projection", () => {
  const result = config.pacSessionCallback({
    session: { expires: "2099-01-01T00:00:00.000Z", user: { name: "Octo", email: "owner@example.com", image: "x" }, accessToken: SECRETS.access },
    token: { pacIdentity: { provider: "github", providerSubject: SUBJECT }, access_token: SECRETS.access },
  });
  assert.deepEqual(result, { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: SUBJECT } });
  noSecret(result);
  assert.deepEqual(config.pacSessionCallback({ session: { expires: "2099-01-01T00:00:00.000Z" }, token: {} }), { expires: "2099-01-01T00:00:00.000Z" });
});

test("config: the logger never prints error details, and there is no hard-coded credential in the auth sources", () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const error = Object.assign(new Error(`OAuth failed ${SECRETS.access} ${SECRETS.clientSecret}`), { name: "OAuthCallbackError" });
    (config.createPacAuthConfig().logger as any).error(error);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["[auth] OAuthCallbackError"]);
  for (const file of ["../lib/auth/auth-config.ts", "../lib/auth/next-auth.server.ts", "../lib/auth/github-session-identity-source.ts", "../app/api/auth/[...nextauth]/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/clientSecret\s*:|clientId\s*:|secret\s*:\s*["'`]|process\.env/u.test(source), false, `${file} must not hard-code or read credentials`);
    assert.equal(/allowDangerousEmailAccountLinking/u.test(source.replace(/\/\/.*$/gmu, "")), false);
    assert.equal(/adapter\s*:/u.test(source), false);
  }
});

test("route: the Auth.js route only re-exports the Auth.js GET/POST handlers; it is the only app/api route", () => {
  const route = readFileSync(new URL("../app/api/auth/[...nextauth]/route.ts", import.meta.url), "utf8").replace(/\/\/.*$/gmu, "").trim();
  assert.equal(route, 'import { handlers } from "@/lib/auth/next-auth.server";\n\nexport const { GET, POST } = handlers;');
  const apiRoutes: string[] = [];
  const walk = (url: URL) => {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) walk(new URL(`${encodeURIComponent(name)}/`, url));
      else if (/^route\.(ts|tsx|js)$/u.test(name)) apiRoutes.push(fileURLToPath(child));
    }
  };
  walk(new URL("../app/api/", import.meta.url));
  assert.deepEqual(apiRoutes.map((file) => file.split("/app/api/")[1]), ["auth/[...nextauth]/route.ts"]);
  const server = readFileSync(new URL("../lib/auth/next-auth.server.ts", import.meta.url), "utf8");
  assert.match(server, /^import "server-only";$/mu);
});

// ---------------------------------------------------------------------------------------------
// GitHubSessionIdentitySource.
// ---------------------------------------------------------------------------------------------

test("identity source: an active mapping resolves exactly { userId } using only provider + subject", async () => {
  const { db, result } = await resolveWith(session());
  assert.deepEqual(result, { userId: USER });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(db.calls.mapping, [["github", SUBJECT]], "parameters: provider and subject only (no email, no workspace)");
  assert.equal(db.calls.resolveTenant, 0, "the mapping layer never looks up a workspace");
});

test("identity source: no session, missing / disabled / unknown mapping → null", async () => {
  for (const value of [null, undefined, {}, { expires: "2099-01-01T00:00:00.000Z" }]) {
    assert.equal((await resolveWith(value)).result, null);
  }
  assert.equal((await resolveWith(session(), { mappings: {} })).result, null);
  assert.equal((await resolveWith(session(), { mappings: { [`github:${SUBJECT}`]: { userId: USER, status: "disabled" } } })).result, null);
  assert.equal((await resolveWith(session({ provider: "github", providerSubject: "7654321" }))).result, null);
});

test("identity source: hostile claims (role, workspace, userId, email) carry no authority; only the projection is read", async () => {
  const hostile = session(undefined, { role: "owner", workspace: "tenant-b", workspaceId: "tenant-b", userId: "00000000-0000-4000-8000-000000000999",
    email: "owner@example.com", user: { email: "owner@example.com", id: "00000000-0000-4000-8000-000000000999" }, accessToken: SECRETS.access });
  const { db, result } = await resolveWith(hostile);
  assert.deepEqual(result, { userId: USER }, "the PAC mapping decides the user, not the claims");
  assert.deepEqual(db.calls.mapping, [["github", SUBJECT]]);
  noSecret(result);
  // Authority-bearing fields INSIDE the projection are rejected outright.
  for (const projection of [
    { provider: "github", providerSubject: SUBJECT, userId: USER },
    { provider: "github", providerSubject: SUBJECT, role: "owner" },
    { provider: "github", providerSubject: SUBJECT, email: "owner@example.com" },
  ]) {
    const rejected = await resolveWith(session(projection));
    assert.equal(rejected.result, null);
    assert.deepEqual(rejected.db.calls.mapping, []);
  }
});

test("identity source: malformed provider / subject never reaches or broadens the lookup", async () => {
  for (const projection of [
    { provider: "GitHub", providerSubject: SUBJECT }, { provider: "google", providerSubject: SUBJECT }, { provider: "github", providerSubject: "%" },
    { provider: "github", providerSubject: "' or '1'='1" }, { provider: "github", providerSubject: "octocat" }, { provider: "github", providerSubject: "" },
    { provider: "github", providerSubject: `${SUBJECT} ` }, { provider: "github", providerSubject: 1234567 }, { provider: "github", providerSubject: "owner@example.com" },
    { provider: "github" }, { providerSubject: SUBJECT }, [], "github:1234567", null,
  ]) {
    const { db, result } = await resolveWith(session(projection));
    assert.equal(result, null, JSON.stringify(projection));
    assert.deepEqual(db.calls.mapping, [], "no query for a malformed identity");
  }
});

test("identity source: Proxy, accessor, array, class-instance and thenable sessions are rejected without executing them", async () => {
  let trapped = 0;
  let getterRan = false;
  let thenCalled = false;
  const handler = { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; },
    getPrototypeOf() { trapped += 1; return Object.prototype; }, getOwnPropertyDescriptor() { trapped += 1; return undefined; } };
  for (const value of [
    new Proxy(session(), handler),
    session(new Proxy({ provider: "github", providerSubject: SUBJECT }, handler)),
    Object.defineProperty({ expires: "x" }, "pacIdentity", { enumerable: true, get() { getterRan = true; return { provider: "github", providerSubject: SUBJECT }; } }),
    session(Object.defineProperty({ provider: "github" }, "providerSubject", { enumerable: true, get() { getterRan = true; return SUBJECT; } })),
    [session()],
    new (class Session { pacIdentity = { provider: "github", providerSubject: SUBJECT }; })(),
    { ...session(), [Symbol("x")]: 1 },
    { then(resolve: (value: unknown) => void) { thenCalled = true; resolve(session()); } },
    Object.defineProperty({}, "then", { enumerable: true, get() { getterRan = true; return undefined; } }),
  ]) {
    const { db, result } = await resolveWith(value);
    assert.equal(result, null);
    assert.deepEqual(db.calls.mapping, []);
  }
  assert.equal(trapped, 0);
  assert.equal(getterRan, false);
  assert.equal(thenCalled, false);
  // A genuine Promise of a valid session is accepted.
  assert.deepEqual((await resolveWith(Promise.resolve(session()))).result, { userId: USER });
});

test("identity source: construction hardening, receiver-free captured methods, replacement after capture changes nothing", async () => {
  const db = fakeDatabase();
  let getterRan = false;
  for (const input of [
    null, {}, { sessionResolver: { resolve: () => null } }, { sessionResolver: { resolve: () => null }, database: db.database, extra: 1 },
    { sessionResolver: new Proxy({ resolve: () => null }, {}), database: db.database },
    { sessionResolver: { resolve: () => null }, database: new Proxy(db.database, {}) },
    { sessionResolver: Object.defineProperty({}, "resolve", { enumerable: true, get() { getterRan = true; return () => null; } }), database: db.database },
    new Proxy({ sessionResolver: { resolve: () => null }, database: db.database }, {}),
  ]) {
    assert.throws(() => adapter.createGitHubSessionIdentitySource(input), /configuration is invalid/u);
  }
  assert.equal(getterRan, false);
  const receivers: unknown[] = [];
  const resolver: any = {
    current: session(),
    resolve(this: any) { receivers.push(this); return this?.current ?? session({ provider: "github", providerSubject: "7654321" }); },
  };
  const source = adapter.createGitHubSessionIdentitySource({ sessionResolver: resolver, database: db.database });
  resolver.resolve = () => session();
  resolver.current = session();
  assert.equal(await source.resolve(), null, "the captured receiver-free method saw no receiver state (unknown subject 7654321)");
  assert.deepEqual(receivers, [undefined]);
  assert.deepEqual(db.calls.mapping, [["github", "7654321"]]);
});

test("identity source: database failures are sanitized and discard the session; a malformed stored user id is refused", async () => {
  const failed = await resolveWith(session(), { failMapping: true });
  assert.equal(failed.result, null);
  assert.ok(failed.db.calls.released.includes(true));
  const malformed = await resolveWith(session(), { mappings: { [`github:${SUBJECT}`]: { userId: "not-a-uuid", status: "active" } } });
  assert.equal(malformed.result, null);
});

// ---------------------------------------------------------------------------------------------
// Composition through AI-038.1 (not mocked) and request scope.
// ---------------------------------------------------------------------------------------------

test("composition: session → mapping → AI-038.1 membership/Owner → backend; every failure is opaque", async () => {
  const db = fakeDatabase();
  const ok = await composed.createGitHubOwnerReadRuntime({ database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() } });
  assert.equal(ok.verdict, "allow");
  assert.deepEqual(db.calls.verify, [[WORKSPACE_UUID, USER]], "AI-038.1 verified THIS tenant with the mapped PAC user");
  assert.deepEqual(Reflect.ownKeys(ok.backend!).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "getTask", "getTaskFeaturePlans", "listApprovalQueue", "listProjectTasks", "listProjects", "listRuns", "listTasks"]);
  const unauthenticated = { verdict: "deny", reason: "unauthenticated", backend: null };
  const unavailable = { verdict: "deny", reason: "unavailable", backend: null };
  assert.deepEqual(await composed.createGitHubOwnerReadRuntime({ database: fakeDatabase().database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => null } }), unauthenticated);
  assert.deepEqual(await composed.createGitHubOwnerReadRuntime({ database: fakeDatabase({ mappings: {} }).database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() } }), unauthenticated);
  assert.deepEqual(await composed.createGitHubOwnerReadRuntime({ database: fakeDatabase({ owners: [] }).database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() } }), unavailable);
  assert.deepEqual(await composed.createGitHubOwnerReadRuntime({ database: fakeDatabase().database, domainWorkspaceId: "tenant-b", sessionResolver: { resolve: () => session() } }), unavailable);
  for (const input of [
    new Proxy({ database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() } }, {}),
    { database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() }, userId: USER },
    { database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: { resolve: () => session() }, role: "owner" },
    { database: db.database, sessionResolver: { resolve: () => session() } },
    null,
  ]) {
    assert.deepEqual(await composed.createGitHubOwnerReadRuntime(input), unavailable);
  }
});

test("request scope: each composition re-reads session, mapping and membership; nothing is cached", async () => {
  const db = fakeDatabase({ mappings: { [`github:${SUBJECT}`]: { userId: USER, status: "active" } } });
  let current: unknown = session();
  const resolver = { resolve: () => current };
  const first = await composed.createGitHubOwnerReadRuntime({ database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: resolver });
  current = null;
  const second = await composed.createGitHubOwnerReadRuntime({ database: db.database, domainWorkspaceId: WORKSPACE, sessionResolver: resolver });
  assert.equal(first.verdict, "allow");
  assert.deepEqual(second, { verdict: "deny", reason: "unauthenticated", backend: null });
  assert.equal(db.calls.mapping.length, 1, "no identity → no mapping query");
  assert.equal(db.calls.resolveTenant, 2);
});

// ---------------------------------------------------------------------------------------------
// Server-only and import rules.
// ---------------------------------------------------------------------------------------------

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  const walk = (url: URL) => {
    for (const name of readdirSync(url)) {
      const child = new URL(encodeURIComponent(name), url);
      if (statSync(child).isDirectory()) walk(new URL(`${encodeURIComponent(name)}/`, url));
      else if (/\.(ts|tsx|js|jsx|mts)$/u.test(name)) out.push(fileURLToPath(child));
    }
  };
  walk(new URL(`../${directory}/`, import.meta.url));
  assert.ok(out.length > 0);
  return out;
}

test("server-only: auth and GitHub composition entries are `server-only`; UI never imports auth internals", () => {
  for (const entry of ["../lib/auth/next-auth.server.ts", "../lib/composition/github-owner-read-runtime.server.ts"]) {
    assert.match(readFileSync(new URL(entry, import.meta.url), "utf8"), /^import "server-only";$/mu, entry);
  }
  const githubEntry = readFileSync(new URL("../lib/composition/github-owner-read-runtime.server.ts", import.meta.url), "utf8");
  assert.match(githubEntry, /sessionResolver: \{ resolve: \(\) => auth\(\) \}/u, "the request's own Auth.js session");
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const source = readFileSync(file, "utf8");
    const isAuthRoute = file.endsWith("/app/api/auth/[...nextauth]/route.ts");
    if (!isAuthRoute) {
      assert.equal(/lib\/auth\//u.test(source), false, `${file} must not import auth internals`);
    }
    assert.equal(/github-session-identity-source|auth-config|(?<!authenticated-)owner-read-runtime|github-owner-read-runtime(?!\.server)/u.test(source), false, file);
    if (/^\s*["']use client["']/mu.test(source)) {
      assert.equal(/next-auth\.server|github-owner-read-runtime|authenticated-owner-read-runtime|lib\/auth|lib\/composition/u.test(source), false, `${file} is a Client Component`);
    }
  }
});
