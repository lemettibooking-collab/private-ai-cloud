import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const bridge = await import(new URL("../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../lib/executors/executor-start-boundary");
const concrete = await import(new URL("../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-executor");
type Fetch = import("../lib/executors/openai-agents-executor").ExecutorFetch;
function config() {
  return { identity: { id: "openai-agents", version: "v1" },
    capabilities: { tasks: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] },
    repository: { id: "repo-a", baseline: "a".repeat(40) },
    admission: { taskId: "task-a", completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["src"], taskOwnerApprovalGranted: true,
      plan: { id: "plan-a", title: "Plan", goal: "Proposal", status: "approved", tasks: [{ id: "task-a", sequence: 1,
        title: "Task", goal: "Proposal", scope: ["Source"], nonGoals: ["No autonomous execution"], allowedPaths: ["src"],
        acceptanceCriteria: ["Owner review"], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P3", requiresOwnerApproval: true }] } } };
}
const credential = "synthetic-test-credential-never-live";
const proposal = () => ({ changes: [{ path: "src/a.ts", operation: "add", content: "export const answer = 42;\n" }], report: "Unverified proposal for Owner review." });
function events(output: unknown = proposal()) {
  return [
    { type: "agent.session.created", event_id: "event_1", session: { id: "session_a", object: "agent.session", error: null,
      agent: { model: "explicit-test-model", tools: [{ type: "programmatic_tool_calling", enabled: false }], multi_agent: { enabled: false, max_concurrent_subagents: null } },
      environment: { type: "none" }, status: "in_progress", required_actions: [], vault_ids: [], usage: null, spend_control: { limit: 1, consumed: null } } },
    { type: "agent.session.turn.item.done", event_id: "event_2", session_id: "session_a", turn_id: "turn_a", output_index: 0,
      item: { id: "message_a", type: "message", role: "assistant", status: "completed", phase: "final_answer", turn_id: "turn_a",
        content: [{ type: "output_text", text: JSON.stringify(output) }] } },
    { type: "agent.session.turn.completed", event_id: "event_3", session_id: "session_a", turn_id: "turn_a",
      turn: { id: "turn_a", object: "agent.session.turn", session_id: "session_a", subagent_id: null, status: "completed", error: null,
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
}
const sse = (values: unknown[]) => values.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
function response(values: unknown[] = events()) { return new Response(sse(values), { headers: { "content-type": "text/event-stream" } }); }
function setup(fetcher?: Fetch, timeoutMs = 1000, mode: "test" | "production" = "test") {
  let calls = 0, credentialReads = 0, captured: Parameters<Fetch> | null = null;
  const b = bridge.createExecutorStartBoundary(config(), { maximumExposureUsdMicros: 10000, totalExposureUsdMicros: 160000, permitTtlMs: 60000, reservationTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const raw = { schemaVersion: 1, invocationId: "invocation-a", identity: config().identity, planId: "plan-a", taskId: "task-a", repository: config().repository, capability: "coding", mode: "patch_proposal" };
  const d = b.validateInvocation(raw); assert.ok(d.normalizedInvocation); const i = d.normalizedInvocation;
  const settings = { modelId: "explicit-test-model", accountId: "account-a", timeoutMs, credential: () => { credentialReads++; return credential; } };
  const fake: Fetch = async (url, init) => { calls++; captured = [url, init]; return fetcher ? fetcher(url, init) : response(); };
  const transport = mode === "test" ? concrete.createOpenAIAgentsTestTransport(b, settings, fake) : concrete.createOpenAIAgentsTransport(b, settings);
  let nextReservation = 0;
  const reserve = (invocation = i) => {
    const d = b.budgetAuthority.reserve(invocation, { providerId: "openai", modelId: settings.modelId, accountId: settings.accountId }, null,
      { reservationId: `reservation-${++nextReservation}`, maximumExposureUsdMicros: 10000 });
    assert.ok(d.reservation); return d.reservation;
  };
  const reservation = reserve();
  const p = transport.prepare(i, { files: [{ path: "src/a.ts", content: "// explicitly authorized context" }] }, reservation);
  assert.ok(p.prepared); const prepared = p.prepared;
  const permit = b.dispatchAuthority.issue(i, prepared.target, prepared.requestFingerprint); assert.ok(permit.permit);
  const start = () => {
    const d = b.providerStartFence.start(i, prepared.target, prepared.requestFingerprint, permit.permit, reservation);
    assert.ok(d.ticket); return d.ticket;
  };
  return { b, i, prepared, transport, reservation, reserve, start, calls: () => calls, credentials: () => credentialReads, captured: () => captured };
}
function frozen(value: unknown) { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); } }
function denied(d: Awaited<ReturnType<ReturnType<typeof setup>["prepared"]["invoke"]>>) { assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); frozen(d); }
test("exact managed request contains only admitted task and explicitly bounded context; tools/environment/subagents disabled", async () => {
  const s = setup(), result = await s.prepared.invoke(s.start()); assert.equal(result.verdict, "allow");
  const captured = s.captured(); assert.ok(captured);
  assert.equal(captured[0], "https://api.openai.com/v1/agents/sessions");
  assert.equal(captured[1].method, "POST"); assert.equal(captured[1].redirect, "error");
  assert.equal(captured[1].headers["OpenAI-Beta"], "agents=v1"); assert.equal(captured[1].headers.Authorization, `Bearer ${credential}`);
  const body = JSON.parse(captured[1].body); assert.deepEqual(Object.keys(body), ["agent", "environment", "input", "stream", "spend_control"]);
  assert.deepEqual(body.spend_control, { limit: 1 });
  assert.deepEqual(body.environment, { type: "none" }); assert.equal(body.stream, true);
  assert.equal(body.agent.model, "explicit-test-model"); assert.deepEqual(body.agent.multi_agent, { enabled: false });
  assert.deepEqual(body.agent.tools, [{ type: "programmatic_tool_calling", enabled: false }]);
  const input = JSON.parse(body.input); assert.deepEqual(input.task, s.i.task); assert.deepEqual(input.allowedPaths, ["src"]);
  assert.deepEqual(input.context.files, [{ path: "src/a.ts", content: "// explicitly authorized context" }]);
  for (const absent of [credential, "verificationCommands", "selectedExecutor", "npm test", "previous_response_id", "conversation"])
    assert.ok(!captured[1].body.includes(absent));
  assert.equal(s.calls(), 1); assert.equal(result.normalizedResult?.verificationStatus, "not_run");
  assert.equal(result.normalizedResult?.ownerDecisionRequired, true); assert.equal(result.normalizedResult?.automaticRetryAllowed, false);
  assert.ok(!JSON.stringify(result).includes(credential)); assert.ok(!JSON.stringify(result).includes("Authorization"));
});
test("no authority, validation receipt, reservation or human metadata can invoke transport", async () => {
  const s = setup();
  for (const fake of [null, {}, s.i, s.reservation, { selectedExecutor: "openai-agents" }, { ...s.start() }]) denied(await s.prepared.invoke(fake));
  assert.equal(s.calls(), 0); assert.equal(s.credentials(), 0);
});
test("production/live dispatch stays BLOCKED even with process-local fence; zero credential/network reads", async () => {
  const s = setup(undefined, 1000, "production"), d = await s.prepared.invoke(s.start()); denied(d);
  assert.equal(d.reason, "durable_executor_fence_required"); assert.equal(s.calls(), 0); assert.equal(s.credentials(), 0);
});
test("permit cannot be reused for another context, target or invocation; no dispatch", async () => {
  const s = setup(), other = s.transport.prepare(s.i, { files: [] }, s.reserve()); assert.ok(other.prepared);
  const ticket = s.start(); denied(await other.prepared.invoke(ticket));
  assert.equal(s.calls(), 0);
  assert.equal(s.transport.prepare({ ...s.i }, { files: [] }, s.reservation).verdict, "deny");
});
test("context snapshots are fresh, deterministic, immutable and reject outside/secret/oversized/unexpected fields", () => {
  const s = setup(), context = { files: [{ path: "src/z.ts", content: "z" }, { path: "src/a.ts", content: "a" }] }, before = structuredClone(context);
  const reservation = s.reserve();
  const a = s.transport.prepare(s.i, context, reservation); context.files.reverse(); const b = s.transport.prepare(s.i, context, reservation); context.files.reverse();
  assert.ok(a.prepared); assert.ok(b.prepared);
  assert.equal(a.prepared?.requestFingerprint, b.prepared?.requestFingerprint); assert.deepEqual(context, before);
  for (const bad of [{ files: [{ path: "outside/a.ts", content: "a" }] }, { files: [{ path: "src/.env", content: "a" }] },
    { files: [{ path: "src/a.ts", content: "x".repeat(8193) }] }, { files: [{ path: "src/a.ts", content: "api_key=do-not-serialize" }] },
    { files: [], selectedExecutor: "openai-agents" }, { files: Array(9).fill({ path: "src/a.ts", content: "a" }) }])
    assert.equal(s.transport.prepare(s.i, bad, s.reserve()).verdict, "deny");
});
test("context hostile getters/proxies never execute", () => {
  const s = setup(); let reads = 0;
  const bad = Object.defineProperty({}, "files", { enumerable: true, get() { reads++; throw Error("secret"); } });
  assert.equal(s.transport.prepare(s.i, bad, s.reserve()).verdict, "deny"); assert.equal(reads, 0);
  assert.equal(s.transport.prepare(s.i, new Proxy({ files: [] }, {}), s.reserve()).verdict, "deny");
});
test("bounded proposal goes through factual AI-041.0 evaluateResult, never provider claims of Quality Gate", async () => {
  for (const output of [{ ...proposal(), qualityGate: "PASS" }, { ...proposal(), changes: [{ ...proposal().changes[0], path: "outside/a.ts" }] },
    { ...proposal(), changes: [{ ...proposal().changes[0], operation: "shell" }] }, { ...proposal(), report: " " }, { ...proposal(), changes: [] }]) {
    const s = setup(async () => response(events(output))), d = await s.prepared.invoke(s.start()); denied(d); assert.equal(s.calls(), 1);
    assert.equal(d.reconciliation?.reconciliation, "reconciliation_required");
  }
});
test("analysis-only report has no changes and remains unverified", async () => {
  const s = setup(async () => response(events({ changes: [], report: proposal().report })));
  const raw = { schemaVersion: 1, invocationId: "analysis", identity: config().identity, planId: "plan-a", taskId: "task-a", repository: config().repository, capability: "repository_analysis", mode: "analysis_only" };
  const d = s.b.validateInvocation(raw); assert.ok(d.normalizedInvocation);
  const budget = s.reserve(d.normalizedInvocation);
  const p = s.transport.prepare(d.normalizedInvocation, { files: [] }, budget); assert.ok(p.prepared);
  const authority = s.b.dispatchAuthority.issue(d.normalizedInvocation, p.prepared.target, p.prepared.requestFingerprint);
  const start = s.b.providerStartFence.start(d.normalizedInvocation, p.prepared.target, p.prepared.requestFingerprint, authority.permit, budget);
  const result = await p.prepared.invoke(start.ticket); assert.equal(result.verdict, "allow"); assert.deepEqual(result.normalizedResult?.changes, []);
});
test("timeout after transmission is ambiguous, aborts once, retains exposure and never retries", async () => {
  let aborted = 0;
  const s = setup(async (_url, init) => { init.signal.addEventListener("abort", () => { aborted++; }); return new Promise<Response>(() => {}); }, 10);
  const ticket = s.start(), d = await s.prepared.invoke(ticket);
  assert.equal(d.normalizedResult?.status, "outcome_unknown"); assert.equal(d.normalizedResult?.failureCode, "ambiguous_outcome");
  assert.equal(d.reconciliation?.state, "reconciliation_required"); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 10000);
  assert.equal(s.calls(), 1); assert.equal(aborted, 1); denied(await s.prepared.invoke(ticket)); assert.equal(s.calls(), 1);
});
test("connection ambiguity uses same no-retry/retained reservation semantics without raw error", async () => {
  const s = setup(async () => { throw Error(`raw-provider-error ${credential}`); }); const d = await s.prepared.invoke(s.start());
  assert.equal(d.normalizedResult?.status, "outcome_unknown"); assert.equal(s.calls(), 1);
  assert.ok(!JSON.stringify(d).includes(credential)); assert.ok(!JSON.stringify(d).includes("raw-provider-error"));
});
test("caller abort before dispatch makes no call; abort after transmission is ambiguous", async () => {
  const before = setup(), signal = new AbortController(); signal.abort(); const d = await before.prepared.invoke(before.start(), signal.signal);
  assert.equal(d.normalizedResult?.status, "failed"); assert.equal(before.calls(), 0);
  const afterSignal = new AbortController();
  const after = setup(async () => { afterSignal.abort(); return new Promise<Response>(() => {}); });
  const a = await after.prepared.invoke(after.start(), afterSignal.signal); assert.equal(a.normalizedResult?.status, "outcome_unknown"); assert.equal(after.calls(), 1);
});
test("HTTP policy rejection is static; 5xx/429/redirect are ambiguous and never replayed", async () => {
  for (const status of [400, 401, 403, 429, 500, 302]) {
    const s = setup(async () => new Response(`raw error ${credential}`, { status })); const d = await s.prepared.invoke(s.start());
    assert.equal(d.normalizedResult?.status, status <= 403 && status >= 400 ? "rejected" : "outcome_unknown");
    assert.ok(!JSON.stringify(d).includes(credential)); assert.equal(s.calls(), 1);
  }
});
for (const defect of ["unexpected", "wrong_role", "wrong_phase", "wrong_status", "tool", "wrong_turn", "wrong_model", "missing_terminal", "contradictory_terminal"] as const) {
  test(`malformed/provider state denied: ${defect}`, async () => {
    const es = events() as unknown as Array<Record<string, unknown>>;
    if (defect === "unexpected") es[1].unknown = "raw";
    if (["wrong_role", "wrong_phase", "wrong_status", "tool", "wrong_turn"].includes(defect)) {
      const item = es[1].item as Record<string, unknown>;
      if (defect === "wrong_role") item.role = "user";
      if (defect === "wrong_phase") item.phase = "commentary";
      if (defect === "wrong_status") item.status = "incomplete";
      if (defect === "tool") item.type = "function_call";
      if (defect === "wrong_turn") item.turn_id = "different";
    }
    if (defect === "wrong_model") ((es[0].session as Record<string, unknown>).agent as Record<string, unknown>).model = "different";
    if (defect === "missing_terminal") es.pop();
    if (defect === "contradictory_terminal") es.push({ ...es[2], event_id: "event_4", type: "agent.session.turn.failed" });
    const s = setup(async () => response(es)); const d = await s.prepared.invoke(s.start());
    if (defect === "missing_terminal") assert.equal(d.normalizedResult?.status, "outcome_unknown"); else denied(d);
    assert.equal(s.calls(), 1);
  });
}
test("reasoning items ignored safely; reasoning-only completion denied", async () => {
  const es = events(); es.splice(1, 0, { type: "agent.session.turn.item.done", event_id: "reasoning_event", session_id: "session_a", turn_id: "turn_a", output_index: 0,
    item: { id: "reasoning_a", type: "reasoning", status: "completed", turn_id: "turn_a", summary: [] } } as unknown as typeof es[number]);
  const s = setup(async () => response(es)); assert.equal((await s.prepared.invoke(s.start())).verdict, "allow");
  es.splice(2, 1); const only = setup(async () => response(es)); denied(await only.prepared.invoke(only.start()));
});
test("raw secret echoed in final evidence, oversized stream and malformed JSON are denied", async () => {
  for (const body of [sse(events({ ...proposal(), report: credential })), "data: {bad-json}\n\n", "x".repeat(262145)]) {
    const s = setup(async () => new Response(body, { headers: { "content-type": "text/event-stream" } }));
    const d = await s.prepared.invoke(s.start()); denied(d); assert.ok(!JSON.stringify(d).includes(credential));
  }
});
test("arbitrarily split UTF-8 SSE works; bounded reader cancels on terminal", async () => {
  const bytes = new TextEncoder().encode(sse(events({ ...proposal(), report: "Предложение без проверки." }))); let offset = 0, cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, offset += 7)); }, cancel() { cancelled++; } });
  const s = setup(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  assert.equal((await s.prepared.invoke(s.start())).verdict, "allow"); assert.equal(cancelled, 1);
});
test("usage missing is unknown, malformed usage requires reconciliation, token counts never fabricate cost", async () => {
  for (const usage of [null, { input_tokens: 1, output_tokens: 2, total_tokens: 4 }]) {
    const es = events(); (es[2].turn as unknown as Record<string, unknown>).usage = usage;
    const s = setup(async () => response(es)); const d = await s.prepared.invoke(s.start());
    assert.equal(d.reconciliation?.reconciliation, usage === null ? "usage_unknown" : "reconciliation_required");
    assert.equal(d.reconciliation?.observedCostUsdMicros, null); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 10000);
  }
});
test("repeated independent evaluation is deterministic, fresh/frozen; input events never mutated", async () => {
  const es = events(), before = structuredClone(es), a = setup(async () => response(es)), b = setup(async () => response(es));
  const first = await a.prepared.invoke(a.start()), second = await b.prepared.invoke(b.start());
  assert.deepEqual(first, second); assert.notEqual(first.normalizedResult, second.normalizedResult); frozen(first); frozen(second); assert.deepEqual(es, before);
  assert.ok(!("session_id" in first.normalizedResult!)); assert.ok(!("usage" in first.normalizedResult!));
});
test("server composition is explicitly locked and never binds ModelInvocation/OAuth/UI/Git", () => {
  const source = readFileSync(new URL("../lib/composition/development-executor.server.ts", import.meta.url), "utf8");
  assert.match(source, /import "server-only"/u); assert.match(source, /realDispatch: "blocked"/u);
  assert.doesNotMatch(source, /ModelInvocation|chatgpt|child_process|git (?:add|commit|push)|use server/u);
});
test("late provider response cannot settle or overwrite the timeout/ambiguous reservation", async () => {
  let resolve!: (r: Response) => void;
  const s = setup(async () => new Promise<Response>(r => { resolve = r; }), 10), ticket = s.start();
  const d = await s.prepared.invoke(ticket); assert.equal(d.normalizedResult?.status, "outcome_unknown");
  resolve(response()); await new Promise(r => setImmediate(r));
  assert.equal(s.b.budgetAuthority.inspect(s.reservation)?.reconciliation, "reconciliation_required");
  assert.equal(s.b.budgetAuthority.inspect(s.reservation)?.observedUsage, null); assert.equal(s.calls(), 1);
});
test("timeout while reading provider stream cancels reader and retains exposure", async () => {
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const s = setup(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }), 10);
  const d = await s.prepared.invoke(s.start()); assert.equal(d.normalizedResult?.status, "outcome_unknown"); assert.equal(cancelled, 1);
  assert.equal(d.reconciliation?.exposureHeldUsdMicros, 10000); assert.equal(s.calls(), 1);
});
test("another configured executor cannot consume executor A's ticket", async () => {
  const a = setup(), ticket = a.start(), c = config(); c.identity.id = "other-executor";
  const b = bridge.createExecutorStartBoundary(c, { maximumExposureUsdMicros: 10000, totalExposureUsdMicros: 10000, permitTtlMs: 60000, reservationTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const d = b.validateInvocation({ schemaVersion: 1, invocationId: "invocation-a", identity: c.identity, planId: "plan-a", taskId: "task-a", repository: c.repository, capability: "coding", mode: "patch_proposal" }); assert.ok(d.normalizedInvocation);
  let calls = 0;
  const transport = concrete.createOpenAIAgentsTestTransport(b, { modelId: "explicit-test-model", accountId: "account-a", timeoutMs: 1000, credential: () => credential }, async () => { calls++; return response(); });
  const budget = b.budgetAuthority.reserve(d.normalizedInvocation, { providerId: "openai", modelId: "explicit-test-model", accountId: "account-a" }, null,
    { reservationId: "other-executor", maximumExposureUsdMicros: 10000 }); assert.ok(budget.reservation);
  const p = transport.prepare(d.normalizedInvocation, { files: [] }, budget.reservation); assert.ok(p.prepared);
  denied(await p.prepared.invoke(ticket)); assert.equal(calls, 0);
});
test("one fence ticket cannot invoke the provider twice, including concurrent consumers", async () => {
  const s = setup(), ticket = s.start();
  const results = await Promise.all(Array.from({ length: 10 }, () => s.prepared.invoke(ticket)));
  assert.equal(results.filter(d => d.verdict === "allow").length, 1); assert.equal(s.calls(), 1);
  assert.equal(results.filter(d => d.verdict === "deny").length, 9);
});

// Corrective requirements intentionally exercised against the committed baseline first.
function capped(amount: number, fetcher?: Fetch, production = false) {
  let calls = 0, reads = 0, body = "";
  const b = bridge.createExecutorStartBoundary(config(), { maximumExposureUsdMicros: 1000000000, totalExposureUsdMicros: 1000000000,
    permitTtlMs: 60000, reservationTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const d = b.validateInvocation({ schemaVersion: 1, invocationId: "invocation-a", identity: config().identity,
    planId: "plan-a", taskId: "task-a", repository: config().repository, capability: "coding", mode: "patch_proposal" });
  assert.ok(d.normalizedInvocation); const i = d.normalizedInvocation;
  const target = { providerId: "openai", modelId: "explicit-test-model", accountId: "account-a" };
  const r = b.budgetAuthority.reserve(i, target, null, { reservationId: "reservation-a", maximumExposureUsdMicros: amount });
  assert.ok(r.reservation);
  const settings = { ...target, timeoutMs: 1000, credential: () => { reads++; return credential; } };
  const fake: Fetch = async (url, init) => {
    calls++; body = init.body;
    if (fetcher) return fetcher(url, init);
    const es = events(); Object.assign(es[0].session!, { spend_control: { limit: Math.floor(amount / 10000), consumed: null } });
    return response(es);
  };
  const t = production ? concrete.createOpenAIAgentsTransport(b, settings) : concrete.createOpenAIAgentsTestTransport(b, settings, fake);
  const p = t.prepare(i, { files: [] }, r.reservation);
  const start = () => {
    assert.ok(p.prepared);
    const authority = b.dispatchAuthority.issue(i, target, p.prepared.requestFingerprint);
    const result = b.providerStartFence.start(i, target, p.prepared.requestFingerprint, authority.permit, r.reservation);
    assert.ok(result.ticket); return result.ticket;
  };
  return { b, i, target, t, p, r: r.reservation, start, calls: () => calls, reads: () => reads, body: () => body };
}
test("AI-041.1a baseline proof: allowed request must include a fingerprinted provider spending limit", async () => {
  const s = setup(); await s.prepared.invoke(s.start());
  const captured = s.captured(); assert.ok(captured);
  assert.deepEqual(JSON.parse(captured[1].body).spend_control, { limit: 1 });
  assert.equal(s.prepared.requestFingerprint, createHash("sha256").update(captured[1].body).digest("hex"));
});
for (const amount of [9999, 10000, 19999, 20000, 1000000000]) {
  test(`AI-041.1a reservation conversion ${amount} micros is bounded and never rounds upward`, async () => {
    const s = capped(amount);
    if (amount < 10000) { assert.equal(s.p.verdict, "deny"); assert.equal(s.p.prepared, null); assert.equal(s.calls(), 0); return; }
    assert.ok(s.p.prepared); const d = await s.p.prepared.invoke(s.start()); assert.equal(d.verdict, "allow");
    const limit = JSON.parse(s.body()).spend_control.limit;
    assert.equal(limit, Math.floor(amount / 10000)); assert.ok(limit * 10000 <= amount);
    assert.equal(s.p.prepared.requestFingerprint, createHash("sha256").update(s.body()).digest("hex"));
    assert.ok(d.reconciliation);
    assert.equal(d.reconciliation.maximumExposureUsdMicros, amount); assert.equal(d.reconciliation.exposureHeldUsdMicros, amount);
    assert.equal(d.reconciliation.observedCostUsdMicros, null);
  });
}
test("AI-041.1a changed authorized cap changes exact request fingerprint", () => {
  const one = capped(10000), two = capped(20000);
  assert.ok(one.p.prepared); assert.ok(two.p.prepared);
  assert.notEqual(one.p.prepared.requestFingerprint, two.p.prepared.requestFingerprint);
});
test("AI-041.1a missing/caller/foreign/cancelled reservations cannot authorize a cap", () => {
  const s = capped(10000), other = capped(20000); assert.ok(s.p.prepared);
  for (const fake of [null, {}, { ...s.r, maximumExposureUsdMicros: 20000, spend_control: { limit: 2 } }, other.r])
    assert.equal(s.t.prepare(s.i, { files: [] }, fake).verdict, "deny");
  assert.equal(s.t.prepare(s.i, { files: [], spend_control: { limit: 2 } }, s.r).verdict, "deny");
  s.b.budgetAuthority.cancel(s.r);
  assert.equal(s.t.prepare(s.i, { files: [] }, s.r).verdict, "deny");
  assert.equal(s.calls(), 0); assert.equal(s.reads(), 0);
});
for (const spend of [undefined, null, {}, { limit: 1 }, { limit: null, consumed: null }, { limit: 2, consumed: null },
  { limit: 0, consumed: null }, { limit: -1, consumed: null }, { limit: Number.MAX_SAFE_INTEGER + 1, consumed: null },
  { limit: 1.1, consumed: null }, { limit: 1, consumed: -1 }, { limit: 1, consumed: 0.5 },
  { limit: 1, consumed: Number.MAX_SAFE_INTEGER + 1 }, { limit: 1, consumed: 0, extra: true }]) {
  test(`AI-041.1a malformed/missing/contradictory returned spending data ${JSON.stringify(spend)}`, async () => {
    const es = events(); if (spend === undefined) Reflect.deleteProperty(es[0].session!, "spend_control");
    else Object.assign(es[0].session!, { spend_control: spend });
    const before = structuredClone(es), s = capped(10000, async () => response(es)); assert.ok(s.p.prepared);
    const ticket = s.start(), d = await s.p.prepared.invoke(ticket); denied(d);
    assert.equal(d.reconciliation?.state, "reconciliation_required"); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 10000);
    assert.equal(d.reconciliation?.observedCostUsdMicros, null); assert.deepEqual(es, before);
    denied(await s.p.prepared.invoke(ticket)); assert.equal(s.calls(), 1);
  });
}
test("AI-041.1a consumed is best-effort, never settlement even at/above configured cap", async () => {
  for (const consumed of [null, 0, 1, 2, Number.MAX_SAFE_INTEGER]) {
    const es = events(); Object.assign(es[0].session!, { spend_control: { limit: 1, consumed } });
    const s = capped(19999, async () => response(es)); assert.ok(s.p.prepared);
    const d = await s.p.prepared.invoke(s.start()); assert.equal(d.verdict, "allow");
    assert.ok(d.reconciliation);
    assert.equal(d.reconciliation.exposureHeldUsdMicros, 19999); assert.equal(d.reconciliation.observedCostUsdMicros, null);
    assert.equal(s.b.budgetAuthority.cancel(s.r), false);
  }
});
test("AI-041.1a provider spending cap does not unlock production", async () => {
  const s = capped(10000, undefined, true); assert.ok(s.p.prepared);
  const d = await s.p.prepared.invoke(s.start()); denied(d);
  assert.equal(d.reason, "durable_executor_fence_required"); assert.equal(s.reads(), 0); assert.equal(s.calls(), 0);
});
test("AI-041.1a session_budget_exceeded never retries or releases reservation, raw message never escapes", async () => {
  const es = events(); Object.assign(es[0].session!, { spend_control: { limit: 1, consumed: 1 } });
  es.splice(1, 1); Object.assign(es[1], { type: "agent.session.turn.failed" });
  Object.assign(es[1].turn!, { status: "failed", error: { code: "session_budget_exceeded", message: "untrusted-raw-budget-error" } });
  const s = capped(10000, async () => response(es)); assert.ok(s.p.prepared);
  const ticket = s.start(), d = await s.p.prepared.invoke(ticket);
  assert.equal(d.normalizedResult?.status, "failed"); assert.equal(d.normalizedResult?.failureCode, "provider_failure");
  assert.equal(d.normalizedResult?.automaticRetryAllowed, false); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 10000);
  assert.equal(d.reconciliation?.observedCostUsdMicros, null); assert.ok(!JSON.stringify(d).includes("untrusted-raw-budget-error"));
  assert.equal(s.b.budgetAuthority.cancel(s.r), false); denied(await s.p.prepared.invoke(ticket)); assert.equal(s.calls(), 1);
});

test("AI-041.1a higher capped request cannot consume a smaller authorized reservation", async () => {
  const s = capped(10000); assert.ok(s.p.prepared);
  const higher = s.b.budgetAuthority.reserve(s.i, s.target, null, { reservationId: "higher", maximumExposureUsdMicros: 20000 }); assert.ok(higher.reservation);
  const p = s.t.prepare(s.i, { files: [] }, higher.reservation); assert.ok(p.prepared);
  assert.notEqual(p.prepared.requestFingerprint, s.p.prepared.requestFingerprint);
  const authority = s.b.dispatchAuthority.issue(s.i, s.target, p.prepared.requestFingerprint);
  const blocked = s.b.providerStartFence.start(s.i, s.target, p.prepared.requestFingerprint, authority.permit, s.r);
  assert.equal(blocked.verdict, "blocked"); assert.equal(blocked.ticket, null);
  assert.equal(s.b.budgetAuthority.bindRequest(s.r, s.i, s.target, p.prepared.requestFingerprint), false);
  denied(await p.prepared.invoke(s.start())); assert.equal(s.calls(), 0); assert.equal(s.reads(), 0);
});
test("AI-041.1a same-cent requests still require the exact factual reservation and preserve full micros", async () => {
  const s = capped(10000); assert.ok(s.p.prepared);
  const r = s.b.budgetAuthority.reserve(s.i, s.target, null, { reservationId: "remainder", maximumExposureUsdMicros: 19999 }); assert.ok(r.reservation);
  const p = s.t.prepare(s.i, { files: [] }, r.reservation); assert.ok(p.prepared);
  // Equal canonical bytes/cents are legitimate; a ticket must nevertheless belong to its prepared reservation.
  assert.equal(p.prepared.requestFingerprint, s.p.prepared.requestFingerprint);
  const ticket = s.start(); denied(await p.prepared.invoke(ticket)); assert.equal(s.calls(), 0); assert.equal(s.reads(), 0);
  assert.equal((await s.p.prepared.invoke(ticket)).verdict, "allow"); assert.equal(s.calls(), 1);
  assert.equal(s.b.budgetAuthority.inspect(r.reservation)?.exposureHeldUsdMicros, 19999);
});
test("AI-041.1a capped preparations and outputs are deterministic, fresh/frozen and do not mutate inputs", async () => {
  const s = capped(10000), other = capped(10000), context = { files: [] }, before = structuredClone(s.i); assert.ok(other.p.prepared);
  const a = s.t.prepare(s.i, context, s.r), b = s.t.prepare(s.i, context, s.r); assert.ok(a.prepared); assert.ok(b.prepared);
  assert.notEqual(a.prepared, b.prepared); assert.equal(a.prepared.requestFingerprint, b.prepared.requestFingerprint); frozen(a); frozen(b);
  const first = await a.prepared.invoke(s.start()), second = await other.p.prepared.invoke(other.start());
  assert.deepEqual(first, second); assert.notEqual(first.normalizedResult, second.normalizedResult); frozen(first); frozen(second);
  assert.deepEqual(s.i, before); assert.deepEqual(context, { files: [] });
});
