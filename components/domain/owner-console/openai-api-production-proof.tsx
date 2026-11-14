import type { OwnerOpenAIApiProofView } from "@/types/openai-api-proof";
import type { OpenAIApiProofCopy } from "@/lib/i18n/openai-api-proof-copy";
import { SectionCard } from "@/components/ui/section-card";

export function OwnerOpenAIApiProof({view,copy:c,action}:{view:OwnerOpenAIApiProofView;copy:OpenAIApiProofCopy;action(form:FormData):Promise<void>}) {
  if(view.status!=="available")return <SectionCard title={c.api}><p className="text-sm text-ink-2">{c.unavailable}</p></SectionCard>;
  const buttons=view.phase==="NOT_PREPARED"?[["prepare",c.prepare]]:view.phase==="PREPARED"?[["request",c.request]]:view.phase==="AWAITING_OWNER_APPROVAL"?[["approve",c.approve],["reject",c.reject]]:view.phase==="APPROVED"?[["invoke",c.invoke]]:[];
  return <SectionCard title={c.api} description={c.billing}>
    <p className="text-sm text-ink-2" role="status">{view.phase}</p>
    <dl className="mt-3 grid gap-3 text-sm">
      <div><dt>{c.scope}</dt><dd className="break-all font-mono text-xs">{view.projectId} / {view.projectTaskId} / {view.developmentTaskId} / {view.attemptNumber} / {view.planRevision} / {view.repositoryId} / {view.baseline}</dd></div>
      <div><dt>{c.api}</dt><dd>{view.model}</dd></div>
      <div><dt>{c.maximum}</dt><dd>{view.maximumCostUsdMicros}</dd></div><div><dt>{c.remaining}</dt><dd>{view.remainingDailyBudgetUsdMicros}</dd></div>
      <div><dt>{c.reads}</dt><dd>{view.readContextPaths.join(", ")}</dd></div><div><dt>{c.writes}</dt><dd>{view.allowedWritePaths.join(", ")}</dd></div>
    </dl>
    <div className="mt-4 flex flex-wrap gap-2">{buttons.map(([name,label])=><form action={action} key={name}>
      <input name="mode" type="hidden" value="openai_api"/><input name="selection" type="hidden" value={view.selection}/><input name="action" type="hidden" value={name}/>
      <button className="pac-control-accent h-9 px-3 text-sm" type="submit">{label}</button>
    </form>)}</div>
    {view.result&&<p className="mt-4 text-sm text-ink-2">{c.result}: {view.result.status} · {view.result.changedPaths.join(", ")}</p>}
    <p className="mt-3 text-xs leading-5 text-ink-3">{c.footer}</p>
  </SectionCard>;
}
