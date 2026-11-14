import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
const location = new URL("../lib/executors/openai-agents-reconciliation.ts", import.meta.url);
const reconciliation = existsSync(location) ? await import(location.href) : null;
for (const fact of ["retrieval-only reconciler", "saved session retrieval", "saved turn retrieval", "turn item reconstruction", "terminal recovery after restart"])
  test(`baseline prerequisite: ${fact}`, () => assert.equal(typeof reconciliation?.createOpenAIAgentsRetrievalTestReconciler, "function", `baseline 780a005 lacks ${fact}`));
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { memoryReconciler, savedSession, savedTurn, savedAnswer, savedPage, reasoningItem, initialUserInput, assertHeld, frozen, retrieval } from "./fixtures/executor-provider-reconciliation.mts";
const composition = await import(new URL("../lib/composition/executor-provider-reconciliation.ts", import.meta.url).href) as typeof import("../lib/composition/executor-provider-reconciliation");
test("known exact saved IDs reconstruct same proposal; replay frozen/fresh; inputs immutable; no mutation endpoints", async () => {
  const f = memoryReconciler(), before = structuredClone({ raw: f.raw, session: f.state.session, turn: f.state.turn, items: f.state.items });
  const first = await f.reconciler.reconcile(f.raw), replay = await f.reconciler.reconcile(f.raw), again = await f.reconciler.reconcile(f.raw);
  assert.equal(first.status, "settled"); assert.equal(replay.status, "idempotent"); assert.deepEqual(replay, again);
  assert.notEqual(replay, again); assert.notEqual(replay.normalizedResult, again.normalizedResult); frozen(first); frozen(replay);
  assert.equal(f.facts().releases, 1); assert.equal(first.normalizedResult?.changes[0].content, "export const answer = 42;\n");
  assert.deepEqual({ raw: f.raw, session: f.state.session, turn: f.state.turn, items: f.state.items }, before);
  assert.ok(f.state.calls.every(c => c.method === "GET")); assert.equal("createSession" in f.client, false); assert.equal("submitMessage" in f.reconciler, false);
});
for (const status of ["queued", "in_progress", "waiting"]) test(`nonterminal turn ${status}: full hold, no retry`, async () => {
  const f = memoryReconciler(); f.state.turn = savedTurn("turn_a", "session_a", status);
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.equal(d.status, "pending_reconciliation"); assert.equal(f.facts().releases, 0);
});
for (const status of ["idle", "in_progress", "requires_action", "failed"]) test(`session ${status} alone never establishes success`, async () => {
  const f = memoryReconciler(); f.state.session.status = status; f.state.turn = savedTurn("turn_a", "session_a", "waiting");
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.equal(f.facts().releases, 0);
});
test("session in_progress overrides even a later completed turn: defer to another pass", async () => {
  const f = memoryReconciler(); f.state.session.status = "in_progress";
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.state.calls.length, 1);
});
for (const status of ["failed", "cancelled"]) test(`terminal ${status} maps static failure, raw error absent`, async () => {
  const f = memoryReconciler(); f.state.turn = savedTurn("turn_a", "session_a", status);
  Object.assign(f.state.turn, { error: status === "failed" ? { code: "private-error-canary", message: "private-error-canary" } : null });
  const d = await f.reconciler.reconcile(f.raw); assert.equal(d.verdict, "allow"); assert.equal(d.normalizedResult?.status, "failed");
  assert.equal(d.normalizedResult?.failureCode, status === "failed" ? "provider_failure" : "execution_failure");
  assert.doesNotMatch(JSON.stringify(d), /private-error-canary/u); assert.equal(f.state.calls.length, 2);
});
test("final corrective: failed turn with null error remains factual terminal evidence", async () => {
  const f = memoryReconciler(); f.state.turn = savedTurn("turn_a", "session_a", "failed");
  const d = await f.reconciler.reconcile(f.raw); assert.equal(d.status, "settled"); assert.equal(d.normalizedResult?.failureCode, "provider_failure");
  assert.equal(f.facts().releases, 1);
});
for (const status of ["cancelled", "completed", "waiting", "in_progress", "queued"]) test(`final corrective: ${status} with structured error is unavailable and never settles`, async () => {
  const f = memoryReconciler(); f.state.turn = savedTurn("turn_a", "session_a", status);
  Object.assign(f.state.turn, { error: { code: "private-error-canary", message: "private-error-canary" } });
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.equal(d.status, "unavailable"); assert.equal(f.facts().releases, 0);
  assert.equal(f.facts().result, null); assert.equal(f.state.calls.length, 2);
});
const sessionMutations: Record<string, (s: ReturnType<typeof savedSession>) => void> = {
  metadata: s => { s.metadata.pac_execution = "d".repeat(64); }, model: s => { s.agent.model = "another-model"; },
  cap: s => { s.spend_control.limit = 2; }, overcap: s => { s.spend_control.consumed = 2; },
  tools: s => { s.agent.tools[0].enabled = true; }, multiagent: s => { s.agent.multi_agent.enabled = true; },
  environment: s => { s.environment.type = "container"; }, id: s => { s.id = "session_b"; }, object: s => { s.object = "unexpected"; },
  status: s => { s.status = "completed"; }, usage: s => { s.usage.total_tokens = 31; }, timestamp: s => { s.last_active_at = 99; },
};
for (const [label, change] of Object.entries(sessionMutations)) test(`session ${label} mismatch denied`, async () => {
  const f = memoryReconciler(); change(f.state.session); assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
for (const field of ["id", "session_id", "agent_id", "subagent_id", "object", "status", "created_at", "usage", "unexpected"]) test(`turn ${field} mismatch denied`, async () => {
  const f = memoryReconciler(); Object.assign(f.state.turn, { [field]: field === "usage" ? { input_tokens: 1, output_tokens: 2, total_tokens: 0 } : "unexpected" });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
test("reasoning ignored; final answer on LAST item page required", async () => {
  const f = memoryReconciler(); f.state.items = [reasoningItem(), savedAnswer()]; f.state.pageSize = 1;
  const d = await f.reconciler.reconcile(f.raw); assert.equal(d.verdict, "allow"); assert.equal(f.state.calls.length, 4);
  assert.doesNotMatch(JSON.stringify(d), /private-reasoning-canary/u);
});
for (const kind of ["missing", "duplicate-final", "tool", "computer", "function", "subagent", "user", "incomplete", "wrong-turn", "bad-json", "forbidden-path", "credential", "duplicate-id"]) test(`saved items ${kind}: deny without settlement`, async () => {
  const f = memoryReconciler(), item = savedAnswer();
  if (kind === "missing") f.state.items = [reasoningItem()];
  else if (kind === "duplicate-final") f.state.items.push(savedAnswer("message_b"));
  else if (kind === "duplicate-id") { f.state.items.push(item); f.state.pageSize = 1; }
  else {
    if (["tool", "computer", "function", "subagent"].includes(kind)) item.type = kind;
    if (kind === "user") item.role = "user";
    if (kind === "incomplete") item.status = "incomplete";
    if (kind === "wrong-turn") item.turn_id = "foreign_turn";
    if (kind === "bad-json") item.content[0].text = "not JSON";
    if (kind === "forbidden-path") item.content[0].text = item.content[0].text.replace("src/a.ts", ".env.local");
    if (kind === "credential") item.content[0].text = item.content[0].text.replace("Owner review required.", "api_key=private-credential-canary");
    f.state.items = [item];
  }
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.equal(f.facts().releases, 0);
});
for (const count of [0, 1, 2]) test(`correlation discovery ${count} exact matches: exhaustive, never absence proof`, async () => {
  const f = memoryReconciler({ session: null, turn: null });
  f.state.sessions = Array.from({ length: count }, (_, n) => savedSession(undefined, n ? "session_b" : "session_a")); f.state.pageSize = 1;
  const d = await f.reconciler.reconcile(f.raw);
  if (count === 1) { assert.equal(d.status, "settled"); assert.equal(f.p.sessionId, "session_a"); assert.equal(f.p.turnId, "turn_a"); }
  else { assertHeld(d); assert.equal(f.p.sessionId, null); assert.equal(f.facts().releases, 0); assert.equal(d.status, count === 0 ? "pending_reconciliation" : "recovery_required"); }
});
for (const count of [0, 1, 2]) test(`root turn discovery ${count} candidates: never choose newest`, async () => {
  const f = memoryReconciler({ turn: null }); f.state.turns = Array.from({ length: count }, (_, n) => savedTurn(n ? "turn_b" : "turn_a"));
  const d = await f.reconciler.reconcile(f.raw);
  if (count === 1) assert.equal(d.status, "settled"); else { assertHeld(d); assert.equal(f.p.turnId, null); }
});
for (const kind of ["loop", "empty-continuation", "page-bound", "schema", "duplicate", "first-id", "last-id"]) test(`pagination ${kind}: no partial result or ID binding`, async () => {
  const f = memoryReconciler({ session: null, turn: null }); let page = 0;
  f.state.override = () => {
    const s = savedSession(undefined, `session_${++page}`), p = savedPage([s], true);
    if (kind === "loop" || kind === "duplicate") return Response.json(savedPage([savedSession()], true));
    if (kind === "empty-continuation") return Response.json(savedPage([], true));
    if (kind === "schema") return Response.json({ ...p, unexpected: true });
    if (kind === "first-id") p.first_id = "foreign";
    if (kind === "last-id") p.last_id = "foreign";
    return Response.json(p);
  };
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.p.sessionId, null); assert.ok(f.state.calls.length <= 4); assert.equal(f.facts().releases, 0);
});
for (const code of [400, 401, 403, 404, 429, 500, 503, 302]) test(`GET HTTP ${code}: unavailable, no retry or raw body`, async () => {
  const f = memoryReconciler(); f.state.override = () => new Response("private-error-canary", { status: code });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.state.calls.length, 1); assert.equal(f.facts().releases, 0);
});
for (const kind of ["invalid-json", "oversized", "disconnect", "timeout", "hostile-json"]) test(`GET ${kind}: bounded unavailable`, async () => {
  const f = memoryReconciler();
  f.state.override = () => {
    if (kind === "timeout") return new Promise<Response>(() => {});
    if (kind === "disconnect") throw Error("private-error-canary");
    return new Response(kind === "oversized" ? "x".repeat(retrieval.executorRetrievalLimits.jsonBytes + 1) : kind === "hostile-json" ? '{"__proto__":{}}' : "{", { headers: { "content-type": "application/json" } });
  };
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.state.calls.length, 1); assert.equal(f.facts().releases, 0);
});
test("foreign account client and forged/cloned test client denied before GET", () => {
  assert.throws(() => memoryReconciler({ target: { providerId: "openai", modelId: "explicit-test-model", accountId: "other-account" } }));
  const f = memoryReconciler();
  assert.equal(retrieval.openExecutorRetrievalPass({ ...f.client }, { providerId: "openai", modelId: "explicit-test-model", accountId: "account-a" }), null);
});
test("untrusted invocation/getter/proxy denied before GET; no input mutation", async () => {
  const f = memoryReconciler(); let reads = 0;
  const hostile = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { reads++; throw Error("private-error-canary"); } });
  for (const raw of [hostile, new Proxy(f.raw, { ownKeys() { reads++; throw Error(); } }), { ...f.raw, invocationId: "foreign-invocation" }]) assertHeld(await f.reconciler.reconcile(raw));
  assert.equal(reads, 0); assert.equal(f.state.calls.length, 0);
});
test("changed final result conflicts, cannot overwrite first result/release twice", async () => {
  const f = memoryReconciler(); const first = await f.reconciler.reconcile(f.raw);
  f.state.items = [savedAnswer("message_a", "turn_a", "Different bounded proposal report.")];
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 1); assert.equal(f.facts().resultFp, first.resultFingerprint);
});
test("production composition has no configurable transport, credential reader, start issuer or network", async () => {
  const f = composition.createExecutorProviderReconciliationComposition();
  assert.deepEqual(Object.keys(f).sort(), ["realDispatch", "realRetrieval", "reconcile"]);
  assertHeld(await f.reconcile()); assert.equal(f.realRetrieval, "blocked");
});
for (const type of ["session", "turn"]) test(`provider returns a different saved ${type} ID under the exact endpoint: denied`, async () => {
  const f = memoryReconciler(); f.state.override = url => {
    if (type === "session" && url.pathname.endsWith("/session_a")) return Response.json({ ...f.state.session, id: "foreign_session" });
    if (type === "turn" && url.pathname.endsWith("/turn_a")) return Response.json({ ...f.state.turn, id: "foreign_turn" });
  };
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
test("session failed with a factual bound terminal turn uses turn evidence", async () => {
  const f = memoryReconciler(); f.state.session.status = "failed";
  Object.assign(f.state.session, { error: "private-error-canary" });
  const d = await f.reconciler.reconcile(f.raw); assert.equal(d.status, "settled"); assert.doesNotMatch(JSON.stringify(d), /private-error-canary/u);
});
test("corrective RED/GREEN: ConversationCursor differs from item ID; next GET uses exact opaque cursor", async () => {
  const f = memoryReconciler();
  f.state.override = url => {
    if (!url.pathname.endsWith("/items")) return;
    if (!url.searchParams.has("after")) return Response.json({ ...savedPage([reasoningItem("item_a")], true), last_id: "cursor_xyz" });
    assert.equal(url.searchParams.get("after"), "cursor_xyz");
    return Response.json({ ...savedPage([savedAnswer("item_b")]), last_id: "cursor_done" });
  };
  assert.equal((await f.reconciler.reconcile(f.raw)).status, "settled");
  assert.equal(f.state.calls.length, 4); assert.match(f.state.calls.at(-1)!.path, /after=cursor_xyz$/u);
});
test("corrective RED/GREEN: one documented initial user item is inert, exact request-bound and never output", async () => {
  const f = memoryReconciler(), input = initialUserInput(f.config, f.raw);
  f.p.baseRequestFingerprint = input.request.baseRequestFingerprint;
  f.p.requestFingerprint = input.request.requestFingerprint; f.e.requestFingerprint = input.request.requestFingerprint;
  Object.assign(f.e, { maximumExposureUsdMicros: 10000 });
  f.p.correlationFingerprint = input.request.correlationFingerprint; f.state.session.metadata.pac_execution = input.request.correlationFingerprint;
  f.state.items = [input.item, reasoningItem(), savedAnswer()]; f.state.pageSize = 1;
  const before = structuredClone(f.state.items), d = await f.reconciler.reconcile(f.raw);
  assert.equal(d.status, "settled"); assert.equal(d.normalizedResult?.report?.content, "Unverified proposal. Owner review required.");
  assert.deepEqual(f.state.items, before); assert.doesNotMatch(JSON.stringify(d), /authorized test context|private-reasoning-canary/u);
});
test("incomplete item scan cannot use a valid answer found on first page", async () => {
  const f = memoryReconciler(); let page = 0;
  f.state.override = url => url.pathname.endsWith("/items") ? Response.json(savedPage(page++ === 0 ? [savedAnswer()] : [reasoningItem(`reasoning_${page}`)], true)) : undefined;
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0); assert.equal(f.state.calls.length, 10);
});
test("opaque cursor reserved characters are encoded exactly, never interpreted as an item ID/path", async () => {
  const f = memoryReconciler(), cursor = `cursor/with+reserved=:?&${"x".repeat(140)}`;
  f.state.override = url => {
    if (!url.pathname.endsWith("/items")) return;
    if (url.searchParams.get("after") === null) return Response.json({ ...savedPage([reasoningItem("item_a")], true), last_id: cursor });
    assert.equal(url.searchParams.get("after"), cursor); assert.equal(url.searchParams.size, 3);
    return Response.json({ ...savedPage([savedAnswer("item_b")]), last_id: null });
  };
  assert.equal((await f.reconciler.reconcile(f.raw)).status, "settled"); assert.equal(f.state.calls.length, 4);
});
for (const terminal of [false, true]) test(`repeated opaque cursor rejects fresh unique item IDs, terminal=${terminal}`, async () => {
  const f = memoryReconciler(); let n = 0;
  f.state.override = url => !url.pathname.endsWith("/items") ? undefined : Response.json({ ...savedPage(n++ ? [savedAnswer("item_b")] : [reasoningItem("item_a")], n === 1 || !terminal), last_id: "cursor_repeat" });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.state.calls.length, 4); assert.equal(f.facts().releases, 0);
});
for (const cursor of [null, undefined, "", 3, {}, "cursor\nunsafe", "cursor with spaces", "c".repeat(1025)]) test(`unusable item continuation cursor ${typeof cursor}/${String(cursor).length}: fail closed`, async () => {
  const f = memoryReconciler(); f.state.override = url => !url.pathname.endsWith("/items") ? undefined : Response.json({ ...savedPage([savedAnswer()], true), last_id: cursor });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0); assert.equal(f.state.calls.length, 3);
});
test("duplicate item IDs with different opaque cursors remain denied", async () => {
  const f = memoryReconciler(); let n = 0;
  f.state.override = url => !url.pathname.endsWith("/items") ? undefined : Response.json({ ...savedPage(n++ ? [savedAnswer("item_a")] : [reasoningItem("item_a")], n === 1), last_id: `cursor_${n}` });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
for (const status of ["idle", "in_progress", "requires_action"]) test(`non-failed session ${status} cannot carry string error`, async () => {
  const f = memoryReconciler(); Object.assign(f.state.session, { status, error: "private-error-canary" });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
for (const error of ["x".repeat(4097), { code: "private-error-canary", message: "private-error-canary" }, 12]) test(`session.error must be bounded beta string, not ${typeof error}/${String(error).length}`, async () => {
  const f = memoryReconciler(); Object.assign(f.state.session, { status: "failed", error });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
test("turn.error is structured, not a session error string", async () => {
  const f = memoryReconciler(); Object.assign(f.state.turn, { ...savedTurn("turn_a", "session_a", "failed"), error: "private-error-canary" });
  assertHeld(await f.reconciler.reconcile(f.raw)); assert.equal(f.facts().releases, 0);
});
function withInitialUser() {
  const f = memoryReconciler(), input = initialUserInput(f.config, f.raw);
  Object.assign(f.p, { baseRequestFingerprint: input.request.baseRequestFingerprint, requestFingerprint: input.request.requestFingerprint, correlationFingerprint: input.request.correlationFingerprint });
  Object.assign(f.e, { requestFingerprint: input.request.requestFingerprint, maximumExposureUsdMicros: 10000 });
  f.state.session.metadata.pac_execution = input.request.correlationFingerprint; f.state.items = [input.item, savedAnswer()];
  return { ...f, user: input.item };
}
for (const kind of ["extra", "late", "image", "multiple-content", "output-text", "phase", "incomplete", "wrong-turn", "unknown-field", "legacy-null-id", "changed-input", "wrong-base-fingerprint", "wrong-request-fingerprint", "oversized"]) test(`initial user history ${kind}: recovery remains fail closed`, async () => {
  const f = withInitialUser();
  if (kind === "extra") f.state.items.splice(1, 0, { ...f.user, id: "steering_message" });
  if (kind === "late") f.state.items.unshift(reasoningItem());
  if (kind === "image") Object.assign(f.user.content[0], { type: "input_image", image_url: "data:image/png;base64,AA==" });
  if (kind === "multiple-content") f.user.content.push({ type: "input_text", text: "private-input-canary" });
  if (kind === "output-text") f.user.content[0].type = "output_text";
  if (kind === "phase") Object.assign(f.user, { phase: "final_answer" });
  if (kind === "incomplete") f.user.status = "incomplete";
  if (kind === "wrong-turn") f.user.turn_id = "foreign_turn";
  if (kind === "unknown-field") Object.assign(f.user, { steering: "private-input-canary" });
  if (kind === "legacy-null-id") Object.assign(f.user, { id: null });
  if (kind === "changed-input") f.user.content[0].text = f.user.content[0].text.replace("authorized test context", "private-input-canary");
  if (kind === "wrong-base-fingerprint") f.p.baseRequestFingerprint = "b".repeat(64);
  if (kind === "wrong-request-fingerprint") { f.p.requestFingerprint = "d".repeat(64); f.e.requestFingerprint = f.p.requestFingerprint; }
  if (kind === "oversized") f.user.content[0].text = "x".repeat(65537);
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.doesNotMatch(JSON.stringify(d), /private-input-canary/u); assert.equal(f.facts().releases, 0);
});
test("valid initial user content cannot substitute for the missing assistant final answer", async () => {
  const f = withInitialUser(); f.state.items = [f.user, reasoningItem()];
  const d = await f.reconciler.reconcile(f.raw); assertHeld(d); assert.equal(d.reason, "provider_final_output_missing"); assert.equal(f.facts().releases, 0);
});
test("one bound initial input + reasoning + commentary + exactly one final answer: only final answer survives", async () => {
  const f = withInitialUser(), commentary = savedAnswer("commentary"); commentary.phase = "commentary"; commentary.content[0].text = "private-commentary-canary";
  f.state.items = [f.user, reasoningItem(), commentary, savedAnswer()]; f.state.pageSize = 1;
  const d = await f.reconciler.reconcile(f.raw); assert.equal(d.status, "settled"); frozen(d);
  assert.doesNotMatch(JSON.stringify(d), /authorized test context|private-reasoning-canary|private-commentary-canary/u);
  const replay = await f.reconciler.reconcile(f.raw), again = await f.reconciler.reconcile(f.raw);
  assert.deepEqual(replay, again); assert.notEqual(replay.normalizedResult, again.normalizedResult); assert.equal(f.facts().releases, 1);
});
test("saved-user support never weakens the shared streamed-item parser", async () => {
  const parser = await import(new URL("../lib/executors/openai-agents-result.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-result");
  assert.throws(() => parser.openAIAgentsFinalText(initialUserInput().item, "turn_a"));
});
