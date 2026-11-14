import type { Locale } from "./locale";
import type { AssistantProfile, Integration, Role, RoadmapItem, SettingsModule } from "../../types/app";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { assistantProfiles, integrations, roadmapItems, settingsModules } from "../mock-data.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { roles } from "../roles.ts";

// AI-038.6: localized copy of the PROTOTYPE pages reachable from the Owner navigation (Roadmap,
// Settings and its sub-pages). This is static product copy (mock UI content), not stored data.
// English is the existing mock content unchanged; Russian mirrors it 1:1 (same order, ids, versions,
// hrefs and status keys — a test enforces parity). Brand / product names (Private AI Cloud, Smart
// Algorithms, Telegram, GitHub, Codex…) and paths stay as they are.

type Pair = readonly [string, string];

export type PrototypeContent = Readonly<{
  roadmap: Readonly<{
    eyebrow: string; title: string; description: string; focusTitle: string; focusBody: string; currentBadge: string;
    status: Readonly<Record<RoadmapItem["status"], string>>;
    items: readonly RoadmapItem[];
  }>;
  settings: Readonly<{
    eyebrow: string; title: string; description: string; workspaceTitle: string; workspaceDescription: string;
    fields: readonly Pair[]; open: string;
    status: Readonly<Record<string, string>>;
    modules: readonly SettingsModule[];
  }>;
  assistants: Readonly<{ eyebrow: string; title: string; description: string; status: Readonly<Record<string, string>>; profiles: readonly AssistantProfile[] }>;
  integrations: Readonly<{ eyebrow: string; title: string; description: string; status: Readonly<Record<string, string>>; items: readonly Integration[] }>;
  roles: Readonly<{ eyebrow: string; title: string; description: string; firstScreen: string; badge: string; items: readonly Role[] }>;
  operatorConsole: Readonly<{ eyebrow: string; title: string; description: string; badge: string; blocks: readonly Pair[] }>;
  security: Readonly<{ eyebrow: string; title: string; description: string; badge: string; policies: readonly Pair[] }>;
}>;

const en: PrototypeContent = {
  roadmap: {
    eyebrow: "Roadmap",
    title: "Private AI Cloud roadmap",
    description: "Product roadmap from the current Smart Algorithms internal demo to the future owned AI infrastructure layer.",
    focusTitle: "MVP focus",
    focusBody: "The current prototype focuses on v0.1: Smart Algorithms Internal Demo. Later versions are visible to show product direction, not to imply implemented backend, integrations, or infrastructure.",
    currentBadge: "current: v0.1",
    status: { current: "current", next: "next", future: "future" },
    items: roadmapItems,
  },
  settings: {
    eyebrow: "Settings",
    title: "Core Platform controls",
    description: "Workspace administration surfaces for users, roles, permissions, integrations, AI settings, security, and audit logs.",
    workspaceTitle: "Company Workspace",
    workspaceDescription: "Smart Algorithms Demo remains the first workspace in this prototype. Managed service and infrastructure controls are visible as mocked/planned modules.",
    fields: [["Workspace", "Smart Algorithms Demo"], ["Platform mode", "frontend-only prototype"], ["External actions", "locked"]],
    open: "Open",
    status: { "MVP active": "MVP active", "v0.2 planned": "v0.2 planned", "planned / partial": "planned / partial", future: "future", locked: "locked", "manual only": "manual only" },
    modules: settingsModules,
  },
  assistants: {
    eyebrow: "Settings",
    title: "AI Assistants",
    description: "Mock assistant registry for department ownership, model policy, allowed tools, and safety defaults.",
    status: { "MVP active": "MVP active", "v0.2 planned": "v0.2 planned", future: "future" },
    profiles: assistantProfiles,
  },
  integrations: {
    eyebrow: "Settings",
    title: "Integrations",
    description: "Mock integration registry. Real connectors, credentials, and external actions are out of scope for this prototype.",
    status: { "not connected": "not connected", planned: "planned", locked: "locked", "manual only": "manual only" },
    items: integrations,
  },
  roles: {
    eyebrow: "Settings",
    title: "Roles and permissions",
    description: "Role-based UI model with first screens and permission summaries for the MVP prototype.",
    firstScreen: "First screen:",
    badge: "role",
    items: roles,
  },
  operatorConsole: {
    eyebrow: "Settings",
    title: "Operator Console",
    description: "Planned operator control surface for queues, retries, incidents, and infrastructure status.",
    badge: "planned",
    blocks: [
      ["Queues", "Workflow runs, indexing jobs, approvals, and report generation."],
      ["Retries", "Failed indexing and workflow retries will be controlled here later."],
      ["Incidents", "Operational warnings and blocked external actions."],
      ["Infrastructure", "Mock app, worker, storage, integration, and queue health."],
    ],
  },
  security: {
    eyebrow: "Settings",
    title: "Security, Audit & Compliance",
    description: "Security, audit, and compliance controls represented as frontend-only policy cards.",
    badge: "policy",
    policies: [
      ["Approval-first", "Critical actions require human approval records."],
      ["External actions", "Publish, send, run, and integration calls are locked."],
      ["Audit trail", "Generated, edited, approved, rejected, and executed states are recorded."],
      ["Secrets", "Secret references are planned; decrypted values are never shown."],
      ["Merge", "Code merge is always manual outside the system."],
    ],
  },
};

// Russian mirrors of the English mock lists (same order and ids).
const ruRoadmapText: readonly { title: string; description: string; items: readonly string[] }[] = [
  {
    title: "Внутреннее демо Smart Algorithms",
    description: "Текущий объём прототипа: доказать центр AI-операций — знания, RAG, процессы, согласования и отчётность владельца.",
    items: ["База знаний", "RAG-чат", "Ассистент поддержки", "Ассистент контента для Telegram", "Ассистент продукта / задач Codex", "Отчёт QA / ревью", "Очередь согласований администратора"],
  },
  {
    title: "Операционный MVP Smart Algorithms",
    description: "Расширить внутренний операционный MVP: маркетинг, продажи, успех клиентов, отчётность и согласованные интеграции каналов.",
    items: ["Маркетинговые хуки / поиск болей", "Ассистент продаж / лидов", "Успех клиентов / допродажи", "Анализ активности пользователей", "Еженедельный отчёт руководителю", "Интеграция согласования/публикации в Telegram", "Приём лидов с сайта", "Канал поддержки через Telegram-бота", "Канал поддержки через чат на сайте"],
  },
  {
    title: "Первый клиентский пилот",
    description: "Провести контролируемый пилот с отдельным клиентским рабочим пространством и выбранными AI-пакетами.",
    items: ["Отдельное клиентское рабочее пространство", "Демо-просмотрщик", "Загрузка документов", "RAG-чат", "2–3 выбранных AI-пакета", "Базовый аудит", "Базовая безопасность", "Управляемое развёртывание на арендованной инфраструктуре в РФ"],
  },
  {
    title: "Продуктовый Private AI Cloud",
    description: "Упаковать платформу для повторяемых частных развёртываний с коммерческими и операционными механизмами контроля.",
    items: ["Мультиарендная платформа", "Пакетные AI-модули", "Тарифная логика", "Интеграции", "Консоль оператора", "Аналитика использования", "SLA", "Шаблоны развёртывания", "Документация по безопасности"],
  },
  {
    title: "Собственный слой AI-инфраструктуры",
    description: "Перейти от арендованного/частного развёртывания к собственным мощностям AI-инфраструктуры.",
    items: ["Собственные GPU-серверы в колокации", "Централизованный инференс", "Квоты", "Мониторинг", "Аналитика затрат", "Зарезервированные мощности", "Выделенные клиентские среды"],
  },
];

const ruSettingsText: readonly { title: string; description: string }[] = [
  { title: "Рабочее пространство компании", description: "Рабочее пространство Smart Algorithms Demo: метка среды, локаль и операционный контекст." },
  { title: "Пользователи", description: "Демо-справочник, будущие приглашения, владение и назначение ролей." },
  { title: "Роли и права", description: "Владелец, администратор, операторы, ревьюер, наблюдатель и демо-просмотрщик." },
  { title: "Доступ к коллекциям знаний", description: "Видимость на уровне коллекций и права на источники RAG." },
  { title: "Анализ документов", description: "Сводки, условия, риски, сравнения, проверка по чек-листу и извлечение задач." },
  { title: "AI-ассистенты", description: "Ассистенты отделов, политика моделей, инструменты и безопасные настройки по умолчанию." },
  { title: "Центр интеграций", description: "Telegram, GitHub, локальный исполнитель, хранилище, чат на сайте и LLM." },
  { title: "Безопасность, аудит и соответствие", description: "Блокировка внешних действий, журнал аудита, секреты и политика согласований." },
  { title: "Консоль оператора", description: "Будущая панель управления запусками: очереди, инциденты и повторы." },
  { title: "Лимиты использования", description: "Лимиты прототипа для запусков, объёма чата, загрузки источников и инструментов." },
  { title: "Состояние инфраструктуры", description: "Демо-состояние приложения, воркера, хранилища, интеграций, индексации и очередей." },
  { title: "Настройки управляемого сервиса", description: "Будущий тариф сервиса, граница поддержки, резервные копии и доступ оператора." },
];

const ruAssistantText: readonly { name: string; department: string; purpose: string }[] = [
  { name: "Ассистент поддержки", department: "AI-отдел поддержки", purpose: "Готовит ответы поддержки на основе источников и эскалирует вопросы вне FAQ." },
  { name: "Контент-ассистент", department: "AI-отдел маркетинга и роста", purpose: "Готовит контент для Telegram, ищет боли аудитории и собирает сводки роста." },
  { name: "Ассистент сообщества", department: "AI-отдел работы с сообществом", purpose: "Отслеживает обсуждения и готовит официальные комментарии без автопубликации." },
  { name: "Ассистент продаж", department: "AI-отдел продаж", purpose: "Собирает лиды, квалифицирует намерение и готовит повторные письма." },
  { name: "Ассистент успеха клиентов", department: "AI-отдел успеха клиентов / допродаж", purpose: "Анализирует активность, выявляет риск оттока и рекомендует онбординг или допродажи." },
  { name: "Продуктовый ассистент", department: "AI-отдел продукта", purpose: "Превращает обратную связь в группы дорожной карты, пользовательские истории, заметки о релизах и задачи Codex." },
  { name: "Оркестратор Codex", department: "AI-отдел разработки / оркестрации Codex", purpose: "Готовит промпты Codex, сводки передачи и представления для сбора результатов." },
  { name: "QA-ревьюер", department: "AI-отдел QA / код-ревью", purpose: "Проверяет диффы, результаты проверок, риски QA и чек-листы ручного смоук-теста." },
  { name: "Аналитик владельца", department: "AI-отдел аналитики для руководства", purpose: "Сводит внимание владельца, блокеры, рекомендации и точки принятия решений." },
  { name: "Ассистент по юридическим документам", department: "AI-отдел юридических документов", purpose: "Делает сводки документов, извлекает риски, сравнивает версии и готовит вопросы юристу." },
];

const ruIntegrationText: Readonly<Record<string, { name: string; description: string; owner: string }>> = {
  telegram: { name: "Telegram-бот", description: "Публикует согласованные посты в Telegram после одобрения владельца.", owner: "Маркетинг" },
  "website-chat": { name: "Чат на сайте", description: "Принимает вопросы поддержки и готовит ответы.", owner: "Поддержка" },
  github: { name: "GitHub", description: "Заводит задачи в GitHub на основе согласованных задач продукта/Codex.", owner: "Продукт" },
  "local-runner": { name: "Локальный исполнитель", description: "Запускает локальные проверки через контролируемый процесс согласования.", owner: "Разработка" },
  "object-storage": { name: "Объектное хранилище", description: "Хранит документы, артефакты и сформированные отчёты.", owner: "Администратор" },
  "llm-provider": { name: "LLM-провайдер", description: "Настраивает профили моделей для ассистентов и процессов.", owner: "Администратор" },
};

const ruRoleText: Readonly<Record<string, { name: string; summary: string; permissions: readonly string[] }>> = {
  owner: { name: "Владелец", summary: "Полный операционный контроль и согласования с высоким риском.", permissions: ["Одобрять критические действия", "Просматривать отчёты владельца", "Управлять безопасностью пространства", "Видеть все события аудита"] },
  admin: { name: "Администратор", summary: "Администрирование рабочего пространства и настройка интеграций.", permissions: ["Управлять пользователями", "Управлять ролями", "Настраивать интеграции", "Просматривать журналы аудита"] },
  support: { name: "Оператор поддержки", summary: "Запускает процессы поддержки и готовит ответы.", permissions: ["Запускать «Ответ поддержки»", "Использовать знания поддержки", "Отправлять на согласование"] },
  marketing: { name: "Оператор маркетинга", summary: "Готовит контент и отправляет его на согласование.", permissions: ["Запускать «Контент для Telegram»", "Просматривать коллекции контента", "Отправлять на согласование публикации"] },
  product: { name: "Продакт-менеджер", summary: "Создаёт задачи Codex и просматривает сводки обратной связи.", permissions: ["Запускать «Задачу Codex»", "Просматривать отчёты продукта", "Одобрять черновики продукта"] },
  reviewer: { name: "Разработчик / ревьюер", summary: "Проверяет отчёты QA и запросы локальных проверок.", permissions: ["Запускать «QA-ревью»", "Рассматривать технические согласования", "Запрашивать локальные проверки"] },
  viewer: { name: "Наблюдатель", summary: "Только чтение согласованных результатов.", permissions: ["Просматривать отчёты", "Просматривать согласованные результаты", "Просматривать главную"] },
  "demo-viewer": { name: "Демо-просмотрщик", summary: "Отобранные демо-данные без чувствительных элементов управления.", permissions: ["Просматривать демо-главную", "Просматривать демо-отчёты"] },
};

function mirror<T, R>(source: readonly T[], translations: readonly R[], name: string, apply: (item: T, text: R) => T): readonly T[] {
  if (source.length !== translations.length) throw new Error(`Russian prototype content for ${name} is out of sync.`);
  return Object.freeze(source.map((item, index) => apply(item, translations[index])));
}

function byKey<T, R>(source: readonly T[], translations: Readonly<Record<string, R>>, key: (item: T) => string, name: string, apply: (item: T, text: R) => T): readonly T[] {
  return Object.freeze(source.map((item) => {
    const text = translations[key(item)];
    if (!text) throw new Error(`Russian prototype content for ${name} is missing ${key(item)}.`);
    return apply(item, text);
  }));
}

const ru: PrototypeContent = {
  roadmap: {
    eyebrow: "Дорожная карта",
    title: "Дорожная карта Private AI Cloud",
    description: "Дорожная карта продукта: от текущего внутреннего демо Smart Algorithms до будущего собственного слоя AI-инфраструктуры.",
    focusTitle: "Фокус MVP",
    focusBody: "Текущий прототип сосредоточен на v0.1: внутреннее демо Smart Algorithms. Следующие версии показаны как направление продукта и не означают, что бэкенд, интеграции или инфраструктура уже реализованы.",
    currentBadge: "текущая: v0.1",
    status: { current: "текущая", next: "следующая", future: "будущая" },
    items: mirror(roadmapItems as readonly RoadmapItem[], ruRoadmapText, "roadmap", (item, text) => ({ ...item, ...text, items: [...text.items] })),
  },
  settings: {
    eyebrow: "Настройки",
    title: "Управление основной платформой",
    description: "Администрирование рабочего пространства: пользователи, роли, права, интеграции, настройки AI, безопасность и журналы аудита.",
    workspaceTitle: "Рабочее пространство компании",
    workspaceDescription: "Smart Algorithms Demo остаётся первым рабочим пространством этого прототипа. Управляемый сервис и инфраструктура показаны как демонстрационные/запланированные модули.",
    fields: [["Рабочее пространство", "Smart Algorithms Demo"], ["Режим платформы", "прототип только фронтенда"], ["Внешние действия", "закрыты"]],
    open: "Открыть",
    status: { "MVP active": "MVP активен", "v0.2 planned": "запланировано в v0.2", "planned / partial": "запланировано / частично", future: "в будущем", locked: "закрыто", "manual only": "только вручную" },
    modules: mirror(settingsModules as readonly SettingsModule[], ruSettingsText, "settings", (item, text) => ({ ...item, ...text })),
  },
  assistants: {
    eyebrow: "Настройки",
    title: "AI-ассистенты",
    description: "Демо-реестр ассистентов: принадлежность отделам, политика моделей, разрешённые инструменты и безопасные настройки по умолчанию.",
    status: { "MVP active": "MVP активен", "v0.2 planned": "запланировано в v0.2", future: "в будущем" },
    profiles: mirror(assistantProfiles as readonly AssistantProfile[], ruAssistantText, "assistants", (item, text) => ({ ...item, ...text })),
  },
  integrations: {
    eyebrow: "Настройки",
    title: "Интеграции",
    description: "Демо-реестр интеграций. Реальные коннекторы, учётные данные и внешние действия не входят в этот прототип.",
    status: { "not connected": "не подключено", planned: "запланировано", locked: "закрыто", "manual only": "только вручную" },
    items: byKey(integrations as readonly Integration[], ruIntegrationText, (item) => item.id, "integrations", (item, text) => ({ ...item, ...text })),
  },
  roles: {
    eyebrow: "Настройки",
    title: "Роли и права",
    description: "Ролевая модель интерфейса со стартовыми экранами и сводкой прав для MVP-прототипа.",
    firstScreen: "Стартовый экран:",
    badge: "роль",
    items: byKey(roles as readonly Role[], ruRoleText, (item) => item.id, "roles", (item, text) => ({ ...item, ...text, permissions: [...text.permissions] })),
  },
  operatorConsole: {
    eyebrow: "Настройки",
    title: "Консоль оператора",
    description: "Запланированная панель оператора для очередей, повторов, инцидентов и состояния инфраструктуры.",
    badge: "запланировано",
    blocks: [
      ["Очереди", "Запуски процессов, задания индексации, согласования и формирование отчётов."],
      ["Повторы", "Повторы неудачной индексации и процессов позже будут управляться здесь."],
      ["Инциденты", "Операционные предупреждения и заблокированные внешние действия."],
      ["Инфраструктура", "Демо-состояние приложения, воркера, хранилища, интеграций и очередей."],
    ],
  },
  security: {
    eyebrow: "Настройки",
    title: "Безопасность, аудит и соответствие",
    description: "Механизмы безопасности, аудита и соответствия в виде карточек политик (только фронтенд).",
    badge: "политика",
    policies: [
      ["Сначала согласование", "Критические действия требуют записей о согласовании человеком."],
      ["Внешние действия", "Публикация, отправка, запуск и вызовы интеграций закрыты."],
      ["Журнал аудита", "Фиксируются состояния: сформировано, изменено, одобрено, отклонено и выполнено."],
      ["Секреты", "Ссылки на секреты запланированы; расшифрованные значения никогда не показываются."],
      ["Слияние", "Слияние кода всегда выполняется вручную вне системы."],
    ],
  },
};

export const prototypeContent: Readonly<Record<Locale, PrototypeContent>> = Object.freeze({ en, ru });
