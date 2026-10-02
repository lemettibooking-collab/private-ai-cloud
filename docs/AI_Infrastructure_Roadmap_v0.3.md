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
> Historical assumptions here that are **not** current requirements: Redis + BullMQ; Qwen Code in a coding-worker image with a headless execution contract; a PAC-built isolated Coding Worker and one-time Docker/Podman sandbox. Current direction: managed executor first, an `ExecutionEnvironment` abstraction, and a self-hosted/local fallback only when justified.

## Roadmap v0.3

**Дата:** 14 августа 2026 года  
**Принцип:** сначала контролируемый workflow и наблюдаемость, затем дополнительные модели и автономность.

## Общие правила roadmap

- один основной модельный провайдер на первом рабочем контуре;
- новые провайдеры добавляются последовательно через одинаковый контракт;
- внутренние агенты работают через оркестратор, а не связываются произвольно;
- MCP и A2A не являются целью MVP;
- Codex остаётся основным исполнителем на старте;
- Qwen начинает с read-only и повышает допуск только по результатам evals;
- auto-merge, auto-deploy и production-доступ AI-разработчиков запрещены;
- Scanner MVP Smart Algorithms приоритетнее терминала, ботов и growth-экспериментов.

## Фаза 0. Фиксация продукта и контрактов

**Цель:** убрать архитектурную неопределённость.

- [x] ADR-001: центральный оркестратор и специализированные агенты.
- [x] Зафиксировать роли пользователей.
- [x] Зафиксировать логические роли агентов.
- [x] Зафиксировать human-in-the-loop и Approval Queue.
- [x] Зафиксировать model/provider agnostic принцип.
- [x] Добавить OpenAI / Anthropic / DeepSeek / Qwen как целевые provider adapters.
- [x] Добавить Qwen Developer Agent и уровни Q0–Q4.
- [x] Зафиксировать запрет YOLO, auto-merge, auto-deploy и production secrets.
- [ ] Утвердить три workflow первого MVP.
- [ ] Утвердить лимиты данных, стоимости и хранения.

**Gate 0:** Technical Specification v0.3 и ADR-001 приняты как baseline.

## Фаза 1. Repository и локальный foundation

**Цель:** получить локально запускаемый skeleton без внешних действий.

- [ ] Создать monorepo или согласованный app/service layout.
- [ ] Next.js Dashboard shell.
- [ ] Отдельный Orchestrator Service.
- [ ] PostgreSQL migrations.
- [ ] Redis + BullMQ.
- [ ] Базовые сущности Task, Workflow, Approval, AuditEvent.
- [ ] RBAC: Owner, Admin, Operator, Reviewer, Viewer.
- [ ] State machine задач.
- [ ] Structured logging и correlation ID.
- [ ] Docker Compose для локальной разработки.
- [ ] `.env.example` без секретов.

**Gate 1:** задача создаётся, проходит состояния и восстанавливается после перезапуска.

## Фаза 2. Orchestrator MVP

**Цель:** рабочее управление задачами и подтверждениями.

- [ ] Task intake из формы.
- [ ] Детерминированная классификация известных типов.
- [ ] Manager Agent для нестандартной классификации.
- [ ] Policy Engine deny-by-default.
- [ ] Приоритеты P0–P4.
- [ ] Approval Queue.
- [ ] Activity Summary.
- [ ] Retry, timeout, cancellation и idempotency.
- [ ] Kill switch для workflow.
- [ ] Audit trail каждого перехода.

**Gate 2:** критическое действие невозможно выполнить без approval; P0 останавливает разрешённые связанные workflow.

## Фаза 3. Первый Model Provider

**Цель:** модельный вызов через собственную абстракцию.

- [ ] Реализовать `ModelProvider` contract.
- [ ] Реализовать OpenAI adapter первым маршрутом.
- [ ] Server-side secrets.
- [ ] Structured output validation.
- [ ] Tool-call allowlist.
- [ ] Usage/cost/latency logging.
- [ ] Rate limits и retry policy.
- [ ] Provider health check.
- [ ] Mock provider для тестов.

**Gate 3:** ни один workflow не импортирует provider SDK напрямую вне adapter layer.

## Фаза 4. Три workflow MVP

**Цель:** доказать бизнес-пользу до расширения платформы.

### 4.1 Codex Task

- [ ] Форма постановки задачи.
- [ ] Scope, non-goals, touched files, verify commands.
- [ ] Copy-ready prompt.
- [ ] Markdown task artifact.
- [ ] Owner-only запуск.
- [ ] Ручная вставка diff/logs в QA v1.

### 4.2 Support Reply

- [ ] Ручная вставка обращения.
- [ ] Поиск по Knowledge Base.
- [ ] Draft reply.
- [ ] Эскалация неизвестного вопроса.
- [ ] Approval перед отправкой.
- [ ] Telegram/site chat adapters позже внутри этой фазы.

### 4.3 Telegram Content

- [ ] Контент brief.
- [ ] Draft post.
- [ ] Проверка запрещённых обещаний и формулировок.
- [ ] Approval → publish contract.
- [ ] Первая реализация допускается draft-only.

**Gate 4:** три workflow проходят end-to-end; внешние действия не обходят Approval Queue.

## Фаза 5. Knowledge Base и Weekly Owner Report

**Цель:** создать общий контекст и управленческую сводку.

- [ ] Ручная загрузка документов.
- [ ] Parsing и chunking.
- [ ] Метаданные источника и версии.
- [ ] Retrieval с цитированием источника.
- [ ] Права доступа к документам.
- [ ] Weekly Owner Report: поддержка, вопросы, баги, feature requests, контент, лиды, Pro/waitlist, рекомендации.
- [ ] Dashboard: Approval Queue + Activity Summary как первый экран Owner.

**Gate 5:** ответы Knowledge Agent воспроизводимы по источникам; отчёт не смешивает данные разных контуров.

## Фаза 6. Qwen Q0–Q1

**Цель:** проверить Qwen как дополнительного разработчика без права изменять код.

- [ ] Установить Qwen Code в coding-worker image.
- [ ] Подключить Qwen API через `QwenProvider`.
- [ ] Headless execution contract.
- [ ] Q0 Researcher: read-only анализ.
- [ ] Q1 Reviewer: проверка diff Codex.
- [ ] Создать Smart Algorithms coding eval set.
- [ ] Измерять scope adherence, defects found, false positives, tokens, cost, latency.
- [ ] Сравнить Qwen с текущим human/Codex review baseline.

**Gate 6:** Qwen не нарушает scope, стабильно возвращает structured handoff и приносит измеримую пользу как reviewer.

## Фаза 7. Изолированный Coding Worker

**Цель:** безопасно выполнять code tasks в контейнере.

- [ ] Одноразовый Docker/Podman sandbox.
- [ ] Временный git worktree/branch.
- [ ] Command/tool allowlist.
- [ ] Network allowlist.
- [ ] CPU/RAM/time/token/cost limits.
- [ ] Secret scanning до и после run.
- [ ] Сбор diff, stdout/stderr, verify logs.
- [ ] Автоматическая очистка workspace.
- [ ] Запрет main/merge/deploy/prod credentials.

**Gate 7:** escape/secret/forbidden-action tests проходят; контейнер не может получить production secrets.

## Фаза 8. Qwen Q2–Q3

**Цель:** допустить тесты и небольшие patch-задачи.

- [ ] Q2 Test Engineer.
- [ ] Q3 Developer на allowlisted paths.
- [ ] Plan / Ask Permissions / Auto-Edit / ограниченный Auto.
- [ ] YOLO технически запрещён политикой runner.
- [ ] Protected tests.
- [ ] QA и Security review каждого diff.
- [ ] Executor/reviewer separation: Codex ↔ Qwen.
- [ ] Запрет одновременного редактирования одинаковых файлов.
- [ ] Rejection/rollback metrics.

**Gate 8:** заданный процент patch принимается после review, protected tests не ухудшаются, security incidents отсутствуют.

## Фаза 9. Multi-model Router

**Цель:** уменьшить зависимость от одного провайдера без потери контроля.

- [ ] Anthropic adapter через нативный API.
- [ ] DeepSeek adapter.
- [ ] Контрактные тесты tools/structured output/errors.
- [ ] Route policies по качеству, цене, latency, privacy и региону.
- [ ] Fallback только для совместимых task classes.
- [ ] Provider-specific redaction/data policy.
- [ ] A/B и shadow evaluation.
- [ ] Budget dashboard.

**Gate 9:** переключение провайдера не меняет бизнес-контракт workflow; fallback проверен на отказах.

## Фаза 10. Staging VPS

**Цель:** production-like проверка платформы до подключения к реальным контурам.

- [ ] Docker deployment.
- [ ] HTTPS и reverse proxy.
- [ ] Secret management.
- [ ] PostgreSQL backup/restore.
- [ ] Redis persistence policy.
- [ ] Health/readiness endpoints.
- [ ] Centralized logs.
- [ ] Monitoring и alerts.
- [ ] Incident drill P0/P1.
- [ ] Provider outage drill.
- [ ] Queue recovery test.

**Gate 10:** smoke, restore и incident drills пройдены; manual rollback задокументирован.

## Фаза 11. Smart Algorithms integration

**Цель:** подключить платформу к SA через безопасный read-mostly контур.

- [ ] Отдельная service account.
- [ ] Internal API с allowlisted endpoints.
- [ ] System health.
- [ ] Агрегированные user/activity metrics.
- [ ] Open support issues.
- [ ] Development task drafts.
- [ ] Release status.
- [ ] Telegram post drafts.
- [ ] PII redaction.
- [ ] RU data-boundary review.
- [ ] Audit и rate limits.

**Не включать:** live orders, exchange keys, произвольный SQL, production deploy, high-RPS terminal/account flows.

**Gate 11:** компрометация AI-платформы не даёт прямой доступ к production-БД или торговым активам.

## Фаза 12. MCP

**Цель:** стандартизировать только уже стабильные инструменты.

- [ ] Выбрать 1–2 повторно используемых tool contracts.
- [ ] MCP server auth.
- [ ] Tool allowlist и risk annotations.
- [ ] Audit MCP calls.
- [ ] Prompt-injection tests.
- [ ] Версионирование tool schemas.

**Gate 12:** MCP не расширяет права агента относительно исходного internal API.

## Фаза 13. A2A и независимые workers

**Цель:** подключать самостоятельные удалённые agentic-сервисы только при реальной необходимости.

- [ ] Определить кандидата, который действительно требует отдельного сервиса.
- [ ] Agent Card / capability contract.
- [ ] Auth, task IDs, timeouts, callbacks и idempotency.
- [ ] Минимальный передаваемый контекст.
- [ ] Централизованный audit у оркестратора.
- [ ] Kill switch и revoke credentials.

**Gate 13:** удалённый агент не может обойти оркестратор и Policy Engine.

## Фаза 14. Qwen Q4 и long-running development

**Цель:** разрешить длительные задачи только после накопления доказательств.

- [ ] Persistent checkpoints.
- [ ] Session resume.
- [ ] Loop detection.
- [ ] Progress heartbeat.
- [ ] Dynamic budget stop.
- [ ] Intermediate review checkpoints.
- [ ] Overnight task class allowlist.
- [ ] Replay/eval before promotion.
- [ ] Автоматическая остановка при scope drift.

**Gate 14:** длительная работа надёжнее коротких последовательных runs на утверждённом eval set и не увеличивает риск выше допустимого уровня.

## Фаза 15. Growth и внешние каналы

**Цель:** расширить маркетинговые workflow без спама и скрытой имитации людей.

- [ ] Telegram monitoring.
- [ ] Instagram integration в рамках официального API.
- [ ] Approved-source allowlist.
- [ ] Relevance scoring.
- [ ] Draft comments.
- [ ] Daily limits и deduplication.
- [ ] Brand/safety review.
- [ ] Approval перед публикацией.
- [ ] Реакции, переходы, удаления и ограничения аккаунта.
- [ ] Автопауза при негативных сигналах.

**Gate 15:** workflow не нарушает platform policies, не маскирует AI под независимого человека и не создаёт массовый спам.

## Порядок ближайших действий

1. Утвердить Technical Specification v0.3.
2. Выбрать три workflow MVP.
3. Создать repository skeleton и локальный Docker Compose.
4. Реализовать Task/Workflow/Approval/Audit foundation.
5. Подключить первый OpenAI provider adapter.
6. Запустить Codex Task, Support Reply и Telegram Draft.
7. Собрать Smart Algorithms coding eval set.
8. Подключить Qwen Q0 Researcher и Q1 Reviewer.
9. Только после метрик строить sandbox coding-worker для Q2/Q3.

## Критерий успешности первой версии

Первая версия успешна не тогда, когда агенты работают максимально автономно, а когда владелец получает больше выполненной работы при меньшем операционном шуме, а каждое действие остаётся контролируемым, объяснимым, обратимым и проверяемым.
