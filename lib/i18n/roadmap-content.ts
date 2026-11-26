import type { Locale } from "./locale";
import type { DevelopmentExecutionStatus } from "../contracts/development-execution";

// Presentation-only copy for the real read-only B3 roadmap. Never persisted or used for authority.
const en = {
  pageTitle: "Project roadmap", eyebrow: "Development control", description: "Factual milestones, work, gates and Owner decisions. Read-only; live dispatch is blocked.",
  milestones: "Project milestones", current: "Current", next: "Next", blocked: "Blocked", recovery: "Recovery Required", owner: "Owner decision required", tasks: "Roadmap work",
  empty: "No work is explicitly enrolled in the autonomous roadmap.", none: "None", progress: "Progress", attempt: "Attempt", route: "Selected route (not execution)", quality: "Quality", security: "Independent Security / review",
  held: "Held exposure, USD", noRoute: "Not selected", bounded: "This is a bounded selection; work counters cover only the shown items.",
  footnote: "Read-only. Fake proof is not live access. Production/live dispatch is blocked; technical PASS is not final Owner acceptance.",
  nodes: "Development runs", controllerRevision: "Controller revision", completed: "Completed", planned: "Planned", active: "Active", cancelled: "Cancelled",
  not_run: "Not run", pending: "Pending", pass: "PASS", fail_retryable: "Correction required", fail_owner_required: "Owner decision required", hard_stop: "Hard stop",
  planApproval: "FeaturePlan approval", scopeChange: "Scope change", budgetRisk: "Budget / risk increase", architecture: "Architecture change", result: "Final result acceptance",
  nodeStatus: { ready: "Ready", implementing: "Implementing", verifying: "Verifying", reviewing: "Independent review", awaiting_correction: "Awaiting correction", awaiting_owner_decision: "Awaiting Owner", completed: "Completed", blocked: "Blocked", cancelled: "Cancelled" },
} as const;
export type RoadmapContent = Readonly<{ [Key in keyof typeof en]: Key extends "nodeStatus" ? Readonly<Record<DevelopmentExecutionStatus, string>> : string }>;
const ru: RoadmapContent = {
  pageTitle: "Дорожная карта проекта", eyebrow: "Контроль разработки", description: "Фактические этапы, работы, проверки и решения владельца. Только чтение; реальный запуск заблокирован.",
  milestones: "Этапы проекта", current: "Сейчас", next: "Далее", blocked: "Заблокировано", recovery: "Нужно восстановление", owner: "Нужно решение владельца", tasks: "Работы дорожной карты",
  empty: "Нет работ, явно включённых в автономную дорожную карту.", none: "Нет", progress: "Прогресс", attempt: "Попытка", route: "Выбранный маршрут (не запуск)", quality: "Качество", security: "Независимая проверка безопасности",
  held: "Удерживаемая экспозиция, долл. США", noRoute: "Не выбран", bounded: "Показана ограниченная выборка; счётчики работ относятся только к ней.",
  footnote: "Только чтение. Проверка с имитатором не означает допуск к реальному исполнению. Запуск в рабочей среде заблокирован; успешная техническая проверка не заменяет финальное принятие владельцем.",
  nodes: "Циклы разработки", controllerRevision: "Ревизия контроллера", completed: "Завершено", planned: "Запланирован", active: "Активен", cancelled: "Отменён",
  not_run: "Не выполнялась", pending: "Ожидается", pass: "Пройдена", fail_retryable: "Нужно исправление", fail_owner_required: "Нужно решение владельца", hard_stop: "Жёсткая остановка",
  planApproval: "Утверждение плана разработки", scopeChange: "Изменение области работ", budgetRisk: "Увеличение бюджета / риска", architecture: "Изменение архитектуры", result: "Финальное принятие результата",
  nodeStatus: { ready: "Готова", implementing: "Выполняется", verifying: "Проверяется", reviewing: "Независимая проверка", awaiting_correction: "Ожидает исправления", awaiting_owner_decision: "Ожидает владельца", completed: "Завершена", blocked: "Заблокирована", cancelled: "Отменена" },
};
export const roadmapContent: Readonly<Record<Locale, RoadmapContent>> = Object.freeze({
  ru: Object.freeze({ ...ru, nodeStatus: Object.freeze(ru.nodeStatus) }),
  en: Object.freeze({ ...en, nodeStatus: Object.freeze(en.nodeStatus) }),
});
