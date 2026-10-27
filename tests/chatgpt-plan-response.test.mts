import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
const protocol = await import(process.env.AI044_SUBSCRIPTION_RESPONSE_MODULE ? pathToFileURL(process.env.AI044_SUBSCRIPTION_RESPONSE_MODULE).href
  : new URL("../lib/executors/chatgpt-plan-response.ts", import.meta.url).href) as typeof import("../lib/executors/chatgpt-plan-response");
const model = "synthetic-authenticated-model";
function completed() { return { type: "response.completed", response: { id: "resp_synthetic", model, status: "completed", error: null, incomplete_details: null,
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ patch: "synthetic", changedPaths: ["synthetic"], summary: "Proposal" }) }] }] } }; }
function parse(input: unknown[]) { const p = protocol.createSubscriptionResponseParser(model); for (const e of input) p.push(e); return p.finish(); }
test("AI044 S meaningful correlated response.completed alone yields proposed data, not QA", () => {
  const input = [completed()], before = structuredClone(input), a = parse(input), b = parse(input);
  assert.equal(a.state, "completed"); assert.equal(a.automaticRetryAllowed, false);
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.proposal)); assert.deepEqual(input, before);
});
for (const [name, change] of [
  ["wrong model", (x: ReturnType<typeof completed>) => { x.response.model = "other"; }],
  ["wrong role", (x: ReturnType<typeof completed>) => { x.response.output[0].role = "user"; }],
  ["wrong message status", (x: ReturnType<typeof completed>) => { x.response.output[0].status = "in_progress"; }],
  ["tool", (x: ReturnType<typeof completed>) => { x.response.output[0].type = "function_call"; }],
  ["refusal", (x: ReturnType<typeof completed>) => { x.response.output[0].content[0].type = "refusal"; }],
  ["empty output", (x: ReturnType<typeof completed>) => { x.response.output = []; }],
  ["malformed JSON", (x: ReturnType<typeof completed>) => { x.response.output[0].content[0].text = "not JSON"; }],
] as const) test(`AI044 S ${name} fails closed with null proposal`, () => {
  const e = completed(); change(e); const d = parse([e]); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
});
test("AI044 S reasoning is ignored but cannot substitute a meaningful assistant proposal", () => {
  const e = completed(); const reasoning = { type: "reasoning", summary: [{ type: "summary_text", text: "private reasoning" }] };
  Object.assign(e.response, { output: [reasoning, ...e.response.output] }); const d = parse([e]);
  assert.equal(d.state, "completed"); assert.ok(!JSON.stringify(d).includes("private reasoning"));
  Object.assign(e.response, { output: [reasoning] }); assert.equal(parse([e]).state, "outcome_unknown");
});
test("AI044 S unknown/error/nonterminal status cannot turn partial text into completion", () => {
  for (const status of ["queued", "in_progress", "waiting", "incomplete", "failed", "future"]) {
    const e = completed(); e.response.status = status; assert.equal(parse([e]).state, "outcome_unknown");
  }
  for (const extra of [{ error: { code: "bad", message: "RAW_ERROR" } }, { incomplete_details: { reason: "max_output_tokens" } }]) {
    const e = completed(); Object.assign(e.response, extra); const d = parse([e]); assert.equal(d.state, "outcome_unknown"); assert.ok(!JSON.stringify(d).includes("RAW_ERROR"));
  }
});
test("AI044 S response.incomplete is factual non-success with no partial proposal", () => {
  const e = completed(); Object.assign(e, { type: "response.incomplete" }); Object.assign(e.response, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  const d = parse([e]); assert.equal(d.state, "failed"); assert.equal(d.code, "incomplete"); assert.equal(d.proposal, null); assert.equal(d.automaticRetryAllowed, false);
});
test("AI044 S response.failed is factual failure without raw errors", () => {
  const e = completed(); Object.assign(e, { type: "response.failed" }); Object.assign(e.response, { status: "failed", error: { code: "server_error", message: "RAW_PROVIDER_ERROR" } });
  const d = parse([e]); assert.equal(d.state, "failed"); assert.equal(d.code, "provider_failure"); assert.equal(d.proposal, null); assert.ok(!JSON.stringify(d).includes("RAW_PROVIDER_ERROR"));
});
test("AI044 S failed/incomplete terminal output must still be no-tools assistant data", () => {
  for (const status of ["failed", "incomplete"] as const) for (const kind of ["tool", "wrong-role", "unknown-content", "missing-output"]) {
    const e = completed(); Object.assign(e, { type: `response.${status}` });
    Object.assign(e.response, { status, incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null });
    if (kind === "tool") e.response.output[0].type = "function_call";
    if (kind === "wrong-role") e.response.output[0].role = "user";
    if (kind === "unknown-content") e.response.output[0].content[0].type = "tool_result";
    if (kind === "missing-output") Object.assign(e.response, { output: null });
    const d = parse([e]); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
  }
});
test("AI044 S missing terminal, identity mismatch, duplicate terminal and post-terminal data remain ambiguous", () => {
  const start = { type: "response.created", response: { id: "resp_other", model, status: "in_progress", error: null, incomplete_details: null } };
  for (const input of [[], [start], [start, completed()], [completed(), completed()], [completed(), { type: "response.output_text.delta", delta: "late" }]]) {
    const d = parse(input); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null); assert.equal(d.automaticRetryAllowed, false);
  }
});
test("AI044 S stream error and5xx known usage code cannot masquerade as definitive terminal evidence", () => {
  const error = { type: "error", code: "subscription_sharing_usage_limit_exceeded", message: "RAW_SECRET" };
  const start = { type: "response.created", response: { id: "resp_controlled", model, status: "in_progress", error: null, incomplete_details: null } };
  for (const input of [[error], [start, { type: "response.output_text.delta", delta: "partial" }, error]]) {
    const d = parse(input); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
  }
  const d = protocol.subscriptionFailureEvidence(503, { error }); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
});
test("AI044 S hostile getters/proxy/deep/oversized events never escape or leak", () => {
  let calls = 0; const getter = { get type() { calls++; throw Error("secret"); } };
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error("secret"); } });
  for (const e of [getter, proxy, { type: "response.output_text.delta", delta: "a".repeat(300000) }]) {
    const d = parse([e]); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
  }
  assert.equal(calls, 0);
});
for (const [code, expected] of [
  ["subscription_sharing_usage_limit_exceeded", "usage_limit_exceeded"],
  ["subscription_sharing_usage_unavailable", "usage_unavailable"],
  ["subscription_sharing_user_not_eligible", "not_eligible"],
  ["subscription_sharing_unsupported_capability", "unsupported_capability"],
  ["invalid_token", "reauthorization_required"],
] as const) test(`AI044 S ${code} is a safe stop, never billing fallback/retry loop`, () => {
  const d = protocol.subscriptionFailureEvidence(429, { error: { code, message: "RAW_SECRET_ERROR" } });
  assert.equal(d.code, expected); assert.equal(d.state, "failed"); assert.equal(d.proposal, null); assert.equal(d.automaticRetryAllowed, false);
  assert.equal(d.retryAfterMs, expected === "usage_unavailable" ? 30000 : null); assert.ok(!JSON.stringify(d).includes("RAW_SECRET_ERROR"));
});
function stream(data: string) { return new Response(new TextEncoder().encode(data), { headers: { "content-type": "text/event-stream" } }); }
test("AI044 S bounded SSE accepts only terminal completion and DONE is not proof", async () => {
  const valid = await protocol.readSubscriptionResponse(stream(`data: ${JSON.stringify(completed())}\n\n`), model, new AbortController().signal);
  assert.equal(valid.state, "completed");
  for (const data of ["data: [DONE]\n\n", `data: ${JSON.stringify(completed())}`, "data: {}\n\n", `event: response.failed\ndata: ${JSON.stringify(completed())}\n\n`]) {
    const d = await protocol.readSubscriptionResponse(stream(data), model, new AbortController().signal); assert.equal(d.state, "outcome_unknown"); assert.equal(d.proposal, null);
  }
});
test("AI044 S stream abort/exception/wrong type/oversize do not redispatch", async () => {
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await protocol.readSubscriptionResponse(stream(""), model, aborted.signal)).state, "outcome_unknown");
  assert.equal((await protocol.readSubscriptionResponse(new Response("{}"), model, new AbortController().signal)).state, "outcome_unknown");
  assert.equal((await protocol.readSubscriptionResponse(stream("x".repeat(400000)), model, new AbortController().signal)).state, "outcome_unknown");
});
test("AI044 S SSE boundaries may split CRLF/UTF8 across arbitrary chunks without changing canonical result", async () => {
  const data = new TextEncoder().encode(`data: ${JSON.stringify(completed())}\r\n\r\n`);
  const body = new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const d = await protocol.readSubscriptionResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), model, new AbortController().signal);
  assert.equal(d.state, "completed");
});
test("AI044 S abort cancels a stalled stream instead of hanging or returning partial data", async () => {
  const abort = new AbortController(); let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const pending = protocol.readSubscriptionResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), model, abort.signal);
  abort.abort(); const d = await pending; assert.equal(d.state, "outcome_unknown"); assert.equal(cancelled, 1);
});
