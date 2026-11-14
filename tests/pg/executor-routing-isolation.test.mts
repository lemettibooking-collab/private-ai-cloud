import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement, select } from "../fixtures/executor-routing.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { workload } from "../fixtures/executor-portability.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { financialPolicy } from "../fixtures/durable-executor.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const core = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const db = await live.useLiveDatabase("routing_isolation");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Router proof')", [live.primaryWorkspace.id]);
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
for (const provider of ["openai", "anthropic"] as const) test(`B2 PG ${provider}: Router ALLOW cannot reserve/start/rebind durable authority`, async () => {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
  const f = workload(provider, `routing-${provider}`, 1, tenant.workspaceDatabaseId);
  const control = authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration: f.configuration });
  assert.equal((await control.registerCurrentAuthority()).status, "registered");
  const store = core.createPostgresExecutorStartStore({ database, tenant, projectId: "project-a", configuration: f.configuration,
    target: f.target, requestPolicy: f.policy, financialPolicy: financialPolicy(), authorizeStart: () => true });
  const r = requirement(); Object.assign(r, { admission: f.configuration.admission, developmentRun: f.configuration.developmentRun, repository: f.configuration.repository });
  r.policy.requiredExecutorId = candidate(provider).executor.id;
  const before = await control.inspectCurrentAuthority(); const decision = select([candidate(), candidate("anthropic")], r);
  assert.equal(decision.verdict, "allow"); assert.equal(decision.selectedRoute?.providerId, provider);
  assert.equal(decision.dispatchAuthorized, false); assert.equal(decision.runtimeDispatchAllowed, false);
  assert.deepEqual(await control.inspectCurrentAuthority(), before);
  assert.throws(() => authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration: decision }));
  assert.equal((await store.commitProviderStart(decision, f.prepared.requestFingerprint)).startCapability, null);
  assert.equal((await store.commitProviderStart(f.raw, f.prepared.requestFingerprint)).startCapability, null);
  assert.deepEqual(await control.inspectCurrentAuthority(), before);
  assert.equal((await db.admin.query("select count(*)::int as n from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2", [tenant.workspaceDatabaseId, f.raw.attempt.developmentRunId])).rows[0].n, 0);
});
