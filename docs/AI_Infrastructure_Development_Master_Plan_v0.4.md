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
> Historical assumptions here that are **not** current requirements: separate orchestrator/worker/coding-worker services; PostgreSQL + Redis Docker foundation; QwenProvider headless contract; an isolated Coding Worker with one-time containers. Current direction: managed executor first, an `ExecutionEnvironment` abstraction, and a self-hosted/local fallback only when justified.

## Единый план разработки v0.4

**Дата:** 14 августа 2026 года  
**Статус:** рабочий план запуска разработки  
**Основание:** Technical Specification v0.3 и Roadmap v0.3 от 14 августа 2026 года  
**Первый целевой кейс:** Smart Algorithms  
**Стартовый приоритет:** агенты разработки и управляемый Development Workflow

---

## 1. Итоговое решение

Разработку следует начинать не со всех агентов одновременно, а с одного узкого сквозного контура разработки:

```text
Owner создаёт задачу
→ Codex Task Agent готовит строгое ТЗ и Markdown-артефакт
→ Owner подтверждает запуск
→ Codex выполняет patch вручную или через будущий sandbox
→ система принимает diff и verify logs
→ QA/Review Agent выдаёт verdict
→ Owner вручную принимает решение о merge
```

Этот контур первым проверяет главные свойства платформы: Task, Workflow, Approval, Audit, роли, артефакты, модельный адаптер, контроль бюджета и human-in-the-loop. После него те же механизмы можно безопасно переиспользовать для поддержки, Telegram-контента, отчётов и других агентов.

На первом этапе Codex не получает право самостоятельно выполнять merge, deploy или работать с production-секретами. Qwen подключается сначала как Q0 Researcher и Q1 Reviewer. Автономный coding-worker создаётся только после появления стабильного ручного workflow и eval-набора.

---

## 2. Что уже подтверждено документами

### 2.1 Готово на уровне продуктовых решений

- Зафиксирован продукт: внутренний AI Operations Center владельца.
- Первый целевой кейс — Smart Algorithms.
- Выбран центральный гибридный оркестратор: детерминированный Policy Engine + Manager Agent.
- Зафиксированы пользовательские роли: Owner, Admin, Support Operator, Marketing Operator, Product Manager, Developer/Reviewer, Viewer, Demo Viewer.
- Зафиксированы логические агенты продукта.
- Определены приоритеты P0–P4.
- Зафиксирован human-in-the-loop и Approval Queue.
- Зафиксирован provider-agnostic слой с целевыми OpenAI, Anthropic, DeepSeek и Qwen adapters.
- Codex выбран основным исполнителем patch-задач.
- Для Qwen определены уровни допуска Q0–Q4.
- Запрещены YOLO, auto-merge, auto-deploy, production secrets и прямой доступ агентов к production-БД.
- Определена отдельная архитектура control plane и ограниченная интеграция со Smart Algorithms.
- Определены базовые требования к безопасности, audit, бюджетам, evals и наблюдаемости.
- Сформирован целевой roadmap до multi-model, MCP, A2A, Qwen Q4 и growth-каналов.

### 2.2 Не подтверждено кодом и требует аудита

- существует ли отдельный локальный репозиторий проекта;
- создан ли репозиторий на GitHub и какой у него remote URL;
- какая ветка является основной;
- есть ли Next.js-приложение и отдельные сервисы orchestrator/worker;
- выбрана ли структура monorepo;
- существуют ли Docker Compose, PostgreSQL migrations и Redis/BullMQ;
- реализованы ли Task, Workflow, Approval, AuditEvent и RBAC;
- есть ли модельный adapter layer;
- есть ли тесты, CI, lint, typecheck, build и smoke-команды;
- реализован ли хотя бы один end-to-end workflow;
- есть ли ADR-001 отдельным файлом;
- какие части документации уже устарели относительно кода.

Следовательно, отметки о реализации нельзя переносить из roadmap в backlog как факт до завершения технического аудита репозитория.

---

## 3. Границы первой версии

### Входит в первую рабочую версию

1. Локально запускаемый репозиторий.
2. Web UI с первым экраном Owner: Approval Queue + Activity Summary.
3. Базовые сущности Task, Workflow, Approval, AuditEvent, Artifact.
4. RBAC с deny-by-default.
5. Устойчивая state machine и восстановление после перезапуска.
6. ModelProvider contract, MockProvider и один основной provider adapter.
7. Codex Task workflow.
8. Ручная загрузка результата Codex: summary, diff, команды и verify logs.
9. QA/Review workflow v1.
10. Agent Registry и версии конфигураций агентов.
11. Бюджеты, correlation ID и полный audit trail.
12. Qwen Q0/Q1 после создания eval-набора.
13. Support Reply и Telegram Draft после стабилизации development workflow.
14. Ручная Knowledge Base и Weekly Owner Report.

### Не входит в первую рабочую версию

- auto-merge и auto-deploy;
- автоматический production-доступ Codex или Qwen;
- Qwen Q2–Q4 до прохождения gates;
- live trading, exchange keys и финансовые действия;
- прямой произвольный SQL к Smart Algorithms;
- массовая автоматическая публикация или нейрокомментинг;
- MCP/A2A до стабилизации внутренних typed contracts;
- одновременное редактирование одних файлов несколькими coding agents;
- собственный GPU-кластер.

---

## 4. Целевая структура продукта

Предпочтительный вариант — TypeScript monorepo, если аудит не обнаружит уже принятую и жизнеспособную структуру.

```text
apps/
  web/                 # Next.js UI
  orchestrator/        # state machine, policy, routing, approvals
  worker/              # background jobs и model/tool calls
  coding-worker/       # изолированные code runs; добавляется позже
packages/
  contracts/           # shared schemas и typed contracts
  database/            # schema, migrations, repositories
  auth/                # RBAC и permissions
  policy/              # risk classes, approval rules, kill switches
  providers/           # ModelProvider и adapters
  workflows/           # versioned workflow definitions
  observability/       # logs, metrics, tracing, correlation ID
  config/              # validated environment configuration
docs/
  adr/
  product/
  runbooks/
infra/
  docker/
  monitoring/
```

Это не команда на рефакторинг существующего проекта. Окончательное решение принимается после аудита. Если текущая структура уже обеспечивает разделение ответственности, её следует сохранить и расширять minimal diff.

---

## 5. Единый поэтапный план

## Этап 0. Read-only аудит и фиксация baseline

**Цель:** установить фактическое состояние проекта и GitHub до любых изменений.

Работы:

- найти корень проекта в текущем workspace;
- проверить Git repository, текущую ветку, remotes, upstream и рабочее дерево;
- определить, существует ли связанный GitHub repository;
- собрать карту директорий, приложений, сервисов и пакетов;
- определить стек, package manager, версии runtime и команды проверки;
- найти AGENTS.md, README, ADR, спецификации и roadmap;
- найти env-примеры без чтения/вывода секретов;
- проверить Docker, БД, Redis, queues, migrations, CI и тесты;
- построить матрицу «требование v0.3 → реализовано / частично / отсутствует / неясно»;
- перечислить конфликты документации и кода;
- предложить первые задачи без изменения файлов.

**Результат:** `REPOSITORY_AUDIT_2026-08-14.md`.

**Gate 0:** Owner понимает, где находится проект, существует ли GitHub remote, что реально сделано и с какой задачи начинать.

## Этап 1. Репозиторий и локальный foundation

**Цель:** получить воспроизводимый локальный skeleton.

Работы:

- утвердить существующий layout или минимально создать monorepo;
- добавить/проверить README с запуском;
- добавить `.env.example` только с именами переменных;
- поднять PostgreSQL и Redis в Docker Compose;
- добавить миграции и seed для локальной разработки;
- создать shared contracts и runtime validation;
- настроить lint, typecheck, unit tests, build и smoke;
- добавить CI без deploy;
- включить structured logging и correlation ID;
- зафиксировать ADR по структуре репозитория.

**Gate 1:** чистый clone запускается по инструкции; проверки воспроизводимы; секретов в репозитории нет.

## Этап 2. Control Plane Core

**Цель:** реализовать безопасный каркас, на котором работают все агенты.

Основные сущности:

- User, Role, Permission;
- Agent, AgentVersion;
- Task, TaskStep;
- Workflow, WorkflowVersion;
- Approval;
- Artifact;
- AuditEvent;
- Budget;
- Incident.

Работы:

- RBAC с полными восемью продуктовыми ролями;
- state machine из v0.3;
- Policy Engine deny-by-default;
- risk classification и приоритеты P0–P4;
- immutable audit переходов;
- idempotency keys;
- retry, timeout, cancel и blocked states;
- kill switch для workflow/agent/provider/tool;
- базовые API и UI для Tasks, Approvals и Activity.

**Gate 2:** тестовая задача проходит состояния и восстанавливается после рестарта; защищённое действие невозможно без approval.

## Этап 3. Model Provider Foundation

**Цель:** исключить прямую зависимость workflow от SDK конкретной модели.

Работы:

- `ModelProvider` contract;
- MockProvider для deterministic tests;
- OpenAIProvider как первый production-like adapter;
- JSON Schema/Zod validation structured output;
- tool allowlist;
- server-side secrets;
- usage, cost, latency и provider health;
- retry policy и rate limits;
- redaction чувствительных данных до model call.

**Gate 3:** provider SDK импортируется только внутри adapter package; тестовый workflow работает через MockProvider и основной adapter.

## Этап 4. Development Workflow v1 — первый вертикальный срез

### 4.1 Codex Task Agent

Вход:

- бизнес-цель;
- контекст проекта;
- scope и предполагаемые файлы;
- acceptance criteria;
- ограничения и risk class.

Выход:

- copy-ready prompt;
- Markdown task artifact;
- non-goals;
- touched-files policy;
- разрешённые команды;
- forbidden actions;
- verification plan;
- handoff format.

MVP-поведение:

- формирование задания внутри кабинета;
- сохранение версии промта;
- approval Owner;
- кнопка копирования;
- скачиваемый Markdown;
- без автоматического запуска Codex в первом шаге.

### 4.2 Codex Run Intake v1

- Owner запускает Codex вручную;
- вставляет summary, diff/stat, test logs и handoff в кабинет;
- система связывает результат с Task и PromptVersion;
- артефакты хешируются и записываются в audit;
- merge остаётся вне системы и только вручную.

### 4.3 QA/Review Agent v1

- проверяет соответствие scope и acceptance criteria;
- проверяет наличие contract drift и несвязанных изменений;
- анализирует lint/typecheck/test/build/smoke logs;
- выдаёт `approve`, `changes_requested`, `blocked` или `insufficient_evidence`;
- не выполняет merge;
- Security/Compliance rule может заблокировать результат.

**Gate 4:** одна реальная задача Smart Algorithms проходит полный цикл от постановки до review verdict, а каждое решение видно в audit.

## Этап 5. Agent Registry и Qwen Q0–Q1

**Цель:** добавить второго разработчика сначала без права менять код.

Работы:

- карточка агента: назначение, версия, provider/model, permissions, budgets, allowed modes;
- QwenProvider и headless contract;
- Q0 Researcher для read-only исследования репозитория;
- Q1 Reviewer для независимого review diff Codex;
- Smart Algorithms eval set из обезличенных прошлых задач;
- метрики scope adherence, defects found, false positives, latency, tokens и cost;
- executor/reviewer separation;
- запрет параллельного владения одними файлами.

**Gate 5:** Qwen даёт воспроизводимый structured handoff и не нарушает scope. Повышение до Q2 запрещено без формального решения по eval metrics.

## Этап 6. Knowledge Base v1

**Цель:** дать агентам управляемый источник знаний.

Работы:

- ручная загрузка документов через кабинет;
- parsing, chunking, source/version metadata;
- access control на уровне документа и проекта;
- retrieval с обязательными ссылками на источник;
- защита от prompt injection в документах;
- отдельные project spaces;
- позже — GitHub/Drive connectors после стабилизации ручной загрузки.

**Gate 6:** ответ воспроизводим по разрешённым источникам; недоступный документ не попадает в prompt.

## Этап 7. Остальные workflow MVP

### Support Reply

- ручная вставка обращения;
- поиск по Knowledge Base;
- draft ответа и confidence;
- эскалация неизвестного или рискованного вопроса;
- approval перед отправкой;
- затем Telegram bot и чат сайта через adapters.

### Telegram Content

- brief и контент-план;
- draft поста;
- brand/compliance checks;
- архитектурный контракт approval → publish;
- первая реализация может оставаться draft-only.

### Weekly Owner Report

- поддержка и частые вопросы;
- баги и feature requests;
- Telegram drafts/posts;
- лиды, Pro/waitlist signals;
- продуктовые рекомендации;
- стоимость, latency, failures и incidents агентов.

**Gate 7:** три бизнес-workflow работают end-to-end; Owner первым видит Approval Queue и Activity Summary.

## Этап 8. Изолированный Coding Worker

**Цель:** заменить ручной запуск Codex безопасным контролируемым runner, не меняя бизнес-контракт workflow.

Работы:

- одноразовый container;
- временный git worktree/branch;
- allowlist команд и сети;
- read/write scope по путям;
- лимиты CPU/RAM/time/token/cost;
- отсутствие production secrets;
- secret/dependency scanning;
- сбор diff, stdout/stderr и verify logs;
- очистка или контролируемый архив;
- Owner-only запуск;
- технический запрет merge/deploy/main write.

**Gate 8:** escape, secret и forbidden-action tests проходят; runner не может получить production credentials.

## Этап 9. Qwen Q2–Q3

- Q2 запускает тесты в sandbox;
- Q3 выполняет небольшие patch-задачи только в allowlisted paths;
- Plan, Ask Permissions, Auto-Edit и ограниченный Auto;
- YOLO запрещён runner-политикой;
- protected tests;
- QA и Security review каждого diff;
- rejection, rework и rollback metrics.

**Gate 9:** установленный порог patches принимается без ухудшения protected tests и без security incidents.

## Этап 10. Staging и эксплуатационная готовность

- первый VPS без GPU;
- reverse proxy и HTTPS;
- web, orchestrator, worker, coding-worker, PostgreSQL, Redis, monitoring;
- secrets management;
- health/readiness;
- centralized logs, metrics, alerts и tracing;
- backup/restore drill;
- P0/P1 incident drill;
- provider outage и queue recovery drills;
- manual rollback runbook.

**Gate 10:** smoke, restore, incident и rollback проверки пройдены.

## Этап 11. Smart Algorithms Integration

- отдельный service account;
- read-mostly Internal API;
- только allowlisted endpoints из v0.3;
- PII redaction;
- RU data-boundary review;
- audit и rate limits;
- отсутствие прямого доступа к БД, auth tables, exchange secrets и deploy.

**Gate 11:** компрометация AI control plane не открывает production-БД и торговые активы Smart Algorithms.

## Этап 12. Multi-model Router

- Anthropic и DeepSeek adapters добавляются по одному;
- contract tests;
- routing по task class, quality, cost, latency, privacy, region и health;
- совместимые fallback policies;
- shadow evaluation и A/B;
- budget dashboard.

**Gate 12:** смена провайдера не меняет бизнес-контракт workflow.

## Этап 13. MCP, A2A и долгие задачи

Порядок строго последовательный:

1. Стабилизировать внутренние typed tools.
2. Вынести 1–2 повторно используемых контракта в MCP без расширения прав.
3. Подключать A2A только для независимого удалённого сервиса с auth, idempotency, audit и kill switch.
4. Допускать Qwen Q4 только после replay/evals, checkpoints, heartbeat, loop detection и dynamic budget stop.

## Этап 14. Growth и внешние каналы

- Telegram monitoring;
- Instagram только через официальный API;
- approved-source allowlist;
- relevance scoring;
- draft comments;
- daily limits, deduplication и brand/safety review;
- approval перед публикацией;
- автопауза при негативных сигналах;
- отсутствие массового спама и скрытой имитации независимого человека.

---

## 6. Первый backlog после аудита

Порядок задач может быть скорректирован результатом аудита, но базовая очередь такова:

1. `AI-001` — Repository baseline и GitHub status.
2. `AI-002` — ADR структуры репозитория и service boundaries.
3. `AI-003` — Local Docker foundation: PostgreSQL + Redis.
4. `AI-004` — Shared contracts и config validation.
5. `AI-005` — Database schema: Task/Workflow/Approval/Audit/Artifact.
6. `AI-006` — Task state machine и transition tests.
7. `AI-007` — RBAC и Policy Engine deny-by-default.
8. `AI-008` — Owner Dashboard shell: Approval Queue + Activity Summary.
9. `AI-009` — MockProvider + ModelProvider contract.
10. `AI-010` — OpenAIProvider adapter.
11. `AI-011` — Codex Task form и prompt artifact.
12. `AI-012` — Manual Codex result intake.
13. `AI-013` — QA/Review verdict workflow.
14. `AI-014` — Smart Algorithms development eval set.
15. `AI-015` — Qwen Q0 Researcher.
16. `AI-016` — Qwen Q1 Reviewer.

Каждая задача должна быть маленькой, иметь non-goals, разрешённые файлы, acceptance criteria, verification commands и отдельный commit checkpoint.

---

## 7. Сквозные требования ко всем задачам

### Безопасность

- deny-by-default;
- least privilege;
- секреты только server-side;
- PII/secret redaction;
- audit всех model/tool calls;
- approval для внешних, публикационных, финансовых и необратимых действий;
- отдельные service accounts;
- kill switches;
- запрет production secrets в coding runner.

### Надёжность

- idempotency;
- bounded retries;
- timeouts;
- cancellation;
- restart recovery;
- correlation ID;
- deterministic state transitions;
- backup/restore.

### Качество разработки

- minimal diff;
- запрет несогласованного contract drift;
- unit/integration tests для policy и state machine;
- lint, typecheck, tests, build и smoke;
- structured handoff;
- запрет изменений вне scope;
- ручной merge.

### Наблюдаемость и стоимость

- success/failure rate;
- approval wait time;
- latency p50/p95;
- token/cost per run и workflow;
- retry/loop count;
- tool errors;
- rework/rollback;
- coding-agent acceptance rate;
- provider health;
- budget limits на run, workflow, agent, provider, день и месяц.

---

## 8. Первый промт для Codex: аудит состояния проекта

Скопировать промт ниже в Codex, открыв папку, в которой предположительно находится проект «Инфраструктура для ИИ». На этом запуске Codex не должен ничего менять.

```text
Ты работаешь как senior software architect и repository auditor.

ЗАДАЧА
Проведи полный READ-ONLY аудит текущего состояния проекта «Инфраструктура для ИИ» перед началом разработки. Нужно установить факты: существует ли локальный проект, является ли он Git-репозиторием, связан ли он с GitHub, что уже реализовано, что существует только в документации и какой минимальный следующий шаг нужен для запуска Development Agents workflow.

ВАЖНО
- На этом запуске НЕ изменяй, НЕ создавай, НЕ форматируй и НЕ удаляй файлы.
- Не делай commit, branch, stash, push, pull, fetch, merge, rebase, reset, checkout или clean.
- Не создавай GitHub repository, issue или PR.
- Не устанавливай зависимости и не запускай миграции.
- Не запускай приложение или длительные процессы.
- Не читай и не выводи значения секретов из .env, credential stores, keychains или CI secrets.
- Можно проверять только наличие env-файлов и имена переменных в .env.example.
- Не сканируй домашнюю папку или весь диск. Работай только в текущем каталоге и его проектных подпапках.
- Если рабочее дерево dirty, ничего не исправляй и явно сообщи об этом.
- Любой вывод «реализовано» подтверждай конкретными файлами и символами/модулями.

ИСТОЧНИКИ ТРЕБОВАНИЙ
Найди и прочитай, если они присутствуют в workspace:
- Technical Specification v0.3 от 14 августа 2026;
- Roadmap v0.3 от 14 августа 2026;
- ADR-001 «Оркестратор и специализированные агенты»;
- README, AGENTS.md и другие ADR/архитектурные документы.

СНАЧАЛА ОПРЕДЕЛИ КОРЕНЬ
1. Выведи текущую директорию.
2. Проверь текущую директорию через `git rev-parse --show-toplevel`.
3. Если это не Git repository, осмотри только непосредственные подпапки текущей директории и найди вероятные project roots по `.git`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `docker-compose*.yml` и указанным документам.
4. Если найдено несколько кандидатов, не угадывай: перечисли их и продолжи только общий read-only обзор каждого кандидата.

ПРОВЕРЬ GIT И GITHUB
Для каждого Git-кандидата собери:
- абсолютный project root;
- текущую ветку;
- `git status --short --branch`;
- `git remote -v`;
- upstream текущей ветки, если есть;
- последние 10 commit subject/date без patch;
- наличие GitHub remote по host в URL;
- если установлен `gh` и уже есть авторизация: только `gh auth status` и `gh repo view` для репозитория из remote;
- если remote отсутствует или `gh` недоступен, так и напиши. Не создавай remote и не проси токены.

Важно: наличие локальной папки `.git` не доказывает наличие GitHub repository. Наличие GitHub repository подтверждается remote URL и/или успешным read-only `gh repo view`.

ПРОВЕДИ ТЕХНИЧЕСКУЮ ИНВЕНТАРИЗАЦИЮ
Определи:
- monorepo это или single app;
- приложения, сервисы и shared packages;
- framework/runtime/language/package manager;
- версии Node и package manager из project config;
- команды lint, typecheck, test, build, smoke и dev;
- Docker/Compose;
- PostgreSQL schema/migrations/ORM;
- Redis/BullMQ или другая очередь;
- auth и RBAC;
- Task, Workflow, TaskStep, Approval, AuditEvent, Artifact, Budget, Incident;
- state machine, retries, timeout, cancellation, idempotency;
- model provider abstraction и provider adapters;
- agents, agent versions и permissions;
- Codex Task workflow;
- manual diff/log intake;
- QA/Review workflow;
- Knowledge Base;
- Support Reply;
- Telegram Draft/Publish contract;
- Weekly Owner Report;
- logging, metrics, tracing, health/readiness;
- test suites, CI workflows, security/secret scanning;
- deployment manifests;
- integration points со Smart Algorithms.

ПРОВЕРКИ
- Используй быстрый поиск (`rg`, `rg --files`) и чтение конфигураций/кода.
- Не запускай команды, которые меняют lockfile, generated files, cache или database.
- Разрешены только безопасные read-only проверки конфигураций.
- Не запускай `npm install`, `pnpm install`, `yarn`, migrations или Docker.
- Не запускай test/build на этапе аудита, если они могут создать generated output. Вместо этого зафиксируй доступные команды и предложи отдельный verification run.

СОПОСТАВЛЕНИЕ С V0.3
Создай матрицу по фазам и ключевым требованиям со статусами:
- IMPLEMENTED — подтверждено кодом и тестами;
- PARTIAL — есть часть реализации;
- DOCS_ONLY — есть только документация;
- NOT_FOUND — реализация не найдена;
- UNKNOWN — недостаточно доказательств.

Особенно отдельно проверь первый Development Workflow:
Task intake → Codex Task Agent → Owner approval → Codex run/result intake → QA/Review verdict → manual merge decision.

ФОРМАТ ОТВЕТА
Верни отчёт в чат, ничего не записывая на диск:

1. Executive Summary — 10–15 фактов без предположений.
2. Project Location — найденные корни и выбранный root.
3. Git/GitHub Status — ветка, dirty/clean, remotes, upstream, подтверждение или отсутствие GitHub.
4. Stack and Repository Map — компактное дерево и назначение модулей.
5. Commands — package manager и доступные verify/dev команды.
6. Implementation Matrix v0.3 — таблица requirement/status/evidence/gap.
7. Development Agents Readiness — что уже есть для Codex Task, Codex run intake, QA/Review и Qwen Q0/Q1.
8. Security Findings — только подтверждённые риски; не выводи секреты.
9. Documentation Drift — расхождения документов и кода.
10. Recommended Next Slice — одна минимальная вертикальная задача с зависимостями, non-goals, acceptance criteria и verify commands.
11. Proposed Backlog — следующие 10 небольших задач в порядке зависимостей.
12. Questions for Owner — только вопросы, которые нельзя решить по репозиторию.

ПРАВИЛА ДОКАЗАТЕЛЬСТВ
- Для каждого важного вывода укажи относительный путь к файлу.
- Не называй функцию работающей только по имени файла или TODO.
- Различай schema, API, UI и end-to-end integration.
- Если тесты не запускались, пиши «команды обнаружены, выполнение не проверено».
- Если GitHub не подтверждён, пиши «GitHub repository не подтверждён», а не «его нет».

ОСТАНОВКА
После отчёта остановись. Не предлагай и не выполняй patch до отдельного подтверждения Owner.
```

---

## 9. Что делать после ответа Codex

1. Сохранить полный отчёт Codex без сокращений.
2. Не начинать кодирование, пока не определены root, GitHub status и dirty state.
3. Сверить найденную реализацию с матрицей v0.3.
4. Утвердить одну первую задачу, вероятнее всего `AI-001` или ближайший отсутствующий dependency.
5. Подготовить отдельный узкий patch prompt.
6. Выполнить patch в новой feature-ветке.
7. Запустить указанные проверки.
8. Перед следующей задачей провести review diff и logs.

Если отдельного проекта пока нет, следующей задачей будет не весь продукт, а создание минимального repository foundation с README, выбранным layout, Docker Compose, `.env.example`, проверками и ADR. Если проект уже существует, foundation нужно достраивать вокруг текущей структуры без широкого рефакторинга.

---

## 10. Решения, которые Owner должен утвердить после аудита

1. Какой репозиторий является каноническим и кто имеет к нему доступ.
2. Monorepo или сохранение найденной структуры.
3. Три workflow MVP. Рекомендация: Codex Task, Support Reply, Telegram Draft.
4. Основной модельный провайдер первого контура.
5. Лимиты стоимости на run/день/месяц.
6. Срок хранения prompts, model outputs, diffs, logs и audit.
7. Какие данные Smart Algorithms разрешено передавать моделям.
8. Целевые thresholds для допуска Qwen Q1, Q2 и Q3.
9. Где будет staging VPS после прохождения локальных gates.

До этих решений можно безопасно выполнить read-only аудит и локальный foundation без внешних интеграций.
