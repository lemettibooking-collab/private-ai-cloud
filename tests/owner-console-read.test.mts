// AI-038.3 Owner Console read seam: real read wiring contract. No database, no network, no Auth.js:
// the authenticated Owner composition is replaced by deterministic decisions below the seam.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const consoleRead = (await import(new URL("../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-console-read");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");

function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path)];
  });
}

const SENTINEL = {
  actor: "SENTINEL-ACTOR-00000000-0000-4000-8000-000000000101",
  fingerprint: "SENTINEL-FINGERPRINT-abcdef",
  deployment: "SENTINEL-DEPLOYMENT",
  requestModel: "SENTINEL-REQUEST-MODEL",
  error: "SENTINEL-SQL select * from users where password",
};

const approval = (runId: string, risk: string, n: number) => ({
  approvalRequestId: `risk-approval-${n}`,
  runId,
  stepId: "step-one",
  status: "pending",
  riskLevel: risk,
  requestedCapability: "reasoning",
  requestedAt: "2026-10-01T10:00:00.000Z",
  resolvedAt: null,
  requestedByActorId: SENTINEL.actor,
  resolvedByActorId: SENTINEL.actor,
});

const overview = (runId: string) => ({
  runId,
  projectId: "project-one",
  workflowId: "workflow-one",
  status: "running",
  revision: 1,
  createdAt: "2026-10-01T09:00:00.000Z",
  startedAt: "2026-10-01T09:00:01.000Z",
  completedAt: null,
  currentStepIds: ["step-one"],
  readyStepIds: [],
  approval: approval(runId, "high", 0),
  latestModelInvocation: {
    invocationId: "invocation-a", stepId: "step-one", attemptNumber: 1, status: "succeeded", providerId: "mock",
    deploymentId: SENTINEL.deployment, providerModelId: "mock/model", providerRequestModelId: SENTINEL.requestModel,
    providerModelVersion: "v1", providerIdentityVersion: 2, requestFingerprint: SENTINEL.fingerprint,
    createdAt: "2026-10-01T09:00:02.000Z", completedAt: "2026-10-01T09:00:03.000Z",
  },
  modelUsage: {
    invocationCount: 1, succeededCount: 1, failedCount: 0, ambiguousCount: 0, inputTokens: 7, outputTokens: 4,
    totalTokens: 11, totalCostUsdMicros: 1234, lastProviderId: "mock", lastProviderModelId: "mock/model",
    lastProviderRequestModelId: SENTINEL.requestModel, lastProviderModelVersion: "v1",
  },
});

const allow = <T,>(data: T) => ({ verdict: "allow", status: "available", data });
const unavailable = { verdict: "deny", status: "unavailable", data: null };

type Calls = { method: string; args: unknown[] }[];

function fakeBackend(options: { approvals?: unknown[]; runs?: Record<string, "ok" | "deny" | "throw" | "invalid"> } = {}) {
  const calls: Calls = [];
  const runs = options.runs ?? { "run-one": "ok" };
  const run = (method: string, runId: unknown, extra: unknown[], data: () => unknown) => {
    calls.push({ method, args: [runId, ...extra] });
    const mode = typeof runId === "string" ? runs[runId] : undefined;
    if (mode === "throw") throw new Error(SENTINEL.error);
    if (mode === "invalid") return Promise.resolve({ verdict: "deny", status: "invalid_input", data: null });
    return Promise.resolve(mode === "ok" ? allow(data()) : unavailable);
  };
  const backend = {
    getRunOverview: (runId: unknown) => run("getRunOverview", runId, [], () => overview(runId as string)),
    getRunAuditTimeline: (runId: unknown, limit?: unknown) => run("getRunAuditTimeline", runId, [limit], () => [
      { eventType: "run_started", actorKind: "owner", actorId: SENTINEL.actor, runId, createdAt: "2026-10-01T09:00:01.000Z" },
    ]),
    getRunModelUsage: (runId: unknown) => run("getRunModelUsage", runId, [], () => overview(runId as string).modelUsage),
    listApprovalQueue: (limit?: unknown) => {
      calls.push({ method: "listApprovalQueue", args: [limit] });
      return Promise.resolve(allow(options.approvals ?? [approval("run-one", "high", 1), approval("run-one", "medium", 2), approval("run-two", "low", 3)]));
    },
  };
  return { backend, calls };
}

function reader(decision: unknown, ...slugArgument: [unknown?]) {
  const slug = slugArgument.length > 0 ? slugArgument[0] : "smart-algorithms-demo";
  const seen: string[] = [];
  const instance = consoleRead.createOwnerConsoleReader({
    workspaceSlug: slug,
    async withRuntime(domainWorkspaceId, read) {
      seen.push(domainWorkspaceId);
      return read(decision as never);
    },
  });
  return { instance, seen };
}

const forbiddenKeys = ["database", "session", "cookie", "jwt", "token", "providerSubject", "userId", "actorId",
  "requestedByActorId", "resolvedByActorId", "requestFingerprint", "deploymentId", "providerRequestModelId",
  "lastProviderRequestModelId", "workspaceId", "workspaceDatabaseId", "tenant", "backend", "error", "stack"];

function assertSanitized(value: unknown) {
  const json = JSON.stringify(value);
  for (const sentinel of Object.values(SENTINEL)) assert.ok(!json.includes(sentinel), `leaked ${sentinel}`);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        assert.ok(!forbiddenKeys.includes(key), `forbidden key ${key}`);
        visit(child);
      }
    }
  };
  visit(value);
}

test("1. the Owner Console loader is server-only and never imported by client code", () => {
  const server = source("lib/composition/owner-console-read.server.ts");
  assert.match(server, /^(\/\/[^\n]*\n)*import "server-only";/u, "server-only must be the first import");
  assert.ok(!/["']use server["']/u.test(server), "no Server Action module");
  const clientFiles = [...walk("app"), ...walk("components")].filter((path) => /\.(tsx?|mts)$/u.test(path))
    .filter((path) => /^\s*["']use client["']/mu.test(source(path)));
  assert.ok(clientFiles.length > 0);
  for (const path of clientFiles) {
    assert.ok(!/owner-console-read|github-owner-read-runtime|next-auth|lib\/db\//u.test(source(path)), `${path} imports server data access`);
  }
});

test("2. only the trusted workspace configuration reaches the authenticated composition", async () => {
  const { backend } = fakeBackend();
  const { instance, seen } = reader({ verdict: "allow", reason: null, backend });
  await instance.loadOwnerConsoleOverview();
  await instance.loadOwnerAttentionSummary();
  await instance.loadOwnerRun("run-one");
  // Hostile caller-shaped input carries a workspace; it cannot become authority.
  await instance.loadOwnerRun({ runId: "run-one", workspaceId: "other-tenant" } as unknown as string);
  assert.deepEqual([...new Set(seen)], ["smart-algorithms-demo"]);
  for (const name of ["loadOwnerConsoleOverview", "loadOwnerAttentionSummary"] as const) {
    assert.equal(instance[name].length, 0, `${name} takes no arguments`);
  }
  assert.equal(instance.loadOwnerRun.length, 1, "Run Detail takes only a runId");
  // Invalid/missing trusted configuration fails closed without opening a runtime.
  for (const slug of [undefined, "", "Bad Slug", "../x", { slug: "smart-algorithms-demo" }]) {
    const { instance: broken, seen: none } = reader({ verdict: "allow", reason: null, backend }, slug);
    assert.deepEqual(await broken.loadOwnerConsoleOverview(), { state: "unavailable", project: null });
    assert.deepEqual(none, []);
  }
  const server = source("lib/composition/owner-console-read.server.ts");
  assert.match(server, /workspaceSlug: process\.env\.APP_DEMO_WORKSPACE_SLUG/u);
  assert.equal((server.match(/domainWorkspaceId/gu) ?? []).length, 2, "workspace only flows from the reader's trusted value");
  for (const page of walk("app").filter((path) => /(dashboard|projects|runs|approvals)\/.*page\.tsx$/u.test(path))) {
    assert.ok(!/searchParams|cookies\(|headers\(|workspaceId|localStorage/u.test(source(page)), `${page} must not read caller workspace input`);
  }
});

test("3. UI projections never contain database, session, identity, actor or raw error data", async () => {
  const { backend } = fakeBackend({ runs: { "run-one": "ok", "run-two": "ok" } });
  const { instance } = reader({ verdict: "allow", reason: null, backend });
  const run = await instance.loadOwnerRun("run-one");
  for (const result of [await instance.loadOwnerConsoleOverview(), await instance.loadOwnerAttentionSummary(), run]) assertSanitized(result);
  assert.equal(run.state, "available");
  if (run.state === "available" && run.run.state === "available") {
    assert.equal(run.run.detail.usage.totalCostUsdMicros, 1234);
    assert.deepEqual(run.run.detail.audit, { state: "available", limit: 50, items: [{ eventType: "run_started", actorKind: "owner", createdAt: "2026-10-01T09:00:01.000Z" }] });
  }
  // A throwing composition never surfaces its error.
  const failing = consoleRead.createOwnerConsoleReader({
    workspaceSlug: "smart-algorithms-demo",
    withRuntime: async () => { throw new Error(SENTINEL.error); },
  });
  const failed = await failing.loadOwnerConsoleOverview();
  assert.deepEqual(failed, { state: "unavailable", project: { slug: "smart-algorithms-demo", displayName: "Smart Algorithms Demo" } });
  assertSanitized(failed);
});

test("4. an unauthenticated session maps to the sign-in state", async () => {
  const { instance } = reader({ verdict: "deny", reason: "unauthenticated", backend: null });
  const project = { slug: "smart-algorithms-demo", displayName: "Smart Algorithms Demo" };
  assert.deepEqual(await instance.loadOwnerConsoleOverview(), { state: "unauthenticated", project });
  assert.deepEqual(await instance.loadOwnerAttentionSummary(), { state: "unauthenticated", project });
  assert.deepEqual(await instance.loadOwnerRun("run-one"), { state: "unauthenticated", project });
});

test("5. every run denial is the same opaque unavailable state", async () => {
  const { backend } = fakeBackend({ runs: { "run-one": "ok", missing: "deny", foreign: "deny", broken: "throw", odd: "invalid" } });
  const { instance } = reader({ verdict: "allow", reason: null, backend });
  const opaque = await instance.loadOwnerRun("missing");
  assert.deepEqual(opaque, { state: "available", project: { slug: "smart-algorithms-demo", displayName: "Smart Algorithms Demo" }, run: { state: "unavailable" } });
  for (const runId of ["foreign", "broken", "odd", "UPPER", "../run", "x".repeat(65), ""]) {
    assert.deepEqual(await instance.loadOwnerRun(runId), opaque, runId);
  }
  // Composition-level denials (not an Owner, revoked membership, runtime down) share one state too.
  const { instance: denied } = reader({ verdict: "deny", reason: "unavailable", backend: null });
  assert.deepEqual(await denied.loadOwnerRun("run-one"), { state: "unavailable", project: opaque.project });
  assert.deepEqual(await denied.loadOwnerConsoleOverview(), { state: "unavailable", project: opaque.project });
});

test("6. Run Detail's only runtime target is the runId route parameter", async () => {
  const { backend, calls } = fakeBackend();
  const { instance } = reader({ verdict: "allow", reason: null, backend });
  await instance.loadOwnerRun("run-one");
  assert.deepEqual(calls.map((call) => call.method), ["getRunOverview", "getRunAuditTimeline", "getRunModelUsage"]);
  for (const call of calls) assert.equal(call.args[0], "run-one");
  const page = source("app/runs/[runId]/page.tsx");
  assert.match(page, /params: Promise<\{ runId: string \}>/u);
  assert.match(page, /const \{ runId \} = await params;/u);
  assert.match(page, /loadOwnerRun\(runId\)/u);
  assert.ok(!/searchParams|workspaceId|actorId|userId|role/u.test(page.replace(/\/\/[^\n]*/gu, "")));
});

test("7. the Owner Console loader exposes read functions only", async () => {
  const { backend } = fakeBackend();
  const { instance } = reader({ verdict: "allow", reason: null, backend });
  assert.deepEqual(Object.keys(instance).sort(), ["loadOwnerAttentionSummary", "loadOwnerConsoleOverview", "loadOwnerRun"]);
  assert.ok(Object.isFrozen(instance));
  const server = source("lib/composition/owner-console-read.server.ts");
  const exported = [...server.matchAll(/export async function (\w+)/gu)].map((match) => match[1]).sort();
  assert.deepEqual(exported, ["loadOwnerAttentionSummary", "loadOwnerConsoleOverview", "loadOwnerRun"]);
  // Any call of a write-shaped function (status literals such as "approved" are data, not calls).
  const writes = /\b(?:approve|reject|create(?!OwnerConsoleReader|WorkflowRuntimePostgresDatabase|RequestOwnerReadRuntime)|update|delete|execute|retry|publish|merge|mutate|insert)\w*\s*\(/iu;
  for (const path of ["lib/composition/owner-console-read.ts", "lib/composition/owner-console-read.server.ts"]) {
    const code = source(path).replace(/\/\/[^\n]*/gu, "");
    assert.ok(!writes.test(code), `${path} contains a write-shaped call`);
  }
});

test("8. the approval list is read-only end to end", async () => {
  const { backend, calls } = fakeBackend({ runs: { "run-one": "ok", "run-two": "ok" } });
  const { instance } = reader({ verdict: "allow", reason: null, backend });
  const result = await instance.loadOwnerConsoleOverview();
  assert.ok(calls.every((call) => ["listApprovalQueue", "getRunOverview"].includes(call.method)), JSON.stringify(calls));
  assert.equal(result.state, "available");
  if (result.state === "available") {
    assert.equal(result.pendingApprovals, 3);
    assert.equal(result.highRiskApprovals, 1);
    assert.deepEqual(result.attentionRuns.map((run) => run.runId), ["run-one", "run-two"]);
  }
  for (const path of ["app/approvals/page.tsx", "components/domain/owner-console/approval-queue.tsx", "app/dashboard/page.tsx"]) {
    const code = source(path);
    assert.ok(!/<form|onClick|formAction|["']use server["']|<button/u.test(code), `${path} must not offer decision controls`);
  }
});

test("9. rewritten Owner pages import no mock runtime data", () => {
  for (const path of ["app/dashboard/page.tsx", "app/approvals/page.tsx", "app/projects/page.tsx", "app/runs/page.tsx", "app/runs/[runId]/page.tsx",
    ...walk("components/domain/owner-console"), ...walk("components/shell")]) {
    assert.ok(!/mock-data|-demo"|project-control-center|project-operations/u.test(source(path)), `${path} imports demo data`);
  }
});

test("10. the only HTTP API route is the Auth.js route", () => {
  assert.deepEqual(walk("app/api").sort(), ["app/api/auth/[...nextauth]/route.ts"]);
  assert.deepEqual(walk("app").filter((path) => /(^|\/)route\.(ts|tsx|js)$/u.test(path)), ["app/api/auth/[...nextauth]/route.ts"]);
});
