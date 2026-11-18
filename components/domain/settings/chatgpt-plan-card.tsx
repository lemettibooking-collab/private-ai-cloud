import type { ChatGPTIntegrationView } from "@/lib/composition/chatgpt-integration.server";
import type { Messages } from "@/lib/i18n/messages";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

// AI-039.2 Settings → Integrations: the ChatGPT plan card (Server Component). It renders ONLY the safe
// status projection (state, validated account email, plan-usage permission, access mode, models); no
// token, ID token, subject or client id ever reaches it. Every action is a Server Action that
// re-verifies the PAC Owner; connecting performs no inference.

type Labels = Messages["chatgptIntegration"];
type Actions = Readonly<{
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshModels: () => Promise<void>;
  selectModel: (form: FormData) => Promise<void>;
}>;

const stateTone = {
  not_connected: "muted",
  signed_out: "muted",
  connecting: "info",
  plan_usage_enabled: "success",
  plan_usage_missing: "warning",
  reauthorization_required: "warning",
  temporarily_unavailable: "danger",
} as const;

const primaryButton = "pac-control-accent inline-flex h-8 items-center px-3 text-[13px] font-medium";
const secondaryButton = "pac-control inline-flex h-8 items-center px-3 text-[12.5px] text-ink-2 hover:text-ink";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

export function ChatGPTPlanCard({ view, labels, actions, notice }: { view: ChatGPTIntegrationView; labels: Labels; actions: Actions; notice: string | null }) {
  const noticeText = notice ? (labels.notices as Readonly<Record<string, string>>)[notice] ?? null : null;
  if (view.state !== "available") {
    return (
      <SectionCard className="md:col-span-2 xl:col-span-3" description={labels.description} title={labels.title}>
        <p className="text-[12.5px] leading-5 text-ink-2">{view.state === "unauthenticated" ? labels.signInRequired : labels.unavailable}</p>
      </SectionCard>
    );
  }
  const status = view.status;
  const connected = status.state === "plan_usage_enabled" || status.state === "plan_usage_missing" || status.state === "reauthorization_required";
  return (
    <SectionCard
      action={<StatusBadge tone={stateTone[status.state]}>{labels.states[status.state]}</StatusBadge>}
      className="md:col-span-2 xl:col-span-3"
      description={labels.description}
      title={labels.title}
    >
      {noticeText && <p aria-live="polite" className="mb-3 rounded-pac border border-line px-3 py-2 text-[12.5px] leading-5 text-ink-2" role="status">{noticeText}</p>}
      {status.state === "plan_usage_enabled" && (
        <div className="mb-3 rounded-pac border border-accent/35 bg-accent/6 px-3 py-2.5">
          <p className="text-[13px] font-semibold text-accent">{labels.usingPlan}</p>
          <p className="mt-0.5 text-[12.5px] leading-5 text-ink-2">{labels.usingPlanBody}</p>
        </div>
      )}
      <dl className="-my-2 divide-y divide-line">
        <Row label={labels.account}>{status.accountLabel ?? "—"}</Row>
        <Row label={labels.accessMode}>{labels.accessModeValue}</Row>
        <Row label={labels.planUsage}>{status.planUsageGranted ? labels.planUsageGranted : labels.planUsageMissing}</Row>
        <Row label={labels.modelLabel}>{status.selectedModel ? <span className="font-mono text-[11.5px]">{status.selectedModel}</span> : labels.noModelSelected}</Row>
      </dl>
      {status.state === "plan_usage_enabled" && (
        <div className="mt-3 border-t border-line pt-3">
          {status.availableModels.length === 0 ? (
            <p className="text-[12px] text-ink-3">{labels.noModels}</p>
          ) : (
            <form action={actions.selectModel} className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="chatgpt-model">{labels.modelLabel}</label>
              <select className="pac-control h-8 px-2 text-[12.5px] text-ink" defaultValue={status.selectedModel ?? status.availableModels[0]?.slug} id="chatgpt-model" name="model">
                {status.availableModels.map((model) => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}
              </select>
              <button className={secondaryButton} type="submit">{labels.selectModel}</button>
            </form>
          )}
        </div>
      )}
      <p className="mt-3 text-[12px] leading-5 text-ink-3">{labels.eligibilityNote} {labels.noInferenceNote}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(!connected || status.state === "reauthorization_required" || status.state === "plan_usage_missing") && (
          <form action={actions.connect}><button className={primaryButton} type="submit">{labels.connect}</button></form>
        )}
        {status.state === "plan_usage_enabled" && (
          <form action={actions.refreshModels}><button className={secondaryButton} type="submit">{labels.refreshModels}</button></form>
        )}
        {connected && (
          <form action={actions.disconnect}><button className={secondaryButton} type="submit">{labels.disconnect}</button></form>
        )}
        <a className={secondaryButton} href={view.manageUsageUrl} rel="noopener noreferrer" target="_blank">{labels.manageUsage}</a>
      </div>
    </SectionCard>
  );
}
