/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.1 authenticated identity boundary: request-scoped, provider-neutral identity source →
// tenant-scoped Owner verification → AI-038.0 OwnerReadBackend. The SQL policy itself is proven live
// (tests/pg/authenticated-owner-read-runtime.test.mts); here the fake database answers the single
// owner-principal statement from a table of (workspace UUID, user id) Owner facts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const authenticated = (await import(
  new URL("../lib/composition/authenticated-owner-read-runtime.ts", import.meta.url).href
)) as typeof import("../lib/composition/authenticated-owner-read-runtime");

const workspaceId = "workspace-primary";
const workspaceUuid = "00000000-0000-4000-8000-0000000000a1";
const ownerUser = "00000000-0000-4000-8000-000000000101";
const otherUser = "00000000-0000-4000-8000-000000000102";
const secret = "SESSION_TOKEN_DO_NOT_PROPAGATE_7f3a";

function fakeDatabase(options: { owners?: string[]; failVerify?: boolean; workspaceStatus?: string } = {}) {
  const owners = new Set(options.owners ?? [`${workspaceUuid}:${ownerUser}`]);
  const calls = { connect: 0, resolves: 0, verifies: [] as unknown[][], reads: 0, released: [] as unknown[] };
  const database = {
    async connect() {
      calls.connect += 1;
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? text.trim();
          if (tag === "workflow-runtime-tenant:resolve") {
            calls.resolves += 1;
            return values[0] === workspaceId
              ? { rows: [{ workspace_database_id: workspaceUuid, domain_workspace_id: workspaceId, status: options.workspaceStatus ?? "active" }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (tag === "owner-principal:verify") {
            calls.verifies.push([...values]);
            if (options.failVerify) throw new Error(`driver: DATABASE_URL=postgres://u:${secret}@h/db select * from users`);
            return { rows: [{ is_owner: owners.has(`${values[0]}:${values[1]}`) }], rowCount: 1 };
          }
          calls.reads += 1;
          return { rows: [], rowCount: 0 };
        },
        release(destroy?: boolean) { calls.released.push(destroy); },
      };
    },
  };
  return { database, calls };
}

function identity(result: unknown | (() => unknown)) {
  const calls: unknown[][] = [];
  return {
    calls,
    source: { resolve(...args: unknown[]) { calls.push(args); return typeof result === "function" ? (result as () => unknown)() : result; } },
  };
}

async function compose(identityResult: unknown, dbOptions: Parameters<typeof fakeDatabase>[0] = {}) {
  const db = fakeDatabase(dbOptions);
  const id = identity(identityResult);
  const decision = await authenticated.createAuthenticatedOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, identitySource: id.source });
  return { db, id, decision };
}

const unauthenticated = { verdict: "deny", reason: "unauthenticated", backend: null };
const unavailable = { verdict: "deny", reason: "unavailable", backend: null };

test("A–B. a valid identity source is resolved exactly once, with no arguments; an active Owner gets the backend", async () => {
  const { db, id, decision } = await compose({ userId: ownerUser });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(id.calls, [[]], "resolve() called once, no arguments");
  assert.equal(db.calls.resolves, 1, "tenant resolved once");
  assert.deepEqual(db.calls.verifies, [[workspaceUuid, ownerUser]], "one tenant-scoped Owner check");
  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(Reflect.ownKeys(decision.backend!).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "listApprovalQueue"]);
  assert.deepEqual(await decision.backend!.listApprovalQueue(), { verdict: "allow", status: "available", data: [] });
  // Upper-case UUIDs are canonicalized to the internal lower-case form.
  const upper = await compose({ userId: ownerUser.toUpperCase() });
  assert.equal(upper.decision.verdict, "allow");
  assert.deepEqual(upper.db.calls.verifies, [[workspaceUuid, ownerUser]]);
});

test("tenant first: an unavailable workspace denies before the identity source is consulted", async () => {
  for (const [status, overrides] of [["archived", {}], ["suspended", {}], ["active", { domainWorkspaceId: "workspace-missing" }]] as const) {
    const db = fakeDatabase({ workspaceStatus: status });
    const id = identity({ userId: ownerUser });
    const decision = await authenticated.createAuthenticatedOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, identitySource: id.source, ...overrides });
    assert.deepEqual(decision, unavailable);
    assert.deepEqual(id.calls, [], "identity never resolved for an unusable tenant");
    assert.deepEqual(db.calls.verifies, []);
  }
});

test("C. no identity (null / undefined) → unauthenticated, with no membership read", async () => {
  for (const result of [null, undefined, Promise.resolve(null)]) {
    const { db, decision } = await compose(result);
    assert.deepEqual(decision, unauthenticated);
    assert.deepEqual(db.calls.verifies, [], "no membership/role read without an identity");
  }
});

test("D. a throwing or rejecting identity source fails closed, sanitized", async () => {
  for (const result of [() => { throw new Error(`session store down ${secret}`); }, () => Promise.reject(new Error(secret))]) {
    const { db, decision } = await compose(result);
    assert.deepEqual(decision, unauthenticated);
    assert.equal(JSON.stringify(decision).includes(secret), false);
    assert.deepEqual(db.calls.verifies, []);
  }
});

test("E. malformed user ids fail closed without a membership read", async () => {
  for (const userId of ["", "owner", "owner@smartalgorithms.local", `${ownerUser} `, `${ownerUser}x`, "00000000-0000-0000-0000-000000000000",
    ownerUser.replaceAll("-", ""), 42, null, ["x"], { id: ownerUser }]) {
    const { db, decision } = await compose({ userId });
    assert.deepEqual(decision, unauthenticated, JSON.stringify(userId));
    assert.deepEqual(db.calls.verifies, []);
  }
});

test("F–H. Proxy, accessor, symbol-keyed, extra-field and exotic identity results are rejected; no trap or getter runs", async () => {
  let trapped = 0;
  let getterRan = false;
  const handler = { get() { trapped += 1; return ownerUser; }, ownKeys() { trapped += 1; return ["userId"]; },
    getOwnPropertyDescriptor() { trapped += 1; return { value: ownerUser, enumerable: true, configurable: true, writable: true }; },
    getPrototypeOf() { trapped += 1; return Object.prototype; } };
  for (const result of [
    new Proxy({ userId: ownerUser }, handler),
    Object.defineProperty({}, "userId", { enumerable: true, get() { getterRan = true; return ownerUser; } }),
    { userId: ownerUser, [Symbol("role")]: "owner" },
    { userId: ownerUser, role: "owner" },
    { userId: ownerUser, workspaceId: "tenant-b" },
    { userId: ownerUser, actorId: "owner-one" },
    { userId: ownerUser, token: secret },
    Object.assign(Object.create({ inherited: true }), { userId: ownerUser }),
    new (class Session { userId = ownerUser; })(),
    [ownerUser],
    ownerUser,
  ]) {
    const { db, decision } = await compose(result);
    assert.deepEqual(decision, unauthenticated);
    assert.equal(JSON.stringify(decision).includes(secret), false);
    assert.deepEqual(db.calls.verifies, []);
  }
  assert.equal(trapped, 0, "no Proxy trap ran");
  assert.equal(getterRan, false, "no identity getter ran");
});

test("F′. thenables are never followed and async Proxy results are still rejected", async () => {
  let thenCalled = false;
  let thenGetterRan = false;
  for (const result of [
    { then(resolve: (value: unknown) => void) { thenCalled = true; resolve({ userId: ownerUser }); } },
    Object.defineProperty({}, "then", { enumerable: true, get() { thenGetterRan = true; return undefined; } }),
    Object.assign(Promise.resolve({ userId: ownerUser }), { then: () => { thenCalled = true; } }),
  ]) {
    const { db, decision } = await compose(result);
    assert.deepEqual(decision, unauthenticated);
    assert.deepEqual(db.calls.verifies, []);
  }
  assert.equal(thenCalled, false, "a foreign then() is never invoked");
  assert.equal(thenGetterRan, false, "a then getter is never read");
  // A genuine Promise resolving to a Proxy: rejected after resolution (any trap ran in the source's own promise).
  const asyncProxy = await compose(Promise.resolve().then(() => new Proxy({ userId: ownerUser }, {})));
  assert.deepEqual(asyncProxy.decision, unauthenticated);
  // A genuine Promise resolving to a valid identity is accepted.
  assert.equal((await compose(Promise.resolve({ userId: ownerUser }))).decision.verdict, "allow");
});

test("I. construction rejects Proxy, getter, missing or non-callable identity sources and malformed configuration", async () => {
  const db = fakeDatabase();
  let getterRan = false;
  for (const config of [
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: new Proxy({ resolve: () => ({ userId: ownerUser }) }, {}) },
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: Object.defineProperty({}, "resolve", { enumerable: true, get() { getterRan = true; return () => ({ userId: ownerUser }); } }) },
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: {} },
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: { resolve: "owner" } },
    { database: db.database, domainWorkspaceId: workspaceId },
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: { resolve: () => null }, ownerActorId: "owner-one" },
    { database: db.database, domainWorkspaceId: workspaceId, identitySource: { resolve: () => null }, userId: ownerUser },
    { database: db.database, domainWorkspaceId: "Workspace Primary", identitySource: { resolve: () => null } },
    { database: new Proxy(db.database, {}), domainWorkspaceId: workspaceId, identitySource: { resolve: () => null } },
    new Proxy({ database: db.database, domainWorkspaceId: workspaceId, identitySource: { resolve: () => null } }, {}),
    null,
  ]) {
    assert.deepEqual(await authenticated.createAuthenticatedOwnerReadRuntime(config), unavailable);
  }
  assert.equal(getterRan, false);
  assert.equal(db.calls.connect, 0, "invalid configuration never touches the database");
});

test("J–K. replacing resolve() or mutating the source's receiver state after capture changes nothing", async () => {
  const db = fakeDatabase();
  const receivers: unknown[] = [];
  const source: any = {
    user: ownerUser,
    resolve(this: any) {
      receivers.push(this);
      return { userId: this?.user ?? otherUser };
    },
  };
  const pending = authenticated.createAuthenticatedOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, identitySource: source });
  // Mutations while the composition is in flight (after capture): neither can change the identity.
  source.resolve = () => ({ userId: ownerUser });
  source.user = ownerUser;
  const decision = await pending;
  assert.equal(receivers.includes(source), false, "the caller's object is never the receiver");
  assert.deepEqual(receivers, [undefined]);
  assert.deepEqual(db.calls.verifies, [[workspaceUuid, otherUser]], "the captured method ran receiver-free");
  assert.deepEqual(decision, unavailable, "otherUser is not an Owner; mutation granted nothing");
});

test("X. a database failure during the Owner check is sanitized and the session is discarded", async () => {
  const { db, decision } = await compose({ userId: ownerUser }, { failVerify: true });
  assert.deepEqual(decision, unavailable);
  assert.equal(/DATABASE_URL|postgres|select|driver|SESSION_TOKEN/u.test(JSON.stringify(decision)), false);
  assert.ok(db.calls.released.includes(true), "failed session released with destroy");
});

test("opaque failure model: not-Owner, other-tenant Owner and unknown user are indistinguishable", async () => {
  const notOwner = await compose({ userId: otherUser });
  const otherTenant = await compose({ userId: ownerUser }, { owners: [`00000000-0000-4000-8000-0000000000b2:${ownerUser}`] });
  const nobody = await compose({ userId: "00000000-0000-4000-8000-000000000999" });
  assert.deepEqual(notOwner.decision, unavailable);
  assert.deepEqual(otherTenant.decision, unavailable);
  assert.deepEqual(nobody.decision, unavailable);
  assert.deepEqual(otherTenant.db.calls.verifies, [[workspaceUuid, ownerUser]], "checked only against THIS tenant");
});

test("request-scoped: every composition resolves identity and membership again; nothing is cached", async () => {
  const db = fakeDatabase();
  let user = ownerUser;
  const source = { resolve: () => ({ userId: user }) };
  const first = await authenticated.createAuthenticatedOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, identitySource: source });
  user = otherUser;
  const second = await authenticated.createAuthenticatedOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, identitySource: source });
  assert.equal(first.verdict, "allow");
  assert.deepEqual(second, unavailable);
  assert.equal(db.calls.resolves, 2);
  assert.deepEqual(db.calls.verifies, [[workspaceUuid, ownerUser], [workspaceUuid, otherUser]]);
  assert.notEqual(first.backend, second.backend);
});

test("no token propagation: nothing but the internal user id crosses the boundary", async () => {
  const withToken = await compose({ userId: ownerUser, sessionToken: secret });
  assert.deepEqual(withToken.decision, unauthenticated);
  const ok = await compose({ userId: ownerUser });
  const text = JSON.stringify([ok.decision, await ok.decision.backend!.getRunOverview("run-one"), ok.db.calls.verifies]);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(workspaceUuid) && JSON.stringify(ok.decision).includes(workspaceUuid), false, "no workspace UUID in the decision");
});

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  const walk = (url: URL) => {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) walk(new URL(`${name}/`, url));
      else if (/\.(ts|tsx|js|jsx|mts)$/u.test(name)) out.push(fileURLToPath(child));
    }
  };
  walk(new URL(`../${directory}/`, import.meta.url));
  assert.ok(out.length > 0);
  return out;
}

test("server-only and entry rule: the authenticated entry is `server-only`; UI uses neither bundle internals nor the AI-038.0 entry", () => {
  const entry = readFileSync(new URL("../lib/composition/authenticated-owner-read-runtime.server.ts", import.meta.url), "utf8");
  assert.match(entry, /^import "server-only";$/mu);
  assert.match(entry, /export \{ createAuthenticatedOwnerReadRuntime \} from "\.\/authenticated-owner-read-runtime";/u);
  assert.equal(/createOwnerReadRuntime(ForTenant)?\b(?!.*Authenticated)/u.test(entry.replace(/createAuthenticatedOwnerReadRuntime/gu, "")), false,
    "the authenticated entry does not re-export the lower-level compositions");
  const core = readFileSync(new URL("../lib/composition/authenticated-owner-read-runtime.ts", import.meta.url), "utf8");
  assert.match(core, /typeof window !== "undefined"/u);
  assert.match(core, /createOwnerReadRuntimeForTenant/u, "delegates through AI-038.0");
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const source = readFileSync(file, "utf8");
    assert.equal(/(?<!authenticated-)owner-read-runtime/u.test(source), false, `${file}: authenticated traffic must use the AI-038.1 entry`);
    assert.equal(/authenticated-owner-read-runtime(?!\.server)/u.test(source), false, `${file}: only the .server entry`);
    if (/^\s*["']use client["']/mu.test(source)) assert.equal(/owner-read-runtime/u.test(source), false, `${file} is a Client Component`);
  }
});
