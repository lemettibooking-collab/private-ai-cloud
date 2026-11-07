const en = {
  title: "OpenAI API", description: "Separate, explicitly selected API-key access. Never a fallback from ChatGPT Plan.",
  billing: "OpenAI API usage is billed separately from the ChatGPT subscription.",
  states: { not_connected: "Not connected", connected: "Connected", configuration_invalid: "Configuration invalid", temporarily_unavailable: "Temporarily unavailable" },
  key: "API key (saved locally; never displayed again)", connect: "Connect API", change: "Change key", disconnect: "Disconnect", select: "Select model / save limits",
  model: "Exact model snapshot", context: "Maximum context bytes", input: "Maximum input tokens", output: "Maximum output tokens",
  cost: "Maximum invocation cost (USD microdollars)", daily: "Daily PAC API budget (USD microdollars)",
  note: "1 USD = 1,000,000 microdollars. No network or inference on save. Connected means a local key is saved, not provider-validated access.",
  blocked: "Saving a key does not authorize any call. The separate Owner production-proof runner requires explicit OpenAI API selection, fresh pricing, exact FeaturePlan scope, one-shot approval and durable cost reservation.",
  notice: { saved: "Configuration saved locally. No provider call was made.", denied: "Owner authorization required.", configuration_invalid: "Invalid key, exact model or required limits.", temporarily_unavailable: "Protected local storage is unavailable. Nothing was authorized." },
};
export type OpenAIApiCopy = typeof en;
const ru: OpenAIApiCopy = {
  title: "OpenAI API", description: "Отдельный явно выбранный доступ по ключу API. Не используется как запасной маршрут ChatGPT Plan.",
  billing: "Использование OpenAI API оплачивается отдельно от подписки ChatGPT.",
  states: { not_connected: "Не подключено", connected: "Подключено", configuration_invalid: "Некорректная конфигурация", temporarily_unavailable: "Временно недоступно" },
  key: "Ключ API (сохраняется локально; повторно не отображается)", connect: "Подключить API", change: "Изменить ключ", disconnect: "Отключить", select: "Выбрать модель / сохранить лимиты",
  model: "Точная версия модели", context: "Максимальный контекст в байтах", input: "Максимум входных токенов", output: "Максимум выходных токенов",
  cost: "Максимальная стоимость вызова (микродоллары США)", daily: "Дневной бюджет PAC API (микродоллары США)",
  note: "1 USD = 1 000 000 микродолларов. Сохранение не вызывает сеть или модель. Подключение означает локальное сохранение ключа, а не проверку доступа у провайдера.",
  blocked: "Сохранённый ключ ничего не разрешает. Отдельный проверочный запуск требует явного выбора OpenAI API, актуальных цен, точной области FeaturePlan, одноразового одобрения и сохранённого резерва стоимости.",
  notice: { saved: "Настройки сохранены локально. Провайдер не вызывался.", denied: "Требуются полномочия владельца.", configuration_invalid: "Некорректный ключ, точная модель или обязательные лимиты.", temporarily_unavailable: "Защищённое локальное хранилище недоступно. Ничего не разрешено." },
};
export const openAIApiCopy = { ru, en };
