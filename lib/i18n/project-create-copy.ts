const en = {
  title: "New Project", description: "Create a project in your workspace. Repository binding and execution are separate steps.",
  projectId: "Stable Project ID", idHint: "1–64 lowercase letters, digits, dots, underscores or hyphens. Start with a letter or digit.",
  displayName: "Display name", nameHint: "1–120 characters, without leading or trailing spaces or control characters.",
  submit: "Create project", pending: "Creating…", created: "Project created.", replayed: "This project was already created by this request.",
  dashboard: "Open project Dashboard", invalid_input: "Check the Project ID and display name.",
  conflict: "This Project ID cannot be used for this request. Choose a different ID or review existing projects.",
  unauthenticated: "Sign in as the workspace Owner and try again.",
  unavailable: "Creation could not be confirmed. Retry with the same Project ID and name to check safely.",
};
export type ProjectCreateCopy = typeof en;
const ru: ProjectCreateCopy = {
  title: "Новый проект", description: "Создайте проект в своей рабочей области. Подключение репозитория и запуск выполняются отдельно.",
  projectId: "Постоянный ID проекта", idHint: "1–64 строчных латинских буквы, цифры, точки, подчёркивания или дефисы. Первый символ — буква или цифра.",
  displayName: "Название", nameHint: "1–120 символов без пробелов по краям и управляющих символов.",
  submit: "Создать проект", pending: "Создание…", created: "Проект создан.", replayed: "Этот запрос уже создал проект.",
  dashboard: "Открыть Dashboard проекта", invalid_input: "Проверьте ID и название проекта.",
  conflict: "Этот ID проекта нельзя использовать для данного запроса. Выберите другой ID или проверьте существующие проекты.",
  unauthenticated: "Войдите как владелец рабочей области и повторите запрос.",
  unavailable: "Создание не удалось подтвердить. Для безопасной проверки повторите запрос с теми же ID и названием.",
};
export function projectCreateCopy(locale: "ru" | "en"): ProjectCreateCopy { return locale === "en" ? en : ru; }
