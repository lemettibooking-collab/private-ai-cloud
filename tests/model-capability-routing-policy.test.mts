import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */

const contract = (await import(
  new URL("../lib/contracts/model-capability-routing-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-capability-routing-policy");

const {
  evaluateModelCapabilityRoutingPolicy,
  isModelCapabilityRoutingVerdict,
  isModelCapabilityTaskClass,
  isModelCapabilityTier,
  modelCapabilityRoutingPolicyLimits,
  modelCapabilityRoutingVerdicts,
  modelCapabilityTaskClasses,
  modelCapabilityTiers,
  parseModelCapabilityRoutingVerdict,
  parseModelCapabilityTaskClass,
  parseModelCapabilityTier,
} = contract;

function budget() {
  return {
    maxInputTokens: 16_000,
    maxOutputTokens: 4_000,
    maxCostUsdMicros: 500_000,
  };
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    taskClass: "analysis",
    requestedCapability: "reasoning",
    riskLevel: "medium",
    requiresModel: true,
    requiresRepositoryRead: true,
    requiresRepositoryWrite: false,
    requiresCommandExecution: false,
    requiresNetwork: false,
    budget: budget(),
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

function reasonCodes(decision: ReturnType<typeof evaluateModelCapabilityRoutingPolicy>) {
  return decision.reasons.map((reason) => reason.code);
}

function assertDeny(decision: ReturnType<typeof evaluateModelCapabilityRoutingPolicy>) {
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.authorizedCapability, null);
  assert.equal(decision.modelExecutionAllowed, false);
  assert.equal(decision.repositoryReadRequired, null);
  assert.equal(decision.repositoryWriteRequired, null);
  assert.equal(decision.commandExecutionRequired, null);
  assert.equal(decision.networkRequired, null);
  assert.equal(decision.budget, null);
  assert.equal(deeplyFrozen(decision), true);
}

test("exports exact frozen capability tiers, task classes, verdicts, and limits", () => {
  assert.deepEqual(modelCapabilityTiers, [
    "deterministic", "economy", "reasoning", "advanced_reasoning", "coding",
  ]);
  assert.deepEqual(modelCapabilityTaskClasses, [
    "deterministic_operation", "classification", "summarization",
    "structured_transformation", "analysis", "planning", "review",
    "quality_assurance", "security_analysis", "architecture", "implementation",
  ]);
  assert.deepEqual(modelCapabilityRoutingVerdicts, ["allow", "deny"]);
  assert.equal(Object.isFrozen(modelCapabilityTiers), true);
  assert.equal(Object.isFrozen(modelCapabilityTaskClasses), true);
  assert.equal(Object.isFrozen(modelCapabilityRoutingVerdicts), true);
  assert.equal(Object.isFrozen(modelCapabilityRoutingPolicyLimits), true);
});

test("guards and parsers accept canonical values and reject unknown values", () => {
  for (const value of modelCapabilityTiers) {
    assert.equal(isModelCapabilityTier(value), true);
    assert.equal(parseModelCapabilityTier(value), value);
  }
  for (const value of modelCapabilityTaskClasses) {
    assert.equal(isModelCapabilityTaskClass(value), true);
    assert.equal(parseModelCapabilityTaskClass(value), value);
  }
  for (const value of modelCapabilityRoutingVerdicts) {
    assert.equal(isModelCapabilityRoutingVerdict(value), true);
    assert.equal(parseModelCapabilityRoutingVerdict(value), value);
  }
  assert.equal(parseModelCapabilityTier("gpt-premium"), null);
  assert.equal(parseModelCapabilityTaskClass("autonomous-agent"), null);
  assert.equal(parseModelCapabilityRoutingVerdict("fallback"), null);
});

test("requiresModel=false plus deterministic allows an explicit no-model decision", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "deterministic_operation",
    requestedCapability: "deterministic",
    requiresModel: false,
    requiresRepositoryRead: false,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.authorizedCapability, "deterministic");
  assert.equal(decision.modelExecutionAllowed, false);
  assert.equal(decision.repositoryReadRequired, false);
  assert.equal(deeplyFrozen(decision), true);
});

for (const requestedCapability of ["economy", "reasoning"] as const) {
  test(`requiresModel=false plus ${requestedCapability} denies without downgrade`, () => {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      taskClass: requestedCapability === "economy" ? "classification" : "analysis",
      requestedCapability,
      requiresModel: false,
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("model_not_required"));
  });
}

test("deterministic capability cannot be paired with requiresModel=true", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    requestedCapability: "deterministic",
  }));
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("deterministic_requires_no_model"));
});

test("valid economy classification is authorized", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "classification",
    requestedCapability: "economy",
    requiresRepositoryRead: false,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.authorizedCapability, "economy");
  assert.equal(decision.modelExecutionAllowed, true);
});

test("valid normal analysis reasoning is authorized without repository write", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.authorizedCapability, "reasoning");
  assert.equal(decision.repositoryReadRequired, true);
  assert.equal(decision.repositoryWriteRequired, false);
  assert.equal(decision.commandExecutionRequired, false);
});

test("advanced reasoning is authorized for a medium-risk security analysis", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "security_analysis",
    requestedCapability: "advanced_reasoning",
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.authorizedCapability, "advanced_reasoning");
});

for (const riskLevel of ["high", "critical"] as const) {
  test(`${riskLevel}-risk advanced reasoning fails closed for external approval orchestration`, () => {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      taskClass: "architecture",
      requestedCapability: "advanced_reasoning",
      riskLevel,
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("risk_approval_required"));
  });
}

test("coding without repository write authority is denied", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresCommandExecution: true,
  }));
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("coding_requires_repository_write"));
});

test("coding without command execution authority is denied", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresRepositoryWrite: true,
  }));
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("coding_requires_command_execution"));
});

test("valid coding reports side effects only as requirements and grants capability only", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresRepositoryWrite: true,
    requiresCommandExecution: true,
    requiresNetwork: true,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.authorizedCapability, "coding");
  assert.equal(decision.modelExecutionAllowed, true);
  assert.equal(decision.repositoryReadRequired, true);
  assert.equal(decision.repositoryWriteRequired, true);
  assert.equal(decision.commandExecutionRequired, true);
  assert.equal(decision.networkRequired, true);
  for (const forbiddenField of [
    "repositoryReadAllowed", "repositoryWriteAllowed", "commandExecutionAllowed", "networkAllowed",
  ]) assert.equal(Object.hasOwn(decision, forbiddenField), false);
});

test("reasoning command requirement does not create command execution authority", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    requiresCommandExecution: true,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.commandExecutionRequired, true);
  assert.equal(Object.hasOwn(decision, "commandExecutionAllowed"), false);
});

test("reasoning network requirement does not create generic network authority", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    requiresNetwork: true,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.networkRequired, true);
  assert.equal(Object.hasOwn(decision, "networkAllowed"), false);
});

test("deterministic command and network requirements remain facts without execution authority", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "deterministic_operation",
    requestedCapability: "deterministic",
    requiresModel: false,
    requiresRepositoryRead: false,
    requiresCommandExecution: true,
    requiresNetwork: true,
  }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.modelExecutionAllowed, false);
  assert.equal(decision.commandExecutionRequired, true);
  assert.equal(decision.networkRequired, true);
  assert.equal(Object.hasOwn(decision, "commandExecutionAllowed"), false);
  assert.equal(Object.hasOwn(decision, "networkAllowed"), false);
});

for (const taskClass of ["review", "quality_assurance"] as const) {
  test(`${taskClass} cannot obtain coding authority through requested flags`, () => {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      taskClass,
      requestedCapability: "coding",
      requiresRepositoryWrite: true,
      requiresCommandExecution: true,
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("capability_not_authorized"));
  });
}

test("a non-coding capability cannot gain repository write authority", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    requiresRepositoryWrite: true,
  }));
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("repository_write_requires_coding"));
});

test("repository write requires explicit repository read authority", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresRepositoryRead: false,
    requiresRepositoryWrite: true,
    requiresCommandExecution: true,
  }));
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("repository_write_requires_read"));
});

test("valid maximum budget boundaries are preserved exactly", () => {
  const maximum = {
    maxInputTokens: modelCapabilityRoutingPolicyLimits.maxInputTokens,
    maxOutputTokens: modelCapabilityRoutingPolicyLimits.maxOutputTokens,
    maxCostUsdMicros: modelCapabilityRoutingPolicyLimits.maxCostUsdMicros,
  };
  const decision = evaluateModelCapabilityRoutingPolicy(policy({ budget: maximum }));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.deepEqual(decision.budget, maximum);
  assert.notEqual(decision.budget, maximum);
});

for (const [label, value] of [
  ["negative", -1],
  ["zero", 0],
  ["float", 1.5],
  ["string", "100"],
] as const) {
  test(`${label} budget values deny without coercion`, () => {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      budget: { ...budget(), maxInputTokens: value },
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("invalid_budget"));
  });
}

for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`${String(value)} budget value fails the bounded snapshot`, () => {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      budget: { ...budget(), maxOutputTokens: value },
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("invalid_input"));
  });
}

test("oversized token and cost budgets are denied", () => {
  for (const budgetOverride of [
    { maxInputTokens: modelCapabilityRoutingPolicyLimits.maxInputTokens + 1 },
    { maxOutputTokens: modelCapabilityRoutingPolicyLimits.maxOutputTokens + 1 },
    { maxCostUsdMicros: modelCapabilityRoutingPolicyLimits.maxCostUsdMicros + 1 },
  ]) {
    const decision = evaluateModelCapabilityRoutingPolicy(policy({
      budget: { ...budget(), ...budgetOverride },
    }));
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("invalid_budget"));
  }
});

test("coercible budget objects are rejected without coercion", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    budget: { ...budget(), maxCostUsdMicros: { valueOf: () => 10 } },
  }));
  assertDeny(decision);
});

test("unknown root and budget fields are rejected without sentinel leakage", () => {
  for (const input of [
    { ...policy(), "unknown-hostile-sentinel": true },
    policy({ budget: { ...budget(), "budget-hostile-sentinel": true } }),
  ]) {
    const decision = evaluateModelCapabilityRoutingPolicy(input);
    assertDeny(decision);
    const serialized = JSON.stringify(decision);
    assert.equal(serialized.includes("hostile-sentinel"), false);
  }
});

test("accessors are rejected without invoking getters", () => {
  let reads = 0;
  const input = policy();
  Object.defineProperty(input, "taskClass", {
    enumerable: true,
    get() { reads += 1; return "analysis"; },
  });
  assertDeny(evaluateModelCapabilityRoutingPolicy(input));
  assert.equal(reads, 0);
});

test("inherited properties and non-plain roots are rejected", () => {
  const inherited = Object.create(policy());
  for (const input of [inherited, [], new Set(), new Map(), null, "analysis", 1]) {
    assertDeny(evaluateModelCapabilityRoutingPolicy(input));
  }
});

test("throwing and revoked proxies fail closed without leaking trap details", () => {
  const throwing = new Proxy({}, {
    ownKeys() { throw new Error("proxy-hostile-sentinel"); },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const input of [throwing, revoked.proxy]) {
    const decision = evaluateModelCapabilityRoutingPolicy(input);
    assertDeny(decision);
    assert.equal(JSON.stringify(decision).includes("proxy-hostile-sentinel"), false);
  }
});

test("symbol-key smuggling is rejected", () => {
  const input = policy() as Record<PropertyKey, unknown>;
  input[Symbol("symbol-hostile-sentinel")] = true;
  const decision = evaluateModelCapabilityRoutingPolicy(input);
  assertDeny(decision);
  assert.equal(JSON.stringify(decision).includes("symbol-hostile-sentinel"), false);
});

test("cyclic input fails closed without throw", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertDeny(evaluateModelCapabilityRoutingPolicy(policy({ budget: cyclic })));
});

test("deep and oversized nested input fails the bounded snapshot", () => {
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let index = 0; index < 80; index += 1) {
    const nested: Record<string, unknown> = {};
    cursor.next = nested;
    cursor = nested;
  }
  const deepDecision = evaluateModelCapabilityRoutingPolicy(policy({ budget: deep }));
  assertDeny(deepDecision);
  assert.ok(reasonCodes(deepDecision).includes("limit_exceeded"));

  const oversizedDecision = evaluateModelCapabilityRoutingPolicy(policy({
    budget: Array(4_097).fill(0),
  }));
  assertDeny(oversizedDecision);
  assert.ok(reasonCodes(oversizedDecision).includes("limit_exceeded"));
});

test("invalid enum and requirement values produce source-accurate stable reasons", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "provider-specific",
    requestedCapability: "premium-model",
    riskLevel: "extreme",
    requiresNetwork: "yes",
  }));
  assertDeny(decision);
  assert.deepEqual(decision.reasons.map(({ code, path }) => ({ code, path })), [
    { code: "invalid_task_class", path: "taskClass" },
    { code: "invalid_capability", path: "requestedCapability" },
    { code: "invalid_risk_level", path: "riskLevel" },
    { code: "invalid_requirement", path: "requiresNetwork" },
  ]);
});

test("repeated evaluation is deterministic, fresh, deeply frozen, and input-immutable", () => {
  const input = policy({
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresRepositoryWrite: true,
    requiresCommandExecution: true,
  });
  const before = clone(input);
  const first = evaluateModelCapabilityRoutingPolicy(input);
  const second = evaluateModelCapabilityRoutingPolicy(input);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.notEqual(second.budget, first.budget);
  assert.equal(deeplyFrozen(first), true);
  assert.equal(deeplyFrozen(second), true);
  assert.deepEqual(input, before);
});

test("caller mutation after evaluation cannot alter the decision", () => {
  const input = policy() as any;
  const decision = evaluateModelCapabilityRoutingPolicy(input);
  const before = clone(decision);
  input.requestedCapability = "coding";
  input.requiresRepositoryWrite = true;
  input.budget.maxCostUsdMicros = 1;
  assert.deepEqual(decision, before);
});

test("denied advanced capability has no hidden downgrade or executable partial permit", () => {
  const decision = evaluateModelCapabilityRoutingPolicy(policy({
    taskClass: "security_analysis",
    requestedCapability: "advanced_reasoning",
    riskLevel: "critical",
  }));
  assertDeny(decision);
  assert.equal(JSON.stringify(decision).includes("economy"), false);
  assert.equal(JSON.stringify(decision).includes("reasoning"), false);
});

test("production contract exposes policy only and has no runtime or provider selection mechanisms", () => {
  const source = readFileSync(
    new URL("../lib/contracts/model-capability-routing-policy.ts", import.meta.url),
    "utf8",
  );
  for (const token of [
    ".run(", ".health(", "responses.create", "chat.completions", "fetch(",
    "Open" + "AI", "Anth" + "ropic", "Deep" + "Seek", "Q" + "wen",
    "Cod" + "ex", "process.env", "node:fs", "child_process", "exec(",
    "spawn(", "writeFile", "readFile", "toolCall", "providerModelId",
    "deploymentId", "modelProfileId", "setTimeout", "setInterval",
  ]) assert.equal(source.includes(token), false, token);
});
