import { DocumentCard } from "@/components/domain/document-card";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

// Tags are technical search tokens (not translated).
const tags = ["roadmap", "faq", "telegram", "codex", "review", "source-gap"];

export default async function KnowledgePage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].knowledge;
  const { documents, knowledgeOpsBlocks, documentIntelligenceCapabilities, labels } = prototypeMock[locale];
  return (
    <AppShell>
      <PageHeader
        action={<ActionButton disabled>{c.uploadDisabled}</ActionButton>}
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className="space-y-6">
          <SectionCard
            description={c.uploadDescription}
            title={c.uploadTitle}
          >
            <div className="rounded-xl border border-dashed border-cyan-400/30 bg-cyan-400/5 p-6 text-center">
              <p className="text-sm font-medium text-cyan-100">
                {c.uploadDrop}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {c.uploadNote}
              </p>
            </div>
          </SectionCard>

          <SectionCard title={c.collectionFilter}>
            <div className="flex flex-wrap gap-2">
              {c.collections.map((collection, index) => (
                <StatusBadge key={collection} tone={index === 0 ? "info" : "neutral"}>
                  {collection}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={c.searchTags}>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-500">
              {c.searchPlaceholder}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <StatusBadge key={tag} tone="neutral">
                  #{tag}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={c.permissions}>
            <div className="space-y-3">
              {c.permissionRows.map(([role, scope]) => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                  key={role}
                >
                  <span className="text-sm text-slate-300">{role}</span>
                  <StatusBadge tone="locked">{scope}</StatusBadge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          description={c.documentListDescription}
          title={c.documentList}
        >
          <div className="space-y-4">
            {documents.map((document) => (
              <DocumentCard document={document} key={document.id} statusLabel={labels.documentStatus[document.status]} />
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {knowledgeOpsBlocks.map((block) => (
          <SectionCard key={block.title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-50">
                {block.title}
              </h2>
              <StatusBadge tone={block.tone}>
                {c.blockStatus[block.tone]}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {block.detail}
            </p>
          </SectionCard>
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          action={<StatusBadge tone="warning">{c.plannedPartial}</StatusBadge>}
          description={c.intelligenceDescription}
          title={c.intelligenceTitle}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {documentIntelligenceCapabilities.map((capability) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={capability.title}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {capability.title}
                  </h3>
                  <StatusBadge
                    tone={
                      capability.status === "planned / partial"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {labels.capabilityStatus[capability.status]}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {capability.description}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <SectionCard title={c.versionsTitle}>
          <p className="text-sm leading-6 text-slate-400">{c.versionsBody}</p>
        </SectionCard>
        <SectionCard title={c.updateTitle}>
          <p className="text-sm leading-6 text-slate-400">{c.updateBody}</p>
        </SectionCard>
        <SectionCard title={c.connectorsTitle}>
          <p className="text-sm leading-6 text-slate-400">{c.connectorsBody}</p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
