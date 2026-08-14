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
  type CodexTaskValidationErrors,
} from "@/lib/codex-task-artifact";

const initialInput: CodexTaskArtifactInput = {
  goal: "",
  context: "",
  scope: "",
  nonGoals: "",
  allowedPaths: "",
  allowedCommands: "",
  acceptanceCriteria: "",
  verificationCommands: "",
  expectedHandoff: "",
  additionalForbiddenActions: "",
};

const fieldDefinitions: ReadonlyArray<{
  name: CodexTaskArtifactField;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  rows: number;
}> = [
  {
    name: "goal",
    label: "Goal",
    description: "The concrete outcome Codex must deliver.",
    placeholder: "Add a deterministic Codex task artifact generator.",
    required: true,
    rows: 3,
  },
  {
    name: "context",
    label: "Current context / problem",
    description: "Relevant repository state and why the change is needed.",
    placeholder: "The current workflow displays a static preview.",
    required: true,
    rows: 4,
  },
  {
    name: "scope",
    label: "Scope",
    description: "The approved boundary for the implementation.",
    placeholder: "Codex task page, dedicated component, pure serializer, tests.",
    required: true,
    rows: 3,
  },
  {
    name: "nonGoals",
    label: "Non-goals",
    description: "One item per line.",
    placeholder: "No backend\nNo LLM call\nNo persistence",
    required: true,
    rows: 4,
  },
  {
    name: "allowedPaths",
    label: "Allowed / expected paths",
    description: "One path or path policy per line.",
    placeholder: "app/workflows/codex-task/run/page.tsx\ncomponents/domain/",
    required: true,
    rows: 4,
  },
  {
    name: "allowedCommands",
    label: "Allowed commands",
    description: "One command per line.",
    placeholder: "npm run lint\nnpm run typecheck\nnpm test\nnpm run build",
    required: true,
    rows: 4,
  },
  {
    name: "acceptanceCriteria",
    label: "Acceptance criteria",
    description: "One verifiable criterion per line.",
    placeholder: "Input generates deterministic Markdown\nInvalid input is rejected",
    required: true,
    rows: 5,
  },
  {
    name: "verificationCommands",
    label: "Verification commands",
    description: "Commands Codex must run before handoff, one per line.",
    placeholder: "npm run lint\nnpm run typecheck\nnpm test\nnpm run build",
    required: true,
    rows: 4,
  },
  {
    name: "expectedHandoff",
    label: "Expected handoff",
    description: "The exact report structure expected from Codex.",
    placeholder: "Changed files, verification results, risks, and git status.",
    required: true,
    rows: 4,
  },
  {
    name: "additionalForbiddenActions",
    label: "Additional forbidden actions",
    description: "Optional additions, one per line. System restrictions remain mandatory.",
    placeholder: "Do not update dependencies\nDo not change public copy",
    required: false,
    rows: 3,
  },
];

type CopyStatus = "idle" | "success" | "error";

export function CodexTaskArtifactForm() {
  const [input, setInput] = useState<CodexTaskArtifactInput>(initialInput);
  const [errors, setErrors] = useState<CodexTaskValidationErrors>({});
  const [artifact, setArtifact] = useState<CodexTaskArtifact | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [artifactInvalidated, setArtifactInvalidated] = useState(false);

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

  function generateArtifact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = createCodexTaskArtifact(input);

    if (!result.ok) {
      setErrors(result.errors);
      setArtifact(null);
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
    setDownloadStatus(`Downloaded ${artifact.filename}.`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <SectionCard
        title="Codex task input"
        description="Generate a deterministic prompt and Markdown artifact from Owner input. Nothing is saved or executed."
      >
        <form className="space-y-5" onSubmit={generateArtifact}>
          {fieldDefinitions.map((field) => {
            const fieldErrors = errors[field.name] ?? [];
            const errorId = `${field.name}-error`;

            return (
              <label className="block" key={field.name}>
                <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-200">
                  <span>
                    {field.label}
                    {field.required && (
                      <span className="ml-1 text-rose-300" aria-hidden="true">
                        *
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-normal text-slate-600">
                    {input[field.name].length}/{codexTaskFieldLimits[field.name]}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {field.description}
                </span>
                <textarea
                  aria-describedby={fieldErrors.length > 0 ? errorId : undefined}
                  aria-invalid={fieldErrors.length > 0}
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm leading-6 text-slate-100 outline-none ring-cyan-400/40 placeholder:text-slate-600 focus:ring-2"
                  maxLength={codexTaskFieldLimits[field.name] + 1}
                  name={field.name}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  placeholder={field.placeholder}
                  aria-required={field.required}
                  rows={field.rows}
                  value={input[field.name]}
                />
                {fieldErrors.length > 0 && (
                  <span
                    className="mt-2 block text-xs text-rose-300"
                    id={errorId}
                  >
                    {fieldErrors.map((error) => error.message).join(" ")}
                  </span>
                )}
              </label>
            );
          })}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/15 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25"
              type="submit"
            >
              Generate prompt and Markdown
            </button>
            <StatusBadge tone="locked">no external action</StatusBadge>
          </div>

          {artifactInvalidated && (
            <p className="text-xs text-amber-300" role="status">
              Input changed. The previous artifact was invalidated; generate it
              again before copying or downloading.
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
          <StatusBadge tone={artifact ? "success" : "neutral"}>
            {artifact ? "artifact ready" : "not generated"}
          </StatusBadge>
        }
        title="Codex task artifact"
        description={`Copy the exact prompt or download ${codexTaskArtifactFilename}. Preview, clipboard, and file contents are identical.`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/15 px-3 text-sm font-medium text-cyan-100 transition enabled:hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!artifact}
              onClick={copyPrompt}
              type="button"
            >
              Copy prompt
            </button>
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-3 text-sm font-medium text-slate-200 transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!artifact}
              onClick={downloadMarkdown}
              type="button"
            >
              Download Markdown
            </button>
          </div>

          <div aria-live="polite" className="min-h-5 text-xs">
            {copyStatus === "success" && (
              <p className="text-emerald-300">Prompt copied to clipboard.</p>
            )}
            {copyStatus === "error" && (
              <p className="text-rose-300">
                Clipboard access failed. Use the preview to copy the prompt
                manually.
              </p>
            )}
            {downloadStatus && (
              <p className="text-emerald-300">{downloadStatus}</p>
            )}
          </div>

          {artifact ? (
            <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-xs leading-6 text-slate-200">
              {artifact.markdown}
            </pre>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
              <p className="text-sm font-medium text-slate-300">
                No artifact generated yet
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Complete every required field, then generate a deterministic
                preview.
              </p>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
