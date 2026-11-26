/* eslint-disable @typescript-eslint/no-explicit-any -- live SQL fixtures cross untyped pg boundaries */
// Live PostgreSQL: tenant integrity enforced by the database (AI-036.5 / migration 0007).
// A representative matrix derived from the AI-036 re-gate harness attack-db.mts (J, L, M): every
// cross-workspace vector must fail on its tenant constraint, and every same-workspace control
// must succeed. Vectors that first hit an unrelated uniqueness constraint are deliberately omitted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
const tenantContract = (await import(
  new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-tenant");

const db = await live.useLiveDatabase("tenant");
const A = live.primaryWorkspace.id;
const B = live.secondaryWorkspace.id;
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await live.insertWorkspace(db.admin, live.secondaryWorkspace);

const hex = (character: string) => character.repeat(64);
const one = async (sql: string, values: unknown[] = []) => (await db.admin.query(sql, values)).rows[0];

async function attempt(sql: string, values: unknown[] = []) {
  await db.admin.query("savepoint vector");
  try {
    await db.admin.query(sql, values);
    await db.admin.query("release savepoint vector");
    return { accepted: true as const };
  } catch (error: any) {
    await db.admin.query("rollback to savepoint vector");
    return { accepted: false as const, sqlstate: String(error.code), constraint: error.constraint ?? null };
  }
}

async function runRow(workspaceId: string, runtimeId: string) {
  const snapshot = fixtures.createWorkflowRuntimeStateFixture().snapshot;
  return (await one(`insert into workflow_runs (workspace_id, status, runtime_id, project_id, workflow_id, revision,
      runtime_snapshot, project_registry, model_provider_registry)
    values ($1, 'queued', $2, 'project-one', 'workflow-one', 0, $3, '{}'::jsonb, '{}'::jsonb) returning id`,
  [workspaceId, runtimeId, JSON.stringify(snapshot)])).id as string;
}

async function executionChain(workspaceId: string, runDbId: string, tag: string) {
  const claim = (await one(`insert into workflow_runtime_claims (workspace_id, run_id, step_id, attempt_number,
      expected_revision, execution_id, status, lease_expires_at, released_at)
    values ($1, $2, 'step-one', 1, 0, $3, 'released', now(), now()) returning id`, [workspaceId, runDbId, `execution-${tag}`])).id;
  const execution = (await one(`insert into workflow_runtime_executions (workspace_id, run_id, claim_id, step_id,
      attempt_number, expected_revision, execution_id, request_fingerprint, status, started_at, completed_at)
    values ($1, $2, $3, 'step-one', 1, 0, $4, $5, 'completed', now(), now()) returning id`,
  [workspaceId, runDbId, claim, `execution-${tag}`, hex("a")])).id;
  const invocation = (await one(`insert into workflow_model_invocations (workspace_id, workflow_run_id,
      workflow_execution_id, invocation_id, run_revision, project_id, workflow_id, agent_id, agent_binding_id, step_id,
      attempt_number, model_profile_id, request_fingerprint, reservation_token, status, provider_id, deployment_id,
      provider_model_id, provider_model_version, provider_request_model_id, provider_identity_version)
    values ($1, $2, $3, $4, 1, 'project-one', 'workflow-one', 'agent-one', 'agent-one-binding', 'step-one', 1,
      'model-shared', $5, $6, 'running', 'p', 'd', 'm', 'v', 'r', 2) returning id`,
  [workspaceId, runDbId, execution, `invocation-${tag}`, `sha256:${hex("a")}`, randomUUID()])).id;
  return { execution, invocation };
}

const budgetReservationSql = `insert into workflow_model_budget_reservations (workspace_id, workflow_run_id,
    workflow_execution_id, model_invocation_id, invocation_id, project_id, department_id, workflow_id,
    workflow_binding_id, workflow_binding_version, step_id, attempt_number, request_fingerprint,
    input_envelope_fingerprint, canonical_request_fingerprint, provider_id, deployment_id, provider_model_id,
    provider_request_model_id, provider_model_version, input_token_count, effective_max_output_tokens,
    reserved_total_tokens, reserved_cost_usd_micros, daily_token_budget, monthly_cost_budget_usd_micros,
    daily_window_start, monthly_window_start, status)
  values ($1, $2, $3, $4, $5, 'project-one', 'department-one', 'workflow-one', 'workflow-one-binding', 1,
    'step-one', 1, $6, $6, $6, 'p', 'd', 'm', 'r', 'v', 1, 1, 2, 0, 10, 10, current_date,
    date_trunc('month', current_date)::date, 'reserved')`;

test("cross-workspace runtime relations fail on their tenant constraints; same-workspace controls succeed", async () => {
  await db.admin.query("begin");
  try {
    const runA = await runRow(A, "run-a");
    const runB = await runRow(B, "run-b");
    const chainA = await executionChain(A, runA, "a");
    const chainB = await executionChain(B, runB, "b");
    const stepSql = `insert into workflow_step_runs (workspace_id, run_id, step_key, type, status)
      values ($1, $2, 'step-x', 'agent_task', 'pending')`;
    const commandSql = `insert into workflow_runtime_commands (workspace_id, run_id, command_id, fingerprint,
      expected_revision, status, lease_expires_at) values ($1, $2, 'command-x', $3, 0, 'in_progress', now())`;
    const claimSql = `insert into workflow_runtime_claims (workspace_id, run_id, step_id, attempt_number,
      expected_revision, execution_id, status, lease_expires_at, released_at)
      values ($1, $2, 'step-x', 1, 0, 'execution-x', 'released', now(), now())`;

    const matrix = {
      "step A -> Run B": await attempt(stepSql, [A, runB]),
      "step A -> Run A": await attempt(stepSql, [A, runA]),
      "command A -> Run B": await attempt(commandSql, [A, runB, hex("c")]),
      "command A -> Run A": await attempt(commandSql, [A, runA, hex("c")]),
      "claim A -> Run B": await attempt(claimSql, [A, runB]),
      "claim A -> Run A": await attempt(claimSql, [A, runA]),
      "budget A -> invocation B": await attempt(budgetReservationSql,
        [A, runA, chainA.execution, chainB.invocation, "invocation-b", `sha256:${hex("b")}`]),
      "budget A -> invocation A": await attempt(budgetReservationSql,
        [A, runA, chainA.execution, chainA.invocation, "invocation-a", `sha256:${hex("a")}`]),
      "Run A re-homed to workspace B while it has children": await attempt(
        "update workflow_runs set workspace_id = $2 where id = $1", [runA, B]),
    };
    assert.deepEqual(matrix, {
      "step A -> Run B": { accepted: false, sqlstate: "23503", constraint: "workflow_step_runs_run_workspace_fk" },
      "step A -> Run A": { accepted: true },
      "command A -> Run B": { accepted: false, sqlstate: "23503", constraint: "workflow_runtime_commands_run_workspace_fk" },
      "command A -> Run A": { accepted: true },
      "claim A -> Run B": { accepted: false, sqlstate: "23503", constraint: "workflow_runtime_claims_run_workspace_fk" },
      "claim A -> Run A": { accepted: true },
      "budget A -> invocation B": {
        accepted: false, sqlstate: "23503", constraint: "workflow_model_budget_reservations_invocation_workspace_fk",
      },
      "budget A -> invocation A": { accepted: true },
      "Run A re-homed to workspace B while it has children": {
        accepted: false, sqlstate: "23503", constraint: "workflow_model_invocations_workspace_run_fk",
      },
    });
  } finally {
    await db.admin.query("rollback");
  }
});

test("runtime audit events cannot reference another workspace's Run or omit the workspace", async () => {
  await db.admin.query("begin");
  try {
    await runRow(A, "run-a");
    await runRow(B, "run-b");
    const auditSql = `insert into audit_events (workspace_id, event_type, actor_kind, actor_id, runtime_run_id, runtime_event_key)
      values ($1, 'workflow.test', 'owner', 'owner-one', $2, $3)`;
    const matrix = {
      "audit A -> Run B": await attempt(auditSql, [A, "run-b", "key-cross"]),
      "audit A -> Run A": await attempt(auditSql, [A, "run-a", "key-same"]),
      "runtime audit without workspace": await attempt(auditSql, [null, "run-a", "key-null"]),
      "platform audit (no workspace, no Run)": await attempt(
        "insert into audit_events (workspace_id, event_type) values (null, 'platform.test')"),
    };
    assert.deepEqual(matrix, {
      "audit A -> Run B": { accepted: false, sqlstate: "23503", constraint: "audit_events_runtime_run_workspace_fk" },
      "audit A -> Run A": { accepted: true },
      "runtime audit without workspace": {
        accepted: false, sqlstate: "23514", constraint: "audit_events_runtime_workspace_required",
      },
      "platform audit (no workspace, no Run)": { accepted: true },
    });
  } finally {
    await db.admin.query("rollback");
  }
});

test("canonical Workspace mapping stays intact and resolves exactly", async () => {
  const canonical = (await db.admin.query(`select id::text as id, slug from workspaces
    where domain_workspace_id = $1`, [live.canonicalWorkspace.domain])).rows;
  assert.deepEqual(canonical.map((row: any) => row.id), [live.canonicalWorkspace.id]);

  // Re-applying the canonical seed is idempotent: still exactly one canonical row.
  await db.admin.query(readFileSync(new URL("../../db/seeds/0001_seed_smart_algorithms_demo.sql", import.meta.url), "utf8"));
  const afterReseed = (await db.admin.query("select id::text as id from workspaces where domain_workspace_id = $1",
    [live.canonicalWorkspace.domain])).rows;
  assert.deepEqual(afterReseed.map((row: any) => row.id), [live.canonicalWorkspace.id]);

  const duplicate = await (async () => {
    await db.admin.query("begin");
    try {
      return await attempt(`insert into workspaces (id, name, slug, type, region, status, domain_workspace_id)
        values ($1, 'Impostor', 'impostor', 'company', 'eu', 'active', $2)`, [randomUUID(), live.canonicalWorkspace.domain]);
    } finally {
      await db.admin.query("rollback");
    }
  })();
  assert.deepEqual(duplicate, { accepted: false, sqlstate: "23505", constraint: "workspaces_domain_workspace_id_unique" });

  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 2 });
  try {
    const resolver = tenantContract.createPostgresWorkflowRuntimeTenantResolver(database);
    const resolve = async (domain: unknown) => {
      const tenant = await resolver.resolve(domain as string);
      return tenant ? { workspaceId: tenant.workspaceId, workspaceDatabaseId: tenant.workspaceDatabaseId } : null;
    };
    assert.deepEqual(await resolve(live.canonicalWorkspace.domain), {
      workspaceId: live.canonicalWorkspace.domain, workspaceDatabaseId: live.canonicalWorkspace.id,
    });
    assert.deepEqual(await resolve(live.primaryWorkspace.domain), {
      workspaceId: live.primaryWorkspace.domain, workspaceDatabaseId: A,
    });
    assert.deepEqual(await resolve(live.secondaryWorkspace.domain), {
      workspaceId: live.secondaryWorkspace.domain, workspaceDatabaseId: B,
    });
    assert.equal(await resolve("Smart-Algorithms-Demo"), null);
    assert.equal(await resolve("missing-workspace"), null);
  } finally {
    await database.close();
  }
});
