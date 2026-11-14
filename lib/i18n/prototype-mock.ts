import type { Locale } from "./locale";
import type { ApprovalStatus, WorkflowRunStatus } from "../contracts/domain";
import type { ApprovalRequest, AuditEvent } from "../../types/approval";
import type { Department, DocumentIntelligenceCapability, KnowledgeOpsBlock, OwnerReportSummary, Report, StatusTone } from "../../types/app";
import type { KnowledgeDocument, SourceCitation } from "../../types/knowledge";
import type { WorkflowAvailability, WorkflowGroup, WorkflowLifecycleStep, WorkflowPreview, WorkflowRun } from "../../types/workflow";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import * as mock from "../mock-data.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { workflowPreviews } from "../workflow-config.ts";

// AI-038.6 L10N-1: localized PROTOTYPE data for the mock-data pages (Knowledge, Chat, Workflows,
// Departments, Reports, approval / workflow-run detail). English is the existing mock data unchanged.
// Russian mirrors it 1:1: ids, hrefs, status tokens, tones, numbers and flags are copied from the
// English source; only human-readable text is replaced. A missing or extra entry throws at load time
// (never a silent English fallback). Status tokens are displayed through the label maps below.

type MockContent = Readonly<{
  documents: readonly KnowledgeDocument[];
  sourceCitations: readonly SourceCitation[];
  departments: readonly Department[];
  workflowGroups: readonly WorkflowGroup[];
  workflowLifecycleSteps: readonly WorkflowLifecycleStep[];
  workflowRuns: readonly WorkflowRun[];
  approvals: readonly ApprovalRequest[];
  weeklyOwnerReportSummary: OwnerReportSummary;
  reports: readonly Report[];
  knowledgeOpsBlocks: readonly KnowledgeOpsBlock[];
  documentIntelligenceCapabilities: readonly DocumentIntelligenceCapability[];
  chatThreads: readonly { id: string; title: string; assistant: string; updatedAt: string }[];
  chatMessages: readonly { id: string; role: string; author: string; body: string; timestamp: string }[];
  auditEvents: readonly AuditEvent[];
  workflowPreviews: Readonly<Record<string, WorkflowPreview>>;
  labels: Readonly<{
    documentStatus: Readonly<Record<KnowledgeDocument["status"], string>>;
    approvalStatus: Readonly<Record<ApprovalStatus, string>>;
    risk: Readonly<Record<ApprovalRequest["riskLevel"], string>>;
    runStatus: Readonly<Record<WorkflowRunStatus, string>>;
    tone: Readonly<Record<StatusTone, string>>;
    confidence: Readonly<Record<string, string>>;
    reportStatus: Readonly<Record<string, string>>;
    departmentStatus: Readonly<Record<Department["status"], string>>;
    availability: Readonly<Record<WorkflowAvailability, string>>;
    capabilityStatus: Readonly<Record<DocumentIntelligenceCapability["status"], string>>;
  }>;
}>;

function byKey<T, R>(source: readonly T[], translations: Readonly<Record<string, R>>, key: (item: T) => string, name: string, apply: (item: T, text: R) => T): readonly T[] {
  if (Object.keys(translations).length !== source.length) throw new Error(`Russian prototype data for ${name} is out of sync.`);
  return Object.freeze(source.map((item) => {
    const text = translations[key(item)];
    if (!text) throw new Error(`Russian prototype data for ${name} is missing ${key(item)}.`);
    return apply(item, text);
  }));
}
function byIndex<T, R>(source: readonly T[], translations: readonly R[], name: string, apply: (item: T, text: R) => T): readonly T[] {
  if (source.length !== translations.length) throw new Error(`Russian prototype data for ${name} is out of sync.`);
  return Object.freeze(source.map((item, index) => apply(item, translations[index])));
}

// Collections / roles / document names that appear inside the data (shared vocabulary).
const ruCollection: Readonly<Record<string, string>> = {
  Product: "Продукт", Support: "Поддержка", Content: "Контент", Engineering: "Разработка", Policies: "Политики", QA: "QA",
};
const ruPerson: Readonly<Record<string, string>> = {
  Owner: "Владелец", Admin: "Администратор", "Product Manager": "Продакт-менеджер", "Support Operator": "Оператор поддержки",
  "Marketing Operator": "Оператор маркетинга", "Developer / Reviewer": "Разработчик / ревьюер", "Codex Orchestrator": "Оркестратор Codex",
  "Owner Analyst": "Аналитик владельца", "Sales Assistant": "Ассистент продаж", "Sales Operator": "Оператор продаж", "QA Reviewer": "QA-ревьюер",
  "System Policy": "Системная политика", "Support Lead": "Руководитель поддержки", "Support Assistant": "Ассистент поддержки",
  "Content Assistant": "Контент-ассистент", "Product Assistant": "Продуктовый ассистент", System: "Система",
};
const ruDocumentName: Readonly<Record<string, string>> = {
  "Smart Algorithms Roadmap": "Дорожная карта Smart Algorithms", "Scanner MVP Checklist": "Чек-лист MVP Scanner", "Support FAQ": "FAQ поддержки",
  "SEO Strategy": "SEO-стратегия", "Codex Task Template": "Шаблон задачи Codex", "System Policy": "Системная политика",
};
const person = (value: string) => ruPerson[value] ?? value;
const docName = (value: string) => ruDocumentName[value] ?? value;
const ruTime: Readonly<Record<string, string>> = {
  "Today, 10:20": "Сегодня, 10:20", "Today, 09:45": "Сегодня, 09:45", "Yesterday, 17:30": "Вчера, 17:30", "Yesterday, 13:12": "Вчера, 13:12",
  "10 min ago": "10 мин назад", "11 min ago": "11 мин назад", "12 min ago": "12 мин назад", "8 min ago": "8 мин назад", "19 min ago": "19 мин назад",
  "35 min ago": "35 мин назад", "38 min ago": "38 мин назад", "46 min ago": "46 мин назад", "1 hour ago": "1 ч назад", "2 hours ago": "2 ч назад",
  "3 hours ago": "3 ч назад", "2 days ago": "2 дня назад", Yesterday: "Вчера", Today: "Сегодня", Now: "Сейчас", Policy: "Политика",
};
const time = (value: string) => ruTime[value] ?? value;
const size = (value: string) => value.replace(" KB", " КБ");
const duration = (value: string) => value.replace(/(\d+)m /u, "$1 мин ").replace(/(\d+)s$/u, "$1 с");

const ruDocuments: Readonly<Record<string, { sourcePreview: string; indexingNote: string }>> = {
  roadmap: { sourcePreview: "Приоритеты дорожной карты: центр AI-операций, исполнение процессов через согласование, ответы поддержки на основе RAG.", indexingNote: "Проиндексирован и доступен для RAG-ответов." },
  "scanner-checklist": { sourcePreview: "Чек-лист охватывает локальную проверку, видимость статусов, ревью владельца и команды проверки прототипа.", indexingNote: "Проиндексирован с тегами продуктового контекста." },
  "support-faq": { sourcePreview: "Ответы должны опираться на коллекции поддержки и эскалироваться, если контекста базы знаний недостаточно.", indexingNote: "Проиндексирован и используется Ассистентом поддержки." },
  "seo-strategy": { sourcePreview: "Черновик контент-стратегии: обучение продукту, пояснения для Telegram и посты с техническим сравнением.", indexingNote: "Ошибка индексации: неподдерживаемое извлечение таблиц. Нужен повтор." },
  "codex-template": { sourcePreview: "Шаблон включает контекст, цель, ограничения, команды проверки и ожидания к итоговому отчёту.", indexingNote: "Индексация выполняется. Пока недоступен для RAG-ответов." },
};

const ruCitations: Readonly<Record<string, { excerpt: string }>> = {
  "citation-roadmap": { excerpt: "Private AI Cloud должен показывать согласования и журнал аудита до включения внешних действий." },
  "citation-support": { excerpt: "Если контекста базы знаний недостаточно, ассистент должен сказать об этом и не выдумывать операционные детали." },
};

const ruDepartments: Readonly<Record<string, { title: string; description: string; primaryAssistant: string; keyWorkflows: string[]; approvalRequirement: string; integrationsLater: string[] }>> = {
  support: { title: "AI-отдел поддержки", description: "Готовит ответы поддержки на основе источников и эскалирует вопросы вне FAQ.", primaryAssistant: "Ассистент поддержки", keyWorkflows: ["Ответ из базы знаний", "Ответ поддержки"], approvalRequirement: "Внешние ответы требуют согласования человеком.", integrationsLater: ["Чат на сайте", "Электронная почта", "Система обращений"] },
  "marketing-growth": { title: "AI-отдел маркетинга и роста", description: "Готовит контент для Telegram, ищет боли аудитории и собирает сводки роста.", primaryAssistant: "Контент-ассистент", keyWorkflows: ["Контент для Telegram", "Маркетинговые хуки / поиск болей"], approvalRequirement: "Публикация закрыта до одобрения владельца.", integrationsLater: ["Telegram-бот", "Аналитика", "CMS"] },
  community: { title: "AI-отдел работы с сообществом", description: "Отслеживает обсуждения и готовит официальные комментарии без автопубликации.", primaryAssistant: "Ассистент сообщества", keyWorkflows: ["Мониторинг обсуждений", "Черновик официального комментария"], approvalRequirement: "Все публичные комментарии требуют согласования.", integrationsLater: ["Telegram-группы", "Форумы", "Мониторинг соцсетей"] },
  sales: { title: "AI-отдел продаж", description: "Собирает лиды, квалифицирует намерение и готовит повторные письма.", primaryAssistant: "Ассистент продаж", keyWorkflows: ["Приём лидов", "Квалификация лидов", "Черновик повторного письма"], approvalRequirement: "Коммерческие обращения требуют согласования владельца или отдела продаж.", integrationsLater: ["Формы", "CRM позже", "Электронная почта"] },
  "customer-success": { title: "AI-отдел успеха клиентов / допродаж", description: "Анализирует активность, выявляет риск оттока и рекомендует онбординг или допродажи.", primaryAssistant: "Ассистент успеха клиентов", keyWorkflows: ["Выявление риска оттока", "Черновик сообщения о допродаже"], approvalRequirement: "Сообщения клиентам требуют согласования человеком.", integrationsLater: ["События использования", "Биллинг позже", "Электронная почта"] },
  product: { title: "AI-отдел продукта", description: "Превращает обратную связь в группы дорожной карты, пользовательские истории, заметки о релизах и задачи Codex.", primaryAssistant: "Продуктовый ассистент", keyWorkflows: ["Задача продукта / Codex", "Анализ запросов на функции"], approvalRequirement: "Дорожная карта и передача задач требуют продуктового ревью.", integrationsLater: ["Задачи GitHub", "Документация", "Доска дорожной карты"] },
  development: { title: "AI-отдел разработки / оркестрации Codex", description: "Готовит промпты Codex, сводки передачи и представления для сбора результатов.", primaryAssistant: "Оркестратор Codex", keyWorkflows: ["Промпт задачи Codex", "Сводка передачи", "Сбор результатов"], approvalRequirement: "Запуск Codex и локальное исполнение остаются за согласованием.", integrationsLater: ["Codex", "GitHub", "Локальный исполнитель"] },
  "qa-review": { title: "AI-отдел QA / код-ревью", description: "Проверяет диффы, результаты проверок, риски QA и чек-листы ручного смоук-теста.", primaryAssistant: "QA-ревьюер", keyWorkflows: ["Отчёт QA-ревью", "Анализ рисков диффа"], approvalRequirement: "Приёмка кода фиксируется; слияние остаётся ручным.", integrationsLater: ["Проверки GitHub", "Браузерный смоук-раннер", "CI"] },
  executive: { title: "AI-отдел аналитики для руководства", description: "Сводит внимание владельца, блокеры, рекомендации и точки принятия решений.", primaryAssistant: "Аналитик владельца", keyWorkflows: ["Еженедельный отчёт владельца", "Сводка точек решений"], approvalRequirement: "Владелец просматривает рекомендации до действий.", integrationsLater: ["Хранилище данных использования", "Финансы позже", "Экспорт в BI"] },
  legal: { title: "AI-отдел юридических документов", description: "Делает сводки документов, извлекает риски, сравнивает версии и готовит вопросы юристу.", primaryAssistant: "Ассистент по юридическим документам", keyWorkflows: ["Сводка документа", "Извлечение рисков", "Сравнение версий"], approvalRequirement: "Юридические результаты только для ревью и никогда не применяются автоматически.", integrationsLater: ["Хранилище документов", "Электронная подпись позже", "Юридическое ревью"] },
};

const ruGroups: Readonly<Record<string, { title: string; description: string; workflows: readonly (readonly [string, string])[] }>> = {
  mvp: { title: "Процессы MVP", description: "Первые демо-процессы Smart Algorithms, которые можно открыть из этого прототипа.", workflows: [
    ["База знаний", "Отвечает строго по выбранным проиндексированным коллекциям."],
    ["Ответ поддержки", "Готовит ответ поддержки со ссылками и заметками об эскалации."],
    ["Контент для Telegram", "Готовит пост для Telegram из продуктового и контентного контекста."],
    ["Задача продукта / Codex", "Превращает продуктовый запрос в промпт задачи для Codex."],
    ["Отчёт QA / ревью", "Сводит диф и сигналы QA с рекомендацией по ревью."],
  ] },
  "marketing-growth": { title: "Маркетинг и рост", description: "Контент-план, поиск болей и отчётность по росту.", workflows: [
    ["Маркетинговые хуки / поиск болей", "Извлекает боли аудитории из согласованных заметок-источников."],
    ["Контент-план", "Формирует темы контента на неделю и черновики брифов."],
    ["Отчёт о росте", "Сводит динамику, эффективность контента и следующие эксперименты."],
  ] },
  community: { title: "Работа с сообществом", description: "Мониторинг публичных обсуждений и черновики ответов для репутации.", workflows: [
    ["Мониторинг обсуждений", "Отслеживает повторяющиеся темы и вопросы в каналах сообщества."],
    ["Черновик официального комментария", "Готовит публичный ответ для проверки человеком."],
    ["Мониторинг репутации", "Отмечает риски, недопонимания и срочные вопросы для владельца."],
  ] },
  sales: { title: "Продажи", description: "Приём лидов, квалификация, повторные письма и черновики предложений.", workflows: [
    ["Приём лидов", "Нормализует входящие данные лида в запись для проверки."],
    ["Квалификация лидов", "Оценивает соответствие, срочность, признаки бюджета и недостающие вопросы."],
    ["Черновик повторного письма", "Готовит ответ на согласование владельцу или отделу продаж."],
    ["Черновик коммерческого предложения", "Готовит текст предложения по согласованным источникам о ценах и объёме."],
  ] },
  "customer-success": { title: "Успех клиентов / допродажи", description: "Анализ использования, сигналы оттока, онбординг и черновики допродаж.", workflows: [
    ["Анализ активности пользователей", "Сводит активность аккаунта и пробелы во внедрении."],
    ["Выявление риска оттока", "Находит низкую вовлечённость и нерешённые блокеры."],
    ["Выявление потенциала Pro", "Находит аккаунты, которым, вероятно, пригодятся платные возможности."],
    ["Черновик сообщения о допродаже", "Готовит аккуратное сообщение клиенту об апгрейде."],
    ["Рекомендация по онбордингу", "Рекомендует следующие шаги настройки по использованию и контексту знаний."],
  ] },
  product: { title: "Продукт", description: "Анализ обратной связи, группировка дорожной карты, истории и релизы.", workflows: [
    ["Анализ запросов на функции", "Группирует запросы по боли, влиянию и предлагаемому приоритету."],
    ["Группировка дорожной карты", "Объединяет продуктовые сигналы в темы дорожной карты для ревью владельца."],
    ["Черновик пользовательской истории", "Создаёт пользовательскую историю с критериями приёмки."],
    ["Чек-лист релиза", "Готовит проверки готовности релиза и заметки для коммуникации."],
  ] },
  development: { title: "Разработка / Codex", description: "Промпты Codex, контекст передачи и сбор результатов исполнения.", workflows: [
    ["Промпт задачи Codex", "Готовит ограничения, контекст и команды проверки."],
    ["Сводка передачи", "Сводит работу для следующего шага реализации или ревью."],
    ["Сбор результатов", "Собирает результаты, изменённые файлы, проверки и остаточные риски."],
  ] },
  qa: { title: "QA / код-ревью", description: "Отчёты ревью, риски диффа и чек-листы ручного QA.", workflows: [
    ["Отчёт QA-ревью", "Сводит находки ревью и рекомендации: одобрить, доработать или отклонить."],
    ["Анализ рисков диффа", "Подсвечивает рискованные файлы, изменения поведения и недостающие тесты."],
    ["Чек-лист ручного QA", "Формирует чек-лист оператора для ручной проверки."],
    ["Чек-лист браузерного смоук-теста", "Готовит ключевые маршруты браузера и визуальные состояния для проверки."],
  ] },
  executive: { title: "Аналитика для руководства", description: "Отчёты владельца, ежедневные отчёты и сводки точек решений.", workflows: [
    ["Еженедельный отчёт владельца", "Сводит операции, блокеры, риски и рекомендации."],
    ["Ежедневный отчёт позже", "Ежедневная сводка для внимания владельца и операционных изменений."],
    ["Сводка точек решений", "Выделяет явные решения владельца из отчётов и согласований."],
  ] },
  legal: { title: "Юридические документы", description: "Сводки документов, риски, сравнение версий и вопросы юристу.", workflows: [
    ["Сводка документа", "Делает сводку договоров и длинных документов для ревью."],
    ["Извлечение рисков", "Извлекает обязательства, исключения и неясные условия."],
    ["Сравнение версий", "Сравнивает две версии документа и отмечает существенные изменения."],
    ["Проверка по чек-листу", "Проверяет документ по согласованному владельцем чек-листу."],
    ["Черновик вопросов юристу", "Готовит вопросы юристу по извлечённым рискам."],
  ] },
};

const ruLifecycle: Readonly<Record<WorkflowLifecycleStep["status"], string>> = {
  input: "Ввод", retrieving: "Источники", generating: "Результат AI", risk: "Проверка рисков", approval: "Согласование", export: "Экспорт / внешнее действие",
};

const ruRuns: Readonly<Record<string, { title: string; outputPreview: string }>> = {
  "run-1042": { title: "Ответ по онбордингу Scanner", outputPreview: "Черновик ответа сформирован по FAQ поддержки и чек-листу MVP Scanner." },
  "run-1041": { title: "Пост об AI-операциях через согласование", outputPreview: "Черновик поста для Telegram готов к проверке рисков и ручному согласованию." },
  "run-1039": { title: "Ревью прототипа очереди согласований", outputPreview: "QA-ревью рекомендует одобрить после проверки lint/build." },
};

const ruApprovals: Readonly<Record<string, { title: string; actionType: string; preview: string; auditHint: string; originalOutput?: string; editedOutput?: string; finalOutput?: string; riskNotes: string[] }>> = {
  "approval-501": {
    title: "Публикация поста в Telegram", actionType: "публикация поста в Telegram",
    preview: "Пост объясняет AI-операции через согласование. Внешняя публикация в MVP закрыта.",
    auditHint: "Сформировано, проверены риски, запрошено согласование.",
    originalOutput: "Private AI Cloud — центр AI-операций с согласованием для команд, которым нужно, чтобы ответы, процессы и внешние действия оставались под контролем человека. Начните с внутренних знаний, создайте черновик, проверьте риски и опубликуйте вручную после согласования.",
    editedOutput: "Private AI Cloud помогает Smart Algorithms проверить AI-операции через согласование: ответы на основе знаний, черновики процессов, видимые риски и ручная публикация после ревью владельца.",
    finalOutput: "Private AI Cloud проходит проверку как центр AI-операций с согласованием: RAG-ответы, черновики процессов, проверка рисков и ручная публикация с одобрения владельца.",
    riskNotes: ["Никаких инвестиционных обещаний.", "Никаких сигналов к покупке или продаже.", "Никакой внешней публикации в Telegram до согласования."],
  },
  "approval-502": { title: "Ответ поддержки за рамками FAQ", actionType: "отправка ответа поддержки", preview: "Ответ ссылается на FAQ поддержки и чек-лист Scanner. Только ручная отправка.", auditHint: "Перед ревью добавлена заметка о недостающем контексте.", riskNotes: ["Ответ выходит за рамки FAQ и требует проверки оператором."] },
  "approval-503": { title: "Создание задачи Codex", actionType: "создание задачи Codex", preview: "Промпт задачи отредактирован: уточнены демо-данные и отсутствие бэкенда в объёме.", auditHint: "Исходная и отредактированная версии сохранены.", riskNotes: ["Создаёт работу по реализации; запуска Codex здесь не происходит."] },
  "approval-504": { title: "Запуск Codex", actionType: "запуск Codex", preview: "Запрос на запуск подготовлен, но исполнение остаётся ручным и за согласованием.", auditHint: "Намерение запуска зафиксировано без внешнего исполнения.", riskNotes: ["Запуск Codex — высокий риск и в прототипе остаётся ручным."] },
  "approval-505": { title: "Запуск локальных проверок", actionType: "запуск локальных проверок", preview: "Интеграция локального исполнителя не включена. Запрос остаётся закрытым.", auditHint: "Из этого прототипа команды не выполняются.", riskNotes: ["Выполнение локальных команд отключено."] },
  "approval-506": { title: "Действие внешней интеграции", actionType: "действие внешней интеграции", preview: "Внешнее действие требует настройки интеграции, списка разрешённых действий и политики согласования.", auditHint: "Действие интеграции по умолчанию закрыто.", riskNotes: ["Список разрешённых действий интеграции и секреты не настроены."] },
  "approval-507": { title: "Повторное письмо лиду", actionType: "отправка повторного письма лиду", preview: "Черновик повторного письма задаёт уточняющие вопросы и не отправляется наружу.", auditHint: "Процесс продаж запланирован; это демонстрационный пример согласования.", riskNotes: ["Исходящие продажи запланированы и остаются ручными."] },
  "approval-508": { title: "Приёмка кода", actionType: "приёмка результата кода", preview: "Отчёт QA рекомендует приёмку после lint/build и ручной проверки маршрутов.", auditHint: "Приёмка фиксируется; слияние в репозиторий выполняется вручную.", riskNotes: ["Запись о приёмке не сливает код."] },
  "approval-509": { title: "Слияние вручную вне системы", actionType: "ручное слияние вне системы", preview: "Слияние всегда выполняется вручную вне системы. Эта очередь фиксирует только намерение и статус ревью.", auditHint: "Нет кнопки слияния и автоматических изменений в системе контроля версий.", riskNotes: ["В продукте нет кнопки слияния."] },
};

const ruReports: Readonly<Record<string, { title: string; summary: string; metrics: string[] }>> = {
  "weekly-owner": { title: "Еженедельный отчёт владельца", summary: "Операции в норме, но в индексации знаний один документ с ошибкой, а согласования с высоким риском требуют ревью.", metrics: ["28 запусков процессов", `ожидают согласования: ${mock.pendingApprovalsCount}`, `ошибок индексации: ${mock.indexingIssuesCount}`] },
  "daily-report": { title: "Ежедневный отчёт", summary: "Запланированная ежедневная сводка по согласованиям, изменениям процессов, инцидентам и вниманию владельца.", metrics: ["будущее расписание", "сводка владельца", "бэкенда пока нет"] },
  "support-summary": { title: "Сводка поддержки", summary: "Большинство черновиков поддержки касаются онбординга Scanner, состояния чек-листа и ожиданий к ответам на основе источников.", metrics: ["9 черновиков", "2 эскалации", "0 внешних отправок"] },
  "leads-summary": { title: "Сводка по лидам", summary: "Запланированное представление продаж: приём лидов, результаты квалификации и черновики повторных писем.", metrics: ["приём лидов запланирован", "0 отправок", "нужно согласование"] },
  "marketing-summary": { title: "Сводка маркетинга", summary: "Черновики для Telegram, контентные хуки, наблюдения по росту и согласования публикаций.", metrics: ["4 черновика", "2 согласования", "0 опубликовано"] },
  "product-summary": { title: "Сводка продукта", summary: "Операторы хотят нагляднее видеть различия в согласованиях, быстрее повторять индексацию и иметь пресеты задач Codex.", metrics: ["7 сигналов", "3 приоритета", "2 задачи Codex"] },
  "development-summary": { title: "Сводка разработки", summary: "Промпты задач Codex, заметки передачи и сбор результатов остаются за согласованием.", metrics: ["2 задачи", "1 передача", "запуск закрыт"] },
  "qa-code-review": { title: "Сводка QA / код-ревью", summary: "Процесс QA-ревью дал одну рекомендацию одобрить и одну — доработать.", metrics: ["2 отчёта", "1 проваленная проверка", "1 доработка"] },
  blockers: { title: "Блокеры", summary: "Ошибка индексации, закрытый локальный исполнитель и ожидающие согласования с высоким риском требуют внимания владельца.", metrics: ["1 ошибка индексации", "2 закрытых действия", "3 решения"] },
  recommendations: { title: "Рекомендации", summary: "Приоритет — повтор индексации, одобрение или отклонение ожидающих публикаций и сохранение внешних действий закрытыми.", metrics: ["3 рекомендации", "сначала согласование", "ручное исполнение"] },
  "owner-decision-points": { title: "Точки решений владельца", summary: "Явная очередь решений: публикации, запуски Codex, локальные проверки и направление дорожной карты.", metrics: [`согласований: ${mock.pendingApprovalsCount}`, "2 пункта дорожной карты", "1 заметка о политике"] },
  "usage-summary": { title: "Сводка использования системы", summary: "Использование AI-чата и процессов сосредоточено в поддержке и продуктовых операциях.", metrics: ["42 сообщения в чате", `ассистентов: ${mock.assistantProfiles.length}`, "6 интеграций"] },
};

const ruOps: readonly { title: string; detail: string }[] = [
  { title: "Коллекции", detail: "Продукт, поддержка, контент, разработка, политики, QA." },
  { title: "Очередь индексации", detail: "1 документ индексируется, 1 с ошибкой, повтор имитируется." },
  { title: "Документы с ошибкой", detail: "SEO-стратегия: ошибка извлечения таблиц, исключена из RAG." },
  { title: "Права на источники", detail: "Доступ к коллекциям в основной платформе будет зависеть от роли." },
  { title: "Версионирование запланировано", detail: "Версии документов и сравнение показаны как запланированная работа." },
  { title: "Управление источниками", detail: "Загрузка, теги, архив, повтор индексации и обновление базы знаний." },
  { title: "Готовность RAG", detail: "В ответах и ссылках должны появляться только проиндексированные источники." },
  { title: "Интеграции позже", detail: "Коннекторы GitHub, Google Диск, Яндекс Диск и S3 остаются запланированными." },
];

const ruCapabilities: readonly { title: string; description: string }[] = [
  { title: "Сводка документа", description: "Создать понятную владельцу сводку по загруженным источникам." },
  { title: "Извлечение ключевых терминов", description: "Выделить продуктовые, политические, договорные и операционные термины." },
  { title: "Выявление рисков", description: "Отметить обязательства, исключения, неясные формулировки и недостающий контекст." },
  { title: "Сравнение версий", description: "Сравнить редакции документа и показать существенные изменения." },
  { title: "Проверка по чек-листу", description: "Оценить документ по чек-листу ручного QA или юридическому чек-листу." },
  { title: "Сроки / суммы / обязательства", description: "Извлечь даты, денежные суммы, ответственность и действия владельца." },
  { title: "Генерация карточки документа", description: "Превратить источник в переиспользуемую карточку-сводку для процессов." },
  { title: "Черновик комментариев/вопросов", description: "Подготовить комментарии и вопросы для специалиста." },
  { title: "Преобразование документа в задачи", description: "Создать задачи по документу-источнику для ревью владельцем." },
];

const ruThreads: Readonly<Record<string, { title: string }>> = {
  "thread-1": { title: "Ответ по онбордингу Scanner" }, "thread-2": { title: "Подача поста для Telegram" }, "thread-3": { title: "Задача Codex для прототипа" },
};
const ruMessages: Readonly<Record<string, { body: string }>> = {
  "msg-1": { body: "Что показывать, когда в базе знаний нет релевантных данных?" },
  "msg-2": { body: "Покажите понятное состояние «нет данных» и не выдумывайте детали. Предложите загрузить документ-источник или отправить вопрос в процесс на ревью." },
};
const ruAudit: Readonly<Record<string, { label: string; detail: string }>> = {
  "audit-1": { label: "Сформирован результат AI", detail: "Ответ поддержки сформирован с 2 ссылками на источники." },
  "audit-2": { label: "Запрошено согласование", detail: "Ответ поддержки переведён в ожидание согласования." },
  "audit-3": { label: "Внешнее действие закрыто", detail: "Отправка ответа поддержки в MVP остаётся только ручной." },
};

const ruPreviews: Readonly<Record<string, { title: string; sections: readonly (readonly [string, string])[]; sources?: readonly string[] }>> = {
  "support-reply": { title: "Предпросмотр ответа поддержки", sections: [
    ["Классификация", "Вопрос классифицирован как онбординг Scanner / несоответствие чек-листу. Приоритет: средний."],
    ["Сформированный ответ", "Чек-лист MVP Scanner предполагает сначала локальную проверку, затем просмотр статуса индексации, затем согласование владельца перед публикацией ответа клиенту."],
    ["Заметка о безопасности", "Внешняя отправка в MVP-прототипе отключена. Ответ нужно скопировать вручную после согласования."],
  ], sources: ["Ответы клиентам должны ссылаться на проиндексированные знания поддержки и не содержать непроверенных операционных утверждений."] },
  "telegram-content": { title: "Предпросмотр контента для Telegram", sections: [
    ["Черновик поста", "Private AI Cloud превращает внутренние документы в контролируемые AI-операции: спросить, сформировать, согласовать и только потом действовать."],
    ["Проверка рисков", "Средний риск: публичный канал. Требуется согласование владельца и ручная публикация в MVP."],
  ] },
  "codex-task": { title: "Предпросмотр задачи продукта / Codex", sections: [
    ["Промпт для Codex", "Создать статическую страницу прототипа Next.js для деталей согласования на демо-данных без интеграций бэкенда."],
    ["Задача в Markdown", "Реализовать только интерфейс. Включить плашки статусов, предпросмотр «до/после», место для комментариев и отключённые действия одобрения/отклонения."],
    ["Критерии приёмки", "Страница отображается на демо-данных, использует общую оболочку приложения, проходит линтер и сборку."],
    ["Команды проверки", "npm run lint; npm run build"],
  ] },
  "qa-review": { title: "Предпросмотр отчёта QA / ревью", sections: [
    ["Изменённые файлы", "app/approvals/page.tsx, components/domain/approval-card.tsx, lib/mock-data.ts"],
    ["Риски", "Реализация только на демо-данных безопасна. Проверьте, что отключённые кнопки явно ничего не выполняют."],
    ["Проваленные проверки", "В предоставленном демо-логе проваленных проверок нет."],
    ["Рекомендация", "Одобрить для ветки прототипа после успешных lint/build."],
  ] },
};

const enLabels: MockContent["labels"] = {
  documentStatus: { indexed: "indexed", indexing: "indexing", failed: "failed", uploaded: "uploaded" },
  approvalStatus: { pending: "pending", approved: "approved", rejected: "rejected", edited: "edited", expired: "expired", cancelled: "cancelled" },
  risk: { low: "low", medium: "medium", high: "high", critical: "critical", blocked: "blocked" },
  runStatus: { draft: "draft", queued: "queued", running: "running", generated: "generated", waiting_approval: "waiting_approval", approved: "approved", rejected: "rejected", executed: "executed", failed: "failed", cancelled: "cancelled" },
  tone: { neutral: "neutral", info: "info", success: "success", warning: "warning", danger: "danger", locked: "locked" },
  confidence: { High: "High", Medium: "Medium", Low: "Low" },
  reportStatus: { Ready: "Ready", Planned: "Planned", Draft: "Draft", Review: "Review" },
  departmentStatus: { "MVP active": "MVP active", "v0.2 planned": "v0.2 planned", future: "future" },
  availability: { active: "MVP active", planned: "v0.2 planned", locked: "locked", future: "future" },
  capabilityStatus: { "planned / partial": "planned / partial", future: "future" },
};

const ruLabels: MockContent["labels"] = {
  documentStatus: { indexed: "проиндексирован", indexing: "индексируется", failed: "ошибка", uploaded: "загружен" },
  approvalStatus: { pending: "ожидает", approved: "одобрено", rejected: "отклонено", edited: "отредактировано", expired: "истекло", cancelled: "отменено" },
  risk: { low: "низкий", medium: "средний", high: "высокий", critical: "критический", blocked: "заблокировано" },
  runStatus: { draft: "черновик", queued: "в очереди", running: "выполняется", generated: "сформировано", waiting_approval: "ожидает согласования", approved: "одобрено", rejected: "отклонено", executed: "выполнено", failed: "ошибка", cancelled: "отменено" },
  tone: { neutral: "нейтрально", info: "информация", success: "успешно", warning: "внимание", danger: "опасно", locked: "закрыто" },
  confidence: { High: "Высокая", Medium: "Средняя", Low: "Низкая" },
  reportStatus: { Ready: "Готов", Planned: "Запланирован", Draft: "Черновик", Review: "На ревью" },
  departmentStatus: { "MVP active": "MVP активен", "v0.2 planned": "запланировано в v0.2", future: "в будущем" },
  availability: { active: "MVP активен", planned: "запланировано в v0.2", locked: "закрыто", future: "в будущем" },
  capabilityStatus: { "planned / partial": "запланировано / частично", future: "в будущем" },
};

const en: MockContent = {
  documents: mock.documents, sourceCitations: mock.sourceCitations, departments: mock.departments, workflowGroups: mock.workflowGroups,
  workflowLifecycleSteps: mock.workflowLifecycleSteps, workflowRuns: mock.workflowRuns, approvals: mock.approvals,
  weeklyOwnerReportSummary: mock.weeklyOwnerReportSummary, reports: mock.reports, knowledgeOpsBlocks: mock.knowledgeOpsBlocks,
  documentIntelligenceCapabilities: mock.documentIntelligenceCapabilities, chatThreads: mock.chatThreads, chatMessages: mock.chatMessages,
  auditEvents: mock.auditEvents, workflowPreviews, labels: enLabels,
};

const ruCitationList = (citations: readonly SourceCitation[]) => byKey(citations, ruCitations, (item) => item.id, "citations",
  (item, text) => ({ ...item, ...text, title: docName(item.title), collection: ruCollection[item.collection] ?? item.collection }));

const ru: MockContent = {
  documents: byKey(mock.documents as readonly KnowledgeDocument[], ruDocuments, (item) => item.id, "documents", (item, text) => ({
    ...item, ...text, title: docName(item.title), collection: ruCollection[item.collection] ?? item.collection, uploadedBy: person(item.uploadedBy),
    updatedAt: time(item.updatedAt), size: size(item.size),
  })),
  sourceCitations: ruCitationList(mock.sourceCitations),
  departments: byKey(mock.departments as readonly Department[], ruDepartments, (item) => item.id, "departments", (item, text) => ({ ...item, ...text })),
  workflowGroups: byKey(mock.workflowGroups as readonly WorkflowGroup[], ruGroups, (item) => item.id, "workflowGroups", (group, text) => ({
    ...group, title: text.title, description: text.description,
    workflows: [...byIndex(group.workflows, text.workflows, `workflowGroups.${group.id}`, (workflow, [title, description]) => ({
      ...workflow, title, description, department: ruDepartmentTitleByEnglish(workflow.department),
    }))],
  })),
  workflowLifecycleSteps: byKey(mock.workflowLifecycleSteps as readonly WorkflowLifecycleStep[], ruLifecycle, (item) => item.status, "lifecycle", (item, label) => ({ ...item, label })),
  workflowRuns: byKey(mock.workflowRuns as readonly WorkflowRun[], ruRuns, (item) => item.id, "workflowRuns", (item, text) => ({
    ...item, ...text, requestedBy: person(item.requestedBy), updatedAt: time(item.updatedAt), duration: duration(item.duration),
  })),
  approvals: byKey(mock.approvals as readonly ApprovalRequest[], ruApprovals, (item) => item.id, "approvals", (item, text) => ({
    ...item, ...text, requestedBy: person(item.requestedBy), allowedApprovers: item.allowedApprovers?.map(person),
    sourceDocuments: item.sourceDocuments?.map(docName), createdAt: time(item.createdAt),
  })),
  weeklyOwnerReportSummary: {
    title: "Еженедельный отчёт владельца — текущий MVP",
    subtitle: "Сводка для владельца по Smart Algorithms v0.1: поддержка, контент, продукт, Codex, QA и согласования.",
    metrics: byIndex((mock.weeklyOwnerReportSummary as OwnerReportSummary).metrics, ["Ожидают решения", "Согласования с высоким риском", "Проблемы индексации", "Задачи Codex в ожидании", "Готовые отчёты QA"],
      "weeklyOwnerReportSummary.metrics", (metric, label) => ({ ...metric, label })) as OwnerReportSummary["metrics"],
    sections: byIndex((mock.weeklyOwnerReportSummary as OwnerReportSummary).sections, [
      ["Поддержка и частые вопросы", ["Новые запросы в поддержку касаются онбординга Scanner и локальной проверки.", "Частые вопросы — про ответы на основе источников и поведение при нехватке контекста."]],
      ["Ошибки и запросы на функции", ["Одна ошибка индексации мешает контентным источникам стать готовыми для RAG.", "Операторы просили различия в согласованиях, управление повторами и пресеты задач Codex."]],
      ["Контент, лиды и сигналы", ["Черновики для Telegram готовы к ручному ревью; автоматически ничего не публикуется.", "Лиды и сигналы Pro/листа ожидания запланированы в отчётности v0.2."]],
      ["Продукт, Codex и QA", ["Создание задачи Codex и запуск Codex — отдельные решения о согласовании.", "Статус QA/код-ревью готов к ревью владельца перед ручной приёмкой."]],
    ] as const, "weeklyOwnerReportSummary.sections", (section, [title, items]) => ({ ...section, title, items: [...items] })) as OwnerReportSummary["sections"],
  },
  reports: byKey(mock.reports as readonly Report[], ruReports, (item) => item.id, "reports", (item, text) => ({
    ...item, ...text, owner: person(item.owner), updatedAt: time(item.updatedAt),
  })),
  knowledgeOpsBlocks: byIndex(mock.knowledgeOpsBlocks as readonly KnowledgeOpsBlock[], ruOps, "knowledgeOpsBlocks", (item, text) => ({ ...item, ...text })),
  documentIntelligenceCapabilities: byIndex(mock.documentIntelligenceCapabilities as readonly DocumentIntelligenceCapability[], ruCapabilities, "capabilities", (item, text) => ({ ...item, ...text })),
  chatThreads: byKey(mock.chatThreads as MockContent["chatThreads"], ruThreads, (item) => item.id, "chatThreads", (item, text) => ({
    ...item, ...text, assistant: person(item.assistant), updatedAt: time(item.updatedAt),
  })),
  chatMessages: byKey(mock.chatMessages as MockContent["chatMessages"], ruMessages, (item) => item.id, "chatMessages", (item, text) => ({
    ...item, ...text, author: person(item.author),
  })),
  auditEvents: byKey(mock.auditEvents as readonly AuditEvent[], ruAudit, (item) => item.id, "auditEvents", (item, text) => ({ ...item, ...text, timestamp: time(item.timestamp) })),
  workflowPreviews: Object.freeze(Object.fromEntries(Object.entries(workflowPreviews as Record<string, WorkflowPreview>).map(([key, preview]) => {
    const text = ruPreviews[key];
    if (!text) throw new Error(`Russian prototype data for workflowPreviews is missing ${key}.`);
    return [key, {
      ...preview,
      title: text.title,
      sections: [...byIndex(preview.sections, text.sections, `workflowPreviews.${key}`, (section, [title, content]) => ({ ...section, title, content }))],
      ...(preview.sources ? { sources: [...byIndex(preview.sources, text.sources ?? [], `workflowPreviews.${key}.sources`, (source, excerpt) => ({
        ...source, excerpt, title: docName(source.title), collection: ruCollection[source.collection] ?? source.collection,
      }))] } : {}),
    }];
  }))),
  labels: ruLabels,
};

function ruDepartmentTitleByEnglish(title: string): string {
  const department = (mock.departments as readonly Department[]).find((item) => item.title === title);
  if (department) return ruDepartments[department.id].title;
  const extra: Readonly<Record<string, string>> = { "Core Platform": "Основная платформа" };
  return extra[title] ?? title;
}

export const prototypeMock: Readonly<Record<Locale, MockContent>> = Object.freeze({ en, ru });
