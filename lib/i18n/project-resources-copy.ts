const en = {
  repository: "Repository", knowledge: "Knowledge", projects: "Projects", dashboard: "Project Dashboard", owner: "Owner · project resources",
  repositoryDescription: "Save a GitHub repository locator. PAC login does not grant repository access. No network verification or GitHub write is performed.",
  url: "GitHub repository URL", branch: "Default branch", bind: "Save unverified binding", saving: "Saving…",
  not_configured: "Not configured", configured_unverified: "Configured · unverified", baseline: "Verified baseline SHA: unavailable",
  knowledgeDescription: "Private project documents, stored as immutable versions. Content is plain text; YAML is never executed or parsed as configuration.",
  choose: "Select a project", empty: "No project documents yet.", upload: "Upload document", file: "Markdown or YAML document",
  limits: "UTF-8 .md/.yaml/.yml · 256 KiB per file · 100 documents/project · 50 versions/document · 16 MiB/project. No indexing, embeddings or network ingestion.",
  filename: "Document", version: "Version", uploaded: "Uploaded", status: "Verification", uploaded_unverified: "Uploaded · unverified", hash: "Exact SHA-256",
  pending: "Saving…", saved: "Saved. Repository access and document verification are not implied.", replayed: "This exact request was already saved.",
  invalid_input: "Check the fields, filename, UTF-8 encoding and size limits.", conflict: "The state changed, the request conflicts, or a storage limit was reached. Reload and review the current state.",
  unauthenticated: "Sign in as the workspace Owner.", unavailable: "The operation cannot be confirmed. Retry the same request safely; no external action was started.",
  history: "Immutable version history", view: "View", newVersion: "The selected filename's current version is checked before appending. Existing versions are never overwritten.",
};
export type ProjectResourcesCopy = typeof en;
const ru: ProjectResourcesCopy = {
  repository: "Репозиторий", knowledge: "База знаний", projects: "Проекты", dashboard: "Панель проекта", owner: "Владелец · ресурсы проекта",
  repositoryDescription: "Сохранение адреса GitHub. Вход в PAC не даёт доступа к репозиторию. Проверка по сети и запись в GitHub не выполняются.",
  url: "URL репозитория GitHub", branch: "Основная ветка", bind: "Сохранить непроверенную привязку", saving: "Сохранение…",
  not_configured: "Не настроено", configured_unverified: "Настроено · не проверено", baseline: "Проверенный SHA исходной версии: недоступен",
  knowledgeDescription: "Приватные документы проекта с неизменяемыми версиями. Содержимое — простой текст; YAML не исполняется и не загружается как конфигурация.",
  choose: "Выберите проект", empty: "Документов проекта пока нет.", upload: "Загрузить документ", file: "Документ Markdown или YAML",
  limits: "UTF-8 .md/.yaml/.yml · 256 КиБ на файл · 100 документов на проект · 50 версий на документ · 16 МиБ на проект. Без индексации, векторных представлений и сетевой загрузки.",
  filename: "Документ", version: "Версия", uploaded: "Загружен", status: "Проверка", uploaded_unverified: "Загружен · не проверен", hash: "Точный SHA-256",
  pending: "Сохранение…", saved: "Сохранено. Это не подтверждает доступ к репозиторию или проверку документа.", replayed: "Этот точный запрос уже сохранён.",
  invalid_input: "Проверьте поля, имя файла, кодировку UTF-8 и ограничения размера.", conflict: "Состояние изменилось, запрос конфликтует или достигнут лимит хранилища. Перезагрузите страницу и проверьте данные.",
  unauthenticated: "Войдите как владелец рабочей области.", unavailable: "Операцию не удалось подтвердить. Тот же запрос можно безопасно повторить; внешнее действие не запускалось.",
  history: "Неизменяемая история версий", view: "Открыть", newVersion: "Перед добавлением проверяется текущая версия выбранного имени файла. Старые версии не перезаписываются.",
};
export function projectResourcesCopy(locale: "ru" | "en") { return locale === "en" ? en : ru; }
