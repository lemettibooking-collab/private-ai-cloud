import type {
  DevelopmentExecutionBlockingReasonCode,
  DevelopmentExecutionEvent,
  DevelopmentExecutionFailure,
  DevelopmentExecutionFailureReport,
  DevelopmentExecutionNextAction,
  DevelopmentExecutionRun,
  DevelopmentExecutionStatus,
} from "./contracts/development-execution";
import type { DevelopmentTaskAdmissionDecision } from "./contracts/development-task-policy";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createDevelopmentExecutionRun } from "./contracts/development-execution.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { getDevelopmentExecutionNextAction } from "./contracts/development-execution.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { transitionDevelopmentExecutionRun } from "./contracts/development-execution.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeDevelopmentExecutionRun } from "./contracts/development-execution.ts";

export const developmentExecutionDemoScenarioIds = [
  "success_first_attempt",
  "verification_correction_success",
  "review_correction_success",
  "repeated_failure_blocked",
  "attempt_budget_exhausted",
  "owner_decision_required",
  "forbidden_path_blocked",
] as const;

export type DevelopmentExecutionDemoScenarioId =
  (typeof developmentExecutionDemoScenarioIds)[number];

export const developmentExecutionDemoCategories = [
  "neutral",
  "active",
  "success",
  "warning",
  "blocked",
] as const;

export type DevelopmentExecutionDemoCategory =
  (typeof developmentExecutionDemoCategories)[number];

export type DevelopmentExecutionDemoScenario = Readonly<{
  id: DevelopmentExecutionDemoScenarioId;
  title: string;
  description: string;
}>;

export type DevelopmentExecutionDemoStep = Readonly<{
  id: string;
  number: number;
  title: string;
  description: string;
  snapshot: DevelopmentExecutionRun;
  status: DevelopmentExecutionStatus;
  nextAction: DevelopmentExecutionNextAction;
  attemptNumber: number;
  category: DevelopmentExecutionDemoCategory;
  checkedSummary: string;
  failureReason: string | null;
  retryExplanation: string;
  nextDescription: string;
}>;

export type DevelopmentExecutionDemoTimeline = Readonly<{
  scenario: DevelopmentExecutionDemoScenario;
  steps: readonly DevelopmentExecutionDemoStep[];
}>;

export type DevelopmentExecutionDemoBuildError = Readonly<{
  code: "invalid_scenario_id" | "scenario_build_failed";
  message: string;
  reasonCodes: readonly string[];
}>;

export type DevelopmentExecutionDemoResult =
  | Readonly<{ ok: true; value: DevelopmentExecutionDemoTimeline }>
  | Readonly<{ ok: false; error: DevelopmentExecutionDemoBuildError }>;

export const developmentExecutionDemoScenarios = [
  {
    id: "success_first_attempt",
    title: "Успех с первой попытки",
    description: "Изменения, проверки и review проходят без исправлений.",
  },
  {
    id: "verification_correction_success",
    title: "Ошибка тестов → исправление → успех",
    description: "После ошибки проверок система создаёт вторую попытку.",
  },
  {
    id: "review_correction_success",
    title: "Ошибка review → исправление → успех",
    description: "Review возвращает работу на исправление, затем принимает её.",
  },
  {
    id: "repeated_failure_blocked",
    title: "Повторяется одна и та же ошибка",
    description: "Одинаковое замечание останавливает автоматический цикл.",
  },
  {
    id: "attempt_budget_exhausted",
    title: "Исчерпан лимит попыток",
    description: "Три разные ошибки используют весь доступный лимит.",
  },
  {
    id: "owner_decision_required",
    title: "Требуется решение Owner",
    description: "Исправление потребовало бы выйти за разрешённые границы.",
  },
  {
    id: "forbidden_path_blocked",
    title: "Запрещённый путь",
    description: "Системный запрет останавливает задачу до проверок и review.",
  },
] as const satisfies readonly DevelopmentExecutionDemoScenario[];

export const developmentExecutionDemoStatusLabels = {
  ready: "Задача допущена и готова к началу",
  implementing: "Агент подготавливает изменения",
  verifying: "Система проверяет подготовленные изменения",
  reviewing: "Проверки пройдены — идёт review",
  awaiting_correction: "Нужно исправление",
  awaiting_owner_decision: "Требуется решение владельца проекта",
  completed: "Задача успешно завершена",
  blocked: "Автоматический цикл остановлен",
  cancelled: "Задача отменена владельцем проекта",
} as const satisfies Readonly<Record<DevelopmentExecutionStatus, string>>;

export const developmentExecutionDemoNextActionLabels = {
  start_initial_attempt: "Начать первую попытку",
  submit_patch_or_failure: "Подготовить изменения или сообщить об ошибке",
  report_verification: "Сохранить результат обязательных проверок",
  report_review: "Сохранить результат review",
  start_corrective_attempt: "Начать исправление в новой попытке",
  owner_decision_required: "Получить новое решение владельца проекта",
  none: "Автоматических действий больше нет",
} as const satisfies Readonly<Record<DevelopmentExecutionNextAction, string>>;

export const developmentExecutionDemoReasonLabels = {
  admission_not_allowed: "Задача не была допущена к выполнению.",
  admission_task_mismatch: "Допуск относится к другой задаче.",
  invalid_admitted_path: "Разрешённая область содержит некорректный путь.",
  system_forbidden_path:
    "Обнаружен системно запрещённый путь. Обычное подтверждение не может снять этот запрет.",
  path_outside_admitted_scope:
    "Изменение вышло за ранее разрешённые границы задачи.",
  protected_path_modified: "Изменение затрагивает защищённый путь.",
  non_retryable_failure: "Ошибка не допускает автоматическую повторную попытку.",
  repeated_failure:
    "Повторилось то же самое замечание. Автоматическое продолжение остановлено, чтобы агент не тратил ресурсы по кругу.",
  attempt_budget_exhausted:
    "Использованы все три попытки. Требуется участие Owner или разработчика.",
  scope_expansion_required:
    "Продолжение требует выйти за ранее разрешённые границы. Нужно новое решение Owner.",
  invalid_transition: "Сценарий запросил недопустимый переход состояния.",
  invalid_verification_evidence:
    "Результаты обязательных проверок неполны или некорректны.",
  cancelled_by_owner: "Владелец проекта остановил выполнение.",
} as const satisfies Readonly<
  Record<DevelopmentExecutionBlockingReasonCode, string>
>;

type StepPresentation = Readonly<{
  key: string;
  title: string;
  description: string;
  category: DevelopmentExecutionDemoCategory;
  checkedSummary: string;
  failureReason?: string;
  retryExplanation: string;
  nextDescription: string;
}>;

const requiredVerificationCommands = [
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run build",
] as const;

const changedPaths = [
  "components/domain/development-plan-simulator.tsx",
] as const;

function createAdmissionDecision(): DevelopmentTaskAdmissionDecision {
  return {
    verdict: "allow",
    taskId: "feature-implementation",
    reasons: [],
    normalizedAllowedPaths: [...changedPaths],
    conflictingTaskIds: [],
    ownerApprovalRequired: false,
    ownerApprovalSatisfied: false,
  };
}

function createFailure(
  input: Readonly<{
    phase: DevelopmentExecutionFailureReport["phase"];
    code: string;
    fingerprint: string;
    summary: string;
    retryable?: boolean;
    scopeExpansionRequired?: boolean;
  }>,
): DevelopmentExecutionFailureReport {
  return {
    phase: input.phase,
    code: input.code,
    fingerprint: input.fingerprint,
    summary: input.summary,
    retryable: input.retryable ?? true,
    scopeExpansionRequired: input.scopeExpansionRequired ?? false,
    protectedPathViolation: false,
    systemForbiddenPathViolation: false,
  };
}

function createPassedChecks() {
  return requiredVerificationCommands.map((command) => ({
    command,
    exitCode: 0,
  }));
}

function createBuildError(
  message: string,
  reasonCodes: readonly string[],
): DevelopmentExecutionDemoResult {
  return {
    ok: false,
    error: {
      code: "scenario_build_failed",
      message,
      reasonCodes: [...reasonCodes],
    },
  };
}

function isScenarioId(input: unknown): input is DevelopmentExecutionDemoScenarioId {
  return (
    typeof input === "string" &&
    developmentExecutionDemoScenarioIds.some((scenarioId) => scenarioId === input)
  );
}

function getScenario(
  scenarioId: DevelopmentExecutionDemoScenarioId,
): DevelopmentExecutionDemoScenario | null {
  return (
    developmentExecutionDemoScenarios.find(
      (scenario) => scenario.id === scenarioId,
    ) ?? null
  );
}

function appendStep(
  steps: DevelopmentExecutionDemoStep[],
  scenarioId: DevelopmentExecutionDemoScenarioId,
  run: DevelopmentExecutionRun,
  presentation: StepPresentation,
): DevelopmentExecutionDemoResult | null {
  const validation = validateAndNormalizeDevelopmentExecutionRun(run);
  if (!validation.ok) {
    return createBuildError(
      "AI-011 отклонил snapshot учебного сценария.",
      validation.errors.map((error) => error.code),
    );
  }

  const nextAction = getDevelopmentExecutionNextAction(validation.value);
  if (!nextAction.ok) {
    return createBuildError(
      "AI-011 не смог определить следующее безопасное действие.",
      nextAction.errors.map((error) => error.code),
    );
  }

  if (nextAction.value !== validation.value.nextAction) {
    return createBuildError(
      "Snapshot и вычисленное следующее действие AI-011 не совпали.",
      ["invalid_transition"],
    );
  }

  steps.push({
    id: `${scenarioId}-${presentation.key}`,
    number: steps.length + 1,
    title: presentation.title,
    description: presentation.description,
    snapshot: validation.value,
    status: validation.value.status,
    nextAction: nextAction.value,
    attemptNumber: validation.value.currentAttemptNumber,
    category: presentation.category,
    checkedSummary: presentation.checkedSummary,
    failureReason: presentation.failureReason ?? null,
    retryExplanation: presentation.retryExplanation,
    nextDescription: presentation.nextDescription,
  });

  return null;
}

function applyTransition(
  steps: DevelopmentExecutionDemoStep[],
  scenarioId: DevelopmentExecutionDemoScenarioId,
  run: DevelopmentExecutionRun,
  event: DevelopmentExecutionEvent,
  presentation: StepPresentation,
): { ok: true; value: DevelopmentExecutionRun } | { ok: false; result: DevelopmentExecutionDemoResult } {
  const transition = transitionDevelopmentExecutionRun(run, event);
  if (!transition.ok) {
    return {
      ok: false,
      result: createBuildError(
        "AI-011 отклонил ожидаемый переход учебного сценария.",
        transition.errors.map((error) => error.code),
      ),
    };
  }

  const stepError = appendStep(
    steps,
    scenarioId,
    transition.value,
    presentation,
  );
  return stepError
    ? { ok: false, result: stepError }
    : { ok: true, value: transition.value };
}

function buildScenario(
  scenario: DevelopmentExecutionDemoScenario,
): DevelopmentExecutionDemoResult {
  const creation = createDevelopmentExecutionRun({
    id: `demo-${scenario.id}`,
    planId: "development-plan-simulator",
    taskId: "feature-implementation",
    admissionDecision: createAdmissionDecision(),
    requiredVerificationCommands: [...requiredVerificationCommands],
    protectedPaths: ["lib/contracts"],
  });
  if (!creation.ok) {
    return createBuildError(
      "AI-011 не создал учебный запуск.",
      creation.errors.map((error) => error.code),
    );
  }

  const steps: DevelopmentExecutionDemoStep[] = [];
  const initialStepError = appendStep(steps, scenario.id, creation.value, {
    key: "admitted",
    title: "Задача допущена",
    description:
      "Границы задачи и обязательные проверки приняты. Реальное выполнение не запускалось.",
    category: "neutral",
    checkedSummary: "Проверены допуск задачи и разрешённые пути.",
    retryExplanation: "Попытки ещё не начались.",
    nextDescription: "Система может начать первую попытку.",
  });
  if (initialStepError) {
    return initialStepError;
  }

  let run = creation.value;
  const transition = (
    event: DevelopmentExecutionEvent,
    presentation: StepPresentation,
  ): DevelopmentExecutionDemoResult | null => {
    const result = applyTransition(steps, scenario.id, run, event, presentation);
    if (!result.ok) {
      return result.result;
    }
    run = result.value;
    return null;
  };

  const startAttempt = (attemptNumber: number): DevelopmentExecutionDemoResult | null =>
    transition(
      { type: "start_attempt" },
      {
        key: `attempt-${attemptNumber}-started`,
        title:
          attemptNumber === 1
            ? "Началась первая попытка"
            : `Началась попытка ${attemptNumber} из 3`,
        description:
          attemptNumber === 1
            ? "Агенту разрешено подготовить изменения в заданных границах."
            : "Система создала отдельную корректирующую попытку после исправимой ошибки.",
        category: "active",
        checkedSummary: "Проверки и review для этой попытки ещё не начались.",
        retryExplanation:
          attemptNumber === 1
            ? "Это первая попытка."
            : "Новая попытка создана по правилам AI-011.",
        nextDescription: "Дальше ожидается подготовка изменений.",
      },
    );

  const submitPatch = (
    attemptNumber: number,
    corrective: boolean,
  ): DevelopmentExecutionDemoResult | null =>
    transition(
      { type: "submit_patch", changedPaths: [...changedPaths] },
      {
        key: `attempt-${attemptNumber}-patch`,
        title: corrective ? "Исправление подготовлено" : "Изменения подготовлены",
        description: corrective
          ? "Корректирующие изменения остаются внутри ранее разрешённых границ."
          : "Подготовленные изменения находятся внутри разрешённой области задачи.",
        category: "active",
        checkedSummary: "Проверена область изменённых путей; команды ещё не выполнялись.",
        retryExplanation: corrective
          ? "Сейчас выполняется корректирующая попытка."
          : "Новая попытка пока не нужна.",
        nextDescription: "Дальше нужно получить результаты обязательных проверок.",
      },
    );

  const verificationPassed = (
    attemptNumber: number,
  ): DevelopmentExecutionDemoResult | null =>
    transition(
      { type: "verification_passed", checks: createPassedChecks() },
      {
        key: `attempt-${attemptNumber}-verification-passed`,
        title: "Обязательные проверки пройдены",
        description:
          "В snapshot сохранены успешные результаты всех обязательных проверок учебного сценария.",
        category: "success",
        checkedSummary: "Lint, типы, unit-тесты и build отмечены успешными.",
        retryExplanation: "Исправление по результатам проверок не требуется.",
        nextDescription: "Отдельный review должен оценить результат.",
      },
    );

  const reviewPassed = (
    attemptNumber: number,
  ): DevelopmentExecutionDemoResult | null =>
    transition(
      { type: "review_passed" },
      {
        key: `attempt-${attemptNumber}-review-passed`,
        title: "Review пройден — задача завершена",
        description:
          "AI-011 завершил задачу только после сохранённых успешных проверок и положительного review.",
        category: "success",
        checkedSummary: "Все обязательные проверки и review отмечены успешными.",
        retryExplanation: "Новая попытка не нужна.",
        nextDescription: "Автоматических действий больше нет.",
      },
    );

  const reportFailure = (
    attemptNumber: number,
    phase: "verification" | "review",
    fingerprint: string,
    summary: string,
    finalExplanation?: string,
  ): DevelopmentExecutionDemoResult | null => {
    const event =
      phase === "verification"
        ? ({
            type: "verification_failed",
            failure: createFailure({
              phase,
              code: "demo_check_failed",
              fingerprint,
              summary,
            }),
          } as const)
        : ({
            type: "review_failed",
            failure: createFailure({
              phase,
              code: "demo_review_issue",
              fingerprint,
              summary,
            }),
          } as const);

    return transition(event, {
      key: `attempt-${attemptNumber}-${phase}-failed`,
      title:
        phase === "verification"
          ? "Проверка нашла ошибку"
          : "Review нашёл проблему",
      description: summary,
      category: finalExplanation ? "blocked" : "warning",
      checkedSummary:
        phase === "verification"
          ? "Review не начался, потому что обязательная проверка не прошла."
          : "Обязательные проверки прошли, но review не принял результат.",
      failureReason: finalExplanation ?? summary,
      retryExplanation: finalExplanation
        ? "Новая автоматическая попытка не создаётся."
        : "Ошибка исправима, поэтому разрешена новая попытка.",
      nextDescription: finalExplanation
        ? "Нужно участие Owner или разработчика."
        : "Система может начать корректирующую попытку.",
    });
  };

  let error: DevelopmentExecutionDemoResult | null;
  error = startAttempt(1);
  if (error) return error;

  if (scenario.id === "owner_decision_required") {
    error = transition(
      {
        type: "implementation_failed",
        failure: createFailure({
          phase: "implementation",
          code: "scope_change_needed",
          fingerprint: "implementation/scope-change-needed",
          summary:
            "Для продолжения потребовалось бы изменить файлы вне ранее разрешённой области.",
          scopeExpansionRequired: true,
        }),
      },
      {
        key: "owner-decision-required",
        title: "Нужно новое решение Owner",
        description:
          "Задача требует выйти за ранее разрешённые границы, поэтому автоматическое исправление не начинается.",
        category: "warning",
        checkedSummary: "Проверки и review не начались.",
        failureReason: developmentExecutionDemoReasonLabels.scope_expansion_required,
        retryExplanation: "Новая автоматическая попытка не создаётся.",
        nextDescription:
          "Owner должен отдельно пересмотреть границы задачи; эта демонстрация их не меняет.",
      },
    );
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  if (scenario.id === "forbidden_path_blocked") {
    error = transition(
      { type: "submit_patch", changedPaths: [".git/config"] },
      {
        key: "system-forbidden-path",
        title: "Системный запрет остановил задачу",
        description:
          "Путь .git/config запрещён политикой системы. Задача остановлена до проверок и review.",
        category: "blocked",
        checkedSummary: "Проверки и review не запускались.",
        failureReason: developmentExecutionDemoReasonLabels.system_forbidden_path,
        retryExplanation: "Новая попытка не создаётся.",
        nextDescription:
          "Обычное подтверждение не может обойти системный запрет.",
      },
    );
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  error = submitPatch(1, false);
  if (error) return error;

  if (scenario.id === "success_first_attempt") {
    error = verificationPassed(1);
    if (error) return error;
    error = reviewPassed(1);
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  if (scenario.id === "verification_correction_success") {
    error = reportFailure(
      1,
      "verification",
      "verification/unit-test-failure",
      "В демонстрационном результате один unit-тест не прошёл.",
    );
    if (error) return error;
    error = startAttempt(2);
    if (error) return error;
    error = submitPatch(2, true);
    if (error) return error;
    error = verificationPassed(2);
    if (error) return error;
    error = reviewPassed(2);
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  error = verificationPassed(1);
  if (error) return error;

  if (scenario.id === "review_correction_success") {
    error = reportFailure(
      1,
      "review",
      "review/missing-empty-state",
      "Review заметил, что для пустого состояния не хватает понятного объяснения.",
    );
    if (error) return error;
    error = startAttempt(2);
    if (error) return error;
    error = submitPatch(2, true);
    if (error) return error;
    error = verificationPassed(2);
    if (error) return error;
    error = reviewPassed(2);
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  if (scenario.id === "repeated_failure_blocked") {
    error = reportFailure(
      1,
      "review",
      "review/repeated-accessibility-gap",
      "Review нашёл проблему с доступностью элемента управления.",
    );
    if (error) return error;
    error = startAttempt(2);
    if (error) return error;
    error = submitPatch(2, true);
    if (error) return error;
    error = verificationPassed(2);
    if (error) return error;
    error = reportFailure(
      2,
      "review",
      "review/repeated-accessibility-gap",
      "Review снова нашёл ту же проблему с доступностью.",
      developmentExecutionDemoReasonLabels.repeated_failure,
    );
    if (error) return error;
    return { ok: true, value: { scenario, steps } };
  }

  const failureFingerprints = [
    "review/missing-owner-copy",
    "review/missing-focus-marker",
    "review/missing-mobile-wrap",
  ] as const;
  const failureSummaries = [
    "Review запросил более понятное объяснение для Owner.",
    "Review нашёл недостаточно заметный текстовый маркер фокуса.",
    "Review нашёл переполнение на узком экране.",
  ] as const;

  error = reportFailure(
    1,
    "review",
    failureFingerprints[0],
    failureSummaries[0],
  );
  if (error) return error;

  for (const attemptNumber of [2, 3] as const) {
    error = startAttempt(attemptNumber);
    if (error) return error;
    error = submitPatch(attemptNumber, true);
    if (error) return error;
    error = verificationPassed(attemptNumber);
    if (error) return error;
    error = reportFailure(
      attemptNumber,
      "review",
      failureFingerprints[attemptNumber - 1],
      failureSummaries[attemptNumber - 1],
      attemptNumber === 3
        ? developmentExecutionDemoReasonLabels.attempt_budget_exhausted
        : undefined,
    );
    if (error) return error;
  }

  return { ok: true, value: { scenario, steps } };
}

export function getDevelopmentExecutionDemoCurrentAttemptFailure(
  run: DevelopmentExecutionRun,
): DevelopmentExecutionFailure | null {
  const currentAttempt = run.attempts.find(
    (attempt) => attempt.number === run.currentAttemptNumber,
  );
  if (!currentAttempt) {
    return null;
  }

  return (
    run.failures.find(
      (failure) => failure.attemptNumber === currentAttempt.number,
    ) ?? null
  );
}

export function getDevelopmentExecutionDemoHistoricalFailures(
  run: DevelopmentExecutionRun,
): readonly DevelopmentExecutionFailure[] {
  return run.failures
    .filter((failure) => failure.attemptNumber < run.currentAttemptNumber)
    .map((failure) => ({ ...failure }));
}

export function createDevelopmentExecutionDemoScenario(
  scenarioIdInput: unknown,
): DevelopmentExecutionDemoResult {
  if (!isScenarioId(scenarioIdInput)) {
    return {
      ok: false,
      error: {
        code: "invalid_scenario_id",
        message: "Неизвестный сценарий отклонён. Демонстрация не запущена.",
        reasonCodes: ["invalid_scenario_id"],
      },
    };
  }

  const scenario = getScenario(scenarioIdInput);
  if (scenario === null) {
    return {
      ok: false,
      error: {
        code: "invalid_scenario_id",
        message: "Неизвестный сценарий отклонён. Демонстрация не запущена.",
        reasonCodes: ["invalid_scenario_id"],
      },
    };
  }

  try {
    return buildScenario({ ...scenario });
  } catch {
    return createBuildError("Учебный сценарий не удалось безопасно построить.", [
      "invalid_transition",
    ]);
  }
}
