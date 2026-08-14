# Проект «Инфраструктура для ИИ»

## Исполнительный план v0.5 — после аудита репозитория

**Дата:** 14 августа 2026 года  
**Статус:** фактический baseline и очередь реализации  
**Проект в коде:** Private AI Cloud  
**Первый продуктовый workspace:** Smart Algorithms Demo  
**Приоритет:** Development Agents workflow

---

## 1. Фактическое состояние

### Подтверждено аудитом Codex

- Локальный проект существует: `/Users/rabota2/Desktop/IT/Private AI Cloud/private-ai-cloud`.
- Это Git-репозиторий на ветке `main`.
- В репозитории восемь коммитов.
- Git remote и upstream отсутствуют.
- GitHub repository не подтверждён.
- `gh` установлен, но авторизация недействительна.
- Рабочее дерево dirty из-за пяти untracked-документов.
- Проект — single Next.js 16.2.9 app, а не monorepo.
- Реализован подробный frontend-прототип AI Operations Center.
- Все основные продуктовые страницы существуют, но используют mock data.
- Есть raw PostgreSQL migration на 17 P0-таблиц.
- Есть idempotent seed Smart Algorithms Demo.
- SQL migration и seed ни разу не применялись: локально отсутствовал `psql`.
- Backend runtime, API routes, auth, server-side RBAC, Redis/BullMQ и Docker отсутствуют.
- Codex Task, QA Review, Support Reply и Telegram Content существуют только как статические UI-сценарии.
- ModelProvider, Agent Registry, Qwen и coding-worker существуют только в документации.
- В проекте нет test/typecheck/smoke scripts, CI и security scanning.

### Реально выполненная продуктовая работа

1. UI prototype baseline.
2. Dashboard владельца.
3. Knowledge Base и RAG Chat mock surfaces.
4. Все десять AI Departments.
5. Каталог workflow и четыре run-формы.
6. Approval Queue и approval detail mock.
7. Weekly Owner Report mock.
8. Settings, роли, интеграции, security и operator console mock.
9. Roadmap UI.
10. UX Patch 1: roadmap, согласованные approval counts, Document Intelligence, workflow filters, approval detail, chat composer и lifecycle strip.
11. DB-01: foundation scaffold.
12. DB-02: первая raw SQL migration.
13. DB-03: Smart Algorithms Demo seed.

### Что нельзя считать работающим

- реальные AI-агенты;
- оркестратор;
- state machine;
- approvals как механизм безопасности;
- сохранение задач и результатов;
- работающая БД;
- Knowledge retrieval/RAG;
- внешние публикации;
- GitHub-интеграция;
- QA по diff;
- Qwen reviewer;
- production/staging deployment.

---

## 2. Архитектурные решения после аудита

### 2.1 Сохранить single-app на первый вертикальный срез

Не переводить проект в monorepo сейчас. Отдельные `orchestrator`, `worker` и `coding-worker` нужны позднее, но ранний перенос создаст большой diff без доказанной пользы.

На первом этапе разделять модули внутри текущего приложения:

```text
lib/
  contracts/
  db/
  policy/
  workflows/
  providers/
  audit/
```

Выделение сервисов выполнять после появления очередей и изолированного coding runner.

### 2.2 Сохранить PostgreSQL + raw SQL

- Первая локальная БД: PostgreSQL 16 через Homebrew, поскольку Docker ранее был блокером на текущем Mac.
- Production provider пока не выбирать.
- Миграции остаются provider-neutral PostgreSQL.
- Raw SQL сохраняется до стабилизации P0/P1 schema и read-only queries.
- Docker Compose возвращается для воспроизводимой разработки и VPS позднее, но не блокирует первый локальный milestone.

### 2.3 Разделить типы состояний

Одна строка `status` не должна одновременно описывать задачу, workflow, approval и risk.

Канонические словари:

```text
TaskStatus:
draft | classified | policy_checked | queued | running |
awaiting_approval | approved | executing | review |
completed | failed | blocked | cancelled

WorkflowRunStatus:
draft | queued | running | awaiting_approval | approved |
executing | review | completed | rejected | failed |
blocked | cancelled

ApprovalStatus:
pending | approved | rejected | changes_requested |
expired | cancelled

RiskLevel:
low | medium | high | critical
```

`blocked` — состояние, а не уровень риска. Старые `generated`, `waiting_approval` и `executed` должны быть сопоставлены в отдельном migration/compatibility решении; нельзя менять их попутно в UI-задаче.

### 2.4 Канонические role codes

```text
owner
admin
support_operator
marketing_operator
product_manager
developer_reviewer
viewer
demo_viewer
```

Display labels могут быть локализованы. Permissions и persistence используют стабильные codes.

### 2.5 Первый model route

1. `MockProvider` для тестов.
2. `OpenAIProvider` как первый реальный adapter.
3. Qwen только после устойчивого Development Workflow и eval set.
4. Anthropic и DeepSeek — после contract tests и метрик.

---

## 3. Правильная последовательность разработки

## Волна 0. Зафиксировать baseline

### AI-001 — Documentation baseline

- признать Technical Specification v0.3, Roadmap v0.3, ADR-001 и этот план каноническими;
- переименовать ADR без `копия`;
- поместить ADR в стабильную папку `docs/adr/`;
- обновить README/PROJECT_STATUS по реальному состоянию DB-01–DB-03;
- сохранить документы в Git отдельным commit;
- не смешивать с кодовыми изменениями.

### AI-002 — GitHub linkage

Выполняется отдельно после решения Owner:

- выбрать имя и видимость GitHub repository;
- восстановить авторизацию `gh` или использовать web flow;
- создать пустой repository без README/license/gitignore либо выбрать существующий;
- добавить `origin`;
- проверить, что секреты и ненужные файлы не попадут в push;
- push `main` и установить upstream;
- не включать deployment и CI secrets.

**Gate 0:** canonical docs находятся в Git; рабочее дерево ожидаемо clean; GitHub remote подтверждён либо Owner явно решил временно работать local-only.

## Волна 1. Quality foundation

### AI-003 — Runtime и verification contract

- закрепить Node/npm версии;
- добавить `typecheck`;
- добавить минимальный unit-test runner;
- добавить `test`;
- добавить безопасный `smoke` для ключевых страниц/контрактов;
- не менять UI и продуктовую логику;
- зафиксировать команды в README.

### AI-004 — Contract convergence

- создать единые типы role/status/risk;
- добавить mapping старых mock/SQL значений;
- покрыть mapping unit tests;
- не менять migration `0001` до отдельного schema review;
- не выполнять широкий refactor UI.

**Gate 1:** `lint`, `typecheck`, `test`, `build`, `smoke` воспроизводимы; канонические словари проверяются тестами.

## Волна 2. Первый функциональный Development Agent

### AI-005 — Codex Task Artifact v1

Цепочка:

```text
Owner вводит задачу
→ детерминированная validation/normalization
→ система создаёт copy-ready Codex prompt
→ система создаёт Markdown artifact
→ Owner копирует или скачивает результат
→ Codex запускается вручную
```

Обязательные поля артефакта:

- goal;
- current context;
- scope;
- non-goals;
- allowed/touched paths;
- allowed commands;
- forbidden actions;
- acceptance criteria;
- verification commands;
- expected handoff.

На этом этапе агент может быть детерминированным генератором, а не LLM. Это создаёт реальный полезный workflow без API-ключа и без ложной автономности.

### AI-006 — Prompt artifact tests и UX truthfulness

- serializer/validator tests;
- empty/invalid input cases;
- escaping и Markdown structure;
- запреты merge/deploy/secrets/out-of-scope;
- UI явно сообщает, что Codex не был запущен;
- отсутствие сетевых и Git side effects.

**Gate 2:** реальная задача Smart Algorithms превращается в корректный prompt/Markdown; результат зависит от input и проходит тесты.

## Волна 3. Проверить и подключить DB foundation

### AI-007 — DB-03.5 Local SQL validation

- установить/подключить PostgreSQL 16 отдельно от patch;
- создать только disposable local database;
- применить `0001_initial_p0_schema.sql`;
- запустить seed два раза;
- проверить constraints, foreign keys, unique keys и ожидаемые counts;
- не подключать приложение;
- сохранить фактические команды и результаты.

### AI-008 — Read-only DB runtime

- server-only DB client;
- validated `DATABASE_URL`;
- typed read queries;
- dev demo workspace context;
- no writes;
- no auth imitation;
- graceful local error reporting.

### AI-009 — Read-only API и первая DB-backed page

- начать с Approvals;
- сохранить external actions locked;
- не использовать mock fallback молча: dev UI должен показывать источник данных;
- route tests;
- затем Knowledge/Workflows/Reports по одному.

**Gate 3:** миграция и seed воспроизводимы; `/approvals` читает данные из локальной PostgreSQL без write endpoints.

## Волна 4. Development domain persistence

Текущих 17 таблиц недостаточно для нового Development Workflow.

### AI-010 — Schema v0.2 design

Добавить проектирование:

- `tasks`;
- `task_steps`;
- `prompt_versions`;
- `artifacts`;
- `codex_run_intakes`;
- `review_verdicts`;
- `approval_decisions`;
- `agent_versions`;
- `model_calls`;
- `budgets`;
- `incidents`.

Сначала blueprint/review, затем migration `0002`; не переписывать применённую `0001` после прохождения validation.

### AI-011 — Task state machine

- детерминированные переходы;
- transition guards;
- Owner approval gate;
- idempotency;
- cancellation и blocked;
- audit event на каждый переход;
- restart recovery через PostgreSQL;
- unit/integration tests.

### AI-012 — Persisted Codex Task workflow

- сохранить Task и PromptVersion;
- создать Artifact;
- записать approval request;
- сохранить решение Owner;
- manual Codex launch остаётся вне системы;
- никаких GitHub actions.

**Gate 4:** задача и approval переживают restart, а незаконный переход блокируется.

## Волна 5. Ручной результат Codex и QA/Review

### AI-013 — Codex Run Intake v1

- ручная вставка summary, diff/stat, commands и verify logs;
- связь с Task/PromptVersion;
- evidence completeness validation;
- хеширование артефакта;
- audit trail;
- без исполнения команд на сервере.

### AI-014 — QA/Review v1

- scope adherence;
- acceptance criteria coverage;
- unrelated changes;
- contract drift;
- lint/typecheck/test/build/smoke evidence;
- verdict: `approve`, `changes_requested`, `blocked`, `insufficient_evidence`;
- ручная запись merge decision, но merge только вне системы.

**Gate 5:** полный ручной путь Development Workflow работает end-to-end.

## Волна 6. Настоящий model layer

### AI-015 — ModelProvider + MockProvider

- единый contract;
- structured output validation;
- usage/cost/latency model;
- tool allowlist;
- provider health;
- deterministic contract tests.

### AI-016 — OpenAIProvider

- server-side secret;
- redaction;
- bounded retry и timeout;
- model/version audit;
- budget enforcement;
- отсутствие прямого SDK import вне adapter.

### AI-017 — Model-assisted Codex Task и QA

- модель улучшает prompt или review;
- детерминированная validation остаётся обязательной;
- model failure не теряет Task;
- результат модели не обходит approval/policy.

**Gate 6:** workflow работает через MockProvider и OpenAIProvider без изменения бизнес-контракта.

## Волна 7. Qwen Q0–Q1

### AI-018 — Smart Algorithms eval set

- реальные обезличенные задачи;
- expected scope/files/risks;
- known defects;
- acceptance rubric;
- replay format.

### AI-019 — QwenProvider и Q0 Researcher

- read-only repository analysis;
- structured handoff;
- no patch/write/secret access.

### AI-020 — Qwen Q1 Reviewer

- независимый review diff Codex;
- defects/false positives;
- scope adherence;
- tokens/cost/latency;
- promotion gate.

**Gate 7:** Qwen даёт измеримую пользу и не нарушает scope. Q2/Q3 остаются заблокированы.

## Волна 8 и далее

После Development Workflow:

1. Knowledge Base v1 и source citations.
2. Support Reply: manual input → KB → draft → approval.
3. Telegram Content: brief → draft; publish contract остаётся locked до adapter.
4. Weekly Owner Report с provenance.
5. Redis/BullMQ и отдельный worker.
6. Изолированный coding-worker.
7. Qwen Q2–Q3.
8. Staging VPS и incident drills.
9. Smart Algorithms read-mostly Internal API.
10. Multi-model Router.
11. MCP для стабильных tools.
12. A2A для независимых remote agents.
13. Qwen Q4 после eval/replay gates.
14. Growth-каналы с approval и anti-spam controls.

---

## 4. Что делать прямо сейчас

### Ручные решения Owner

1. Подтвердить, что документы v0.3, ADR-001 и планы v0.4/v0.5 являются baseline.
2. Решить, создаём ли новый private GitHub repository для `private-ai-cloud`.
3. Утвердить сохранение single-app до работающего Development Workflow.
4. Утвердить PostgreSQL 16 через Homebrew для локальной DB validation.
5. Утвердить OpenAI как первый provider после MockProvider.

### Первый кодовый patch

После отдельного документационного commit начинать с `AI-003 — Runtime и verification contract`. Только после его review выполнять `AI-004`, затем `AI-005`.

---

## 5. Промт Codex №1 — Runtime и verification foundation

Запускать только после того, как baseline-документы сохранены отдельным commit и рабочее дерево проверено.

```text
Ты работаешь в репозитории Private AI Cloud как senior TypeScript/Next.js engineer.

ЗАДАЧА
Реализуй узкий foundation patch AI-003: закрепи runtime/package-manager contract и добавь воспроизводимые typecheck + unit test scripts. Не меняй продуктовую логику, UI, SQL schema, mock data и архитектуру приложения.

СНАЧАЛА ПРОВЕРЬ
1. Прочитай AGENTS.md, если он есть.
2. Покажи `git status --short --branch`.
3. Подтверди текущий root, branch и package manager.
4. Прочитай `package.json`, `package-lock.json`, `tsconfig.json`, ESLint config и README.
5. Если рабочее дерево содержит неожиданные изменения, пересекающиеся с разрешёнными файлами, остановись и сообщи.

РАЗРЕШЁННЫЙ SCOPE
- `package.json`
- `package-lock.json`
- `.nvmrc` или другой один выбранный runtime-version file
- конфигурация unit-test runner только при необходимости
- новая папка с одним минимальным безопасным unit test
- README: только секция local prerequisites/verification

НЕ МЕНЯТЬ
- `app/**`
- `components/**`
- `lib/mock-data.ts`
- `lib/workflow-config.ts`
- `types/**`
- `db/**`
- `docs/**`, кроме строго указанной секции README
- стили, тексты интерфейса и маршруты

ТРЕБОВАНИЯ
1. Закрепи поддерживаемую Node major/minor версию, совместимую с текущим Next.js 16.2.9.
2. Закрепи npm/package-manager contract без перехода на pnpm/yarn.
3. Добавь `npm run typecheck`, выполняющий TypeScript noEmit check.
4. Добавь минимальный unit-test runner, совместимый с текущим TypeScript/Next.js стеком.
5. Добавь `npm test` в non-watch режиме, пригодном для CI.
6. Добавь один минимальный unit test чистой функции/контракта без React/browser/network/DB. Если подходящей чистой функции нет, создай только небольшой test fixture/helper внутри test scope; не рефактори production code ради теста.
7. Не добавляй smoke/CI в этот patch: они будут отдельными задачами.
8. Не добавляй DB, auth, provider SDK, Docker или API routes.
9. Не обновляй существующие зависимости без необходимости.
10. Не запускай Git/GitHub mutations, commit, push или PR.

ACCEPTANCE CRITERIA
- Runtime и npm prerequisites явно зафиксированы.
- Существующие `dev`, `build`, `start`, `lint` scripts сохранены.
- `npm run typecheck` существует и проходит.
- `npm test` существует, завершается и запускает минимум один meaningful unit test.
- `npm run lint` проходит.
- `npm run build` проходит.
- Нет изменений вне scope.
- Нет секретов, generated build output или cache в diff.

VERIFY
Выполни по порядку:
1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `git diff --check`
6. `git status --short`

Если установка dependency требует изменения package-lock, это допустимо только для выбранного test runner и его прямых обязательных зависимостей.

HANDOFF
Верни:
1. Root cause / зачем нужен patch.
2. Изменённые файлы.
3. Выбранные Node/npm/test-runner версии и обоснование совместимости.
4. Что именно проверяет добавленный test.
5. Полные результаты verify-команд.
6. `git diff --stat`.
7. Риски/ограничения.
8. Подтверждение, что commit/push не выполнялись.

После handoff остановись. Не выполняй следующий patch.
```

---

## 6. Контрольная точка после первого patch

Не переходить к Codex Task Agent автоматически. Сначала проверить:

- нет ли лишнего обновления зависимостей;
- корректно ли закреплена Node-версия;
- не созданы ли generated/cache файлы;
- действительно ли тест meaningful;
- проходят ли четыре verify-команды;
- чист ли diff от UI/DB/architecture changes.

После review создать отдельный prompt для `AI-004 — Contract convergence`. Затем отдельный prompt для `AI-005 — Codex Task Artifact v1`.
