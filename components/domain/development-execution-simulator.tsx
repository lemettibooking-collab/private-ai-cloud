"use client";

import { useMemo, useState } from "react";

import {
  createDevelopmentExecutionDemoScenario,
  developmentExecutionDemoNextActionLabels,
  developmentExecutionDemoReasonLabels,
  developmentExecutionDemoScenarios,
  developmentExecutionDemoStatusLabels,
  getDevelopmentExecutionDemoCurrentAttemptFailure,
  getDevelopmentExecutionDemoHistoricalFailures,
  type DevelopmentExecutionDemoCategory,
  type DevelopmentExecutionDemoScenarioId,
} from "@/lib/development-execution-demo";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/types/app";

const categoryStyles: Readonly<
  Record<
    DevelopmentExecutionDemoCategory,
    Readonly<{ border: string; dot: string; text: string; tone: StatusTone }>
  >
> = {
  neutral: {
    border: "border-slate-700 bg-slate-900/60",
    dot: "bg-slate-400",
    text: "text-slate-200",
    tone: "neutral",
  },
  active: {
    border: "border-cyan-400/40 bg-cyan-400/10",
    dot: "bg-cyan-300",
    text: "text-cyan-100",
    tone: "info",
  },
  success: {
    border: "border-emerald-400/40 bg-emerald-400/10",
    dot: "bg-emerald-300",
    text: "text-emerald-100",
    tone: "success",
  },
  warning: {
    border: "border-amber-400/40 bg-amber-400/10",
    dot: "bg-amber-300",
    text: "text-amber-100",
    tone: "warning",
  },
  blocked: {
    border: "border-rose-400/40 bg-rose-400/10",
    dot: "bg-rose-300",
    text: "text-rose-100",
    tone: "danger",
  },
};

const reviewLabels = {
  not_started: "Ещё не начат",
  pending: "Ожидается результат review",
  passed: "Успешно пройден",
  failed: "Найдена ошибка",
} as const;

const attemptKindLabels = {
  initial: "первая попытка",
  corrective: "корректирующая попытка",
} as const;

const attemptStatusLabels = {
  in_progress: "в процессе",
  failed: "завершилась ошибкой",
  passed: "успешно завершена",
} as const;

const closureKindLabels = {
  none: "попытка ещё открыта",
  domain_failure: "исправимая ошибка",
  policy_block: "остановлено политикой",
  cancelled: "отменено владельцем",
  successful_completion: "успешное завершение",
} as const;

function getOwnerResult(status: string): string {
  switch (status) {
    case "reviewing":
      return "Проверки пройдены — идёт review";
    case "awaiting_correction":
      return "Нужно исправление";
    case "completed":
      return "Задача успешно завершена";
    case "blocked":
      return "Автоматический цикл остановлен";
    case "awaiting_owner_decision":
      return "Требуется решение владельца проекта";
    default:
      return "Задача выполняется";
  }
}

function getAttemptLabel(attemptNumber: number): string {
  return attemptNumber === 0
    ? "Попытки ещё не начаты"
    : `Попытка ${attemptNumber} из 3`;
}

function TechnicalList({
  title,
  values,
}: Readonly<{ title: string; values: readonly string[] }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{title}</dt>
      <dd className="mt-1 min-w-0 text-sm text-slate-300">
        {values.length > 0 ? (
          <ul className="min-w-0 space-y-1">
            {values.map((value, index) => (
              <li className="min-w-0 break-all font-mono text-xs" key={`${value}-${index}`}>
                {value}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-500">нет данных</span>
        )}
      </dd>
    </div>
  );
}

export function DevelopmentExecutionSimulator() {
  const [scenarioId, setScenarioId] =
    useState<DevelopmentExecutionDemoScenarioId>("success_first_attempt");
  const [stepIndex, setStepIndex] = useState(0);
  const result = useMemo(
    () => createDevelopmentExecutionDemoScenario(scenarioId),
    [scenarioId],
  );

  const selectScenario = (nextScenarioId: DevelopmentExecutionDemoScenarioId) => {
    setScenarioId(nextScenarioId);
    setStepIndex(0);
  };

  if (!result.ok) {
    return (
      <section
        aria-live="polite"
        className="min-w-0 rounded-xl border border-rose-400/40 bg-rose-400/10 p-5"
      >
        <h2 className="text-lg font-semibold text-rose-100">
          Демонстрация безопасно остановлена
        </h2>
        <p className="mt-2 text-sm leading-6 text-rose-100/80">
          {result.error.message}
        </p>
      </section>
    );
  }

  const timeline = result.value;
  const safeStepIndex = Math.min(stepIndex, timeline.steps.length - 1);
  const currentStep = timeline.steps[safeStepIndex];
  if (!currentStep) {
    return null;
  }

  const run = currentStep.snapshot;
  const currentAttempt = run.attempts.at(-1);
  const currentAttemptFailure =
    getDevelopmentExecutionDemoCurrentAttemptFailure(run);
  const historicalFailures =
    getDevelopmentExecutionDemoHistoricalFailures(run);
  const isStoppedOnCurrentVerificationFailure =
    currentAttemptFailure?.phase === "verification" &&
    currentAttempt?.status === "failed" &&
    (run.status === "awaiting_correction" ||
      run.status === "awaiting_owner_decision" ||
      run.status === "blocked");
  const currentStyle = categoryStyles[currentStep.category];
  const isFinalStep = safeStepIndex === timeline.steps.length - 1;
  const completedStepCount = safeStepIndex;

  return (
    <div className="min-w-0 space-y-6">
      <section
        aria-labelledby="development-cycle-explanation-title"
        className="min-w-0 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-400/10 via-slate-950/70 to-fuchsia-400/10 p-5"
      >
        <h2
          className="text-lg font-semibold text-slate-50"
          id="development-cycle-explanation-title"
        >
          Как работает цикл разработки
        </h2>
        <ol className="mt-4 grid min-w-0 gap-3 text-sm leading-6 text-slate-300 md:grid-cols-2 xl:grid-cols-3">
          {[
            "Агент подготавливает изменения.",
            "Система запускает обязательные проверки.",
            "Отдельный review проверяет результат.",
            "Если найдена исправимая ошибка — создаётся новая попытка.",
            "После успешных проверок и review задача завершается.",
            "После повторной ошибки, запрещённого действия или трёх попыток система останавливается.",
          ].map((item, index) => (
            <li className="flex min-w-0 gap-3" key={item}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-xs font-semibold text-cyan-200">
                {index + 1}
              </span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Это учебная демонстрация правил AI-011. Сейчас модели не подключены,
          команды не выполняются, файлы и Git не изменяются.
        </p>
      </section>

      <SectionCard
        title="Примеры работы цикла"
        description="Выберите ситуацию. Новый сценарий всегда начинается с первого шага и ничего не запускает во внешних системах."
      >
        <fieldset className="min-w-0">
          <legend className="sr-only">Выбор примера цикла разработки</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {developmentExecutionDemoScenarios.map((scenario) => {
              const selected = scenario.id === scenarioId;
              const controlId = `development-execution-scenario-${scenario.id}`;

              return (
                <label
                  className="flex min-w-0 cursor-pointer flex-col rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400/70 has-checked:border-cyan-400/50 has-checked:bg-cyan-400/10"
                  htmlFor={controlId}
                  key={scenario.id}
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <input
                      checked={selected}
                      className="mt-1 size-4 shrink-0 accent-cyan-400"
                      id={controlId}
                      name="development-execution-scenario"
                      onChange={() => selectScenario(scenario.id)}
                      type="radio"
                      value={scenario.id}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-slate-100">
                        {scenario.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {scenario.description}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 text-xs font-medium text-cyan-200">
                    {selected ? "Сценарий выбран" : "Показать сценарий"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </SectionCard>

      <section
        aria-live="polite"
        className={`min-w-0 rounded-xl border p-5 ${currentStyle.border}`}
      >
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Результат для владельца проекта
            </p>
            <h2 className={`mt-2 break-words text-2xl font-semibold ${currentStyle.text}`}>
              {getOwnerResult(run.status)}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {currentStep.description}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge tone={currentStyle.tone}>
              {getAttemptLabel(run.currentAttemptNumber)}
            </StatusBadge>
            <StatusBadge tone="neutral">
              Шаг {currentStep.number} из {timeline.steps.length}
            </StatusBadge>
          </div>
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/15 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={isFinalStep}
          onClick={() => setStepIndex((index) => Math.min(index + 1, timeline.steps.length - 1))}
          type="button"
        >
          Следующий шаг
        </button>
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-4 text-sm font-medium text-slate-200 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={() => setStepIndex(timeline.steps.length - 1)}
          type="button"
        >
          Показать весь цикл
        </button>
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-4 text-sm font-medium text-slate-200 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={() => setStepIndex(0)}
          type="button"
        >
          Начать сначала
        </button>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0 space-y-6">
          <SectionCard
            className="min-w-0"
            title="Что происходит сейчас"
            description={currentStep.title}
            action={<StatusBadge tone={currentStyle.tone}>текущий шаг</StatusBadge>}
          >
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <dt className="text-xs font-medium text-slate-500">Что проверено</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-200">
                  {currentStep.checkedSummary}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <dt className="text-xs font-medium text-slate-500">Будет ли новая попытка</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-200">
                  {currentStep.retryExplanation}
                </dd>
              </div>
              {currentStep.failureReason && (
                <div className="min-w-0 rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 sm:col-span-2">
                  <dt className="text-xs font-medium text-rose-200">Почему возникла остановка или исправление</dt>
                  <dd className="mt-2 text-sm leading-6 text-rose-100">
                    {currentStep.failureReason}
                  </dd>
                </div>
              )}
              <div className="min-w-0 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 sm:col-span-2">
                <dt className="text-xs font-medium text-cyan-200">Что произойдёт дальше</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-200">
                  {currentStep.nextDescription}
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            className="min-w-0"
            title="Проверки и review"
            description="Здесь показаны только данные, сохранённые в выбранном snapshot. Команды в действительности не выполнялись."
          >
            <p className="mb-4 text-xs font-medium text-amber-200">
              Результат в демонстрационном сценарии
            </p>
            <div className="min-w-0 space-y-3">
              {run.requiredVerificationCommands.map((command) => {
                const check = currentAttempt?.verificationChecks.find(
                  (candidate) => candidate.command === command,
                );
                return (
                  <div
                    className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    key={command}
                  >
                    <code className="min-w-0 break-all text-xs text-slate-300">
                      {command}
                    </code>
                    <span className={`shrink-0 text-xs font-medium ${check ? "text-emerald-300" : "text-slate-500"}`}>
                      {check ? "Успешный результат сохранён" : "Результат ещё не сохранён"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex min-w-0 flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Состояние review</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  {reviewLabels[currentAttempt?.reviewStatus ?? "not_started"]}
                </p>
              </div>
              {isStoppedOnCurrentVerificationFailure && (
                <span className="text-xs text-amber-200">
                  Сначала требуется исправить проверку
                </span>
              )}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          className="min-w-0 self-start"
          title="История шагов"
          description={`${completedStepCount} из ${timeline.steps.length - 1} переходов уже показано.`}
        >
          <ol className="min-w-0 space-y-0">
            {timeline.steps.map((step, index) => {
              const isCurrent = index === safeStepIndex;
              const isPast = index < safeStepIndex;
              const style = categoryStyles[step.category];

              return (
                <li className="relative flex min-w-0 gap-3 pb-5 last:pb-0" key={step.id}>
                  {index < timeline.steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[0.4375rem] top-4 h-[calc(100%-0.25rem)] w-px bg-slate-800"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={`relative mt-1 size-4 shrink-0 rounded-full border-4 border-slate-950 ${isPast || isCurrent ? style.dot : "bg-slate-700"}`}
                  />
                  <div className={`min-w-0 flex-1 ${index > safeStepIndex ? "opacity-45" : ""}`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className={`min-w-0 break-words text-sm font-semibold ${isPast || isCurrent ? style.text : "text-slate-400"}`}>
                        {step.title}
                      </p>
                      <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-slate-500">
                        {isCurrent
                          ? "текущий шаг"
                          : isPast
                            ? "завершён"
                            : "будущий шаг"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Шаг {step.number} · {getAttemptLabel(step.attemptNumber)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </SectionCard>
      </div>

      <details className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/70 p-5 open:border-slate-700">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-cyan-300">
          Технические детали AI-011
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Canonical значения для проверки контракта. Они не нужны для понимания основного результата.
        </p>
        <dl className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">status</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-300">{run.status}</dd>
            <dd className="mt-1 text-xs text-slate-500">{developmentExecutionDemoStatusLabels[run.status]}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">nextAction</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-300">{run.nextAction}</dd>
            <dd className="mt-1 text-xs text-slate-500">{developmentExecutionDemoNextActionLabels[run.nextAction]}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">attempt kind / status</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-300">
              {currentAttempt ? `${currentAttempt.kind} / ${currentAttempt.status}` : "none / none"}
            </dd>
            {currentAttempt && (
              <dd className="mt-1 text-xs text-slate-500">
                {attemptKindLabels[currentAttempt.kind]}, {attemptStatusLabels[currentAttempt.status]}
              </dd>
            )}
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">closureKind</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-300">{currentAttempt?.closureKind ?? "none"}</dd>
            <dd className="mt-1 text-xs text-slate-500">
              {closureKindLabels[currentAttempt?.closureKind ?? "none"]}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">reviewStatus</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-300">{currentAttempt?.reviewStatus ?? "not_started"}</dd>
          </div>
          <TechnicalList
            title="failure fingerprint текущей попытки"
            values={
              currentAttemptFailure ? [currentAttemptFailure.fingerprint] : []
            }
          />
          <TechnicalList
            title="raw reason codes"
            values={[
              ...run.blockingReasons.map((reason) => reason.code),
              ...(currentAttemptFailure ? [currentAttemptFailure.code] : []),
            ]}
          />
          <TechnicalList title="admitted paths" values={run.admittedAllowedPaths} />
          <TechnicalList title="changed paths" values={currentAttempt?.changedPaths ?? []} />
        </dl>
        {historicalFailures.length > 0 && (
          <div className="mt-5 min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium text-slate-400">
              История ошибок предыдущих попыток
            </p>
            <ul className="mt-3 min-w-0 space-y-3">
              {historicalFailures.map((failure) => (
                <li
                  className="min-w-0 rounded-md border border-slate-800 bg-slate-950/50 p-3"
                  key={`${failure.attemptNumber}-${failure.phase}-${failure.fingerprint}`}
                >
                  <p className="text-xs font-medium text-slate-300">
                    Попытка {failure.attemptNumber} · phase: {failure.phase}
                  </p>
                  <code className="mt-1 block min-w-0 break-all text-xs text-slate-500">
                    fingerprint: {failure.fingerprint}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {run.blockingReasons.length > 0 && (
          <div className="mt-5 min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-medium text-slate-500">Пояснения reason codes</p>
            <ul className="mt-2 min-w-0 space-y-2">
              {run.blockingReasons.map((reason, index) => (
                <li className="min-w-0 text-xs leading-5 text-slate-300" key={`${reason.code}-${index}`}>
                  <code className="break-all text-slate-400">{reason.code}</code>: {developmentExecutionDemoReasonLabels[reason.code]}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}
