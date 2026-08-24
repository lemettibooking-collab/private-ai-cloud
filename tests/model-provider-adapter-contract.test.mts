import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = (await import(new URL("../lib/contracts/model-provider-adapter.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-provider-adapter");
const invocationContract = (await import(new URL("../lib/contracts/model-invocation.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-invocation");

const {
  isModelProviderAdapterVerdict,
  isModelProviderHealthStatus,
  modelProviderAdapterLimits,
  modelProviderAdapterVerdicts,
  modelProviderHealthStatuses,
  parseModelProviderAdapterVerdict,
  parseModelProviderHealthStatus,
  validateAndNormalizeModelProviderHealth,
  validateAndNormalizeModelProviderIdentity,
} = contract;
const { modelInvocationLimits } = invocationContract;

function identity(overrides: Record<string, unknown> = {}) {
  return { providerId: "provider-mock", providerKind: "mock", deploymentId: "deployment-mock", providerModelId: "mock/model:v1@stable", providerModelVersion: "2026-08-24", ...overrides };
}
function health(overrides: Record<string, unknown> = {}) {
  return { providerId: "provider-mock", deploymentId: "deployment-mock", status: "healthy", observedAt: "2026-08-24T10:15:30.000Z", latencyMs: 25, detailCode: null, ...overrides };
}
function clone<T>(value: T): T { return structuredClone(value); }
function deeplyFrozen(value: unknown): boolean { if (typeof value !== "object" || value === null) return true; return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen); }

test("exports exact frozen adapter enums, guards, parsers, and limits", () => {
  assert.deepEqual(modelProviderHealthStatuses, ["healthy", "degraded", "unavailable"]);
  assert.deepEqual(modelProviderAdapterVerdicts, ["allow", "deny"]);
  for (const value of [modelProviderHealthStatuses, modelProviderAdapterVerdicts, modelProviderAdapterLimits]) assert.equal(Object.isFrozen(value), true);
  for (const value of modelProviderHealthStatuses) { assert.equal(isModelProviderHealthStatus(value), true); assert.equal(parseModelProviderHealthStatus(value), value); }
  for (const value of modelProviderAdapterVerdicts) { assert.equal(isModelProviderAdapterVerdict(value), true); assert.equal(parseModelProviderAdapterVerdict(value), value); }
  assert.equal(parseModelProviderHealthStatus("bad"), null); assert.equal(parseModelProviderAdapterVerdict("bad"), null);
  assert.equal(modelProviderAdapterLimits.maxLatencyMs, modelInvocationLimits.maxLatencyMs);
});

test("identity exact schema normalizes freshly and deeply frozen", () => { const input = identity(); const before = clone(input); const first = validateAndNormalizeModelProviderIdentity(input); const second = validateAndNormalizeModelProviderIdentity(input); assert.equal(first.verdict, "allow", JSON.stringify(first.reasons)); assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.normalizedIdentity, input); assert.equal(deeplyFrozen(first), true); assert.deepEqual(input, before); });
test("identity rejects unknown and sensitive fields with no partial identity", () => { for (const field of ["apiKey", "credentials", "endpoint", "connectionId", "environmentVariableName"]) { const decision = validateAndNormalizeModelProviderIdentity({ ...identity(), [field]: "not-allowed" }); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedIdentity, null); assert.equal(decision.reasons[0]?.path, "$" ); } });
test("identity enforces stable IDs, canonical provider kinds, and audit identifiers", () => { for (const [field, value] of [["providerId", "INVALID"], ["deploymentId", "bad/id"], ["providerKind", "other"], ["providerModelId", ""], ["providerModelVersion", "   "]] as const) { const decision = validateAndNormalizeModelProviderIdentity(identity({ [field]: value })); assert.equal(decision.verdict, "deny"); assert.ok(decision.reasons.some((reason) => reason.path === `$.${field}`)); } });
test("identity rejects LF, CR, controls, U+2028, U+2029 and audit limit plus one", () => { for (const field of ["providerModelId", "providerModelVersion"] as const) for (const value of ["line\nfeed", "carriage\rreturn", "control\u0001value", "unicode\u2028line", "unicode\u2029line", "x".repeat(modelInvocationLimits.maxProviderAuditIdLength + 1)]) { const decision = validateAndNormalizeModelProviderIdentity(identity({ [field]: value })); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedIdentity, null); assert.ok(decision.reasons.some((reason) => reason.path === `$.${field}`)); } });

test("health exact schema accepts every factual status", () => { for (const status of modelProviderHealthStatuses) { const decision = validateAndNormalizeModelProviderHealth(health({ status })); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.equal(decision.normalizedHealth?.status, status); } });
test("health rejects unknown and sensitive fields with no partial health", () => { for (const field of ["endpoint", "apiKey", "credentials"]) { const decision = validateAndNormalizeModelProviderHealth({ ...health(), [field]: "not-allowed" }); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedHealth, null); } });
test("health validates canonical ISO timestamps", () => { assert.equal(validateAndNormalizeModelProviderHealth(health({ observedAt: "2024-02-29T23:59:59.999Z" })).verdict, "allow"); for (const value of ["2026-08-24", "2026-08-24T10:15:30Z", "2026-02-30T10:15:30.000Z", "2026-08-24T10:15:30.000+00:00"]) { const decision = validateAndNormalizeModelProviderHealth(health({ observedAt: value })); assert.equal(decision.verdict, "deny"); assert.ok(decision.reasons.some((reason) => reason.path === "$.observedAt")); } });
test("health latency accepts canonical endpoints and denies limit plus one", () => { assert.equal(validateAndNormalizeModelProviderHealth(health({ latencyMs: 0 })).verdict, "allow"); assert.equal(validateAndNormalizeModelProviderHealth(health({ latencyMs: modelInvocationLimits.maxLatencyMs })).verdict, "allow"); for (const value of [-1, 1.5, modelInvocationLimits.maxLatencyMs + 1]) assert.equal(validateAndNormalizeModelProviderHealth(health({ latencyMs: value })).verdict, "deny"); });
test("health detailCode is nullable bounded safe audit text", () => { assert.equal(validateAndNormalizeModelProviderHealth(health({ detailCode: "mock/degraded:v1" })).verdict, "allow"); for (const value of ["", "line\nfeed", "x".repeat(modelProviderAdapterLimits.maxDetailCodeLength + 1)]) assert.equal(validateAndNormalizeModelProviderHealth(health({ detailCode: value })).verdict, "deny"); });

test("hostile identity and health values fail closed without exception", () => { const getter = {}; Object.defineProperty(getter, "providerId", { enumerable: true, get() { throw new Error("no read"); } }); const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } }); const revoked = Proxy.revocable({}, {}); revoked.revoke(); const cycle: Record<string, unknown> = {}; cycle.self = cycle; const sparse = Array(2); const derived = Object.setPrototypeOf([], {}); for (const value of [getter, proxy, revoked.proxy, cycle, new Set(), new Map(), new Date(), /x/u, sparse, derived, Object.create({ providerId: "provider-mock" }), BigInt(1), Number.NaN, Number.POSITIVE_INFINITY]) { assert.doesNotThrow(() => validateAndNormalizeModelProviderIdentity(value)); assert.equal(validateAndNormalizeModelProviderIdentity(value).verdict, "deny"); assert.equal(validateAndNormalizeModelProviderHealth(value).verdict, "deny"); } });
test("absolute depth, string, and total-character limits deny deterministically", () => { const deep: Record<string, unknown> = {}; let cursor = deep; for (let index = 0; index <= modelProviderAdapterLimits.maxEnvelopeDepth; index += 1) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; } assert.equal(validateAndNormalizeModelProviderIdentity(deep).verdict, "deny"); assert.ok(validateAndNormalizeModelProviderIdentity("x".repeat(modelProviderAdapterLimits.maxEnvelopeStringLength + 1)).reasons.some((reason) => reason.code === "limit_exceeded")); const strings = Array.from({ length: Math.ceil(modelProviderAdapterLimits.maxTotalStringCharacters / modelProviderAdapterLimits.maxEnvelopeStringLength) + 1 }, () => "x".repeat(modelProviderAdapterLimits.maxEnvelopeStringLength)); assert.ok(validateAndNormalizeModelProviderIdentity({ strings }).reasons.some((reason) => reason.code === "limit_exceeded")); });
test("identity and health evaluation is locale-independent deterministic", () => { const inputs = [identity({ providerModelId: "z/model" }), identity({ providerModelId: "a/model" })]; const forward = inputs.map(validateAndNormalizeModelProviderIdentity); const reverse = [...inputs].reverse().map(validateAndNormalizeModelProviderIdentity).reverse(); assert.deepEqual(forward, reverse); assert.deepEqual(validateAndNormalizeModelProviderHealth(health()), validateAndNormalizeModelProviderHealth(health())); });
test("production source reuses canonical AI-022 and AI-023 exports", () => { const source = readFileSync(new URL("../lib/contracts/model-provider-adapter.ts", import.meta.url), "utf8"); assert.equal(source.includes("modelInvocationLimits"), true); assert.equal(source.includes("modelProviderKinds"), true); for (const copied of ["9_000_000_000", "86_400_000", "openai\", \"anthropic", "succeeded\", \"failed", "stop\", \"length"]) assert.equal(source.includes(copied), false, copied); });
