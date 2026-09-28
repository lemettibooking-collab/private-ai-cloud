import assert from "node:assert/strict";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- hostile composition inputs cross unknown */

const tenantContract = (await import(
  new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-tenant");
const persistenceContract = (await import(
  new URL("../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-persistence");
const storeContract = (await import(
  new URL("../lib/db/workflow-runtime-store.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-store");
const readContract = (await import(
  new URL("../lib/db/workflow-runtime-read-model.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-read-model");

const { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } = tenantContract;
const { createPostgresWorkflowRuntimePersistence } = persistenceContract;
const { PostgresWorkflowRuntimeStateStore } = storeContract;
const { PostgresWorkflowRuntimeReadModel } = readContract;
const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";

class TenantDatabase {
  readonly rows: Record<string, readonly Record<string, unknown>[]>;
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  releases = 0;
  error: Error | null = null;

  constructor(rows: Record<string, readonly Record<string, unknown>[]>) {
    this.rows = rows;
  }

  async connect() {
    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        this.queries.push({ text, values });
        if (this.error) throw this.error;
        const rows = this.rows[String(values[0])] ?? [];
        return { rows: rows as readonly Row[], rowCount: rows.length };
      },
      release: () => { this.releases += 1; },
    };
  }
}

function row(domainWorkspaceId: string, workspaceDatabaseId: string, status = "active") {
  return {
    workspace_database_id: workspaceDatabaseId,
    domain_workspace_id: domainWorkspaceId,
    status,
  };
}

test("tenant resolver maps each canonical domain Workspace to exactly one DB UUID", async () => {
  const database = new TenantDatabase({
    "workspace-a": [row("workspace-a", workspaceA)],
    "workspace-b": [row("workspace-b", workspaceB, "demo")],
  });
  const resolver = createPostgresWorkflowRuntimeTenantResolver(database);
  const first = await resolver.resolve("workspace-a");
  const second = await resolver.resolve("workspace-b");
  assert.deepEqual(first, { workspaceId: "workspace-a", workspaceDatabaseId: workspaceA });
  assert.deepEqual(second, { workspaceId: "workspace-b", workspaceDatabaseId: workspaceB });
  assert.equal(isResolvedWorkflowRuntimeTenant(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(database.queries.map((query) => query.values), [["workspace-a"], ["workspace-b"]]);
});

test("tenant resolver fails closed for malformed, missing, duplicate, inactive, malformed UUID, and DB errors", async () => {
  const database = new TenantDatabase({
    duplicate: [row("duplicate", workspaceA), row("duplicate", workspaceB)],
    inactive: [row("inactive", workspaceA, "suspended")],
    malformed: [row("malformed", "not-a-uuid")],
  });
  const resolver = createPostgresWorkflowRuntimeTenantResolver(database);
  assert.equal(await resolver.resolve("UPPERCASE"), null);
  assert.equal(database.queries.length, 0);
  assert.equal(await resolver.resolve("missing"), null);
  assert.equal(await resolver.resolve("duplicate"), null);
  assert.equal(await resolver.resolve("inactive"), null);
  assert.equal(await resolver.resolve("malformed"), null);
  database.error = new Error("postgresql://secret@production");
  assert.equal(await resolver.resolve("workspace-a"), null);
});

test("runtime constructors require a resolver-owned identity and reject structural forgeries", async () => {
  const database = new TenantDatabase({ "workspace-a": [row("workspace-a", workspaceA)] });
  const forged = { workspaceId: "workspace-a", workspaceDatabaseId: workspaceA };
  assert.equal(isResolvedWorkflowRuntimeTenant(forged), false);
  assert.throws(() => new PostgresWorkflowRuntimeStateStore({ database, tenant: forged } as any));
  assert.throws(() => new PostgresWorkflowRuntimeReadModel({ database, tenant: forged } as any));
  const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve("workspace-a");
  assert.ok(tenant);
  assert.doesNotThrow(() => new PostgresWorkflowRuntimeStateStore({ database, tenant }));
  assert.doesNotThrow(() => new PostgresWorkflowRuntimeReadModel({ database, tenant }));
});

test("public persistence composition rejects caller-supplied workspaceDatabaseId", async () => {
  const database = new TenantDatabase({ "workspace-a": [row("workspace-a", workspaceA)] });
  const hostile = await createPostgresWorkflowRuntimePersistence({
    database,
    domainWorkspaceId: "workspace-a",
    workspaceDatabaseId: workspaceB,
  });
  assert.equal(hostile, null);
  assert.equal(database.queries.length, 0);
  const resolved = await createPostgresWorkflowRuntimePersistence({
    database,
    domainWorkspaceId: "workspace-a",
  });
  assert.ok(resolved);
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(database.queries.at(-1)?.values, ["workspace-a"]);
});

test("public persistence composition fails closed for malformed or hostile configuration", async () => {
  assert.equal(await createPostgresWorkflowRuntimePersistence({
    database: {},
    domainWorkspaceId: "workspace-a",
  }), null);
  const hostile = new Proxy({}, {
    ownKeys() { throw new Error("hostile keys"); },
  });
  assert.equal(await createPostgresWorkflowRuntimePersistence(hostile), null);
});

test("resolver outputs are fresh, deterministic, frozen, and caller input is not mutated", async () => {
  const database = new TenantDatabase({ "workspace-a": [row("workspace-a", workspaceA)] });
  const resolver = createPostgresWorkflowRuntimeTenantResolver(database);
  const input = "workspace-a";
  const first = await resolver.resolve(input);
  const second = await resolver.resolve(input);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(input, "workspace-a");
});
