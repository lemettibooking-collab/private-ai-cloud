import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { WorkflowRuntimeDatabase } from "../lib/db/workflow-runtime-store";
import type { OwnerRoadmapView } from "../lib/db/roadmap-owner-read";
const read = await import(new URL("../lib/db/roadmap-owner-read.ts", import.meta.url).href) as typeof import("../lib/db/roadmap-owner-read");
const require = createRequire(import.meta.url), ts = require("typescript") as typeof import("typescript");
const uuid = "12345678-1234-4234-9234-123456789012", ownerId = "22345678-1234-4234-9234-123456789012";
function fake(options: Readonly<{ owner?: boolean; fail?: boolean; corruptProject?: boolean }> = {}) {
  const calls: string[] = [], releases: boolean[] = [];
  const database = { connect: async () => ({ async query(sql: string) {
    calls.push(sql); const response = (rows: Record<string, unknown>[]) => ({ rows, rowCount: rows.length });
    if (sql.includes("workflow-runtime-tenant:resolve")) return response([{ workspace_database_id: uuid, domain_workspace_id: "workspace-a", status: "active" }]);
    if (sql.includes("owner-lock")) return response(options.owner === false ? [] : [{ id: ownerId }]);
    if (options.fail && sql.includes("roadmap-owner:")) throw Error("private-driver-error");
    if (sql.includes("roadmap-owner:projects")) return response([{ project_key: "project-a", display_name: options.corruptProject ? "bad\nname" : "Project A", status: "active", repository_url: null, default_branch: null }]);
    if (/\b(?:insert|update|delete)\s+(?:into|from)?\s*(?:roadmap|controller|project_tasks)/iu.test(sql)) assert.fail("Owner read attempted a domain mutation");
    if (sql.includes("roadmap-owner:") || /\b(begin|commit|rollback)\b/u.test(sql)) return response([]);
    assert.fail("Unexpected SQL outside read boundary");
  }, release(destroy = false) { releases.push(destroy); } }) } as unknown as WorkflowRuntimeDatabase;
  return { database, calls, releases };
}
test("unauthenticated roadmap read performs zero raw roadmap/project reads", async () => { const f = fake(), reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => null } }); assert.deepEqual(await reader.read(), { state: "unauthenticated" }); assert.equal(f.calls.filter(q => q.includes("roadmap-owner:")).length, 0); });
test("denied Owner read is opaque and performs zero raw data reads", async () => { const f = fake({ owner: false }), reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => ({ userId: ownerId }) } }); assert.deepEqual(await reader.read(), { state: "unavailable" }); assert.equal(f.calls.filter(q => q.includes("roadmap-owner:")).length, 0); });
test("authorized empty read fresh frozen deterministic without guard upsert or partial fields", async () => { const f = fake(), reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => ({ userId: ownerId }) } }); const a = await reader.read(), b = await reader.read(); assert.equal(a.state, "available"); assert.deepEqual(a, b); assert.notEqual(a, b); assert.ok(Object.isFrozen(a)); assert.ok(!f.calls.some(q => /insert\s+into|update\s+roadmap|delete\s+from/iu.test(q))); assert.ok(f.calls.findIndex(q => q.includes("owner-lock")) < f.calls.findIndex(q => q.includes("roadmap-owner:"))); assert.doesNotMatch(JSON.stringify(a), /workspaceDatabaseId|context|fingerprint|private-driver-error/u); });
test("unknown/malformed/duplicate project selector never falls back to workspace", async () => { const f = fake(), reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => ({ userId: ownerId }) } }); for (const selector of ["missing", "", ["project-a"], {}, new Proxy({}, {})]) assert.deepEqual(await reader.read(selector), { state: "project_unavailable" }); const ok = await reader.read("project-a"); assert.equal(ok.state, "available"); if (ok.state === "available") assert.equal(ok.scope.mode, "project"); });
test("malformed registry or driver error denies whole view without raw data", async () => { for (const option of [{ fail: true }, { corruptProject: true }]) { const f = fake(option), reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => ({ userId: ownerId }) } }); assert.deepEqual(await reader.read(), { state: "unavailable" }); } });
test("hostile config/identity getters not executed and no DB reads for malformed identity", async () => { let invoked = 0; const f = fake(); assert.throws(() => read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", get identitySource() { invoked++; throw Error("private"); } })); const reader = read.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: "workspace-a", identitySource: { resolve: () => ({ get userId() { invoked++; throw Error("private"); } }) } }); assert.deepEqual(await reader.read(), { state: "unauthenticated" }); assert.equal(invoked, 0); });

function server(options: Readonly<{ signal?: boolean; fail?: boolean }> = {}) {
  const events: string[] = [], exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const source = readFileSync(new URL("../lib/composition/owner-roadmap-read.server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, process: { env: { APP_DEMO_WORKSPACE_SLUG: "workspace-a" } }, require(name: string) {
    if (name === "server-only") return {};
    if (name === "next/server") return { connection: async () => { events.push("connection"); if (options.signal) throw Error("prerender-signal"); } };
    if (name.includes("auth/next-auth")) return { auth: async () => null };
    if (name.includes("db/postgres")) return { createWorkflowRuntimePostgresDatabase: () => { events.push("pool"); if (options.fail) throw Error("private-url"); return { close: async () => { events.push("close"); } }; } };
    if (name.includes("github-session-identity-source")) return { createGitHubSessionIdentitySource: () => ({ resolve: () => null }) };
    if (name.includes("roadmap-owner-read")) return { createRoadmapOwnerReader: () => ({ read: async () => { events.push("read"); return { state: "available" }; } }) };
    throw Error("Unexpected server dependency");
  } }); return { events, load: exports.loadOwnerRoadmap };
}
test("server loader awaits request boundary before pool/read, closes pool", async () => { const s = server(); await s.load(undefined); assert.deepEqual(s.events, ["connection", "pool", "read", "close"]); });
test("server request-time signal is never swallowed and DB construction error is opaque", async () => { const signal = server({ signal: true }); await assert.rejects(signal.load(undefined), /prerender-signal/u); assert.deepEqual(signal.events, ["connection"]); const failed = server({ fail: true }); assert.equal((await failed.load(undefined) as { state: string }).state, "unavailable"); });

test("Owner roadmap component renders actual RU/EN truth boundaries, escaped content, no write controls", async () => {
  const React = require("react") as typeof import("react"), render = require("react-dom/server") as typeof import("react-dom/server");
  const messages = await import(new URL("../lib/i18n/messages.ts", import.meta.url).href) as typeof import("../lib/i18n/messages");
  const roadmapContent = await import(new URL("../lib/i18n/roadmap-content.ts", import.meta.url).href) as typeof import("../lib/i18n/roadmap-content");
  const exports: Record<string, (props: { view: Extract<OwnerRoadmapView, { state: "available" }>; locale: "ru" | "en" }) => React.ReactNode> = {}, source = readFileSync(new URL("../components/domain/roadmap-owner-view.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require(name: string) {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) };
    if (name.includes("section-card")) return { SectionCard: ({ title, children }: { title: string; children: React.ReactNode }) => React.createElement("section", {}, title, children) };
    if (name.includes("status-badge")) return { StatusBadge: ({ children }: { children: React.ReactNode }) => React.createElement("span", {}, children) };
    if (name.includes("i18n/messages")) return messages;
    if (name.includes("i18n/roadmap-content")) return roadmapContent;
    throw Error("Unexpected component dependency");
  } });
  const view: Extract<OwnerRoadmapView, { state: "available" }> = { state: "available", projects: [], scope: { mode: "all" }, milestones: [], truncated: false, runtimeDispatchAllowed: false, tasks: [{ taskId: "task-a", projectId: "project-a", milestoneId: "m1", title: "<script>escape-me</script>", status: "waiting_owner", ready: false, controllerRevision: 9, completedNodes: 1, totalNodes: 1, nodes: [{ developmentTaskId: "node-a", status: "completed", attemptNumber: 2, selectedExecutor: "claude-managed-agents/v1", quality: "pass", security: "pass" }], pendingOwnerPurposes: ["result_acceptance"], heldExposureUsdMicros: 0 }] };
  for (const locale of ["ru", "en"] as const) { const html = render.renderToStaticMarkup(React.createElement(exports.RoadmapOwnerView, { view, locale })); assert.match(html, /&lt;script&gt;escape-me&lt;\/script&gt;/u); assert.match(html, /claude-managed-agents\/v1/u); assert.doesNotMatch(html, /<button|<form|<script>/u); assert.match(html, locale === "en" ? /Selected route \(not execution\)/u : /Выбранный маршрут \(не запуск\)/u); assert.match(html, locale === "en" ? /technical PASS is not final Owner acceptance/u : /успешная техническая проверка не заменяет/u); assert.match(html, locale === "en" ? /Controller revision/u : /Ревизия контроллера/u); assert.match(html, locale === "en" ? /Completed/u : /Завершена/u); }
});
test("roadmap route uses server loader/current locale and no prototype data or actions", () => { const source = readFileSync(new URL("../app/roadmap/page.tsx", import.meta.url), "utf8"); assert.match(source, /loadOwnerRoadmap/u); assert.match(source, /searchParams: Promise/u); assert.doesNotMatch(source, /prototypeContent|use server|createDevelopmentController|advanceController|<form/u); });
test("real roadmap locale dictionary has exact RU/EN key and placeholder parity", async () => {
  const { roadmapContent } = await import(new URL("../lib/i18n/roadmap-content.ts", import.meta.url).href) as typeof import("../lib/i18n/roadmap-content");
  function entries(value: unknown, prefix = ""): ReadonlyArray<readonly [string, string]> {
    if (typeof value === "string") { assert.ok(value.trim().length > 0, prefix); return [[prefix, value]]; }
    assert.ok(value && typeof value === "object"); return Object.entries(value).flatMap(([key, child]) => entries(child, prefix ? `${prefix}.${key}` : key));
  }
  const ru = entries(roadmapContent.ru), en = entries(roadmapContent.en);
  assert.deepEqual(ru.map(([key]) => key).sort(), en.map(([key]) => key).sort());
  const values = new Map(en);
  for (const [key, value] of ru) {
    const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z]+)\}/gu)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(value), placeholders(values.get(key)!), key);
    assert.equal(value.replace(/\{[A-Za-z]+\}/gu, "").includes("{"), false, key);
    assert.equal(values.get(key)!.replace(/\{[A-Za-z]+\}/gu, "").includes("{"), false, key);
    assert.doesNotMatch(value.replace(/\{[A-Za-z]+\}/gu, ""), /[A-Za-z]/u, `Untranslated Russian prose: ${key}`);
  }
});
test("roadmap dictionary exhaustively labels canonical node/gate/milestone states and is frozen", async () => {
  const { roadmapContent } = await import(new URL("../lib/i18n/roadmap-content.ts", import.meta.url).href) as typeof import("../lib/i18n/roadmap-content");
  const { developmentExecutionStatuses } = await import(new URL("../lib/contracts/development-execution.ts", import.meta.url).href) as typeof import("../lib/contracts/development-execution");
  for (const locale of ["ru", "en"] as const) {
    const content = roadmapContent[locale]; assert.deepEqual(Object.keys(content.nodeStatus).sort(), [...developmentExecutionStatuses].sort());
    for (const key of ["not_run", "pending", "pass", "fail_retryable", "fail_owner_required", "hard_stop", "planned", "active", "blocked", "completed", "cancelled"] as const) assert.ok(content[key].length > 0, `${locale}:${key}`);
    assert.ok(Object.isFrozen(content)); assert.ok(Object.isFrozen(content.nodeStatus));
  }
});
test("roadmap rendered sources consume dictionaries rather than hardcoded locale text", () => {
  for (const path of ["../app/roadmap/page.tsx", "../components/domain/roadmap-owner-view.tsx"]) { const source = readFileSync(new URL(path, import.meta.url), "utf8"); assert.match(source, /roadmapContent\[locale\]/u); assert.doesNotMatch(source, /[А-Яа-яЁё]/u); }
});
