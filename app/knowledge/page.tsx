import { DocumentCard } from "@/components/domain/document-card";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  documentIntelligenceCapabilities,
  documents,
  knowledgeOpsBlocks,
} from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";

const collections = [
  "All",
  "Product",
  "Support",
  "Content",
  "Engineering",
  "Policies",
  "QA",
];

const tags = ["roadmap", "faq", "telegram", "codex", "review", "source-gap"];

const knowledgeStatusLabel = {
  info: "MVP active",
  success: "MVP active",
  warning: "planned / partial",
  danger: "needs review",
  locked: "locked",
  neutral: "v0.2 planned",
} satisfies Record<StatusTone, string>;

export default function KnowledgePage() {
  return (
    <AppShell>
      <PageHeader
        action={<ActionButton disabled>Upload disabled in prototype</ActionButton>}
        description="Manage internal documents, collections, source previews, and indexing status for RAG-backed workflows."
        eyebrow="Knowledge Base"
        title="Documents and indexing"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className="space-y-6">
          <SectionCard
            description="Mock upload surface. No file is stored in this frontend-only prototype."
            title="Upload document"
          >
            <div className="rounded-xl border border-dashed border-cyan-400/30 bg-cyan-400/5 p-6 text-center">
              <p className="text-sm font-medium text-cyan-100">
                Drop PDF, Markdown, or text source here
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Upload, parsing, and indexing are mocked. Backend storage is out
                of scope.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Collection filter">
            <div className="flex flex-wrap gap-2">
              {collections.map((collection, index) => (
                <StatusBadge key={collection} tone={index === 0 ? "info" : "neutral"}>
                  {collection}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Search and tags">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-500">
              Search indexed documents, citations, and source previews
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <StatusBadge key={tag} tone="neutral">
                  #{tag}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Collection permissions">
            <div className="space-y-3">
              {[
                ["Owner", "All collections"],
                ["Support Operator", "Support + Product read"],
                ["Marketing Operator", "Content + Product read"],
                ["Demo Viewer", "Curated Smart Algorithms demo only"],
              ].map(([role, scope]) => (
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
          description="Mock documents required by the blueprint."
          title="Document list"
        >
          <div className="space-y-4">
            {documents.map((document) => (
              <DocumentCard document={document} key={document.id} />
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
                {knowledgeStatusLabel[block.tone]}
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
          action={<StatusBadge tone="warning">planned / partial</StatusBadge>}
          description="Document Intelligence turns uploaded files into reviewable summaries, risks, checklists, and owner tasks. Current prototype is mocked only."
          title="Document Intelligence"
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
                    {capability.status}
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
        <SectionCard title="Document versions">
          <p className="text-sm leading-6 text-slate-400">
            Version history, compare, and rollback are planned. Current cards
            show latest mocked source state only.
          </p>
        </SectionCard>
        <SectionCard title="Knowledge base update">
          <p className="text-sm leading-6 text-slate-400">
            Updating a source should trigger parsing, indexing, audit, and RAG
            readiness checks before it appears in citations.
          </p>
        </SectionCard>
        <SectionCard title="GitHub / Drive / Yandex / S3">
          <p className="text-sm leading-6 text-slate-400">
            Connectors are represented as later integrations. No external source
            sync is implemented in this frontend prototype.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
