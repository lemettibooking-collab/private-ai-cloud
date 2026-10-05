/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.4b Quick Create binding: untrusted form → exact createTask input, per-form idempotency key,
// public outcome mapping, and the dependency direction UI → Server Action → server composition →
// owner-task-mutations. No real DB, no network (the live chain is tests/pg/owner-task-create.test.mts).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const binding = (await import(new URL("../lib/composition/owner-task-create.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-task-create");

const root = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "postgres://owner:secret@db/x duplicate key value violates unique constraint project_tasks_workspace_creation_key_unique";
const UUID = "11111111-2222-4333-8444-555555555555";

function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path)];
  });
}
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'])\/\/[^\n]*/gu, "$1");
const applicationFiles = () => [...walk("app"), ...walk("components"), ...walk("lib")].filter((path) => /\.(tsx?|mts)$/u.test(path));
const importers = (module: RegExp) => applicationFiles().filter((path) => module.test(code(path))).sort();

function form(fields: Record<string, string | string[] | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item as any);
  }
  return data;
}
const valid = () => ({
  idempotencyKey: binding.newQuickCreateFormKey(), projectId: "project-a", title: "  Add risk filter  ", goal: "",
  type: "feature", priority: "", riskLevel: "high",
});

test("form → exact createTask input: fixed fields, trimmed title/goal, empty optionals → null", () => {
  const fields = valid();
  const parsed = binding.quickCreateInputFromForm(form({ ...fields, "$ACTION_REF_1": "", "$ACTION_KEY": "k1" }));
  assert.deepEqual(parsed, {
    idempotencyKey: fields.idempotencyKey, projectId: "project-a", title: "Add risk filter", goal: null, type: "feature", priority: null, riskLevel: "high",
  });
  assert.ok(Object.isFrozen(parsed));
  assert.deepEqual(Object.keys(parsed!), [...binding.quickCreateFormFields]);
  assert.equal(binding.quickCreateInputFromForm(form({ ...fields, goal: "  Outcome  \r\n" }))?.goal, "Outcome");
});

test("form: authority fields, duplicates, files, missing fields and non-FormData are refused", () => {
  for (const extra of ["taskId", "workspaceId", "workspace", "userId", "actorId", "role", "status", "createdBy", "created_by", "createdAt", "runId", "executor", "model", "branch", "repositoryPath"]) {
    assert.equal(binding.quickCreateInputFromForm(form({ ...valid(), [extra]: "x" })), null, extra);
  }
  assert.equal(binding.quickCreateInputFromForm(form({ ...valid(), projectId: ["project-a", "project-b"] })), null, "duplicate");
  assert.equal(binding.quickCreateInputFromForm(form({ ...valid(), idempotencyKey: [binding.newQuickCreateFormKey(), binding.newQuickCreateFormKey()] })), null);
  assert.equal(binding.quickCreateInputFromForm(form({ ...valid(), title: new Blob(["x"]) })), null, "file");
  for (const missing of binding.quickCreateFormFields) {
    const fields: Record<string, string> = valid();
    delete fields[missing];
    assert.equal(binding.quickCreateInputFromForm(form(fields)), null, missing);
  }
  let trapped = 0;
  const proxy = new Proxy(form(valid()), { get(target, key) { trapped += 1; return Reflect.get(target, key); } });
  for (const hostile of [valid(), proxy, null, undefined, "x", [], new URLSearchParams(valid())]) {
    assert.equal(binding.quickCreateInputFromForm(hostile), null);
  }
  assert.equal(trapped, 0);
});

test("per-form idempotency key: opaque CSPRNG, accepted by the mutation key rule, unique per render", () => {
  const keys = new Set(Array.from({ length: 2000 }, () => binding.newQuickCreateFormKey()));
  assert.equal(keys.size, 2000);
  for (const key of keys) {
    assert.match(key, /^qc-[0-9a-f]{32}$/u);
    assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u, "AI-038.4a creation_idempotency_key rule");
  }
  const page = source("app/tasks/new/page.tsx");
  assert.match(page, /formKey=\{issueQuickCreateFormKey\(\)\}/u, "the key is issued by the server per render");
  const action = code("app/tasks/new/actions.ts");
  assert.ok(!/newQuickCreateFormKey|issueQuickCreateFormKey|randomBytes|randomUUID|Date\.now/u.test(action), "the action never mints a key per retry");
  const formComponent = code("components/domain/owner-console/quick-create-form.tsx");
  assert.match(formComponent, /<input name="idempotencyKey" type="hidden" value=\{props\.formKey\} \/>/u);
  assert.ok(!/crypto|Math\.random|Date\.now|useId/u.test(formComponent), "the browser never generates the key");
  assert.ok(!/searchParams[^;]*idempotency|idempotency[^;]*searchParams|\?[^"'`]*idempotencyKey/u.test(page + action + formComponent), "the key never travels in a URL");
});

test("outcome mapping: created / replayed → factual Task Detail; everything else → generic public status", () => {
  for (const status of ["created", "replayed"]) {
    assert.deepEqual(binding.quickCreateOutcome({ status, task: { taskId: "task-0123456789abcdef0123", projectId: "project-a", status: "draft" } }),
      { status: "redirect", href: "/tasks/task-0123456789abcdef0123?project=project-a" });
  }
  for (const task of [{ taskId: "../x", projectId: "project-a" }, { taskId: "Task-A", projectId: "project-a" }, { taskId: "a b", projectId: "project-a" }, { taskId: "task-1", projectId: "Project?x=1" }, null]) {
    assert.deepEqual(binding.quickCreateOutcome({ status: "created", task }), { status: "unavailable" }, JSON.stringify(task));
  }
  for (const status of ["conflict", "invalid_input", "unauthenticated"]) assert.deepEqual(binding.quickCreateOutcome({ status }), { status });
  for (const result of [{ status: "unavailable" }, { status: "attached" }, { status: "other" }, null, undefined, SECRET, new Proxy({ status: "created" }, {})]) {
    assert.deepEqual(binding.quickCreateOutcome(result), { status: "unavailable" });
  }
});

test("submit: invalid form or workspace never reaches the binding; failures are sanitized; input is exact", async () => {
  const seen: { workspace: string; input: unknown }[] = [];
  const quick = (slug: unknown, result: () => Promise<unknown>) => binding.createOwnerQuickCreate({
    workspaceSlug: slug,
    async withTaskCreate(workspace, create) {
      return create(Object.freeze({ async createTask(input: unknown) { seen.push({ workspace, input }); return result() as any; } }));
    },
  });
  const ok = quick("smart-algorithms-demo", async () => ({ status: "created", task: { taskId: "task-aa", projectId: "project-a", status: "draft" } }));
  const fields = valid();
  assert.deepEqual(await ok.submit(form(fields)), { status: "redirect", href: "/tasks/task-aa?project=project-a" });
  assert.deepEqual(seen, [{ workspace: "smart-algorithms-demo", input: { ...fields, title: "Add risk filter", goal: null, priority: null } }]);
  seen.length = 0;
  assert.deepEqual(await ok.submit(form({ ...fields, workspaceId: UUID })), { status: "invalid_input" });
  assert.deepEqual(await ok.submit({ ...fields }), { status: "invalid_input" });
  for (const slug of [undefined, "", "Bad Slug", UUID.repeat(3)]) {
    assert.deepEqual(await quick(slug, async () => ({ status: "created" })).submit(form(valid())), { status: "unavailable" });
  }
  assert.equal(seen.length, 0, "nothing reached createTask");
  const failing = quick("smart-algorithms-demo", async () => { throw new Error(SECRET); });
  const failed = await failing.submit(form(valid()));
  assert.deepEqual(failed, { status: "unavailable" });
  assert.ok(!JSON.stringify(failed).includes("secret"));
  const throwingComposition = binding.createOwnerQuickCreate({ workspaceSlug: "smart-algorithms-demo", async withTaskCreate() { throw new Error(SECRET); } });
  assert.deepEqual(await throwingComposition.submit(form(valid())), { status: "unavailable" });
});

test("N. public result hygiene: no internal UUID, workspace, actor, key, fingerprint or raw error leaves", async () => {
  const fields = valid();
  const leaky = binding.createOwnerQuickCreate({
    workspaceSlug: "smart-algorithms-demo",
    async withTaskCreate(_workspace, create) {
      return create({ async createTask() {
        return { status: "replayed", task: { taskId: "task-bb", projectId: "project-a", status: "draft", id: UUID, workspaceId: UUID, createdBy: UUID,
          idempotencyKey: fields.idempotencyKey, fingerprint: "f".repeat(64) }, error: SECRET } as any;
      } });
    },
  });
  const result = await leaky.submit(form(fields));
  assert.deepEqual(result, { status: "redirect", href: "/tasks/task-bb?project=project-a" });
  const json = JSON.stringify(result);
  for (const leaked of [UUID, fields.idempotencyKey, "f".repeat(64), "secret"]) assert.ok(!json.includes(leaked), leaked);
  const action = code("app/tasks/new/actions.ts");
  assert.match(action, /return \{ status: outcome\.status \};/u, "the action returns only the public status");
});

test("binding exposes createTask ONLY (attachRun is never bound) and refuses invalid configuration", () => {
  const created = binding.createGitHubOwnerTaskCreate({ database: { connect: async () => { throw new Error("unused"); } }, domainWorkspaceId: "smart-algorithms-demo", sessionResolver: { resolve: () => null } });
  assert.deepEqual(Object.keys(created), ["createTask"]);
  assert.ok(Object.isFrozen(created));
  assert.equal((created as any).attachRun, undefined);
  for (const config of [null, {}, { database: {}, domainWorkspaceId: "smart-algorithms-demo" }, { database: {}, domainWorkspaceId: 1, sessionResolver: {} },
    { database: {}, domainWorkspaceId: "smart-algorithms-demo", sessionResolver: { resolve: () => null }, workspaceId: UUID },
    new Proxy({ database: {}, domainWorkspaceId: "smart-algorithms-demo", sessionResolver: {} }, {})]) {
    assert.throws(() => binding.createGitHubOwnerTaskCreate(config));
  }
});

test("O. dependency direction: UI → Server Action → server composition → owner-task-mutations (never UI → mutations)", () => {
  // The low-level mutation contract has exactly ONE application importer: the binding module.
  assert.deepEqual(importers(/from\s+["'][^"']*\/tasks\/owner-task-mutations(\.ts)?["']/u), ["lib/composition/owner-task-create.ts"]);
  // The binding is imported only by its server-only entry.
  assert.deepEqual(importers(/from\s+["'][^"']*owner-task-create(\.ts)?["']/u), ["lib/composition/owner-task-create.server.ts"]);
  // The server-only entry is imported only by the Quick Create Server Action and its page (key issue).
  assert.deepEqual(importers(/owner-task-create\.server/u), ["app/tasks/new/actions.ts", "app/tasks/new/page.tsx"]);
  const serverEntry = source("lib/composition/owner-task-create.server.ts");
  assert.match(serverEntry, /^(\/\/[^\n]*\n)*import "server-only";/u, "server-only must be the first import");
  assert.match(serverEntry, /createGitHubOwnerTaskCreate\(\{ database, domainWorkspaceId, sessionResolver: \{ resolve: \(\) => auth\(\) \} \}\)/u, "the real Auth.js session of THIS request");
  assert.match(serverEntry, /workspaceSlug: process\.env\.APP_DEMO_WORKSPACE_SLUG/u, "the workspace is trusted server configuration");
  // Exactly one Server Action module in the application, exporting exactly one async action.
  const serverActionFiles = applicationFiles().filter((path) => /^\s*["']use server["'];/u.test(source(path)));
  assert.deepEqual(serverActionFiles, ["app/tasks/new/actions.ts"]);
  assert.ok(!applicationFiles().filter((path) => path !== "app/tasks/new/actions.ts").some((path) => /["']use server["']/u.test(code(path))), "no inline Server Function elsewhere");
  const action = code("app/tasks/new/actions.ts");
  assert.deepEqual([...action.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gmu)].map((match) => match[1]), ["quickCreateTaskAction"]);
  assert.deepEqual([...action.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]).sort(), ["@/lib/composition/owner-task-create.server", "next/navigation"]);
  // Client Components never import server data access, the binding or the mutations.
  const clientFiles = applicationFiles().filter((path) => /^\s*["']use client["']/mu.test(source(path)));
  assert.ok(clientFiles.includes("components/domain/owner-console/quick-create-form.tsx"));
  for (const path of clientFiles) {
    assert.ok(!/owner-task-create|owner-task-mutations|owner-console-read|lib\/db\/|lib\/auth\/|next-auth|lib\/tasks\//u.test(source(path)), `${path} imports server code`);
  }
  // AI-038.6: localized labels arrive as props; the dictionary is imported as a TYPE only (nothing
  // server-side or runtime i18n is bundled into the form).
  assert.deepEqual([...code("components/domain/owner-console/quick-create-form.tsx").matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]).sort(), ["@/lib/i18n/messages", "next/link", "react"]);
  assert.match(code("components/domain/owner-console/quick-create-form.tsx"), /^import type \{ Messages \} from "@\/lib\/i18n\/messages";$/mu);
  // The read backend and Owner Console read composition stay unbound.
  for (const path of ["lib/composition/owner-read-runtime.ts", "lib/composition/owner-console-read.ts", "lib/composition/owner-console-read.server.ts",
    "lib/composition/authenticated-owner-read-runtime.ts", "lib/composition/github-owner-read-runtime.ts", "lib/workflows/workflow-runtime-access.ts"]) {
    assert.ok(!/owner-task-create|owner-task-mutations|createTask|attachRun/u.test(code(path)), path);
  }
});

test("M. attachRun has no UI, Server Action, route or composition binding; no new HTTP route", () => {
  for (const path of applicationFiles().filter((file) => file !== "lib/tasks/owner-task-mutations.ts")) {
    assert.ok(!/attachRun|attach-run|task\.run_attached/u.test(code(path)), `${path} exposes attachRun`);
  }
  const routes = walk("app").filter((path) => /(^|\/)route\.(ts|tsx|js)$/u.test(path));
  assert.deepEqual(routes, ["app/api/auth/[...nextauth]/route.ts"], "the Auth.js route stays the only HTTP route");
});

test("L / scope. Quick Create starts nothing: no runtime, provider, executor, GitHub or network in its path", () => {
  for (const path of ["lib/composition/owner-task-create.ts", "lib/composition/owner-task-create.server.ts", "app/tasks/new/actions.ts", "app/tasks/new/page.tsx", "components/domain/owner-console/quick-create-form.tsx"]) {
    const text = code(path);
    const specifiers = [...text.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]).join("\n");
    assert.ok(!/providers|workflows|real-provider|executor|octokit|github(?!-session)|development-plan-|runtime-service|lib\/db\/workflow/iu.test(specifiers.replace("@/lib/contracts/development-plan", "")), `${path} imports ${specifiers}`);
    assert.ok(!/\bfetch\(|startRun|dispatch\w*\(|workflow_runs|createFeaturePlan|new\s+Octokit/u.test(text), path);
  }
  // The form offers task intent only: exactly these named fields.
  const names = [...code("components/domain/owner-console/quick-create-form.tsx").matchAll(/\bname="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)].sort(), [...binding.quickCreateFormFields].sort());
});
