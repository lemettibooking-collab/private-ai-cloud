/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-037.7 tenant-bound facade. Two workspaces hold a Run with the SAME runtime id;
// each facade sees only its own tenant, and a request claiming the other workspace is stopped at the
// facade before any database connection is opened.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(
  new URL("./helpers/live-pg.ts", import.meta.url).href
)) as typeof import("./helpers/live-pg");
const fixtures = (await import(
  new URL("./helpers/runtime-fixtures.ts", import.meta.url).href
)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(
  new URL("../../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(
  new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-persistence");
const tenantContract = (await import(
  new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-tenant");
const facadeContract = (await import(
  new URL("../../lib/workflows/workflow-runtime-tenant-facade.ts", import.meta.url).href
)) as typeof import("../../lib/workflows/workflow-runtime-tenant-facade");

const db = await live.useLiveDatabase("facade");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await live.insertWorkspace(db.admin, live.secondaryWorkspace);
const A = live.primaryWorkspace.domain;
const B = live.secondaryWorkspace.domain;

// The canonical fixture, re-homed to another workspace.
function stateFor(workspace: string, started: boolean) {
  const base = started
    ? fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started")
    : fixtures.createWorkflowRuntimeStateFixture();
  return JSON.parse(JSON.stringify(base).replaceAll("\"workspace-primary\"", JSON.stringify(workspace)));
}

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
// Counts every connection a facade opens (the only way its read model reaches PostgreSQL).
function countingDatabase() {
  const calls = { connect: 0 };
  return { calls, database: { connect: () => { calls.connect += 1; return database.connect(); } } };
}
const authorizer = { authorize: (input: any) => ({ verdict: input.actorId === "owner-one" ? "allow" : "deny" }) };

const persistenceA = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: A });
const persistenceB = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: B });
assert.ok(persistenceA && persistenceB);
// Same runtime id in both workspaces: A's Run is started (revision 1), B's is queued (revision 0).
await persistenceA.stateStore.create({ state: stateFor(A, true) });
await persistenceB.stateStore.create({ state: stateFor(B, false) });
const bOnly = stateFor(B, false);
bOnly.snapshot.runId = "run-b-only";
await persistenceB.stateStore.create({ state: bOnly });

const resolver = tenantContract.createPostgresWorkflowRuntimeTenantResolver(database);
const tenantA = await resolver.resolve(A);
const tenantB = await resolver.resolve(B);
assert.ok(tenantA && tenantB);

test("AI-037.7 live: each tenant facade reads only its own Run for the same runtime id", async () => {
  const dbA = countingDatabase();
  const dbB = countingDatabase();
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database: dbA.database, authorizer });
  const facadeB = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantB, database: dbB.database, authorizer });
  const a = await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-one" });
  const b = await facadeB.getRunOverview({ workspaceId: B, actorId: "owner-one", runId: "run-one" });
  assert.equal(a.status, "available", JSON.stringify(a));
  assert.equal(b.status, "available", JSON.stringify(b));
  assert.deepEqual([a.data?.status, a.data?.revision], ["running", 1], "A's Run");
  assert.deepEqual([b.data?.status, b.data?.revision], ["queued", 0], "B's Run, never A's");
  assert.equal(JSON.stringify(a).includes(live.secondaryWorkspace.id), false);
  assert.equal(JSON.stringify(b).includes(live.primaryWorkspace.id), false);
  const usageA = await facadeA.getRunModelUsage({ workspaceId: A, actorId: "owner-one", runId: "run-one" });
  const timelineA = await facadeA.getRunAuditTimeline({ workspaceId: A, actorId: "owner-one", runId: "run-one", limit: 10 });
  const queueA = await facadeA.listApprovalQueue({ workspaceId: A, actorId: "owner-one" });
  assert.equal(usageA.status, "available");
  assert.equal(timelineA.status, "available");
  assert.ok((timelineA.data ?? []).every((item) => item.runId === "run-one"));
  assert.deepEqual(queueA, { verdict: "allow", status: "available", data: [] });
  assert.equal(dbA.calls.connect, 4, "one read-model connection per delegated request");
});

test("AI-037.7 live: a request claiming the other workspace is stopped at the facade — zero connections, opaque", async () => {
  const dbA = countingDatabase();
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database: dbA.database, authorizer });
  for (const request of [
    () => facadeA.getRunOverview({ workspaceId: B, actorId: "owner-one", runId: "run-one" }),
    () => facadeA.getRunOverview({ workspaceId: B, actorId: "owner-one", runId: "run-b-only" }),
    () => facadeA.getRunModelUsage({ workspaceId: B, actorId: "owner-one", runId: "run-one" }),
    () => facadeA.getRunAuditTimeline({ workspaceId: B, actorId: "owner-one", runId: "run-one" }),
    () => facadeA.listApprovalQueue({ workspaceId: B, actorId: "owner-one" }),
  ]) {
    assert.deepEqual(await request(), { verdict: "deny", status: "unavailable", data: null });
  }
  assert.equal(dbA.calls.connect, 0, "no raw read was attempted for a foreign workspace");
});

test("AI-037.7 live: a Run that exists only in the other workspace is indistinguishable from a missing Run", async () => {
  const dbA = countingDatabase();
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database: dbA.database, authorizer });
  const foreignRun = await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-b-only" });
  const missingRun = await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-never-created" });
  const foreignWorkspace = await facadeA.getRunOverview({ workspaceId: B, actorId: "owner-one", runId: "run-b-only" });
  assert.deepEqual(foreignRun, missingRun);
  assert.deepEqual(foreignRun, foreignWorkspace);
  assert.deepEqual(foreignRun, { verdict: "deny", status: "unavailable", data: null });
  assert.equal(dbA.calls.connect, 2, "the in-tenant lookups were tenant-scoped reads; the foreign-workspace request made none");
});

test("AI-037.7 live: invalid, Proxy and unauthorized requests never reach PostgreSQL", async () => {
  const dbA = countingDatabase();
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database: dbA.database, authorizer });
  assert.equal((await facadeA.getRunOverview(new Proxy({ workspaceId: A, actorId: "owner-one", runId: "run-one" }, {}))).status, "invalid_input");
  assert.equal((await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-one", extra: 1 })).status, "invalid_input");
  assert.equal((await facadeA.listApprovalQueue({ workspaceId: A, actorId: "owner-one", limit: 101 })).status, "limit_exceeded");
  assert.equal((await facadeA.getRunOverview({ workspaceId: A, actorId: "intruder", runId: "run-one" })).status, "unavailable");
  assert.equal(dbA.calls.connect, 0);
});

test("AI-037.7 live (corrective #1): the real production database object works as a receiver-free dependency", async () => {
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database, authorizer });
  const a = await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-one" });
  assert.deepEqual([a.status, a.data?.status, a.data?.revision], ["available", "running", 1]);
});

test("AI-037.7 live (corrective #1): mutating the original dependency objects after construction cannot retarget facade A", async () => {
  const bConnections = { count: 0 };
  const foreignDatabase = { connect: () => { bConnections.count += 1; return database.connect(); } };
  const aConnections = { count: 0 };
  const callerDb: any = { connect: () => { aConnections.count += 1; return database.connect(); }, target: null };
  const callerAuth: any = {
    allowedActor: "owner-one",
    authorize(this: any, input: any) {
      // Receiver-free authorizer: the decision cannot depend on the caller's mutable object.
      return { verdict: this === undefined && input.actorId === "owner-one" ? "allow" : "deny" };
    },
  };
  const facadeA = facadeContract.createTenantBoundWorkflowRuntimeFacade({ tenant: tenantA, database: callerDb, authorizer: callerAuth });
  // Post-construction mutations: method replacement, receiver state pointing at another dependency,
  // and authorization state that would grant an intruder if the original receiver were used.
  callerDb.connect = foreignDatabase.connect;
  callerDb.target = foreignDatabase;
  callerAuth.allowedActor = "intruder";
  callerAuth.authorize = () => ({ verdict: "allow" });
  const a = await facadeA.getRunOverview({ workspaceId: A, actorId: "owner-one", runId: "run-one" });
  assert.deepEqual([a.status, a.data?.status, a.data?.revision], ["available", "running", 1], "still A's Run");
  assert.equal(aConnections.count, 1);
  assert.equal(bConnections.count, 0, "the replaced connect was never used");
  const intruder = await facadeA.getRunOverview({ workspaceId: A, actorId: "intruder", runId: "run-one" });
  assert.deepEqual(intruder, { verdict: "deny", status: "unavailable", data: null }, "mutated authorization state granted nothing");
  assert.equal(aConnections.count, 1, "no read for the denied intruder");
  const mismatch = await facadeA.getRunOverview({ workspaceId: B, actorId: "owner-one", runId: "run-one" });
  assert.deepEqual(mismatch, { verdict: "deny", status: "unavailable", data: null });
  assert.equal(aConnections.count + bConnections.count, 1, "workspace mismatch still does zero database work");
});

test("AI-037.7 live teardown", async () => {
  await database.close();
});
