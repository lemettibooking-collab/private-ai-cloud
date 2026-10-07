import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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
      environment: { type: "none" }, status: "in_progress", required_actions: [], vault_ids: [], usage: null } },
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
  const b = bridge.createExecutorStartBoundary(config(), { maximumExposureUsdMicros: 1000, totalExposureUsdMicros: 2000, permitTtlMs: 60000, reservationTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const raw = { schemaVersion: 1, invocationId: "invocation-a", identity: config().identity, planId: "plan-a", taskId: "task-a", repository: config().repository, capability: "coding", mode: "patch_proposal" };
  const d = b.validateInvocation(raw); assert.ok(d.normalizedInvocation); const i = d.normalizedInvocation;
  const settings = { modelId: "explicit-test-model", accountId: "account-a", timeoutMs, credential: () => { credentialReads++; return credential; } };
  const fake: Fetch = async (url, init) => { calls++; captured = [url, init]; return fetcher ? fetcher(url, init) : response(); };
  const transport = mode === "test" ? concrete.createOpenAIAgentsTestTransport(b, settings, fake) : concrete.createOpenAIAgentsTransport(b, settings);
  const p = transport.prepare(i, { files: [{ path: "src/a.ts", content: "// explicitly authorized context" }] });
  assert.ok(p.prepared); const prepared = p.prepared;
  const permit = b.dispatchAuthority.issue(i, prepared.target, prepared.requestFingerprint); assert.ok(permit.permit);
  const reservation = b.budgetAuthority.reserve(i, prepared.target, prepared.requestFingerprint, { reservationId: "reservation-a", maximumExposureUsdMicros: 1000 }); assert.ok(reservation.reservation);
  const start = () => {
    const d = b.providerStartFence.start(i, prepared.target, prepared.requestFingerprint, permit.permit, reservation.reservation);
    assert.ok(d.ticket); return d.ticket;
  };
  return { b, i, prepared, transport, reservation: reservation.reservation, start, calls: () => calls, credentials: () => credentialReads, captured: () => captured };
}
function frozen(value: unknown) { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); } }
function denied(d: Awaited<ReturnType<ReturnType<typeof setup>["prepared"]["invoke"]>>) { assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); frozen(d); }
test("exact managed request contains only admitted task and explicitly bounded context; tools/environment/subagents disabled", async () => {
  const s = setup(), result = await s.prepared.invoke(s.start()); assert.equal(result.verdict, "allow");
  const captured = s.captured(); assert.ok(captured);
  assert.equal(captured[0], "https://api.openai.com/v1/agents/sessions");
  assert.equal(captured[1].method, "POST"); assert.equal(captured[1].redirect, "error");
  assert.equal(captured[1].headers["OpenAI-Beta"], "agents=v1"); assert.equal(captured[1].headers.Authorization, `Bearer ${credential}`);
  const body = JSON.parse(captured[1].body); assert.deepEqual(Object.keys(body), ["agent", "environment", "input", "stream"]);
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
  const s = setup(), ticket = s.start();
  const other = s.transport.prepare(s.i, { files: [] }); assert.ok(other.prepared); denied(await other.prepared.invoke(ticket));
  assert.equal(s.calls(), 0);
  assert.equal(s.transport.prepare({ ...s.i }, { files: [] }).verdict, "deny");
});
test("context snapshots are fresh, deterministic, immutable and reject outside/secret/oversized/unexpected fields", () => {
  const s = setup(), context = { files: [{ path: "src/z.ts", content: "z" }, { path: "src/a.ts", content: "a" }] }, before = structuredClone(context);
  const a = s.transport.prepare(s.i, context); context.files.reverse(); const b = s.transport.prepare(s.i, context); context.files.reverse();
  assert.equal(a.prepared?.requestFingerprint, b.prepared?.requestFingerprint); assert.deepEqual(context, before);
  for (const bad of [{ files: [{ path: "outside/a.ts", content: "a" }] }, { files: [{ path: "src/.env", content: "a" }] },
    { files: [{ path: "src/a.ts", content: "x".repeat(8193) }] }, { files: [{ path: "src/a.ts", content: "api_key=do-not-serialize" }] },
    { files: [], selectedExecutor: "openai-agents" }, { files: Array(9).fill({ path: "src/a.ts", content: "a" }) }])
    assert.equal(s.transport.prepare(s.i, bad).verdict, "deny");
});
test("context hostile getters/proxies never execute", () => {
  const s = setup(); let reads = 0;
  const bad = Object.defineProperty({}, "files", { enumerable: true, get() { reads++; throw Error("secret"); } });
  assert.equal(s.transport.prepare(s.i, bad).verdict, "deny"); assert.equal(reads, 0);
  assert.equal(s.transport.prepare(s.i, new Proxy({ files: [] }, {})).verdict, "deny");
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
  const p = s.transport.prepare(d.normalizedInvocation, { files: [] }); assert.ok(p.prepared);
  const authority = s.b.dispatchAuthority.issue(d.normalizedInvocation, p.prepared.target, p.prepared.requestFingerprint);
  const budget = s.b.budgetAuthority.reserve(d.normalizedInvocation, p.prepared.target, p.prepared.requestFingerprint, { reservationId: "analysis-budget", maximumExposureUsdMicros: 1000 });
  const start = s.b.providerStartFence.start(d.normalizedInvocation, p.prepared.target, p.prepared.requestFingerprint, authority.permit, budget.reservation);
  const result = await p.prepared.invoke(start.ticket); assert.equal(result.verdict, "allow"); assert.deepEqual(result.normalizedResult?.changes, []);
});
test("timeout after transmission is ambiguous, aborts once, retains exposure and never retries", async () => {
  let aborted = 0;
  const s = setup(async (_url, init) => { init.signal.addEventListener("abort", () => { aborted++; }); return new Promise<Response>(() => {}); }, 10);
  const ticket = s.start(), d = await s.prepared.invoke(ticket);
  assert.equal(d.normalizedResult?.status, "outcome_unknown"); assert.equal(d.normalizedResult?.failureCode, "ambiguous_outcome");
  assert.equal(d.reconciliation?.state, "reconciliation_required"); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 1000);
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
    assert.equal(d.reconciliation?.observedCostUsdMicros, null); assert.equal(d.reconciliation?.exposureHeldUsdMicros, 1000);
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
  assert.equal(d.reconciliation?.exposureHeldUsdMicros, 1000); assert.equal(s.calls(), 1);
});
test("another configured executor cannot consume executor A's ticket", async () => {
  const a = setup(), ticket = a.start(), c = config(); c.identity.id = "other-executor";
  const b = bridge.createExecutorStartBoundary(c, { maximumExposureUsdMicros: 1000, totalExposureUsdMicros: 1000, permitTtlMs: 60000, reservationTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const d = b.validateInvocation({ schemaVersion: 1, invocationId: "invocation-a", identity: c.identity, planId: "plan-a", taskId: "task-a", repository: c.repository, capability: "coding", mode: "patch_proposal" }); assert.ok(d.normalizedInvocation);
  let calls = 0;
  const transport = concrete.createOpenAIAgentsTestTransport(b, { modelId: "explicit-test-model", accountId: "account-a", timeoutMs: 1000, credential: () => credential }, async () => { calls++; return response(); });
  const p = transport.prepare(d.normalizedInvocation, { files: [] }); assert.ok(p.prepared);
  denied(await p.prepared.invoke(ticket)); assert.equal(calls, 0);
});
test("one fence ticket cannot invoke the provider twice, including concurrent consumers", async () => {
  const s = setup(), ticket = s.start();
  const results = await Promise.all(Array.from({ length: 10 }, () => s.prepared.invoke(ticket)));
  assert.equal(results.filter(d => d.verdict === "allow").length, 1); assert.equal(s.calls(), 1);
  assert.equal(results.filter(d => d.verdict === "deny").length, 9);
});
