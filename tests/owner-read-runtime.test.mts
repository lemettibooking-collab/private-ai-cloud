/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.0 Owner Read Backend Bundle: workspace and Owner identity are fixed at server composition;
// the public surface accepts only runId / limit and delegates through the AI-037.7 facade.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bundle = (await import(
  new URL("../lib/composition/owner-read-runtime.ts", import.meta.url).href
)) as typeof import("../lib/composition/owner-read-runtime");

const workspaceId = "workspace-primary";
const workspaceDatabaseId = "00000000-0000-4000-8000-0000000000a1";
const ownerActorId = "owner-one";

// One fake database: the tenant resolver's lookup and every read-model statement are recorded.
function fakeDatabase(options: { workspaces?: Record<string, string>; failReads?: boolean; failResolve?: boolean } = {}) {
  const workspaces = options.workspaces ?? { [workspaceId]: "active" };
  const calls = { connect: 0, resolves: 0, reads: [] as string[], readWorkspaceParameters: [] as unknown[] };
  const database = {
    async connect() {
      calls.connect += 1;
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? text.trim();
          if (tag === "workflow-runtime-tenant:resolve") {
            calls.resolves += 1;
            if (options.failResolve) throw new Error("resolver: postgres://owner:secret@db/x select * from workspaces");
            const status = workspaces[values[0] as string];
            return status
              ? { rows: [{ workspace_database_id: workspaceDatabaseId, domain_workspace_id: values[0], status }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          calls.reads.push(tag);
          if (values.length > 0) calls.readWorkspaceParameters.push(values[0]);
          if (options.failReads && !/snapshot-(begin|rollback)/u.test(tag)) throw new Error("driver: DATABASE_URL=postgres://u:p@h/db syntax error at select");
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  return { database, calls };
}

async function compose(options: Parameters<typeof fakeDatabase>[0] = {}, overrides: Record<string, unknown> = {}) {
  const db = fakeDatabase(options);
  const decision = await bundle.createOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, ownerActorId, ...overrides });
  return { db, decision };
}

async function backend(options: Parameters<typeof fakeDatabase>[0] = {}) {
  const { db, decision } = await compose(options);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  return { db, backend: decision.backend!, readsBefore: db.calls.reads.length };
}

const unavailable = { verdict: "deny", status: "unavailable", data: null };

test("A. construction with a factual active workspace and a configured Owner succeeds; the tenant is resolved once", async () => {
  const { db, decision } = await compose();
  assert.equal(decision.verdict, "allow");
  assert.equal(db.calls.resolves, 1);
  assert.equal(Object.isFrozen(decision), true);
  await decision.backend!.getRunOverview("run-one");
  await decision.backend!.listApprovalQueue();
  assert.equal(db.calls.resolves, 1, "no per-read re-resolution");
});

test("B–C. missing, unknown or inactive workspace and resolver failure fail closed, sanitized", async () => {
  for (const [options, overrides] of [
    [{}, { domainWorkspaceId: "workspace-missing" }],
    [{ workspaces: { [workspaceId]: "archived" } }, {}],
    [{ workspaces: { [workspaceId]: "suspended" } }, {}],
    [{ failResolve: true }, {}],
  ] as const) {
    const { decision } = await compose(options as any, overrides);
    assert.deepEqual(decision, { verdict: "deny", reason: "workspace_unavailable", backend: null });
    assert.equal(/secret|postgres|select/u.test(JSON.stringify(decision)), false);
  }
  for (const overrides of [{ domainWorkspaceId: undefined }, { domainWorkspaceId: "" }, { domainWorkspaceId: "Workspace Primary" }, { domainWorkspaceId: 1 }]) {
    const { db, decision } = await compose({}, overrides);
    assert.deepEqual(decision, { verdict: "deny", reason: "invalid_configuration", backend: null });
    assert.equal(db.calls.connect, 0, "invalid configuration never touches the database");
  }
});

test("D. invalid Owner principal or configuration shape is refused before any database work", async () => {
  const db = fakeDatabase();
  let getterRan = false;
  for (const config of [
    { database: db.database, domainWorkspaceId: workspaceId, ownerActorId: "" },
    { database: db.database, domainWorkspaceId: workspaceId, ownerActorId: "owner one" },
    { database: db.database, domainWorkspaceId: workspaceId, ownerActorId: "o".repeat(129) },
    { database: db.database, domainWorkspaceId: workspaceId, ownerActorId: 7 },
    { database: db.database, domainWorkspaceId: workspaceId },
    { database: db.database, domainWorkspaceId: workspaceId, ownerActorId, role: "owner" },
    { database: {}, domainWorkspaceId: workspaceId, ownerActorId },
    { database: new Proxy(db.database, {}), domainWorkspaceId: workspaceId, ownerActorId },
    new Proxy({ database: db.database, domainWorkspaceId: workspaceId, ownerActorId }, {}),
    Object.defineProperty({ database: db.database, domainWorkspaceId: workspaceId }, "ownerActorId", { enumerable: true, get() { getterRan = true; return ownerActorId; } }),
    null, "config",
  ]) {
    assert.deepEqual(await bundle.createOwnerReadRuntime(config), { verdict: "deny", reason: "invalid_configuration", backend: null });
  }
  assert.equal(getterRan, false);
  assert.equal(db.calls.connect, 0);
});

test("E–F. reads insert the configured Owner and the bound workspace internally", async () => {
  const seen: any[] = [];
  const original = bundle.createOwnerReadAuthorizer;
  const probe = original(ownerActorId, workspaceId);
  const { db, backend: owner } = await backend();
  const overview = await owner.getRunOverview("run-one");
  const queue = await owner.listApprovalQueue(10);
  const timeline = await owner.getRunAuditTimeline("run-one", 5);
  const usage = await owner.getRunModelUsage("run-one");
  assert.deepEqual(overview, unavailable, "not_found in the fake database stays opaque");
  assert.deepEqual(queue, { verdict: "allow", status: "available", data: [] }, "the configured Owner is authorized for the bound workspace");
  assert.deepEqual(timeline, unavailable);
  assert.deepEqual(usage, unavailable);
  assert.ok(db.calls.readWorkspaceParameters.length > 0);
  assert.ok(db.calls.readWorkspaceParameters.every((value) => value === workspaceDatabaseId), "only the bound tenant's rows are queried");
  // The same authorizer policy denies any other principal or workspace.
  seen.push(probe.authorize({ action: "list_approval_queue", actorId: "intruder", workspaceId, runId: null }));
  seen.push(probe.authorize({ action: "list_approval_queue", actorId: ownerActorId, workspaceId: "tenant-b", runId: null }));
  assert.deepEqual(seen, [{ verdict: "deny" }, { verdict: "deny" }]);
});

test("G–I. malformed, Proxy and over-limit inputs are denied by the AI-037.7 gate with no read and no trap", async () => {
  const { db, backend: owner, readsBefore } = await backend();
  let trapped = 0;
  const handler = { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; },
    getPrototypeOf() { trapped += 1; return Object.prototype; }, toString() { trapped += 1; return "run-one"; } } as any;
  const invalid = { verdict: "deny", status: "invalid_input", data: null };
  const limited = { verdict: "deny", status: "limit_exceeded", data: null };
  for (const runId of ["Run One", "", undefined, null, 1, {}, ["run-one"], new Proxy({}, handler), new Proxy(["run-one"], handler),
    { toString: () => "run-one" }, Object.defineProperty({}, "x", { get() { trapped += 1; return 1; } })]) {
    assert.deepEqual(await owner.getRunOverview(runId), invalid);
    assert.deepEqual(await owner.getRunModelUsage(runId), invalid);
    assert.deepEqual(await owner.getRunAuditTimeline(runId), invalid);
  }
  assert.deepEqual(await owner.getRunOverview("r".repeat(65)), limited);
  assert.deepEqual(await owner.listApprovalQueue(101), limited);
  assert.deepEqual(await owner.getRunAuditTimeline("run-one", 101), limited);
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null, new Proxy({}, handler)]) {
    assert.deepEqual(await owner.listApprovalQueue(limit), invalid, String(typeof limit));
  }
  assert.equal(trapped, 0, "no Proxy trap and no getter ran");
  assert.equal(db.calls.reads.length, readsBefore, "no raw read");
});

test("J–K. the caller cannot supply or override workspaceId or actorId", async () => {
  const { db, backend: owner, readsBefore } = await backend();
  // Envelope-shaped runIds are just invalid scalars; extra positional arguments are ignored.
  for (const runId of [{ workspaceId: "tenant-b", actorId: "intruder", runId: "run-one" }, { runId: "run-one" }]) {
    assert.equal((await owner.getRunOverview(runId)).status, "invalid_input");
  }
  assert.equal(db.calls.reads.length, readsBefore);
  const extra: any = owner.getRunOverview;
  await extra("run-one", { workspaceId: "tenant-b", actorId: "intruder" });
  const queueExtra: any = owner.listApprovalQueue;
  const queue = await queueExtra(10, { workspaceId: "tenant-b" }, "intruder");
  assert.equal(queue.status, "available");
  assert.ok(db.calls.readWorkspaceParameters.every((value) => value === workspaceDatabaseId), "still only the bound tenant");
  // No method signature takes an identity.
  // AI-038.3.1: listProjects(limit), listRuns(projectId, limit); AI-038.4a: listTasks(view),
  // listProjectTasks(projectId, view), getTask(taskId); AI-039: getTaskFeaturePlans(taskId) — still no
  // identity parameter.
  assert.deepEqual(Object.values(owner).map((method: any) => method.length), [1, 2, 1, 1, 1, 2, 1, 2, 1, 1]);
});

test("L–M. the Owner read authorizer denies execute_runtime_command, unknown actions and malformed input", () => {
  const authorizer = bundle.createOwnerReadAuthorizer(ownerActorId, workspaceId);
  for (const action of bundle.ownerReadActions) {
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId, runId: "run-one" }), { verdict: "allow" });
  }
  for (const input of [
    { action: "execute_runtime_command", actorId: ownerActorId, workspaceId, runId: "run-one" },
    { action: "delete_run", actorId: ownerActorId, workspaceId, runId: "run-one" },
    { action: "*", actorId: ownerActorId, workspaceId, runId: null },
    { action: "read_run_overview", actorId: "intruder", workspaceId, runId: "run-one" },
    { action: "read_run_overview", actorId: ownerActorId, workspaceId: "tenant-b", runId: "run-one" },
    new Proxy({ action: "read_run_overview", actorId: ownerActorId, workspaceId, runId: "run-one" }, {}),
    null, undefined, "read_run_overview",
  ]) {
    assert.deepEqual(authorizer.authorize(input as any), { verdict: "deny" });
  }
  assert.equal(Object.isFrozen(authorizer), true);
  assert.deepEqual([...bundle.ownerReadActions].sort(), ["list_approval_queue", "list_project_runs", "list_project_tasks", "list_projects", "list_tasks", "read_run_audit_timeline", "read_run_model_usage", "read_run_overview", "read_task", "read_task_feature_plans"]);
});

test("N. database failures during reads are sanitized: no DATABASE_URL, SQL or driver text leaves", async () => {
  const { backend: owner } = await backend({ failReads: true });
  for (const result of [
    await owner.getRunOverview("run-one"),
    await owner.getRunAuditTimeline("run-one"),
    await owner.getRunModelUsage("run-one"),
    await owner.listApprovalQueue(),
  ]) {
    assert.deepEqual(result, unavailable);
    assert.equal(/DATABASE_URL|postgres|syntax|select|driver/u.test(JSON.stringify(result)), false);
  }
});

test("O–R. the bundle is frozen and exposes exactly the four read methods: no write, no raw internals", async () => {
  const { decision } = await compose();
  const owner: any = decision.backend;
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Reflect.ownKeys(owner).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "getTask", "getTaskFeaturePlans", "listApprovalQueue", "listProjectTasks", "listProjects", "listRuns", "listTasks"]);
  for (const forbidden of ["executeCommand", "execute", "advance", "approve", "reject", "cancel", "database", "tenant",
    "workspaceDatabaseId", "readModel", "facade", "access", "resolver", "authorizer", "runtimeService", "close"]) {
    assert.equal(forbidden in owner, false, forbidden);
  }
  assert.equal(JSON.stringify(decision).includes(workspaceDatabaseId), false, "no raw workspace UUID in the decision");
  const overview = await owner.getRunOverview("run-one");
  assert.equal(JSON.stringify(overview).includes(workspaceDatabaseId), false);
});

// Server-only contract: application code may reach the bundle only through the `server-only` entry.
function sourceFiles(directory: string): string[] {
  const root = new URL(`../${directory}/`, import.meta.url);
  const out: string[] = [];
  const walk = (url: URL) => {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) walk(new URL(`${name}/`, url));
      else if (/\.(ts|tsx|js|jsx|mts)$/u.test(name)) out.push(fileURLToPath(child));
    }
  };
  walk(root);
  assert.ok(out.length > 0, `${directory} has source files`);
  return out;
}

test("server-only: the application entry imports `server-only`; UI code never imports the bundle's internals", () => {
  const entry = readFileSync(new URL("../lib/composition/owner-read-runtime.server.ts", import.meta.url), "utf8");
  assert.match(entry, /^import "server-only";$/mu);
  assert.match(entry, /export \{ createOwnerReadRuntime \} from "\.\/owner-read-runtime";/u);
  const core = readFileSync(new URL("../lib/composition/owner-read-runtime.ts", import.meta.url), "utf8");
  assert.match(core, /typeof window !== "undefined"/u, "runtime guard in the core as defense in depth");
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const source = readFileSync(file, "utf8");
    assert.equal(/owner-read-runtime(?!\.server)/u.test(source), false, `${file} must import only the .server entry`);
    assert.equal(/workflow-runtime-(tenant-facade|access|read-model|tenant)|lib\/db\//u.test(source), false,
      `${file} must not reach raw runtime/DB modules`);
    if (/^\s*["']use client["']/mu.test(source)) {
      assert.equal(/owner-read-runtime/u.test(source), false, `${file} is a Client Component`);
    }
  }
});
