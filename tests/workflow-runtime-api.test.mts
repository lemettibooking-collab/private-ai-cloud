import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial API inputs intentionally cross unknown */

const apiContract = (await import(
  new URL("../lib/workflows/workflow-runtime-api.ts", import.meta.url).href
)) as typeof import("../lib/workflows/workflow-runtime-api");
const { handleWorkflowRuntimeCommand } = apiContract;

function frozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(frozen);
}

function allowedResponse(runId = "run-one") {
  return {
    verdict: "allow" as const,
    status: "running" as const,
    reasons: [],
    runId,
    revision: 1,
    workflowStatus: "running" as const,
    currentStepIds: [],
    readyStepIds: ["step-a"],
    waitingApproval: null,
    retryPending: null,
    lastStepResult: null,
  };
}

function service(overrides: { execute?: (command: any) => unknown | Promise<unknown> } = {}) {
  const calls: any[] = [];
  const execute = async (command: any) => {
    calls.push(command);
    return overrides.execute ? overrides.execute(command) : allowedResponse(command.runId);
  };
  return {
    runtime: {
      execute,
      start: execute,
      advance: execute,
      approve: execute,
      reject: execute,
      cancel: execute,
      get: execute,
    } as any,
    calls,
  };
}

function startCommand() {
  return {
    kind: "start",
    commandId: "start-one",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "actor-one",
  };
}

function draft(stepId = "step-a") {
  return {
    invocationId: "invocation-one",
    invocationSequence: 1,
    stepId,
    messages: [{ role: "user", content: "Execute bounded work.", toolCallId: null }],
    contextArtifactIds: [],
  };
}

test("transport-neutral handler accepts exact start/get/advance/approve/reject/cancel commands", async () => {
  const fixture = service();
  const commands = [
    startCommand(),
    { kind: "get", runId: "run-one", actorId: "actor-one" },
    {
      ...startCommand(),
      kind: "advance",
      commandId: "advance-one",
      agentInputs: [{ stepId: "step-a", executionId: "execution-one", invocationDraft: draft() }],
    },
    {
      ...startCommand(),
      kind: "approve",
      commandId: "approve-one",
      stepId: "approval-one",
      approvalRequestId: "approval-request-one",
    },
    {
      ...startCommand(),
      kind: "reject",
      commandId: "reject-one",
      stepId: "approval-one",
      approvalRequestId: "approval-request-one",
      reason: "Rejected by authorized reviewer.",
    },
    { ...startCommand(), kind: "cancel", commandId: "cancel-one" },
  ];
  for (const command of commands) {
    const result = await handleWorkflowRuntimeCommand(command, fixture.runtime);
    assert.equal(result.verdict, "allow", command.kind);
    assert.equal(frozen(result), true);
  }
  assert.deepEqual(fixture.calls.map((command) => command.kind), [
    "start", "get", "advance", "approve", "reject", "cancel",
  ]);
});

test("unknown or missing fields and caller factual-authority fields deny before service", async () => {
  for (const input of [
    { ...startCommand(), unknown: true },
    { ...startCommand(), snapshot: {} },
    { ...startCommand(), readyStepIds: ["step-a"] },
    { ...startCommand(), projectRegistry: {} },
    { ...startCommand(), actorKind: "owner" },
    { kind: "start", commandId: "start-one", runId: "run-one", actorId: "actor-one" },
  ]) {
    const fixture = service();
    const result = await handleWorkflowRuntimeCommand(input, fixture.runtime);
    assert.equal(result.verdict, "deny");
    assert.equal(result.reasons[0]?.code, "invalid_command");
    assert.equal(fixture.calls.length, 0);
  }
});

test("getters, inherited fields, transparent/revoked proxies, and symbols fail closed", async () => {
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "kind", {
    enumerable: true,
    get() { getterReads += 1; return "start"; },
  });
  const inherited = Object.create({ kind: "start" });
  Object.assign(inherited, startCommand(), { kind: undefined });
  const transparent = new Proxy(startCommand(), {});
  const revoked = Proxy.revocable(startCommand(), {});
  revoked.revoke();
  const symbol = { ...startCommand(), [Symbol("authority")]: true };
  for (const input of [accessor, inherited, transparent, revoked.proxy, symbol]) {
    const fixture = service();
    const result = await handleWorkflowRuntimeCommand(input, fixture.runtime);
    assert.equal(result.verdict, "deny");
    assert.equal(fixture.calls.length, 0);
  }
  assert.equal(getterReads, 0);
});

test("cycles, excessive nesting, and oversized input deny without throw", async () => {
  const cyclic: any = startCommand();
  cyclic.self = cyclic;
  let nested: any = "leaf";
  for (let index = 0; index < 80; index += 1) nested = { nested };
  for (const input of [
    cyclic,
    { ...startCommand(), nested },
    { ...startCommand(), commandId: "x".repeat(1_000_000) },
  ]) {
    const fixture = service();
    const result = await handleWorkflowRuntimeCommand(input, fixture.runtime);
    assert.equal(result.verdict, "deny");
    assert.equal(fixture.calls.length, 0);
  }
});

test("advance requires unique bounded step/execution identities", async () => {
  const base = {
    ...startCommand(),
    kind: "advance",
    commandId: "advance-one",
  };
  for (const agentInputs of [
    [
      { stepId: "step-a", executionId: "execution-one", invocationDraft: draft() },
      { stepId: "step-a", executionId: "execution-two", invocationDraft: draft() },
    ],
    [
      { stepId: "step-a", executionId: "execution-one", invocationDraft: draft() },
      { stepId: "step-b", executionId: "execution-one", invocationDraft: draft("step-b") },
    ],
    [{ stepId: "step-a", executionId: "x".repeat(49), invocationDraft: draft() }],
  ]) {
    const fixture = service();
    const result = await handleWorkflowRuntimeCommand({ ...base, agentInputs }, fixture.runtime);
    assert.equal(result.verdict, "deny");
    assert.equal(fixture.calls.length, 0);
  }
});

test("caller mutation after call cannot alter captured command or immutable response", async () => {
  let release: () => void = () => { throw new Error("not ready"); };
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let observed: any = null;
  const fixture = service({
    async execute(command) {
      observed = command;
      await pending;
      return allowedResponse(command.runId);
    },
  });
  const input: any = {
    ...startCommand(),
    kind: "advance",
    commandId: "advance-one",
    agentInputs: [{ stepId: "step-a", executionId: "execution-one", invocationDraft: draft() }],
  };
  const resultPromise = handleWorkflowRuntimeCommand(input, fixture.runtime);
  input.runId = "run-mutated";
  input.agentInputs[0].stepId = "step-mutated";
  input.agentInputs[0].invocationDraft.messages[0].content = "mutated secret";
  release();
  const result = await resultPromise;
  assert.equal(observed.runId, "run-one");
  assert.equal(observed.agentInputs[0].stepId, "step-a");
  assert.equal(JSON.stringify(observed).includes("mutated secret"), false);
  assert.equal(frozen(observed), true);
  assert.equal(frozen(result), true);
});

test("handler distinguishes invalid input from internal service failure without exception leakage", async () => {
  const input = startCommand();
  const firstFixture = service();
  const secondFixture = service();
  const first = await handleWorkflowRuntimeCommand(input, firstFixture.runtime);
  const second = await handleWorkflowRuntimeCommand(input, secondFixture.runtime);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  const throwing = service({ execute() { throw new Error("sensitive-service-exception"); } });
  const denied = await handleWorkflowRuntimeCommand(input, throwing.runtime);
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.reasons[0]?.code, "runtime_internal_error");
  assert.equal(denied.reasons[0]?.path, "service.execute");
  assert.equal(JSON.stringify(denied).includes("sensitive-service-exception"), false);
  const invalid = await handleWorkflowRuntimeCommand({ ...input, extra: true }, throwing.runtime);
  assert.equal(invalid.reasons[0]?.code, "invalid_command");
});

test("API source has no HTTP route, network, persistence, SDK, shell, or provider execution", () => {
  const source = readFileSync(
    new URL("../lib/workflows/workflow-runtime-api.ts", import.meta.url),
    "utf8",
  );
  for (const token of [
    "Open" + "AI", "Anth" + "ropic", "Q" + "wen", "Cod" + "ex", "fetch(",
    "http://", "https://", "node:fs", "child_process", "process.env", "writeFile",
    "prisma", "postgres", "Redis", "BullMQ", "executeAgentStep(", "app/api",
  ]) assert.equal(source.includes(token), false, token);
});
