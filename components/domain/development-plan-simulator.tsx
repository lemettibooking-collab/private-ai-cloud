"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  developmentPlanDemoReasonLabels,
  developmentPlanDemoScenarios,
  developmentPlanDemoVerdictLabels,
  evaluateDevelopmentPlanDemoScenario,
  type DevelopmentPlanDemoScenarioId,
} from "@/lib/development-plan-demo";
import type { DevelopmentTask } from "@/lib/contracts/development-plan";
import type { DevelopmentTaskAdmissionVerdict } from "@/lib/contracts/development-task-policy";

const verdictExplanations: Readonly<
  Record<DevelopmentTaskAdmissionVerdict, string>
> = {
  allow:
    "Все обязательные проверки пройдены. Это ещё не запуск агента — задача только готова к передаче следующему слою системы.",
  require_approval:
    "Система остановилась и ждёт решения Owner. До подтверждения задача не будет передана дальше.",
  deny:
    "Система заблокировала переход. Подтверждение Owner не должно обходить технические и системные запреты.",
};

const verdictPanelClass: Readonly<
  Record<DevelopmentTaskAdmissionVerdict, string>
> = {
  allow: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  require_approval: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  deny: "border-rose-400/30 bg-rose-400/10 text-rose-100",
};

const developmentProcessSteps = [
  {
    title: "Вы описываете фичу",
    description:
      "Например: добавить управление разработкой через Telegram.",
  },
  {
    title: "Система составляет план",
    description:
      "Определяет связанные файлы, зависимости, риски и проверки.",
  },
  {
    title: "Правила проверяют следующий этап",
    description:
      "Незавершённые зависимости, конфликты файлов и опасные пути блокируются.",
  },
  {
    title: "Owner принимает решение",
    description:
      "Безопасный этап можно передать дальше, а рискованный требует подтверждения.",
  },
] as const;

const planStatusLabels = {
  draft: "Черновик",
  awaiting_approval: "Ожидает утверждения",
  approved: "Утверждён",
  in_progress: "В работе",
  blocked: "Заблокирован",
  completed: "Завершён",
  cancelled: "Отменён",
} as const;

const riskLabels = {
  low: "низкий",
  medium: "средний",
  high: "высокий",
  critical: "критический",
} as const;

function BooleanValue({ value }: { value: boolean }) {
  return (
    <span className={value ? "text-emerald-300" : "text-slate-400"}>
      {value ? "Да" : "Нет"}
    </span>
  );
}

function TokenList({
  values,
  emptyLabel = "нет",
}: {
  values: readonly string[];
  emptyLabel?: string;
}) {
  if (values.length === 0) {
    return <span className="text-sm text-slate-500">{emptyLabel}</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {values.map((value) => (
        <code
          className="max-w-full break-all rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs leading-5 text-slate-300"
          key={value}
        >
          {value}
        </code>
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: DevelopmentTask }) {
  return (
    <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Порядок в плане: {task.sequence}
          </p>
          <h4 className="mt-1 break-words text-sm font-semibold text-slate-100">
            {task.title}
          </h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">приоритет: {task.priority}</StatusBadge>
          <StatusBadge
            tone={
              task.riskLevel === "high" || task.riskLevel === "critical"
                ? "warning"
                : "neutral"
            }
          >
            риск: {riskLabels[task.riskLevel]}
          </StatusBadge>
        </div>
      </div>

      <dl className="mt-4 min-w-0 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-slate-500">
            Что должно быть готово до начала
          </dt>
          <dd className="mt-1">
            <TokenList values={task.dependencyIds} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">
            Какие файлы может менять агент
          </dt>
          <dd className="mt-1">
            <TokenList values={task.allowedPaths} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-xs font-medium text-slate-500">
            Нужно отдельное решение Owner:
          </dt>
          <dd className="text-sm">
            <BooleanValue value={task.requiresOwnerApproval} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function DevelopmentPlanSimulator() {
  const initialScenario = developmentPlanDemoScenarios[0];
  const [scenarioId, setScenarioId] =
    useState<DevelopmentPlanDemoScenarioId>(initialScenario.id);
  const [ownerApprovalGranted, setOwnerApprovalGranted] = useState<boolean>(
    initialScenario.defaultOwnerApprovalGranted,
  );
  const result = evaluateDevelopmentPlanDemoScenario(
    scenarioId,
    ownerApprovalGranted,
  );
  const selectedTask = result.plan.tasks.find(
    (task) => task.id === result.input.taskId,
  );

  function selectScenario(nextScenarioId: DevelopmentPlanDemoScenarioId) {
    const nextScenario = developmentPlanDemoScenarios.find(
      (scenario) => scenario.id === nextScenarioId,
    );

    setScenarioId(nextScenarioId);
    setOwnerApprovalGranted(
      nextScenario?.defaultOwnerApprovalGranted ?? false,
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <SectionCard
        title="Как будет работать модуль разработки"
        description="В рабочей версии вы описываете фичу обычными словами. Система изучает репозиторий, разделяет работу на небольшие задачи, проверяет их порядок и безопасность, а затем предлагает следующий разрешённый этап."
      >
        <ol className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {developmentProcessSteps.map((step, index) => (
            <li
              className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4"
              key={step.title}
            >
              <span className="inline-flex size-8 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-sm font-semibold text-cyan-200">
                {index + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-100">
                {step.title}
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
          На этой странице используется готовый демонстрационный план. Ввод
          собственной фичи и запуск агентов будут подключены на следующих
          этапах.
        </p>
      </SectionCard>

      <section
        aria-labelledby="development-plan-instruction-title"
        className="min-w-0 rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 p-4"
      >
        <h2
          className="text-sm font-semibold text-fuchsia-100"
          id="development-plan-instruction-title"
        >
          Что сделать сейчас
        </h2>
        <p className="mt-2 text-sm leading-6 text-fuchsia-100/80">
          Выберите один из примеров ниже и посмотрите, какое решение примет
          система. В реальной работе эти ситуации будут определяться
          автоматически.
        </p>
      </section>

      <SectionCard
        title="Примеры решений системы"
        description="Это готовые примеры для знакомства с правилами безопасности. Пользователю не придётся выбирать такие режимы при реальной разработке."
      >
        <fieldset className="min-w-0">
          <legend className="sr-only">
            Выбор готового примера решения системы
          </legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {developmentPlanDemoScenarios.map((scenario) => {
              const selected = scenario.id === scenarioId;

              return (
                <label
                  className="flex min-w-0 cursor-pointer flex-col rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400/60 has-checked:border-cyan-400/50 has-checked:bg-cyan-400/10"
                  key={scenario.id}
                >
                  <span className="flex items-start gap-3">
                    <input
                      checked={selected}
                      className="mt-1 size-4 shrink-0 accent-cyan-400"
                      name="development-plan-scenario"
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
                    {selected ? "Пример выбран" : "Посмотреть пример"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {(scenarioId === "approval-required" ||
          scenarioId === "forbidden-active-path") && (
          <label className="mt-5 flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 focus-within:ring-2 focus-within:ring-amber-300/60">
            <input
              checked={ownerApprovalGranted}
              className="mt-1 size-4 shrink-0 accent-amber-300"
              onChange={(event) =>
                setOwnerApprovalGranted(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-amber-100">
                Подтверждение Owner предоставлено
              </span>
              <span className="mt-1 block text-xs leading-5 text-amber-100/70">
                {scenarioId === "forbidden-active-path"
                  ? "Проверка deny-by-default: подтверждение Owner не может разрешить системно запрещённый путь."
                  : "Локальный переключатель повторно проверяет пример и ничего не сохраняет."}
              </span>
            </span>
          </label>
        )}
      </SectionCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          className="min-w-0"
          title="Пример плана фичи"
          description="Готовый учебный план, на котором система показывает свои решения."
          action={<StatusBadge tone="success">план проверен</StatusBadge>}
        >
          <dl className="min-w-0 space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500">Фича</dt>
              <dd className="mt-1 font-semibold text-slate-100">
                {result.plan.title}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Цель</dt>
              <dd className="mt-1 leading-6 text-slate-300">
                {result.plan.goal}
              </dd>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">Статус</dt>
                <dd className="mt-1 text-slate-200">
                  {planStatusLabels[result.plan.status]}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">Этапов в плане</dt>
                <dd className="mt-1 text-slate-200">
                  {result.plan.tasks.length}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">Проверяемый этап</dt>
                <dd className="mt-1 break-words text-slate-200">
                  {selectedTask?.title ?? result.input.taskId}
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                Что уже завершено
              </dt>
              <dd className="mt-2">
                <TokenList values={result.input.completedTaskIds} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                Что выполняется сейчас
              </dt>
              <dd className="mt-2">
                <TokenList values={result.input.activeTaskIds} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                Какие файлы разрешено изменять
              </dt>
              <dd className="mt-2">
                <TokenList values={result.input.repositoryAllowlist} />
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          className="min-w-0"
          title="Можно ли переходить к следующему этапу?"
          description="Система проверяет, можно ли безопасно передать этот этап дальше."
        >
          <div className="min-w-0 space-y-4">
            <div
              aria-live="polite"
              className={`rounded-lg border p-5 ${verdictPanelClass[result.decision.verdict]}`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                Решение системы
              </p>
              <p className="mt-2 text-xl font-semibold leading-7">
                {developmentPlanDemoVerdictLabels[result.decision.verdict]}
              </p>
              <p className="mt-3 text-sm leading-6 opacity-80">
                {verdictExplanations[result.decision.verdict]}
              </p>
            </div>

            {result.decision.reasons.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Причины решения
                </h3>
                <ul className="mt-3 min-w-0 space-y-3">
                  {result.decision.reasons.map((reason, index) => (
                    <li
                      className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 p-4"
                      key={`${reason.code}-${reason.path}-${reason.relatedTaskId ?? "none"}-${index}`}
                    >
                      <p className="text-sm leading-6 text-slate-200">
                        {developmentPlanDemoReasonLabels[reason.code]}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                Блокирующие причины отсутствуют.
              </p>
            )}

            <details className="group min-w-0 rounded-lg border border-slate-800 bg-slate-900/40">
              <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-slate-300 marker:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
                Технические подробности решения
              </summary>
              <div className="min-w-0 space-y-4 border-t border-slate-800 p-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    Каноническое значение решения
                  </p>
                  <code className="mt-1 block break-all text-sm font-semibold text-slate-200">
                    {result.decision.verdict}
                  </code>
                </div>

                {result.decision.reasons.length > 0 && (
                  <div className="min-w-0 space-y-3">
                    {result.decision.reasons.map((reason, index) => (
                      <dl
                        className="min-w-0 space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs"
                        key={`${reason.code}-${reason.path}-${reason.relatedTaskId ?? "none"}-technical-${index}`}
                      >
                        <div>
                          <dt className="text-slate-500">Код причины</dt>
                          <dd>
                            <code className="break-all text-rose-200">
                              {reason.code}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Исходное сообщение</dt>
                          <dd className="break-words leading-5 text-slate-300">
                            {reason.message}
                          </dd>
                        </div>
                        {reason.path && (
                          <div>
                            <dt className="text-slate-500">Путь проверки</dt>
                            <dd>
                              <code className="break-all text-slate-300">
                                {reason.path}
                              </code>
                            </dd>
                          </div>
                        )}
                        {reason.relatedTaskId && (
                          <div>
                            <dt className="text-slate-500">
                              Связанная задача
                            </dt>
                            <dd>
                              <code className="break-all text-slate-300">
                                {reason.relatedTaskId}
                              </code>
                            </dd>
                          </div>
                        )}
                      </dl>
                    ))}
                  </div>
                )}

                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      Нормализованные пути
                    </dt>
                    <dd className="mt-2">
                      <TokenList
                        values={result.decision.normalizedAllowedPaths}
                      />
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      Конфликтующие задачи
                    </dt>
                    <dd className="mt-2">
                      <TokenList
                        values={result.decision.conflictingTaskIds}
                      />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      Подтверждение Owner требуется
                    </dt>
                    <dd className="mt-1 text-sm">
                      <BooleanValue
                        value={result.decision.ownerApprovalRequired}
                      />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      Подтверждение Owner учтено
                    </dt>
                    <dd className="mt-1 text-sm">
                      <BooleanValue
                        value={result.decision.ownerApprovalSatisfied}
                      />
                    </dd>
                  </div>
                </dl>
              </div>
            </details>

            <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 p-4 text-sm leading-6 text-fuchsia-100">
              Сейчас это только демонстрация: Codex не запускается, файлы не
              изменяются, Git-команды не выполняются.
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Порядок выполнения этапов"
        description="Этап 2 начинается после необходимых результатов этапа 1. Независимые задачи могут находиться на одном уровне, но конфликтующие файлы всё равно блокируют параллельную работу."
      >
        <div className="min-w-0 space-y-5">
          {result.waves.map((wave, index) => (
            <section className="min-w-0" key={`wave-${index + 1}`}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Этап {index + 1}
                </h3>
                <StatusBadge tone="neutral">
                  этапов на уровне: {wave.length}
                </StatusBadge>
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {wave.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
