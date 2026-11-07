import type { OpenAIApiAccessView } from "@/types/openai-api-access";
import type { OpenAIApiCopy } from "@/lib/i18n/openai-api-copy";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

type Actions = Readonly<{ connect(form: FormData): Promise<void>; configure(form: FormData): Promise<void>; disconnect(): Promise<void> }>;
export function OpenAIApiCard({ view, labels: c, actions, notice }: { view: OpenAIApiAccessView; labels: OpenAIApiCopy; actions: Actions; notice: string | null }) {
  const fields = [
    ["maxContextBytes", c.context, 1048576], ["maxInputTokens", c.input, 128000], ["maxOutputTokens", c.output, 16384],
    ["maxInvocationCostUsdMicros", c.cost, 10000000], ["dailyBudgetUsdMicros", c.daily, 100000000],
  ] as const;
  const limits = (prefix: string) => <>
    <label className="grid gap-1 text-xs text-ink-2" htmlFor={`${prefix}-model`}>{c.model}
      <input className="pac-control px-2 py-1" defaultValue={view.limits?.model ?? ""} id={`${prefix}-model`} maxLength={96} name="model" required type="text" />
    </label>
    {fields.map(([name, label, max]) => <label className="grid gap-1 text-xs text-ink-2" htmlFor={`${prefix}-${name}`} key={name}>{label}
      <input className="pac-control px-2 py-1" defaultValue={view.limits?.[name] ?? ""} id={`${prefix}-${name}`} max={max} min={1} name={name} required step={1} type="number" />
    </label>)}
  </>;
  const message = notice ? (c.notice as Readonly<Record<string, string>>)[notice] : null;
  return <SectionCard title={c.title} description={c.description} className="md:col-span-2 xl:col-span-3"
    action={<StatusBadge tone={view.state === "connected" ? "success" : "warning"}>{c.states[notice === "configuration_invalid" ? "configuration_invalid" : view.state]}</StatusBadge>}>
    <p className="text-sm font-medium text-amber-300">{c.billing}</p>
    {message && <p className="mt-2 text-xs text-ink-2" role="status">{message}</p>}
    <form action={actions.connect} autoComplete="off" className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-ink-2" htmlFor="openai-api-key">{c.key}
        <input autoComplete="new-password" className="pac-control px-2 py-1" id="openai-api-key" maxLength={4096} name="apiKey" required spellCheck={false} type="password" />
      </label>
      {limits("api-connect")}
      <button className="pac-control-accent h-8 px-3 text-sm" type="submit">{view.state === "connected" ? c.change : c.connect}</button>
    </form>
    {view.state === "connected" && <>
      <form action={actions.configure} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        {limits("api-configure")}<button className="pac-control h-8 px-3 text-sm" type="submit">{c.select}</button>
      </form>
      <form action={actions.disconnect} className="mt-3"><button className="pac-control h-8 px-3 text-sm" type="submit">{c.disconnect}</button></form>
    </>}
    <p className="mt-3 text-xs leading-5 text-ink-3">{c.note}</p>
    <p className="mt-2 text-xs leading-5 text-amber-300">{c.blocked}</p>
  </SectionCard>;
}
