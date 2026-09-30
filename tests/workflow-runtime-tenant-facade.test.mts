/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-037.7: tenant-bound facade + pre-auth limits. Ordering is asserted with spies: the structural
// gate and the workspace check run before any authorization or database work.
import assert from "node:assert/strict";
import test from "node:test";

const facadeContract = (await import(
  new URL("../lib/workflows/workflow-runtime-tenant-facade.ts", import.meta.url).href
)) as typeof import("../lib/workflows/workflow-runtime-tenant-facade");
const tenantContract = (await import(
  new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-tenant");

const { createTenantBoundWorkflowRuntimeFacade, tenantBoundWorkflowRuntimeFacadeLimits: limits } = facadeContract;
const workspaceId = "workspace-primary";
const workspaceDatabaseId = "00000000-0000-4000-8000-0000000000a1";

// A genuine tenant from the real resolver (trusted identity), over a one-row fake workspace table.
async function resolvedTenant(domain = workspaceId, id = workspaceDatabaseId) {
  const resolver = tenantContract.createPostgresWorkflowRuntimeTenantResolver({
    async connect() {
      return {
        async query() {
          return { rows: [{ workspace_database_id: id, domain_workspace_id: domain, status: "active" }], rowCount: 1 };
        },
        release() {},
      };
    },
  });
  const tenant = await resolver.resolve(domain);
  assert.ok(tenant);
  return tenant;
}

// Observes the delegated path: every connect and every SQL statement the read model would issue.
function spyDatabase(rows: (tag: string) => { rows: unknown[]; rowCount: number } = () => ({ rows: [], rowCount: 0 }), fail = false) {
  const calls = { connect: 0, queries: [] as string[], workspaceParameters: [] as unknown[] };
  const database = {
    async connect() {
      calls.connect += 1;
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? text.trim();
          calls.queries.push(tag);
          if (values.length > 0) calls.workspaceParameters.push(values[0]);
          if (fail && !/snapshot-(begin|rollback)/u.test(tag)) throw new Error("driver failure: postgres://user:secret@db/x select secret");
          return rows(tag);
        },
        release() {},
      };
    },
  };
  return { database, calls };
}

function spyAuthorizer(verdict: "allow" | "deny" = "allow") {
  const calls: any[] = [];
  return { authorizer: { authorize(input: any) { calls.push(input); return { verdict }; } }, calls };
}

async function facade(options: { verdict?: "allow" | "deny"; rows?: Parameters<typeof spyDatabase>[0]; fail?: boolean } = {}) {
  const db = spyDatabase(options.rows, options.fail);
  const auth = spyAuthorizer(options.verdict);
  const instance = createTenantBoundWorkflowRuntimeFacade({ tenant: await resolvedTenant(), database: db.database, authorizer: auth.authorizer });
  const delegated = () => ({ authorizations: auth.calls.length, connects: db.calls.connect, queries: db.calls.queries.length });
  return { instance, db, auth, delegated };
}

const run = (overrides: Record<string, unknown> = {}) => ({ workspaceId, actorId: "owner-one", runId: "run-one", ...overrides });
const queue = (overrides: Record<string, unknown> = {}) => ({ workspaceId, actorId: "owner-one", ...overrides });
const none = { authorizations: 0, connects: 0, queries: 0 };

// A–D: valid requests delegate exactly once, with the bound tenant's workspace.
test("A–D. valid overview, approval queue, audit timeline and model usage: gate → workspace → one authorization → one read", async () => {
  for (const [name, call] of [
    ["overview", (f: any) => f.getRunOverview(run())],
    ["queue", (f: any) => f.listApprovalQueue(queue({ limit: 10 }))],
    ["timeline", (f: any) => f.getRunAuditTimeline(run({ limit: 5 }))],
    ["usage", (f: any) => f.getRunModelUsage(run())],
  ] as const) {
    const f = await facade();
    const result = await call(f.instance);
    assert.equal(f.auth.calls.length, 1, `${name}: authorized once`);
    assert.equal(f.auth.calls[0].workspaceId, workspaceId, `${name}: bound workspace`);
    assert.equal(f.auth.calls[0].actorId, "owner-one");
    assert.equal(f.db.calls.connect, 1, `${name}: one read-model delegation`);
    assert.ok(f.db.calls.workspaceParameters.every((value) => value === workspaceDatabaseId), `${name}: tenant-scoped SQL`);
    assert.equal(Object.isFrozen(result), true);
    if (name === "queue") assert.deepEqual(result, { verdict: "allow", status: "available", data: [] });
  }
});

test("E. workspace mismatch is opaque and performs zero authorization and zero database work", async () => {
  const f = await facade();
  for (const call of [
    () => f.instance.getRunOverview(run({ workspaceId: "tenant-b" })),
    () => f.instance.listApprovalQueue(queue({ workspaceId: "tenant-b" })),
    () => f.instance.getRunAuditTimeline(run({ workspaceId: "tenant-b", limit: 5 })),
    () => f.instance.getRunModelUsage(run({ workspaceId: "tenant-b" })),
  ]) {
    const result = await call();
    assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null });
    assert.equal(JSON.stringify(result).includes(workspaceId), false, "no bound-workspace oracle");
  }
  assert.deepEqual(f.delegated(), none);
});

test("U. a delegated not_found is the same opaque unavailable as a foreign workspace", async () => {
  const f = await facade();
  const missing = await f.instance.getRunOverview(run({ runId: "run-missing" }));
  const foreign = await f.instance.getRunOverview(run({ workspaceId: "tenant-b" }));
  assert.deepEqual(missing, foreign);
  assert.equal(f.db.calls.connect, 1, "only the in-tenant request reached the read model");
});

test("authorizer denial is also opaque unavailable, after the gate and workspace check, before any read", async () => {
  const f = await facade({ verdict: "deny" });
  assert.deepEqual(await f.instance.getRunOverview(run()), { verdict: "deny", status: "unavailable", data: null });
  assert.equal(f.auth.calls.length, 1);
  assert.equal(f.db.calls.connect, 0);
});

test("F. construction requires a genuine resolved tenant: forged, Proxy and cross-resolver look-alikes are refused", async () => {
  const db = spyDatabase();
  const auth = spyAuthorizer();
  const genuine = await resolvedTenant();
  for (const tenant of [
    { workspaceId, workspaceDatabaseId },
    Object.freeze({ ...genuine }),
    new Proxy(genuine, {}),
    null,
    undefined,
    "workspace-primary",
  ]) {
    assert.throws(() => createTenantBoundWorkflowRuntimeFacade({ tenant, database: db.database, authorizer: auth.authorizer }),
      /configuration is invalid/u);
  }
  assert.equal(db.calls.connect + auth.calls.length, 0);
});

test("construction hardening: missing, extra, getter and Proxy dependencies fail closed; methods are captured once", async () => {
  const tenant = await resolvedTenant();
  const db = spyDatabase();
  const auth = spyAuthorizer();
  let getterRan = false;
  const getterDb = Object.defineProperty({}, "connect", { enumerable: true, get() { getterRan = true; return db.database.connect; } });
  for (const config of [
    { tenant, database: db.database },
    { tenant, database: db.database, authorizer: auth.authorizer, extra: true },
    { tenant, database: getterDb, authorizer: auth.authorizer },
    { tenant, database: new Proxy(db.database, {}), authorizer: auth.authorizer },
    { tenant, database: db.database, authorizer: new Proxy(auth.authorizer, {}) },
    { tenant, database: {}, authorizer: auth.authorizer },
    { tenant, database: db.database, authorizer: { authorize: "not a function" } },
    new Proxy({ tenant, database: db.database, authorizer: auth.authorizer }, {}),
    Object.defineProperty({ database: db.database, authorizer: auth.authorizer }, "tenant", { enumerable: true, get: () => tenant }),
  ]) {
    assert.throws(() => createTenantBoundWorkflowRuntimeFacade(config), /configuration is invalid/u);
  }
  assert.equal(getterRan, false, "no dependency getter was invoked");
  // Mutation after construction does not substitute the captured methods.
  const mutableDb: any = { connect: db.database.connect };
  const mutableAuth: any = { authorize: auth.authorizer.authorize };
  const instance = createTenantBoundWorkflowRuntimeFacade({ tenant, database: mutableDb, authorizer: mutableAuth });
  let substituted = 0;
  mutableDb.connect = async () => { substituted += 1; throw new Error("substituted"); };
  mutableAuth.authorize = () => { substituted += 1; return { verdict: "allow" }; };
  await instance.getRunOverview(run());
  assert.equal(substituted, 0);
  assert.equal(db.calls.connect, 1);
  assert.equal(auth.calls.length, 1);
  assert.equal(Object.isFrozen(instance), true);
  assert.deepEqual(Object.keys(instance).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "listApprovalQueue"]);
});

test("G–H. root and nested Proxy requests are denied before any trap runs and before any delegation", async () => {
  const f = await facade();
  let trapped = 0;
  const handler = { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; }, getPrototypeOf() { trapped += 1; return Object.prototype; },
    getOwnPropertyDescriptor() { trapped += 1; return undefined; }, has() { trapped += 1; return false; } };
  for (const request of [
    new Proxy(run(), handler),
    new Proxy(run(), {}),
    run({ runId: new Proxy({}, handler) }),
    run({ actorId: new Proxy(["owner-one"], handler) }),
    queue({ limit: new Proxy([10], handler) }),
  ]) {
    assert.deepEqual(await f.instance.getRunOverview(request), { verdict: "deny", status: "invalid_input", data: null });
    assert.deepEqual(await f.instance.listApprovalQueue(request), { verdict: "deny", status: "invalid_input", data: null });
  }
  assert.equal(trapped, 0, "no Proxy trap executed");
  assert.deepEqual(f.delegated(), none);
});

test("I–M. getters are never invoked; symbol keys, extra fields, missing fields and invalid IDs are denied before delegation", async () => {
  const f = await facade();
  let getterRan = false;
  const getter = Object.defineProperty(queue(), "actorId", { enumerable: true, get() { getterRan = true; return "owner-one"; } });
  const setter = Object.defineProperty(run(), "limit", { enumerable: true, set() { getterRan = true; } });
  const cases: unknown[] = [
    getter, setter,
    { ...run(), [Symbol("x")]: 1 },
    { ...run(), extra: true },
    { ...run(), __proto__: null, other: 1 },
    { workspaceId, runId: "run-one" },
    { actorId: "owner-one", runId: "run-one" },
    run({ runId: "Run One" }), run({ runId: "" }), run({ runId: 1 }), run({ runId: null }),
    run({ workspaceId: "Workspace-Primary" }), run({ actorId: "owner one" }), run({ actorId: "" }),
    null, undefined, "run-one", 1, [run()], new Date(), new Map(), new Set(),
    new (class Request { workspaceId = workspaceId; actorId = "owner-one"; runId = "run-one"; })(),
    Object.create({ workspaceId, actorId: "owner-one", runId: "run-one" }),
  ];
  for (const request of cases) {
    const result = await f.instance.getRunOverview(request);
    assert.equal(result.verdict, "deny");
    assert.equal(result.status, "invalid_input", JSON.stringify(result));
  }
  assert.equal(getterRan, false, "no accessor was executed");
  assert.deepEqual(f.delegated(), none);
});

test("N–R. oversized strings, objects, nesting, arrays, cycles and non-finite numbers are denied before delegation", async () => {
  const f = await facade();
  const cyclic: any = run(); cyclic.self = cyclic;
  const deep: any = {}; let cursor = deep; for (let i = 0; i < 100; i += 1) { cursor.next = {}; cursor = cursor.next; }
  const wide = Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => [`k${index}`, index]));
  const expectations: Array<[unknown, "invalid_input" | "limit_exceeded"]> = [
    [run({ runId: "r".repeat(limits.maxIdLength + 1) }), "limit_exceeded"],
    [run({ workspaceId: "w".repeat(1_000_000) }), "limit_exceeded"],
    [run({ actorId: "a".repeat(limits.maxActorIdLength + 1) }), "limit_exceeded"],
    [wide, "limit_exceeded"],
    [{ ...run(), a: 1, b: 2 }, "limit_exceeded"],
    [run({ runId: deep }), "invalid_input"],
    [run({ runId: Array.from({ length: 1_000_000 }) }), "invalid_input"],
    [cyclic, "invalid_input"],
    [run({ limit: Number.NaN }), "invalid_input"],
    [run({ limit: Number.POSITIVE_INFINITY }), "invalid_input"],
    [run({ limit: 1.5 }), "invalid_input"],
    [run({ limit: 0 }), "invalid_input"],
    [run({ limit: "10" }), "invalid_input"],
  ];
  for (const [request, status] of expectations) {
    const result = await f.instance.getRunAuditTimeline(request);
    assert.deepEqual(result, { verdict: "deny", status, data: null });
  }
  assert.deepEqual(f.delegated(), none);
});

test("S. a limit above the read-model maximum is denied before delegation; the maximum itself is accepted", async () => {
  const f = await facade();
  assert.deepEqual(await f.instance.listApprovalQueue(queue({ limit: limits.maxLimit + 1 })), { verdict: "deny", status: "limit_exceeded", data: null });
  assert.deepEqual(await f.instance.getRunAuditTimeline(run({ limit: Number.MAX_SAFE_INTEGER })), { verdict: "deny", status: "limit_exceeded", data: null });
  assert.deepEqual(f.delegated(), none);
  assert.equal(limits.maxLimit, 100);
  assert.equal((await f.instance.listApprovalQueue(queue({ limit: limits.maxLimit }))).status, "available");
  assert.equal(f.db.calls.connect, 1);
});

test("T. a failing dependency yields the sanitized opaque decision; raw error text never escapes", async () => {
  const f = await facade({ fail: true });
  const throwingAuth = createTenantBoundWorkflowRuntimeFacade({
    tenant: await resolvedTenant(),
    database: spyDatabase().database,
    authorizer: { authorize() { throw new Error("authorizer exploded: postgres://secret"); } },
  });
  for (const result of [
    await f.instance.getRunOverview(run()),
    await f.instance.getRunModelUsage(run()),
    await f.instance.getRunAuditTimeline(run()),
    await f.instance.listApprovalQueue(queue()),
    await throwingAuth.getRunOverview(run()),
  ]) {
    assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null });
    assert.equal(/secret|postgres|driver|exploded/u.test(JSON.stringify(result)), false);
  }
});

test("V. every decision is frozen, including denials", async () => {
  const f = await facade();
  for (const result of [
    await f.instance.getRunOverview(run()),
    await f.instance.getRunOverview(run({ workspaceId: "tenant-b" })),
    await f.instance.getRunOverview(null),
    await f.instance.listApprovalQueue(queue()),
  ]) {
    assert.equal(Object.isFrozen(result), true);
    if (result.data !== null) assert.equal(Object.isFrozen(result.data), true);
  }
});

test("the bound tenant cannot be replaced after construction: a request cannot re-target another tenant's facade", async () => {
  const tenantB = await resolvedTenant("tenant-b", "00000000-0000-4000-8000-0000000000b2");
  const dbB = spyDatabase();
  const facadeB = createTenantBoundWorkflowRuntimeFacade({ tenant: tenantB, database: dbB.database, authorizer: spyAuthorizer().authorizer });
  assert.deepEqual(await facadeB.getRunOverview(run()), { verdict: "deny", status: "unavailable", data: null });
  assert.equal(dbB.calls.connect, 0);
  await facadeB.getRunOverview(run({ workspaceId: "tenant-b" }));
  assert.ok(dbB.calls.workspaceParameters.every((value) => value === "00000000-0000-4000-8000-0000000000b2"));
});

// Corrective #1: captured callables must not keep the caller's mutable object as their receiver.
test("receiver: mutating the ORIGINAL database object's state after construction cannot redirect the facade", async () => {
  const tenant = await resolvedTenant();
  const legitimate = spyDatabase();
  const foreign = spyDatabase();
  const receivers: unknown[] = [];
  const callerDb: any = {
    target: legitimate.database,
    connect(this: any) {
      receivers.push(this);
      // A receiver-dependent method: it would follow whatever the caller later puts in `target`.
      return this.target.connect();
    },
  };
  const auth = spyAuthorizer();
  const instance = createTenantBoundWorkflowRuntimeFacade({ tenant, database: callerDb, authorizer: auth.authorizer });
  callerDb.target = foreign.database; // post-construction mutation of receiver-owned state
  const result = await instance.getRunOverview(run());
  assert.equal(receivers.includes(callerDb), false, "the original caller object is never the receiver");
  assert.equal(foreign.calls.connect, 0, "the mutation cannot retarget the facade to another dependency");
  assert.equal(legitimate.calls.connect, 0, "a receiver-dependent method fails closed instead of reading");
  assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null });
});

test("receiver: mutating the ORIGINAL authorizer object's state after construction cannot change a decision", async () => {
  const tenant = await resolvedTenant();
  const db = spyDatabase();
  const receivers: unknown[] = [];
  const callerAuth: any = {
    allowed: "nobody",
    authorize(this: any, input: any) {
      receivers.push(this);
      return { verdict: this?.allowed === input.actorId ? "allow" : "deny" };
    },
  };
  const instance = createTenantBoundWorkflowRuntimeFacade({ tenant, database: db.database, authorizer: callerAuth });
  callerAuth.allowed = "owner-one"; // post-construction mutation of receiver-owned state
  const result = await instance.getRunOverview(run());
  assert.equal(receivers.includes(callerAuth), false, "the original caller object is never the receiver");
  assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null }, "the mutation granted nothing");
  assert.equal(db.calls.connect, 0, "no read after the (unchanged) denial");
});

test("receiver: a receiver-free (closure) dependency works exactly as before, and a workspace mismatch still does zero work", async () => {
  const tenant = await resolvedTenant();
  const db = spyDatabase();
  const auth = spyAuthorizer();
  // Detached copies of the methods: no `this` is needed, like createWorkflowRuntimePostgresDatabase.
  const connect = db.database.connect;
  const authorize = auth.authorizer.authorize;
  const instance = createTenantBoundWorkflowRuntimeFacade({
    tenant,
    database: { connect: () => connect() },
    authorizer: { authorize: (input: any) => authorize(input) },
  });
  assert.equal((await instance.listApprovalQueue(queue())).status, "available");
  assert.deepEqual(await instance.getRunOverview(run({ workspaceId: "tenant-b" })), { verdict: "deny", status: "unavailable", data: null });
  assert.equal(auth.calls.length, 1);
  assert.equal(db.calls.connect, 1);
});
