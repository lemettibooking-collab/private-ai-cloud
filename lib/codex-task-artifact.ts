export const codexTaskArtifactFilename = "codex-task.md";

export const systemForbiddenActions = [
  "Do not read or expose secrets.",
  "Do not modify files outside the approved scope.",
  "Do not merge branches or commits.",
  "Do not deploy.",
  "Do not push changes or create pull requests.",
  "Do not run destructive Git commands.",
  "Do not modify production data or production infrastructure.",
] as const;

export const codexTaskExecutionPolicy = [
  "Read AGENTS.md before making changes.",
  "Check git status before making changes.",
  "Stop if unexpected changes overlap the approved scope.",
  "Keep the diff minimal and focused on the task.",
  "Do not introduce unrelated contract drift.",
  "Run the verification commands, return the requested handoff, and stop.",
  "Do not commit, push, merge, or deploy.",
] as const;

export type CodexTaskArtifactInput = {
  goal: string;
  context: string;
  scope: string;
  nonGoals: string;
  allowedPaths: string;
  allowedCommands: string;
  acceptanceCriteria: string;
  verificationCommands: string;
  expectedHandoff: string;
  additionalForbiddenActions: string;
};

export const requiredCodexTaskFields = [
  "goal",
  "context",
  "scope",
  "nonGoals",
  "allowedPaths",
  "allowedCommands",
  "acceptanceCriteria",
  "verificationCommands",
  "expectedHandoff",
] as const satisfies ReadonlyArray<keyof CodexTaskArtifactInput>;

export type RequiredCodexTaskField =
  (typeof requiredCodexTaskFields)[number];
export type CodexTaskArtifactField = keyof CodexTaskArtifactInput;

export const codexTaskFieldLimits = {
  goal: 1_200,
  context: 6_000,
  scope: 4_000,
  nonGoals: 4_000,
  allowedPaths: 4_000,
  allowedCommands: 4_000,
  acceptanceCriteria: 6_000,
  verificationCommands: 4_000,
  expectedHandoff: 4_000,
  additionalForbiddenActions: 4_000,
} as const satisfies Record<CodexTaskArtifactField, number>;

export type CodexTaskValidationErrorCode =
  | "required"
  | "too_long"
  | "control_characters";

export type CodexTaskValidationError = {
  field: CodexTaskArtifactField;
  code: CodexTaskValidationErrorCode;
  message: string;
};

export type CodexTaskValidationErrors = Partial<
  Record<CodexTaskArtifactField, CodexTaskValidationError[]>
>;

export type NormalizedCodexTaskArtifactInput = {
  goal: string;
  context: string;
  scope: string;
  nonGoals: string[];
  allowedPaths: string[];
  allowedCommands: string[];
  forbiddenActions: string[];
  acceptanceCriteria: string[];
  verificationCommands: string[];
  expectedHandoff: string;
};

export type CodexTaskArtifact = {
  filename: typeof codexTaskArtifactFilename;
  prompt: string;
  markdown: string;
  normalizedInput: NormalizedCodexTaskArtifactInput;
};

export type CodexTaskArtifactResult =
  | {
      ok: true;
      artifact: CodexTaskArtifact;
    }
  | {
      ok: false;
      errors: CodexTaskValidationErrors;
    };

const disallowedControlCharacters =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function deduplicate(values: readonly string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}

function parseList(value: string): string[] {
  return deduplicate(
    normalizeText(value)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function addValidationError(
  errors: CodexTaskValidationErrors,
  error: CodexTaskValidationError,
): void {
  const fieldErrors = errors[error.field] ?? [];
  fieldErrors.push(error);
  errors[error.field] = fieldErrors;
}

function escapeMarkdownLine(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");

  return escaped.replace(
    /^(\s*)(#{1,6}|>|[-+*]|\d+[.)])(?=\s|$)/u,
    "$1\\$2",
  );
}

function escapeMarkdownBlock(value: string): string {
  return value.split("\n").map(escapeMarkdownLine).join("\n");
}

function renderList(values: readonly string[]): string {
  return values.map((value) => `- ${escapeMarkdownLine(value)}`).join("\n");
}

export function validateAndNormalizeCodexTaskInput(
  input: CodexTaskArtifactInput,
):
  | { ok: true; value: NormalizedCodexTaskArtifactInput }
  | { ok: false; errors: CodexTaskValidationErrors } {
  const errors: CodexTaskValidationErrors = {};
  const normalizedFields = Object.fromEntries(
    Object.entries(input).map(([field, value]) => [field, normalizeText(value)]),
  ) as Record<CodexTaskArtifactField, string>;

  for (const field of Object.keys(input) as CodexTaskArtifactField[]) {
    const value = normalizedFields[field];

    if (disallowedControlCharacters.test(value)) {
      addValidationError(errors, {
        field,
        code: "control_characters",
        message: "Remove NUL or unsupported control characters.",
      });
    }

    if (value.length > codexTaskFieldLimits[field]) {
      addValidationError(errors, {
        field,
        code: "too_long",
        message: `Use at most ${codexTaskFieldLimits[field]} characters.`,
      });
    }
  }

  for (const field of requiredCodexTaskFields) {
    if (!normalizedFields[field]) {
      addValidationError(errors, {
        field,
        code: "required",
        message: "This field is required.",
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const additionalForbiddenActions = parseList(
    normalizedFields.additionalForbiddenActions,
  );

  return {
    ok: true,
    value: {
      goal: normalizedFields.goal,
      context: normalizedFields.context,
      scope: normalizedFields.scope,
      nonGoals: parseList(normalizedFields.nonGoals),
      allowedPaths: parseList(normalizedFields.allowedPaths),
      allowedCommands: parseList(normalizedFields.allowedCommands),
      forbiddenActions: deduplicate([
        ...systemForbiddenActions,
        ...additionalForbiddenActions,
      ]),
      acceptanceCriteria: parseList(normalizedFields.acceptanceCriteria),
      verificationCommands: parseList(
        normalizedFields.verificationCommands,
      ),
      expectedHandoff: normalizedFields.expectedHandoff,
    },
  };
}

export function serializeCodexTaskArtifact(
  input: NormalizedCodexTaskArtifactInput,
): string {
  return [
    "# Codex Development Task",
    "",
    "## Goal",
    "",
    escapeMarkdownBlock(input.goal),
    "",
    "## Current Context",
    "",
    escapeMarkdownBlock(input.context),
    "",
    "## Scope",
    "",
    escapeMarkdownBlock(input.scope),
    "",
    "## Non-goals",
    "",
    renderList(input.nonGoals),
    "",
    "## Allowed / Expected Paths",
    "",
    renderList(input.allowedPaths),
    "",
    "## Allowed Commands",
    "",
    renderList(input.allowedCommands),
    "",
    "## Forbidden Actions",
    "",
    renderList(input.forbiddenActions),
    "",
    "## Acceptance Criteria",
    "",
    renderList(input.acceptanceCriteria),
    "",
    "## Verification Commands",
    "",
    renderList(input.verificationCommands),
    "",
    "## Expected Handoff",
    "",
    escapeMarkdownBlock(input.expectedHandoff),
    "",
    "## Execution Policy",
    "",
    renderList(codexTaskExecutionPolicy),
    "",
  ].join("\n");
}

export function createCodexTaskArtifact(
  input: CodexTaskArtifactInput,
): CodexTaskArtifactResult {
  const validation = validateAndNormalizeCodexTaskInput(input);

  if (!validation.ok) {
    return validation;
  }

  const markdown = serializeCodexTaskArtifact(validation.value);

  return {
    ok: true,
    artifact: {
      filename: codexTaskArtifactFilename,
      prompt: markdown,
      markdown,
      normalizedInput: validation.value,
    },
  };
}
