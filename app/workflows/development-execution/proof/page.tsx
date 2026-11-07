import { connection } from "next/server";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerAI044Proof } from "@/components/domain/owner-console/ai044-production-proof";
import { loadOwnerAI044Proof } from "@/lib/composition/owner-ai044-proof.server";
import { ownerAI044ProofAction } from "./actions";
import { getI18n } from "@/lib/i18n/locale.server";
import { ai044ProofCopy } from "@/lib/i18n/ai044-proof-copy";
import Link from "next/link";
import { OwnerOpenAIApiProof } from "@/components/domain/owner-console/openai-api-production-proof";
import { loadOwnerOpenAIApiProof } from "@/lib/composition/owner-openai-api-proof.server";
import { openAIApiProofCopy } from "@/lib/i18n/openai-api-proof-copy";
import { ownerOpenAIApiProofAction } from "./api-actions";

export default async function AI044ProductionProofPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await connection();
  const { locale } = await getI18n();
  const copy = ai044ProofCopy[locale];
  const apiCopy = openAIApiProofCopy[locale], mode = (await searchParams).mode;
  const choices=<nav aria-label={apiCopy.choice} className="mb-4 flex flex-wrap gap-3 text-sm">
    <Link href="/workflows/development-execution/proof?mode=chatgpt_plan">{apiCopy.subscription}</Link>
    <Link href="/workflows/development-execution/proof?mode=openai_api">{apiCopy.api}</Link><p className="text-ink-3">{apiCopy.none}</p>
  </nav>;
  if(mode==="openai_api") {
    const view=await loadOwnerOpenAIApiProof();
    return <AppShell><PageHeader eyebrow={apiCopy.api} title={apiCopy.title} description={apiCopy.description}/>{choices}<OwnerOpenAIApiProof view={view} copy={apiCopy} action={ownerOpenAIApiProofAction}/></AppShell>;
  }
  if(mode!=="chatgpt_plan")return <AppShell><PageHeader eyebrow={copy.eyebrow} title={copy.title} description={apiCopy.choice}/>{choices}</AppShell>;
  const view = await loadOwnerAI044Proof();
  return <AppShell>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    {choices}
    <OwnerAI044Proof initial={view} action={ownerAI044ProofAction} copy={copy} />
  </AppShell>;
}
