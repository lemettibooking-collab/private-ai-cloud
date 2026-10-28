import type { CodexTaskArtifactInput } from "@/lib/codex-task-artifact";

export type PathSelectionMode = "discover" | "manual";

export const discoverAllowedPaths = [
  "Весь репозиторий доступен только для read-only анализа",
  "Не изменять ни один файл до отдельного подтверждения Owner",
] as const;

export const discoverForbiddenActions = [
  "Не изменять, не создавать, не переименовывать и не удалять файлы в этом запуске",
  "Не выполнять команды, изменяющие Git, зависимости, lockfile, generated files, cache или базу данных",
  "После read-only анализа вернуть предлагаемый список путей и остановиться до подтверждения Owner",
] as const;

export const discoverExpectedHandoff = [
  "Предлагаемый минимальный список файлов и папок",
  "Назначение каждого предлагаемого пути",
  "Почему каждый путь нужен для фичи",
  "Файлы, которые были проверены, но не должны изменяться",
  "Риски пересечения с другими модулями",
  "Предлагаемое разбиение фичи на маленькие задачи",
] as const;

function mergeMultilineValues(
  currentValue: string,
  requiredValues: readonly string[],
): string {
  const seen = new Set<string>();

  return [
    ...currentValue.replace(/\r\n?/g, "\n").split("\n"),
    ...requiredValues,
  ]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    })
    .join("\n");
}

export function buildEffectiveCodexTaskInput(
  input: CodexTaskArtifactInput,
  mode: PathSelectionMode,
): CodexTaskArtifactInput {
  if (mode === "manual") {
    return { ...input };
  }

  return {
    ...input,
    allowedPaths: discoverAllowedPaths.join("\n"),
    additionalForbiddenActions: mergeMultilineValues(
      input.additionalForbiddenActions,
      discoverForbiddenActions,
    ),
    expectedHandoff: mergeMultilineValues(
      input.expectedHandoff,
      discoverExpectedHandoff,
    ),
  };
}
