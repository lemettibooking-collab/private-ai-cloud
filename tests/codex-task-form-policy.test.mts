import assert from "node:assert/strict";
import test from "node:test";

const policyModule = (await import(
  new URL("../lib/codex-task-form-policy.ts", import.meta.url).href
)) as typeof import("../lib/codex-task-form-policy");
const artifactModule = (await import(
  new URL("../lib/codex-task-artifact.ts", import.meta.url).href
)) as typeof import("../lib/codex-task-artifact");

const {
  buildEffectiveCodexTaskInput,
  discoverAllowedPaths,
  discoverExpectedHandoff,
  discoverForbiddenActions,
} = policyModule;
const { createCodexTaskArtifact } = artifactModule;

const validInput = {
  goal: "Добавить безопасный выбор области кода.",
  context: "Owner не знает структуру репозитория.",
  scope: "Изменить только UX подготовки задания.",
  nonGoals: "Не запускать Codex\nНе добавлять API",
  allowedPaths: "components/domain/example.tsx\nlib/example.ts",
  allowedCommands: "npm run lint\nnpm test",
  acceptanceCriteria: "Доступны два режима\nDiscover остаётся read-only",
  verificationCommands: "npm run lint\nnpm test",
  expectedHandoff: "Вернуть результаты проверок",
  additionalForbiddenActions: "Не менять публичные тексты",
};

test("manual mode does not add discover policy", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "manual");

  assert.equal(
    result.additionalForbiddenActions,
    validInput.additionalForbiddenActions,
  );
  assert.equal(result.expectedHandoff, validInput.expectedHandoff);
  for (const action of discoverForbiddenActions) {
    assert.doesNotMatch(result.additionalForbiddenActions, new RegExp(action));
  }
});

test("manual mode preserves allowed paths", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "manual");

  assert.equal(result.allowedPaths, validInput.allowedPaths);
  assert.deepEqual(result, validInput);
});

test("discover mode replaces effective allowed paths with read-only policy", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "discover");

  assert.equal(result.allowedPaths, discoverAllowedPaths.join("\n"));
  assert.doesNotMatch(result.allowedPaths, /components\/domain\/example/u);
});

test("discover mode always adds all three forbidden actions", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "discover");
  const actions = result.additionalForbiddenActions.split("\n");

  for (const action of discoverForbiddenActions) {
    assert.ok(actions.includes(action));
  }
});

test("discover mode preserves user forbidden actions without duplicates", () => {
  const duplicate = discoverForbiddenActions[0];
  const result = buildEffectiveCodexTaskInput(
    {
      ...validInput,
      additionalForbiddenActions: `Пользовательский запрет\n${duplicate}\nПользовательский запрет`,
    },
    "discover",
  );
  const actions = result.additionalForbiddenActions.split("\n");

  assert.ok(actions.includes("Пользовательский запрет"));
  assert.equal(actions.filter((action) => action === duplicate).length, 1);
  assert.equal(
    actions.filter((action) => action === "Пользовательский запрет").length,
    1,
  );
});

test("discover handoff contains all six special items", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "discover");
  const handoffItems = result.expectedHandoff.split("\n");

  for (const item of discoverExpectedHandoff) {
    assert.ok(handoffItems.includes(item));
  }
});

test("discover mode preserves the user expected handoff", () => {
  const result = buildEffectiveCodexTaskInput(validInput, "discover");

  assert.match(result.expectedHandoff, /^Вернуть результаты проверок\n/u);
});

test("building effective input does not mutate form input", () => {
  const snapshot = structuredClone(validInput);

  buildEffectiveCodexTaskInput(validInput, "discover");

  assert.deepEqual(validInput, snapshot);
});

test("the same input and mode produce the same effective result", () => {
  const first = buildEffectiveCodexTaskInput(validInput, "discover");
  const second = buildEffectiveCodexTaskInput(
    structuredClone(validInput),
    "discover",
  );

  assert.deepEqual(first, second);
});

test("serialized discover artifact contains read-only paths and edit prohibition", () => {
  const effectiveInput = buildEffectiveCodexTaskInput(validInput, "discover");
  const result = createCodexTaskArtifact(effectiveInput);

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected a valid discover artifact.");
  }

  for (const pathPolicy of discoverAllowedPaths) {
    assert.match(result.artifact.markdown, new RegExp(pathPolicy));
  }
  assert.match(
    result.artifact.markdown,
    /Не изменять, не создавать, не переименовывать и не удалять файлы/u,
  );
});
