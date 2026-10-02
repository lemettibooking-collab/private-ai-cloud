"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  codexTaskArtifactFilename,
  codexTaskFieldLimits,
  createCodexTaskArtifact,
  type CodexTaskArtifact,
  type CodexTaskArtifactField,
  type CodexTaskArtifactInput,
  type CodexTaskValidationError,
  type CodexTaskValidationErrors,
} from "@/lib/codex-task-artifact";
import {
  buildEffectiveCodexTaskInput,
  type PathSelectionMode,
} from "@/lib/codex-task-form-policy";

const initialInput: CodexTaskArtifactInput = {
  goal: "",
  context: "",
  scope: "",
  nonGoals: [
    "Не менять несвязанные функции и страницы",
    "Не проводить широкий рефакторинг",
    "Не менять публичные контракты без явного требования",
    "Не добавлять зависимости без необходимости",
  ].join("\n"),
  allowedPaths: "",
  allowedCommands: [
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "git diff --check",
    "git status --short",
  ].join("\n"),
  acceptanceCriteria: "",
  verificationCommands: [
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "git diff --check",
  ].join("\n"),
  expectedHandoff: [
    "Краткое описание результата",
    "Список изменённых файлов",
    "Результаты проверок",
    "Git diff stat",
    "Оставшиеся риски и ограничения",
    "Подтверждение, что commit и push не выполнялись",
  ].join("\n"),
  additionalForbiddenActions: "",
};

type FieldDefinition = {
  name: CodexTaskArtifactField;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  rows: number;
};

const primaryTaskFieldDefinitions: readonly FieldDefinition[] = [
  {
    name: "goal",
    label: "Что нужно сделать?",
    description:
      "Опишите конкретный результат, который должен получить Codex.",
    placeholder: "Например: улучшить форму подготовки задания для Codex.",
    required: true,
    rows: 3,
  },
  {
    name: "context",
    label: "Почему это нужно?",
    description:
      "Опишите проблему и важный контекст текущего проекта.",
    placeholder: "Опишите текущее состояние и проблему Owner.",
    required: true,
    rows: 4,
  },
  {
    name: "scope",
    label: "Что разрешено изменить?",
    description:
      "Укажите границы задачи: страницу, модуль или часть продукта.",
    placeholder: "Например: только страница и компонент Codex Task.",
    required: true,
    rows: 3,
  },
];

const allowedPathsFieldDefinition: FieldDefinition = {
  name: "allowedPaths",
  label: "Какие файлы или папки можно менять?",
  description:
    "Один путь или правило на строку. Используйте этот режим, только если точные пути уже известны.",
  placeholder: "app/workflows/codex-task/run/page.tsx\ncomponents/domain/",
  required: true,
  rows: 4,
};

const acceptanceCriteriaFieldDefinition: FieldDefinition = {
  name: "acceptanceCriteria",
  label: "Как понять, что задача выполнена?",
  description: "Один проверяемый результат на строку.",
  placeholder: "Форма использует введённые данные\nВсе проверки проходят",
  required: true,
  rows: 5,
};

const technicalFieldDefinitions: readonly FieldDefinition[] = [
  {
    name: "nonGoals",
    label: "Что точно не делать",
    description: "Одно ограничение на строку.",
    placeholder: "Не менять несвязанные функции и страницы",
    required: true,
    rows: 5,
  },
  {
    name: "allowedCommands",
    label: "Разрешённые команды",
    description: "Одна разрешённая команда на строку.",
    placeholder: "npm run lint\nnpm run build",
    required: true,
    rows: 7,
  },
  {
    name: "verificationCommands",
    label: "Команды проверки",
    description: "Одна обязательная команда проверки на строку.",
    placeholder: "npm run lint\nnpm run build\ngit diff --check",
    required: true,
    rows: 6,
  },
  {
    name: "expectedHandoff",
    label: "Какой отчёт должен вернуть Codex",
    description: "Перечислите обязательные части итогового отчёта.",
    placeholder: "Краткое описание результата\nРезультаты проверок",
    required: true,
    rows: 7,
  },
  {
    name: "additionalForbiddenActions",
    label: "Дополнительные запреты",
    description:
      "Необязательные дополнительные запреты, по одному на строку. Системные ограничения сохраняются всегда.",
    placeholder: "Не менять тексты публичного интерфейса",
    required: false,
    rows: 4,
  },
];

type CopyStatus = "idle" | "success" | "error";

function getValidationMessage(error: CodexTaskValidationError): string {
  switch (error.code) {
    case "required":
      return "Заполните обязательное поле.";
    case "too_long":
      return `Используйте не более ${codexTaskFieldLimits[error.field]} символов.`;
    case "control_characters":
      return "Удалите NUL и неподдерживаемые управляющие символы.";
  }
}

export function CodexTaskArtifactForm() {
  const [input, setInput] = useState<CodexTaskArtifactInput>(initialInput);
  const [errors, setErrors] = useState<CodexTaskValidationErrors>({});
  const [artifact, setArtifact] = useState<CodexTaskArtifact | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [artifactInvalidated, setArtifactInvalidated] = useState(false);
  const [technicalSettingsOpen, setTechnicalSettingsOpen] = useState(false);
  const [pathSelectionMode, setPathSelectionMode] =
    useState<PathSelectionMode>("discover");

  function updateField(field: CodexTaskArtifactField, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setCopyStatus("idle");
    setDownloadStatus("");

    if (artifact) {
      setArtifact(null);
      setArtifactInvalidated(true);
    }
  }

  function changePathSelectionMode(mode: PathSelectionMode) {
    if (mode === pathSelectionMode) {
      return;
    }

    setPathSelectionMode(mode);
    setErrors((current) => ({ ...current, allowedPaths: undefined }));
    setCopyStatus("idle");
    setDownloadStatus("");

    if (artifact) {
      setArtifact(null);
      setArtifactInvalidated(true);
    }
  }

  function generateArtifact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const effectiveInput = buildEffectiveCodexTaskInput(
      input,
      pathSelectionMode,
    );
    const result = createCodexTaskArtifact(effectiveInput);

    if (!result.ok) {
      setErrors(result.errors);
      setArtifact(null);

      if (
        technicalFieldDefinitions.some(
          (field) => (result.errors[field.name]?.length ?? 0) > 0,
        )
      ) {
        setTechnicalSettingsOpen(true);
      }

      return;
    }

    setErrors({});
    setArtifact(result.artifact);
    setArtifactInvalidated(false);
    setCopyStatus("idle");
    setDownloadStatus("");
  }

  async function copyPrompt() {
    if (!artifact) {
      return;
    }

    try {
      await navigator.clipboard.writeText(artifact.prompt);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }

  function downloadMarkdown() {
    if (!artifact) {
      return;
    }

    const blob = new Blob([artifact.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = artifact.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setDownloadStatus(`Файл ${artifact.filename} скачан.`);
  }

  function renderField(field: FieldDefinition) {
    const fieldErrors = errors[field.name] ?? [];
    const fieldId = `codex-task-${field.name}`;
    const descriptionId = `${fieldId}-description`;
    const errorId = `${fieldId}-error`;

    return (
      <div className="min-w-0" key={field.name}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <label
            className="text-sm font-medium text-slate-200"
            htmlFor={fieldId}
          >
            {field.label}
            {field.required && (
              <span className="ml-1 text-xs font-normal text-slate-400">
                (обязательное)
              </span>
            )}
          </label>
          <span className="text-xs font-normal text-slate-600">
            {input[field.name].length}/{codexTaskFieldLimits[field.name]}
          </span>
        </div>
        <p
          className="mt-1 text-xs leading-5 text-slate-500"
          id={descriptionId}
        >
          {field.description}
        </p>
        <textarea
          aria-describedby={`${descriptionId}${fieldErrors.length > 0 ? ` ${errorId}` : ""}`}
          aria-invalid={fieldErrors.length > 0}
          aria-required={field.required}
          className="mt-2 min-w-0 w-full max-w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm leading-6 text-slate-100 outline-none ring-cyan-400/40 placeholder:text-slate-600 focus:ring-2"
          id={fieldId}
          maxLength={codexTaskFieldLimits[field.name] + 1}
          name={field.name}
          onChange={(event) => updateField(field.name, event.target.value)}
          placeholder={field.placeholder}
          rows={field.rows}
          value={input[field.name]}
        />
        {fieldErrors.length > 0 && (
          <p className="mt-2 text-xs text-rose-300" id={errorId}>
            {fieldErrors.map(getValidationMessage).join(" ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))] gap-6">
      <SectionCard
        className="min-w-0"
        title="Задание для Codex"
        description="Сформируйте проверяемое задание для Codex. Ничего не сохраняется и не запускается."
      >
        <form className="min-w-0 space-y-5" onSubmit={generateArtifact}>
          {primaryTaskFieldDefinitions.map(renderField)}

          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium text-slate-200">
              Как определить область кода?
              <span className="ml-1 text-xs font-normal text-slate-400">
                (обязательное)
              </span>
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition has-checked:border-cyan-400/40 has-checked:bg-cyan-400/10">
              <input
                checked={pathSelectionMode === "discover"}
                className="mt-1 size-4 shrink-0 accent-cyan-400"
                name="pathSelectionMode"
                onChange={() => changePathSelectionMode("discover")}
                type="radio"
                value="discover"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-200">
                  Определить по репозиторию — рекомендуется
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Codex сначала изучит структуру проекта и предложит минимальный
                  список файлов. На этом этапе код изменяться не будет.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition has-checked:border-cyan-400/40 has-checked:bg-cyan-400/10">
              <input
                checked={pathSelectionMode === "manual"}
                className="mt-1 size-4 shrink-0 accent-cyan-400"
                name="pathSelectionMode"
                onChange={() => changePathSelectionMode("manual")}
                type="radio"
                value="manual"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-200">
                  Указать пути вручную
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Для разработчика, который уже знает точные файлы или папки.
                </span>
              </span>
            </label>
          </fieldset>

          {pathSelectionMode === "discover" ? (
            <div
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100"
              role="status"
            >
              Будет создано задание только на анализ репозитория. Codex
              предложит файлы и остановится до подтверждения Owner.
            </div>
          ) : (
            renderField(allowedPathsFieldDefinition)
          )}

          {renderField(acceptanceCriteriaFieldDefinition)}

          <details
            className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/30 p-4"
            onToggle={(event) =>
              setTechnicalSettingsOpen(event.currentTarget.open)
            }
            open={technicalSettingsOpen}
          >
            <summary className="cursor-pointer text-sm font-semibold text-slate-200 outline-none ring-cyan-400/40 focus-visible:rounded focus-visible:ring-2">
              Технические настройки
            </summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Стандартные ограничения и проверки уже заполнены. При
              необходимости их можно изменить до генерации задания.
            </p>
            <div className="mt-5 min-w-0 space-y-5">
              {technicalFieldDefinitions.map(renderField)}
            </div>
          </details>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/15 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25 sm:w-auto"
              type="submit"
            >
              {pathSelectionMode === "discover"
                ? "Подготовить анализ репозитория"
                : "Подготовить задание"}
            </button>
            <StatusBadge tone="locked">без внешних действий</StatusBadge>
          </div>

          {artifactInvalidated && (
            <p className="text-xs text-amber-300" role="status">
              Поля изменены. Предыдущее задание удалено — подготовьте его
              заново перед копированием или скачиванием.
            </p>
          )}

          <p className="text-xs leading-5 text-slate-500">
            Codex не запущен. Скопируйте или скачайте задание, затем Owner
            запускает Codex вручную.
          </p>
        </form>
      </SectionCard>

      <SectionCard
        action={
          <StatusBadge
            tone={
              artifact && pathSelectionMode === "discover"
                ? "locked"
                : artifact
                  ? "success"
                  : "neutral"
            }
          >
            {artifact && pathSelectionMode === "discover" ? (
              <span className="max-w-48 text-center leading-4">
                Только анализ — изменения запрещены
              </span>
            ) : artifact ? (
              "задание готово"
            ) : (
              "не подготовлено"
            )}
          </StatusBadge>
        }
        className="min-w-0"
        title="Готовое задание"
        description={`Скопируйте точный текст задания или скачайте ${codexTaskArtifactFilename}. Предпросмотр, скопированный текст и содержимое файла полностью совпадают.`}
      >
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/15 px-3 text-sm font-medium text-cyan-100 transition enabled:hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              disabled={!artifact}
              onClick={copyPrompt}
              type="button"
            >
              Скопировать задание
            </button>
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-3 text-sm font-medium text-slate-200 transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              disabled={!artifact}
              onClick={downloadMarkdown}
              type="button"
            >
              Скачать Markdown
            </button>
          </div>

          <div aria-live="polite" className="min-h-5 text-xs">
            {copyStatus === "success" && (
              <p className="text-emerald-300">Задание скопировано.</p>
            )}
            {copyStatus === "error" && (
              <p className="text-rose-300">
                Не удалось получить доступ к буферу обмена. Скопируйте текст
                из предпросмотра вручную.
              </p>
            )}
            {downloadStatus && (
              <p className="text-emerald-300">{downloadStatus}</p>
            )}
          </div>

          {artifact ? (
            <pre className="max-h-[720px] min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-xs leading-6 text-slate-200">
              {artifact.markdown}
            </pre>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-6 text-center sm:p-8">
              <p className="text-sm font-medium text-slate-300">
                Задание ещё не подготовлено
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Заполните все обязательные поля и подготовьте детерминированный
                предпросмотр.
              </p>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
