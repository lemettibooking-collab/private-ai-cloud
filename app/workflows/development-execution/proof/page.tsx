import { connection } from "next/server";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerAI044Proof } from "@/components/domain/owner-console/ai044-production-proof";
import { loadOwnerAI044Proof } from "@/lib/composition/owner-ai044-proof.server";
import { ownerAI044ProofAction } from "./actions";
import { getI18n } from "@/lib/i18n/locale.server";
import { ai044ProofCopy } from "@/lib/i18n/ai044-proof-copy";

export default async function AI044ProductionProofPage() {
  await connection();
  const view = await loadOwnerAI044Proof();
  const { locale } = await getI18n();
  const copy = ai044ProofCopy[locale];
  return <AppShell>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <OwnerAI044Proof initial={view} action={ownerAI044ProofAction} copy={copy} />
  </AppShell>;
}
