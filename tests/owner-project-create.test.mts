import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mutations = (await import(new URL("../lib/projects/owner-project-mutations.ts", import.meta.url).href)) as typeof import("../lib/projects/owner-project-mutations");
const binding = (await import(new URL("../lib/composition/owner-project-create.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-project-create");
const registry = (await import(new URL("../lib/projects/postgres-project-registry.ts", import.meta.url).href)) as typeof import("../lib/projects/postgres-project-registry");
const copy = (await import(new URL("../lib/i18n/project-create-copy.ts", import.meta.url).href)) as typeof import("../lib/i18n/project-create-copy");
const secret = "postgres://private:credential@host/db raw SQL driver error";
const workspace = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const intent = { projectId: "new-project", displayName: "New Project" };

function fixture(options: { anonymous?: boolean; owner?: boolean; identity?: boolean; failure?: string; replay?: boolean; conflict?: boolean; auditCount?: number } = {}) {
  const calls: string[] = [];
  const releases: boolean[] = [];
  let fingerprint = "";
  const row = { id, project_key: intent.projectId, display_name: intent.displayName, status: "active", repository_url: null, default_branch: null };
  const result = (rows: Record<string, unknown>[] = []) => ({ rows, rowCount: rows.length });
  const database = { async connect() { return { async query(sql: string, values: readonly unknown[] = []) {
    const tag = sql.match(/\/\* ([^*]+) \*\//u)?.[1] ?? sql;
    calls.push(tag);
    if (tag === options.failure) throw new Error(secret);
    if (tag === "workflow-runtime-tenant:resolve") return result([{ workspace_database_id: workspace, domain_workspace_id: "workspace-a", status: "active" }]);
    if (tag === "auth-identity:resolve") { assert.deepEqual(values, ["github", "9101"]); return result([{ user_id: user }]); }
    if (tag === "task-mutation:owner-lock") return result(options.owner === false ? [] : [{ id: user }]);
    if (tag === "project-mutation:identity-lock") {
      assert.deepEqual(values, ["github", "9101", user]);
      assert.match(sql, /for share/u); assert(!sql.includes("for key share"));
      return result(options.identity === false ? [] : [{ id }]);
    }
    if (tag === "project-mutation:create") return result(options.replay ? [] : [row]);
    if (tag === "project-mutation:audit-created") { fingerprint = JSON.parse(values[3] as string).intentFingerprint; return result([{ id }]); }
    if (tag === "project-mutation:replay") return result([{ ...row, display_name: options.conflict ? "Other" : row.display_name }]);
    if (tag === "project-mutation:audit-replay") return result(Array.from({ length: options.auditCount ?? 1 }, () => ({ actor_user_id: user, metadata: { projectId: intent.projectId, intentFingerprint: fingerprint || mutations.projectCreationFingerprint(intent) } })));
    return result();
  }, release(destroy = false) { releases.push(destroy); } }; } };
  const service = mutations.createOwnerProjectMutations({ database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => options.anonymous ? null : { userId: user } }, sessionIdentity: { provider: "github", providerSubject: "9101" } });
  return { service, calls, releases, database };
}

test("Owner creates an active project and one atomic audit using trusted identity", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.createProject(intent), { status: "created", project: { projectId: "new-project", displayName: "New Project", status: "active", repository: null } });
  assert(f.calls.indexOf("task-mutation:owner-lock") < f.calls.indexOf("project-mutation:create"));
  assert(f.calls.indexOf("task-mutation:owner-lock") < f.calls.indexOf("project-mutation:identity-lock"));
  assert(f.calls.indexOf("project-mutation:identity-lock") < f.calls.indexOf("project-mutation:create"));
  assert(f.calls.indexOf("project-mutation:audit-created") < f.calls.indexOf("task-mutation:commit"));
});

test("unauthenticated and non-Owner requests never write or disclose private state", async () => {
  for (const options of [{ anonymous: true }, { owner: false }, { identity: false }]) {
    const f = fixture(options);
    assert.deepEqual(await f.service.createProject(intent), { status: options.anonymous ? "unauthenticated" : "unavailable" });
    assert(!f.calls.includes("project-mutation:create"));
  }
});

test("invalid ids, names, caller authority/status and hostile objects do no database work", async () => {
  const f = fixture(); let traps = 0;
  const getter = Object.defineProperty({ projectId: "new-project" }, "displayName", { get() { traps++; throw Error(secret); }, enumerable: true });
  const values = [null, [], getter, new Proxy(intent, { ownKeys() { traps++; throw Error(secret); } }),
    ...["", "Project", "../x", "a".repeat(65)].map(projectId => ({ ...intent, projectId })),
    ...["", " padded ", "a\nb", "x".repeat(121)].map(displayName => ({ ...intent, displayName })),
    ...["workspaceId", "userId", "actorId", "status", "repository_url"].map(key => ({ ...intent, [key]: "active" }))];
  for (const input of values) assert.deepEqual(await f.service.createProject(input), { status: "invalid_input" });
  assert.equal(traps, 0); assert.deepEqual(f.calls, []);
});

test("identical audited retry replays; changed payload or missing/duplicate audit fails closed", async () => {
  const f = fixture({ replay: true });
  const replay = await f.service.createProject(intent);
  assert.equal(replay.status, "replayed"); assert(Object.isFrozen(replay));
  assert(!f.calls.includes("project-mutation:audit-created"));
  for (const options of [{ conflict: true }, { auditCount: 0 }, { auditCount: 2 }]) {
    assert.deepEqual(await fixture({ replay: true, ...options }).service.createProject(intent), { status: "conflict" });
  }
});

test("audit failure rolls back; failed BEGIN/COMMIT destroy session; errors stay opaque", async () => {
  for (const failure of ["task-mutation:begin", "project-mutation:identity-lock", "project-mutation:audit-created", "task-mutation:commit"]) {
    const f = fixture({ failure });
    assert.deepEqual(await f.service.createProject(intent), { status: "unavailable" });
    assert.equal(f.releases.at(-1), true);
    if (failure === "project-mutation:audit-created") assert(f.calls.includes("task-mutation:rollback"));
  }
});

function form(fields: Record<string, string> = intent) { const data = new FormData(); for (const [k,v] of Object.entries(fields)) data.append(k,v); return data; }
test("form boundary is bounded and refuses duplicate, file and authority fields", () => {
  assert.deepEqual(binding.projectCreateInputFromForm(form()), intent);
  const duplicate = form(); duplicate.append("projectId", "other");
  const file = form(); file.set("displayName", new Blob(["private"]));
  for (const data of [duplicate, file, form({ ...intent, workspaceId: workspace }), null, {}]) assert.equal(binding.projectCreateInputFromForm(data), null);
});

test("composition uses server workspace, maps only bounded public outcomes and sanitizes errors", async () => {
  let seen = "";
  const service = binding.createOwnerProjectCreate({ workspaceSlug: "workspace-a", async withProjectCreate(slug, work) {
    seen = slug; return work({ createProject: async () => { throw Error(secret); } });
  } });
  assert.deepEqual(await service.submit(form()), { status: "unavailable" }); assert.equal(seen, "workspace-a");
  assert.deepEqual(await service.submit(form({ ...intent, status: "archived" })), { status: "invalid_input" });
});

test("UI is a separate Owner-only Server Action with no executor or credential imports", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const action = source("app/projects/actions.ts");
  assert.match(action, /^"use server"/u);
  assert.match(action, /revalidatePath\("\/projects"\)/u);
  const server = source("lib/composition/owner-project-create.server.ts");
  assert.equal([...server.matchAll(/await auth\(\)/gu)].length, 1);
  assert(server.indexOf("await auth()") < server.indexOf("createWorkflowRuntimePostgresDatabase({"));
  assert.match(server, /createGitHubOwnerProjectCreate\(\{ database, domainWorkspaceId, session \}\)/u);
  assert.match(source("app/projects/page.tsx"), /ProjectCreateForm/u);
  assert.match(source("components/domain/owner-console/project-create-form.tsx"), /useActionState/u);
  assert(!/executor|provider|credential|fetch\(/u.test(action));
});

test("exact lookup is bounded and binds BOTH workspace and selector; invalid selectors issue no SQL", async () => {
  const seen: { sql: string; values: readonly unknown[] }[] = [];
  const client = { async query(sql: string, values: readonly unknown[] = []) {
    seen.push({ sql, values });
    return { rows: [], rowCount: 0 };
  }, release() {} };
  for (const selector of ["Project", "../escape", { workspaceId: workspace }, null, "x".repeat(65)]) {
    assert.deepEqual(await registry.queryProjects(client, workspace, 1, selector), { verdict: "deny", reason: "invalid_input" });
  }
  assert.equal(seen.length, 0);
  await registry.queryProjects(client, workspace, 1, "new-project");
  assert.match(seen[0].sql, /workspace_id = \$1/u);
  assert.match(seen[0].sql, /and project_key = \$4/u);
  assert.deepEqual(seen[0].values, [workspace, ["active", "paused"], 1, "new-project"]);
});

test("EN/RU creation copy exposes the same bounded outcomes", () => {
  for (const locale of ["en", "ru"] as const) {
    const value = copy.projectCreateCopy(locale);
    assert(value.title && value.created && value.unavailable && value.conflict && value.dashboard);
    assert.deepEqual(Object.keys(value).sort(), Object.keys(copy.projectCreateCopy("en")).sort());
  }
});

test("C1: copied original session survives caller mutation; same-user alternative identity cannot substitute", async () => {
  const f = fixture({ identity: false });
  const rawSession = { pacIdentity: { provider: "github", providerSubject: "9101" } };
  const creator = binding.createGitHubOwnerProjectCreate({ database: f.database, domainWorkspaceId: "workspace-a", session: rawSession });
  rawSession.pacIdentity.providerSubject = "9104";
  assert.deepEqual(await creator.createProject(intent), { status: "unavailable" });
  assert(f.calls.includes("auth-identity:resolve"));
  assert(f.calls.includes("project-mutation:identity-lock"));
  assert(!f.calls.includes("project-mutation:create"));
});

test("C1: session snapshot refuses getters/proxies/classes without executing them", async () => {
  let traps = 0;
  const getter = Object.defineProperty({}, "pacIdentity", { get() { traps++; throw Error(secret); } });
  const proxy = new Proxy({}, { getPrototypeOf() { traps++; throw Error(secret); } });
  class Session { pacIdentity = { provider: "github", providerSubject: "9101" }; }
  for (const session of [null, getter, proxy, new Session(), Promise.resolve({}), { pacIdentity: { provider: "github", providerSubject: "wrong" } }]) {
    const f = fixture();
    const creator = binding.createGitHubOwnerProjectCreate({ database: f.database, domainWorkspaceId: "workspace-a", session });
    assert.deepEqual(await creator.createProject(intent), { status: "unauthenticated" });
    assert(!f.calls.includes("auth-identity:resolve")); assert(!f.calls.includes("task-mutation:begin"));
  }
  assert.equal(traps, 0);
});
