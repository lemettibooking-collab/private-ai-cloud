"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { OwnerAI044ProofView } from "@/types/ai044-proof";
import type { AI044ProofCopy } from "@/lib/i18n/ai044-proof-copy";
import { SectionCard } from "@/components/ui/section-card";

export function OwnerAI044Proof({ initial, action, copy: c }: {
  initial: OwnerAI044ProofView;
  copy: AI044ProofCopy;
  action(previous: OwnerAI044ProofView, form: FormData): Promise<OwnerAI044ProofView>;
}) {
  const [view, submit, pending] = useActionState(action, initial);
  if (view.status !== "available") return <SectionCard title={c.unavailable}>
    <p role="status">{c.unavailableDetail}</p>
    <Link href="/workflows/development-execution/proof">{c.reload}</Link>
  </SectionCard>;
  const button = (value: string, label: string) => <button type="submit" name="action" value={value} disabled={pending}
    className="rounded border border-line px-4 py-2 disabled:opacity-40">{label}</button>;
  return <div className="space-y-4">
    <SectionCard title={c.phases[view.phase]} description={c.statusDetail}>
      <p aria-live="polite">{pending ? c.pending : c.phases[view.phase]}</p>
      <dl className="mt-3 grid gap-2 text-sm">
        <dt>{c.selection}</dt><dd>{view.projectId} / {view.projectTaskId} / {view.developmentTaskId} / {view.attemptNumber}</dd>
        <dt>{c.baseline}</dt><dd className="break-all">{view.planRevision} / {view.baseline}</dd>
        <dt>{c.model}</dt><dd className="break-all">{view.model ?? c.unavailable} / {view.registration ?? c.unavailable}</dd>
        <dt>{c.reads}</dt><dd>{view.readContextPaths.join(", ")}</dd>
        <dt>{c.writes}</dt><dd>{view.allowedWritePaths.join(", ")}</dd>
        <dt>{c.approval}</dt><dd className="break-all">{view.approvalRequestId ?? c.notRequested} / {view.intentFingerprint ?? c.notPrepared}</dd>
        <dt>{c.expiry}</dt><dd>{view.expiresAt ? new Date(view.expiresAt).toISOString() : c.notPrepared}</dd>
      </dl>
      <form action={submit} className="mt-4 space-y-4">
        <input type="hidden" name="selection" value={view.selection} />
        {view.phase === "NOT_PREPARED" && <>
          <input type="hidden" name="registration" value={view.registration ?? ""} />
          <input type="hidden" name="model" value={view.model ?? ""} />
          <label className="block">{c.appLimit}<input name="appLimitPercent" type="number" min="1" max="99" required className="w-20 border border-line p-1" /></label>
          <label className="block"><input type="checkbox" name="confirmed" required />{c.confirmation}</label>
          <p className="text-sm text-ink-3">{c.attestation}</p>
          {button("prepare", c.prepare)}
        </>}
        {view.phase === "PREPARED" && button("request", c.request)}
        {view.phase === "AWAITING_OWNER_APPROVAL" && <div className="flex gap-3">{button("approve", c.approve)}{button("reject", c.reject)}</div>}
        {view.phase === "APPROVED" && <>
          <p>{c.invokeDetail}</p>
          {button("invoke", c.invoke)}
        </>}
      </form>
      {["INVOCATION_STARTED", "RECOVERY_REQUIRED"].includes(view.phase) && <p className="mt-3">{c.recovery}</p>}
      <Link className="mt-4 inline-block underline" href="/workflows/development-execution/proof">{c.reload}</Link>
    </SectionCard>
    {view.result && <SectionCard title={c.result}>
      <p>{view.result.status} · {view.result.changedPaths.join(", ") || c.noChanges}</p>
      <p className="break-all">{c.fingerprint}: {view.result.fingerprint}</p>
      <p>{c.verification}</p>
    </SectionCard>}
    <p className="text-sm text-ink-3">{c.footer}</p>
  </div>;
}
