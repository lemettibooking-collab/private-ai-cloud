import type {
  DevelopmentTask,
  FeaturePlan,
} from "./contracts/development-plan";
import type {
  DevelopmentTaskAdmissionDecision,
  DevelopmentTaskAdmissionInput,
  DevelopmentTaskAdmissionReasonCode,
  DevelopmentTaskAdmissionVerdict,
} from "./contracts/development-task-policy";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { buildDevelopmentTaskWaves } from "./contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "./contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateDevelopmentTaskAdmission } from "./contracts/development-task-policy.ts";

export const developmentPlanDemoScenarioIds = [
  "allow",
  "dependency-blocked",
  "approval-required",
  "path-conflict",
  "forbidden-active-path",
] as const;

export type DevelopmentPlanDemoScenarioId =
  (typeof developmentPlanDemoScenarioIds)[number];

export type DevelopmentPlanDemoScenario = Readonly<{
  id: DevelopmentPlanDemoScenarioId;
  title: string;
  description: string;
  selectedTaskId: string;
  defaultOwnerApprovalGranted: boolean;
}>;

export type DevelopmentPlanDemoAdmissionInput = Readonly<{
  plan: FeaturePlan;
  taskId: string;
  completedTaskIds: readonly string[];
  activeTaskIds: readonly string[];
  repositoryAllowlist: readonly string[];
  taskOwnerApprovalGranted: boolean;
}>;

export type DevelopmentPlanDemoResult = Readonly<{
  scenario: DevelopmentPlanDemoScenario;
  plan: FeaturePlan;
  waves: readonly (readonly DevelopmentTask[])[];
  input: DevelopmentPlanDemoAdmissionInput;
  decision: DevelopmentTaskAdmissionDecision;
}>;

export const developmentPlanDemoScenarios = [
  {
    id: "allow",
    title: "Следующий этап можно начинать",
    description:
      "Предыдущая работа завершена, конфликта файлов нет, дополнительные решения не нужны.",
    selectedTaskId: "feature-implementation",
    defaultOwnerApprovalGranted: false,
  },
  {
    id: "dependency-blocked",
    title: "Сначала нужно закончить предыдущий этап",
    description:
      "Проверяемый этап зависит от реализации, которая ещё не завершена.",
    selectedTaskId: "unit-tests",
    defaultOwnerApprovalGranted: false,
  },
  {
    id: "approval-required",
    title: "Система ждёт вашего подтверждения",
    description:
      "Этап проверки имеет высокий риск и не будет передан дальше без решения Owner.",
    selectedTaskId: "qa-security-review",
    defaultOwnerApprovalGranted: false,
  },
  {
    id: "path-conflict",
    title: "Два агента затрагивают одни файлы",
    description:
      "Активная проверка уже работает с папкой тестов, поэтому второй этап заблокирован.",
    selectedTaskId: "unit-tests",
    defaultOwnerApprovalGranted: false,
  },
  {
    id: "forbidden-active-path",
    title: "Агент запросил защищённые файлы",
    description:
      "Активный этап запросил .git/config — системный запрет нельзя обойти подтверждением.",
    selectedTaskId: "unit-tests",
    defaultOwnerApprovalGranted: false,
  },
] as const satisfies readonly DevelopmentPlanDemoScenario[];

export const developmentPlanDemoVerdictLabels = {
  deny: "Нет, сначала нужно устранить причину",
  require_approval: "Нужно ваше подтверждение",
  allow: "Да, следующий этап можно начинать",
} as const satisfies Readonly<
  Record<DevelopmentTaskAdmissionVerdict, string>
>;

export const developmentPlanDemoReasonLabels = {
  invalid_input: "Входные данные симуляции некорректны.",
  invalid_plan: "План разработки не прошёл проверку.",
  invalid_task_id: "Идентификатор выбранной задачи некорректен.",
  unknown_task_id: "Выбранная задача отсутствует в плане.",
  invalid_completed_task_ids: "Список завершённых задач некорректен.",
  invalid_active_task_ids: "Список активных задач некорректен.",
  invalid_repository_allowlist: "Список разрешённых путей некорректен.",
  invalid_owner_approval: "Значение подтверждения Owner некорректно.",
  plan_not_approved: "План ещё не утверждён для передачи задач.",
  task_already_completed: "Выбранная задача уже завершена.",
  task_already_active: "Выбранная задача уже активна.",
  task_dependencies_incomplete:
    "Сначала нужно завершить предыдущий этап работы.",
  inconsistent_completed_task_state:
    "Набор завершённых задач нарушает порядок зависимостей.",
  unknown_active_task_id: "Активная задача отсутствует в плане.",
  completed_task_marked_active:
    "Одна задача одновременно отмечена завершённой и активной.",
  invalid_repository_path: "Путь репозитория некорректен.",
  path_outside_repository_allowlist:
    "Путь задачи находится вне разрешённой области репозитория.",
  system_forbidden_path:
    "Один из этапов запросил защищённый системный путь.",
  active_task_path_overlap:
    "Другой активный этап уже работает с теми же файлами.",
  task_declares_owner_approval:
    "Задача явно требует отдельного подтверждения Owner.",
  risk_requires_owner_approval:
    "Уровень риска требует отдельного подтверждения Owner.",
  priority_requires_owner_approval:
    "Приоритет задачи требует отдельного подтверждения Owner.",
  sensitive_path_requires_owner_approval:
    "Чувствительный путь требует отдельного подтверждения Owner.",
} as const satisfies Readonly<
  Record<DevelopmentTaskAdmissionReasonCode, string>
>;

function createTask(
  input: Readonly<{
    id: string;
    sequence: number;
    title: string;
    goal: string;
    allowedPaths: readonly string[];
    dependencyIds: readonly string[];
    riskLevel: DevelopmentTask["riskLevel"];
    priority: DevelopmentTask["priority"];
    requiresOwnerApproval?: boolean;
  }>,
): DevelopmentTask {
  return {
    id: input.id,
    sequence: input.sequence,
    title: input.title,
    goal: input.goal,
    scope: [`Выполнить только этап «${input.title}».`],
    nonGoals: [
      "Не запускать внешние действия.",
      "Не изменять области вне разрешённых путей.",
    ],
    allowedPaths: [...input.allowedPaths],
    acceptanceCriteria: [
      `Этап «${input.title}» имеет проверяемый результат.`,
      "Результат готов к ручному Owner review.",
    ],
    verificationCommands: [
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
    ],
    dependencyIds: [...input.dependencyIds],
    riskLevel: input.riskLevel,
    priority: input.priority,
    requiresOwnerApproval: input.requiresOwnerApproval ?? false,
  };
}

export function createDevelopmentPlanDemoPlan(): FeaturePlan {
  return {
    id: "development-plan-simulator",
    title: "Симулятор плана разработки",
    goal: "Показать безопасный путь от анализа фичи до проверяемого handoff без запуска задач.",
    status: "approved",
    tasks: [
      createTask({
        id: "repository-analysis",
        sequence: 10,
        title: "Анализ репозитория",
        goal: "Определить минимальную область изменений и ограничения.",
        allowedPaths: ["lib/development-plan-demo.ts"],
        dependencyIds: [],
        riskLevel: "low",
        priority: "P3",
      }),
      createTask({
        id: "feature-implementation",
        sequence: 20,
        title: "Реализация изменения",
        goal: "Создать frontend-only симулятор на реальных доменных контрактах.",
        allowedPaths: ["components/domain/development-plan-simulator.tsx"],
        dependencyIds: ["repository-analysis"],
        riskLevel: "medium",
        priority: "P2",
      }),
      createTask({
        id: "unit-tests",
        sequence: 30,
        title: "Unit-тесты",
        goal: "Проверить сценарии pure demo model без React DOM.",
        allowedPaths: ["tests/development-plan-demo.test.mts"],
        dependencyIds: ["feature-implementation"],
        riskLevel: "medium",
        priority: "P3",
      }),
      createTask({
        id: "qa-security-review",
        sequence: 40,
        title: "QA и security review",
        goal: "Проверить качество, безопасность и отсутствие внешних действий.",
        allowedPaths: ["tests"],
        dependencyIds: ["feature-implementation"],
        riskLevel: "high",
        priority: "P1",
      }),
      createTask({
        id: "prepare-handoff",
        sequence: 50,
        title: "Подготовка handoff",
        goal: "Собрать итоговый отчёт для Owner без выполнения Git-операций.",
        allowedPaths: ["app/workflows/development-plan/run/page.tsx"],
        dependencyIds: ["unit-tests", "qa-security-review"],
        riskLevel: "low",
        priority: "P3",
      }),
    ],
  };
}

function getScenario(
  scenarioId: DevelopmentPlanDemoScenarioId,
): DevelopmentPlanDemoScenario {
  const scenario = developmentPlanDemoScenarios.find(
    (candidate) => candidate.id === scenarioId,
  );

  if (!scenario) {
    throw new Error(`Unknown development plan demo scenario: ${scenarioId}`);
  }

  return scenario;
}

export function createDevelopmentPlanDemoAdmissionInput(
  scenarioId: DevelopmentPlanDemoScenarioId,
  ownerApprovalGranted = getScenario(scenarioId).defaultOwnerApprovalGranted,
): DevelopmentPlanDemoAdmissionInput {
  const plan = createDevelopmentPlanDemoPlan();

  switch (scenarioId) {
    case "allow":
      return {
        plan,
        taskId: "feature-implementation",
        completedTaskIds: ["repository-analysis"],
        activeTaskIds: [],
        repositoryAllowlist: ["components/domain"],
        taskOwnerApprovalGranted: ownerApprovalGranted,
      };
    case "dependency-blocked":
      return {
        plan,
        taskId: "unit-tests",
        completedTaskIds: ["repository-analysis"],
        activeTaskIds: [],
        repositoryAllowlist: ["tests"],
        taskOwnerApprovalGranted: ownerApprovalGranted,
      };
    case "approval-required":
      return {
        plan,
        taskId: "qa-security-review",
        completedTaskIds: ["repository-analysis", "feature-implementation"],
        activeTaskIds: [],
        repositoryAllowlist: ["tests"],
        taskOwnerApprovalGranted: ownerApprovalGranted,
      };
    case "path-conflict":
      return {
        plan,
        taskId: "unit-tests",
        completedTaskIds: ["repository-analysis", "feature-implementation"],
        activeTaskIds: ["qa-security-review"],
        repositoryAllowlist: ["tests"],
        taskOwnerApprovalGranted: ownerApprovalGranted,
      };
    case "forbidden-active-path": {
      const forbiddenPathPlan: FeaturePlan = {
        ...plan,
        tasks: plan.tasks.map((task) =>
          task.id === "qa-security-review"
            ? {
                ...task,
                allowedPaths: [".git/config"],
              }
            : task,
        ),
      };

      return {
        plan: forbiddenPathPlan,
        taskId: "unit-tests",
        completedTaskIds: ["repository-analysis", "feature-implementation"],
        activeTaskIds: ["qa-security-review"],
        repositoryAllowlist: ["tests"],
        taskOwnerApprovalGranted: ownerApprovalGranted,
      };
    }
  }
}

export function evaluateDevelopmentPlanDemoScenario(
  scenarioId: DevelopmentPlanDemoScenarioId,
  ownerApprovalGranted = getScenario(scenarioId).defaultOwnerApprovalGranted,
): DevelopmentPlanDemoResult {
  const scenario = getScenario(scenarioId);
  const input = createDevelopmentPlanDemoAdmissionInput(
    scenarioId,
    ownerApprovalGranted,
  );
  const validation = validateAndNormalizeFeaturePlan(input.plan);
  if (!validation.ok) {
    throw new Error(
      `Development plan demo fixture is invalid: ${JSON.stringify(validation.errors)}`,
    );
  }

  const waves = buildDevelopmentTaskWaves(validation.value);
  if (!waves.ok) {
    throw new Error(
      `Development plan demo waves are invalid: ${JSON.stringify(waves.errors)}`,
    );
  }

  const admissionInput: DevelopmentTaskAdmissionInput = {
    plan: validation.value,
    taskId: input.taskId,
    completedTaskIds: [...input.completedTaskIds],
    activeTaskIds: [...input.activeTaskIds],
    repositoryAllowlist: [...input.repositoryAllowlist],
    taskOwnerApprovalGranted: input.taskOwnerApprovalGranted,
  };

  return {
    scenario,
    plan: validation.value,
    waves: waves.value,
    input: {
      plan: validation.value,
      taskId: input.taskId,
      completedTaskIds: [...input.completedTaskIds],
      activeTaskIds: [...input.activeTaskIds],
      repositoryAllowlist: [...input.repositoryAllowlist],
      taskOwnerApprovalGranted: input.taskOwnerApprovalGranted,
    },
    decision: evaluateDevelopmentTaskAdmission(admissionInput),
  };
}
