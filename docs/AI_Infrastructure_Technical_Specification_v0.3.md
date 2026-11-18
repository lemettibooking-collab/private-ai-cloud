# Проект «Инфраструктура для ИИ»

> **HISTORICAL / SUPERSEDED FOR STRATEGIC ARCHITECTURE** (notice added 2026-10-01, Roadmap v1.4)
>
> This document remains useful as historical context and is kept unchanged below. Where it conflicts with:
>
> - `docs/ROADMAP.md` v1.4 (canonical roadmap),
> - `docs/architecture/control-plane-architecture-v1.0.md`,
> - `docs/architecture/executor-adapter-strategy-v0.1.md`,
>
> the newer documents are authoritative. Private AI Cloud is now a vendor-neutral AI Engineering Control Plane: PAC owns the engineering process, and executors own the internal agent execution. Implementation status is determined by repository code, not by this document. See `docs/README.md`.
>
> Historical assumptions here that are **not** current requirements: separate Worker Service and Coding Worker processes; Redis + BullMQ for execution; one-time containers; headless Qwen Code inside a PAC coding-worker. Current direction: managed executor first, an `ExecutionEnvironment` abstraction, and a self-hosted/local fallback only when justified.

## Technical Specification v0.3

**Дата:** 14 августа 2026 года  
**Статус:** рабочая целевая спецификация MVP  
**Связанный документ:** ADR-001 «Оркестратор и специализированные агенты»

## 1. Назначение продукта

Платформа — внутренний AI Operations Center для управления продуктовой разработкой, поддержкой, контентом, аналитикой, продвижением и безопасностью проектов владельца. Первый целевой кейс — Smart Algorithms.

Пользователь не запускает множество агентов вручную. Он ставит цель или получает событие, а оркестратор выбирает workflow, исполнителей, модели, разрешения и контрольные точки.

## 2. Бизнес-цели MVP

- единая очередь задач и подтверждений владельца;
- управляемая подготовка заданий Codex;
- черновики поддержки на основе базы знаний;
- draft-only Telegram-контент с approval → publish;
- Weekly Owner Report;
- прозрачный audit действий AI;
- контроль стоимости, рисков и доступа к данным;
- foundation для multi-model и дополнительных агентов без привязки к одному поставщику.

## 3. Не входит в MVP

- полностью автономное управление бизнесом;
- auto-merge и auto-deploy;
- действия с реальными торговыми средствами;
- прямой доступ агентов к production-БД Smart Algorithms;
- автоматическая массовая публикация и нейрокомментинг без approval;
- отдельный микросервис для каждой логической роли;
- A2A между внутренними ролями ради самой технологии;
- собственный GPU-кластер и self-hosted frontier-модели;
- платежи и production traffic switch.

## 4. Пользовательские роли

- **Owner:** утверждает критические действия, запускает Codex, принимает merge/release решения.
- **Admin:** управляет пользователями, workflow и настройками в разрешённых пределах.
- **Support Operator:** работает с обращениями и черновиками ответов.
- **Marketing Operator:** работает с контентом и публикациями.
- **Product Manager:** управляет backlog, требованиями и продуктовой аналитикой.
- **Developer/Reviewer:** проверяет задания, diff, тесты и handoff.
- **Viewer:** read-only доступ к разрешённым данным.
- **Demo Viewer:** ограниченный демонстрационный контур без чувствительных данных.

## 5. Логические агенты

| Агент | Назначение | Разрешённый результат | Approval |
| --- | --- | --- | --- |
| Owner Assistant | Сводка, приоритеты, рекомендации | Dashboard/отчёт | Не нужен для read-only |
| Knowledge Agent | Поиск по загруженным документам | Ответ с источниками | По политике потребителя |
| Support Agent | Черновик ответа пользователю | Draft reply / escalation | Перед отправкой в MVP |
| Telegram Content Agent | Контент-план и посты | Draft post | Перед публикацией |
| Product Analyst Agent | Баги, сигналы, backlog | Insight / task proposal | Для изменения приоритета |
| Codex Task Agent | Узкое ТЗ для Codex | Prompt + Markdown task | Перед запуском Codex |
| Codex Developer Agent | Основной patch | Diff + verify logs | Owner запускает; merge вручную |
| Qwen Developer Agent | Research/review/tests/patch | Report или sandbox diff | По уровню допуска |
| QA/Review Agent | Проверка diff и логов | Review verdict | Блокирует при failure |
| Security/Compliance Agent | Риски и политики | Incident / block proposal | P0 может остановить workflow |
| Report Agent | Weekly Owner Report | Отчёт | Не нужен для генерации |

## 6. Архитектура выполнения

### 6.1 Компоненты

- **Web UI:** Next.js + TypeScript; Dashboard, Workflows, Approvals, Tasks, Agents, Reports, Settings.
- **Orchestrator Service:** отдельный Node.js/TypeScript-процесс; маршрутизация, state machine, policy checks, approvals.
- **Worker Service:** выполнение фоновых задач и model/tool calls.
- **Coding Worker:** отдельный изолированный runner для Codex/Qwen Code.
- **PostgreSQL:** источник истины для задач, workflow, approvals, audit и конфигураций.
- **Redis + BullMQ:** очереди, retries, locks, concurrency и scheduled jobs.
- **Object Storage:** загруженные документы, отчёты и артефакты.
- **pgvector:** поиск по Knowledge Base при подтверждённой необходимости.
- **Reverse Proxy:** HTTPS и маршрутизация.
- **Monitoring:** метрики, ошибки, трассировка, алерты и health checks.

### 6.2 Deployment units первого VPS

```text
reverse-proxy
web
orchestrator
worker
coding-worker
postgres
redis
monitoring
```

Облачные модели вызываются через API; обычному VPS не требуется GPU.

### 6.3 Гибридный оркестратор

Детерминированный слой отвечает за:

- RBAC и permissions;
- приоритеты P0–P4;
- state machine;
- бюджеты и rate limits;
- approval и блокировки;
- retries и idempotency;
- audit и incident response.

Manager Agent отвечает за:

- классификацию нестандартной задачи;
- разбиение на этапы;
- выбор подходящей роли из разрешённого списка;
- синтез нескольких результатов;
- понятную сводку владельцу.

Manager Agent не может обойти Policy Engine.

## 7. Model Provider Layer

Внутренний контракт:

```ts
interface ModelProvider {
  run(request: ModelRequest): Promise<ModelResult>;
  health(): Promise<ProviderHealth>;
}
```

Адаптеры:

- `OpenAIProvider`;
- `AnthropicProvider`;
- `DeepSeekProvider`;
- `QwenProvider`.

`ModelRouter` выбирает маршрут по:

- классу задачи;
- требуемому качеству;
- latency;
- стоимости;
- поддержке tools/structured output;
- региону и политике данных;
- доступности провайдера;
- результатам evals.

Начальный production-like маршрут использует одного основного провайдера. Остальные добавляются по одному после контрактных тестов. Совместимый формат API не считается гарантией одинакового поведения.

## 8. Coding Agent Runtime

### 8.1 Общий входной контракт

```json
{
  "taskId": "string",
  "agent": "codex|qwen",
  "repository": "string",
  "baseBranch": "string",
  "mode": "plan|review|test|patch",
  "scope": ["paths"],
  "allowedCommands": ["string"],
  "forbiddenActions": ["string"],
  "timeLimitMinutes": 45,
  "tokenBudget": 200000,
  "acceptanceCriteria": ["string"]
}
```

### 8.2 Изоляция

Каждый coding run:

1. получает временный git worktree/branch;
2. запускается в одноразовом контейнере;
3. получает только необходимые файлы и инструменты;
4. не получает production secrets;
5. имеет network allowlist;
6. ограничен CPU/RAM/time/token/cost;
7. возвращает diff, команды, логи и handoff;
8. уничтожается или архивируется после завершения.

### 8.3 Codex

- основной исполнитель утверждённых patch-задач;
- запуск только Owner в MVP;
- minimal diff и отсутствие несогласованного contract drift;
- обязательные lint/typecheck/build/smoke по task contract;
- merge и deploy вручную.

### 8.4 Qwen

Уровни допуска:

- `Q0 Researcher`: read-only;
- `Q1 Reviewer`: diff review;
- `Q2 Test Engineer`: тесты в sandbox;
- `Q3 Developer`: небольшой patch в отдельной ветке;
- `Q4 Long-running Developer`: длительная задача после eval gate.

Qwen Code запускается headless внутри coding-worker. Допустимы Plan, Ask Permissions, Auto-Edit и ограниченный Auto. YOLO запрещён.

Codex и Qwen не редактируют один набор файлов одновременно. Для одной задачи предпочтителен паттерн executor + independent reviewer.

## 9. Workflow Engine

Состояния задачи:

```text
draft -> classified -> policy_checked -> queued -> running
      -> awaiting_approval -> approved -> executing
      -> review -> completed | failed | blocked | cancelled
```

Каждый переход хранит:

- actor;
- timestamp;
- policy decision;
- input/output references;
- model/provider/version;
- token/cost/latency;
- tool calls;
- approval record;
- error и retry count.

## 10. Приоритеты

| Приоритет | Пример | Поведение |
| --- | --- | --- |
| P0 | Утечка, взлом, риск активам или данным | Немедленная блокировка и уведомление Owner |
| P1 | Падение, auth incident, массовая ошибка | Приостановка менее важных workflow |
| P2 | Релиз Scanner MVP, критическая задача | Плановая приоритетная работа |
| P3 | Поддержка, контент, аналитика | Параллельная обработка |
| P4 | Эксперименты, будущий терминал/боты | Backlog до выделения ресурсов |

## 11. Интеграция со Smart Algorithms

AI-платформа разворачивается как отдельный control plane и подключается через ограниченный Internal API.

Разрешённые начальные методы:

- `getSystemHealth`;
- `getAggregatedUserMetrics`;
- `getOpenSupportIssues`;
- `createDevelopmentTaskDraft`;
- `getReleaseStatus`;
- `createTelegramPostDraft`.

Запрещены на первом этапе:

- произвольный SQL;
- запись в auth/user tables;
- production deploy;
- live trading;
- доступ к exchange secrets;
- массовый экспорт персональных данных.

Для RU-контура персональные данные остаются в RU-инфраструктуре. Во внешнюю модель отправляется минимально необходимый обезличенный контекст.

## 12. MCP и A2A

- MVP использует внутренние typed functions и очередь.
- MCP вводится после стабилизации tool contracts для повторно используемых интеграций.
- A2A вводится только для независимых удалённых агентов/сервисов с собственным endpoint и auth.
- Внутренние агенты не получают право прямого бесконтрольного общения; оркестратор остаётся владельцем task state.

## 13. Безопасность

- least privilege и deny-by-default;
- секреты только на server side;
- отдельные service accounts;
- encryption in transit и at rest;
- audit всех model/tool calls;
- prompt-injection boundaries;
- redaction PII и секретов;
- dependency и secret scanning для code runs;
- подтверждение внешних, финансовых, публикационных и необратимых действий;
- kill switch для workflow, агента, провайдера и инструмента;
- backup/restore drills;
- incident states P0/P1.

## 14. Наблюдаемость и бюджеты

Метрики:

- task success rate;
- approval rate и wait time;
- tokens/cost per workflow;
- latency p50/p95;
- tool failure rate;
- retry/loop count;
- rollback/rework rate;
- coding-agent acceptance rate;
- incidents by severity;
- provider availability.

Бюджеты задаются на run, workflow, agent, provider и день/месяц.

## 15. Evals и quality gates

Для каждого агента создаётся эталонный набор реальных обезличенных задач.

Qwen получает повышение уровня допуска только если:

- не нарушает scope и forbidden actions;
- стабильно возвращает воспроизводимые логи;
- не ухудшает protected tests;
- не создаёт security findings высокой тяжести;
- имеет приемлемую долю принятых результатов;
- стоимость и время не превышают заданные границы;
- успешно проходит replay на ранее решённых задачах.

## 16. Основные таблицы

```text
users
roles
agents
agent_versions
model_providers
model_routes
tools
tool_permissions
workflows
workflow_versions
tasks
task_steps
approvals
model_calls
tool_calls
artifacts
audit_events
incidents
budgets
eval_suites
eval_runs
knowledge_documents
```

## 17. Definition of Done MVP

MVP считается готовым, когда:

- Owner видит Approval Queue + Activity Summary;
- три начальных workflow работают end-to-end;
- все внешние действия проходят предусмотренный approval;
- модель вызывается только через provider adapter;
- task state восстанавливается после перезапуска;
- audit содержит полный путь задачи;
- Qwen Q0/Q1 протестирован на Smart Algorithms eval set;
- coding worker изолирован и не имеет production secrets;
- backup/restore и kill switch проверены;
- staging VPS проходит smoke и incident drill.
