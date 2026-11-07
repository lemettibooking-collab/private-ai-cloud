const en={
  choice:"Choose execution access explicitly",subscription:"ChatGPT Plan",api:"OpenAI API",none:"No automatic fallback between access modes.",
  title:"AI-044 Production Proof — OpenAI API",description:"One FeaturePlan-bound, Owner-approved invocation. A patch proposal is not verified task success.",
  billing:"OpenAI API usage is billed separately from the ChatGPT subscription.",maximum:"Maximum invocation cost (USD microdollars)",remaining:"Remaining daily PAC API budget (USD microdollars)",
  unavailable:"Unavailable: Owner authority, fresh exact-model pricing, saved key/limits or factual FeaturePlan attempt is missing. No provider call authorized.",
  prepare:"PREPARE — no provider calls",request:"REQUEST APPROVAL — no provider calls",approve:"APPROVE — no provider calls",reject:"REJECT — no provider calls",invoke:"INVOKE OpenAI API — one approved request",
  scope:"Task / plan / exact repository baseline",reads:"Read-only context (not write permission)",writes:"Allowed write paths",result:"Unverified proposal result",
  footer:"Owner decision required · verification not run · no automatic retry · runtimeDispatchAllowed=false · generic production/live dispatch BLOCKED.",
};
export type OpenAIApiProofCopy=typeof en;
const ru:OpenAIApiProofCopy={
  choice:"Явно выберите способ доступа",subscription:"ChatGPT Plan",api:"OpenAI API",none:"Автоматического перехода между способами доступа нет.",
  title:"AI-044 — проверочный запуск через OpenAI API",description:"Один вызов в границах FeaturePlan с одобрением владельца. Предложенные изменения не означают проверенный успех задачи.",
  billing:"Использование OpenAI API оплачивается отдельно от подписки ChatGPT.",maximum:"Максимальная стоимость вызова (микродоллары США)",remaining:"Остаток дневного бюджета PAC API (микродоллары США)",
  unavailable:"Недоступно: не подтверждены полномочия владельца, актуальные цены точной модели, ключ/лимиты или фактическая попытка FeaturePlan. Провайдер не разрешён.",
  prepare:"ПОДГОТОВИТЬ — без вызовов провайдера",request:"ЗАПРОСИТЬ ОДОБРЕНИЕ — без вызовов",approve:"ОДОБРИТЬ — без вызовов провайдера",reject:"ОТКЛОНИТЬ — без вызовов",invoke:"ВЫЗВАТЬ OpenAI API — один одобренный запрос",
  scope:"Задача / план / точная базовая версия репозитория",reads:"Контекст только для чтения (не право записи)",writes:"Допущенные пути записи",result:"Непроверенное предложение изменений",
  footer:"Нужно решение владельца · проверка не выполнена · автоматический повтор запрещён · общее разрешение запуска: нет · общие внешние запуски заблокированы.",
};
export const openAIApiProofCopy={ru,en};
