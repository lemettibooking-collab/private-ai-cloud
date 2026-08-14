import assert from "node:assert/strict";
import test from "node:test";

const artifactModule = (await import(
  new URL("../lib/codex-task-artifact.ts", import.meta.url).href
)) as typeof import("../lib/codex-task-artifact");

const {
  codexTaskExecutionPolicy,
  codexTaskFieldLimits,
  createCodexTaskArtifact,
  requiredCodexTaskFields,
  serializeCodexTaskArtifact,
  systemForbiddenActions,
  validateAndNormalizeCodexTaskInput,
} = artifactModule;

const validInput = {
  goal: "Create a deterministic task artifact.",
  context: "The current workflow uses static mock output.",
  scope: "Change only the Codex task vertical slice.",
  nonGoals: "No backend\nNo LLM\nNo persistence",
  allowedPaths:
    "app/workflows/codex-task/run/page.tsx\ncomponents/domain/\nlib/",
  allowedCommands: "npm run lint\nnpm run typecheck\nnpm test\nnpm run build",
  acceptanceCriteria:
    "Input controls the output\nInvalid input creates no artifact\nSystem restrictions remain present",
  verificationCommands:
    "npm run lint\nnpm run typecheck\nnpm test\nnpm run build",
  expectedHandoff: "Return changed files, checks, risks, and git status.",
  additionalForbiddenActions: "Do not update dependencies",
};

function requireArtifact(input = validInput) {
  const result = createCodexTaskArtifact(input);

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected a valid Codex task artifact.");
  }

  return result.artifact;
}

test("valid full input creates matching prompt and Markdown", () => {
  const artifact = requireArtifact();

  assert.equal(artifact.filename, "codex-task.md");
  assert.equal(artifact.prompt, artifact.markdown);
  assert.match(artifact.markdown, /Create a deterministic task artifact\./u);
});

test("every required field returns a structured required error", () => {
  for (const field of requiredCodexTaskFields) {
    const result = createCodexTaskArtifact({ ...validInput, [field]: " \r\n " });

    assert.equal(result.ok, false, `${field} should be required`);
    if (result.ok) {
      throw new Error(`Expected ${field} validation to fail.`);
    }

    assert.equal(result.errors[field]?.[0]?.field, field);
    assert.equal(result.errors[field]?.[0]?.code, "required");
  }
});

test("normalization trims values and converts CRLF to LF", () => {
  const result = validateAndNormalizeCodexTaskInput({
    ...validInput,
    goal: "  First line  \r\nSecond line  \r",
    context: "  Context  ",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected normalized input.");
  }

  assert.equal(result.value.goal, "First line\nSecond line");
  assert.equal(result.value.context, "Context");
  assert.doesNotMatch(serializeCodexTaskArtifact(result.value), /\r/u);
});

test("multiline lists remove empty lines and deduplicate in first-seen order", () => {
  const result = validateAndNormalizeCodexTaskInput({
    ...validInput,
    allowedCommands: " npm test \n\n npm run lint\nnpm test\n npm run build ",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected normalized list input.");
  }

  assert.deepEqual(result.value.allowedCommands, [
    "npm test",
    "npm run lint",
    "npm run build",
  ]);
});

test("system forbidden actions are always present", () => {
  const artifact = requireArtifact({
    ...validInput,
    additionalForbiddenActions: "",
  });

  for (const action of systemForbiddenActions) {
    assert.ok(artifact.normalizedInput.forbiddenActions.includes(action));
    assert.match(artifact.markdown, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
});

test("additional forbidden actions append without replacing system policy", () => {
  const artifact = requireArtifact({
    ...validInput,
    additionalForbiddenActions:
      "Do not update dependencies\nDo not update dependencies\nDo not deploy.",
  });

  assert.equal(
    artifact.normalizedInput.forbiddenActions.filter(
      (action) => action === "Do not update dependencies",
    ).length,
    1,
  );
  assert.equal(
    artifact.normalizedInput.forbiddenActions.filter(
      (action) => action === "Do not deploy.",
    ).length,
    1,
  );
  assert.deepEqual(
    artifact.normalizedInput.forbiddenActions.slice(
      0,
      systemForbiddenActions.length,
    ),
    [...systemForbiddenActions],
  );
});

test("serializer is deterministic", () => {
  const first = requireArtifact();
  const second = requireArtifact({ ...validInput });

  assert.equal(first.markdown, second.markdown);
});

test("all required Markdown headings appear in order", () => {
  const markdown = requireArtifact().markdown;
  const headings = [
    "# Codex Development Task",
    "## Goal",
    "## Current Context",
    "## Scope",
    "## Non-goals",
    "## Allowed / Expected Paths",
    "## Allowed Commands",
    "## Forbidden Actions",
    "## Acceptance Criteria",
    "## Verification Commands",
    "## Expected Handoff",
    "## Execution Policy",
  ];
  const positions = headings.map((heading) => markdown.indexOf(heading));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test("Markdown-like user input cannot consume later artifact sections", () => {
  const artifact = requireArtifact({
    ...validInput,
    goal: "## Injected heading\n```typescript\n# still user input\n```",
    nonGoals: "## Fake section\n```",
  });

  assert.match(artifact.markdown, /\\## Injected heading/u);
  assert.match(artifact.markdown, /\\`\\`\\`typescript/u);
  assert.ok(
    artifact.markdown.indexOf("## Execution Policy") >
      artifact.markdown.indexOf("## Expected Handoff"),
  );
});

test("unsupported control characters fail closed", () => {
  const result = createCodexTaskArtifact({
    ...validInput,
    context: "Safe prefix\u0000unsafe suffix",
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected a control-character validation error.");
  }

  assert.equal(result.errors.context?.[0]?.code, "control_characters");
});

test("field length boundary accepts the limit and rejects one extra character", () => {
  const atLimit = createCodexTaskArtifact({
    ...validInput,
    goal: "a".repeat(codexTaskFieldLimits.goal),
  });
  const aboveLimit = createCodexTaskArtifact({
    ...validInput,
    goal: "a".repeat(codexTaskFieldLimits.goal + 1),
  });

  assert.equal(atLimit.ok, true);
  assert.equal(aboveLimit.ok, false);
  if (aboveLimit.ok) {
    throw new Error("Expected a length validation error.");
  }

  assert.equal(aboveLimit.errors.goal?.[0]?.code, "too_long");
});

test("execution policy contains the mandatory manual-stop rules", () => {
  assert.deepEqual(codexTaskExecutionPolicy, [
    "Read AGENTS.md before making changes.",
    "Check git status before making changes.",
    "Stop if unexpected changes overlap the approved scope.",
    "Keep the diff minimal and focused on the task.",
    "Do not introduce unrelated contract drift.",
    "Run the verification commands, return the requested handoff, and stop.",
    "Do not commit, push, merge, or deploy.",
  ]);
});
