import { ChatMessage } from "@/components/domain/chat-message";
import { ChatThreadList } from "@/components/domain/chat-thread-list";
import { SourceCitationCard } from "@/components/domain/source-citation-card";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  assistantProfiles,
  chatMessages,
  chatThreads,
  sourceCitations,
} from "@/lib/mock-data";

const selectedCollections = ["Product", "Support", "Engineering"];

export default function ChatPage() {
  return (
    <AppShell>
      <PageHeader
        action={<ActionButton disabled>Send to workflow</ActionButton>}
        description="Source-grounded AI chat with assistant selection, citation cards, no-data state, and action previews."
        eyebrow="RAG Chat"
        title="Answers with sources"
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title="Chat threads">
            <ChatThreadList threads={chatThreads} />
          </SectionCard>

          <SectionCard title="Assistant selector">
            <div className="space-y-2">
              {assistantProfiles.slice(0, 6).map((assistant, index) => (
                <button
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    index === 0
                      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                      : "border-slate-800 bg-slate-900/60 text-slate-300"
                  }`}
                  key={assistant.name}
                  type="button"
                >
                  {assistant.name}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Selected collections">
            <div className="flex flex-wrap gap-2">
              {selectedCollections.map((collection) => (
                <StatusBadge key={collection} tone="info">
                  {collection}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            action={<StatusBadge tone="info">source-grounded</StatusBadge>}
            title="Messages"
          >
            <div className="space-y-4">
              {chatMessages.map((message) => (
                <ChatMessage
                  author={message.author}
                  body={message.body}
                  key={message.id}
                  role={message.role}
                  timestamp={message.timestamp}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Ask selected knowledge">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <textarea
                className="min-h-24 w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                disabled
                placeholder="Ask a question based on selected knowledge collections..."
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                <div className="flex flex-wrap gap-2">
                  {selectedCollections.map((collection) => (
                    <StatusBadge key={collection} tone="info">
                      {collection}
                    </StatusBadge>
                  ))}
                </div>
                <ActionButton disabled>Send disabled</ActionButton>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Mocked in prototype - no real LLM call is executed.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton disabled variant="secondary">
                Send to Support Reply workflow
              </ActionButton>
              <ActionButton disabled variant="secondary">
                Send to Telegram Content workflow
              </ActionButton>
              <ActionButton disabled variant="secondary">
                Save useful answer
              </ActionButton>
            </div>
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-3">
            <SectionCard title="Source citations">
              <div className="space-y-3">
                {sourceCitations.map((citation) => (
                  <SourceCitationCard citation={citation} key={citation.id} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Answer actions">
              <div className="grid gap-3">
                {[
                  ["Save useful answer", "MVP active"],
                  ["Rate quality", "good / weak"],
                  ["Export answer", "manual copy"],
                ].map(([label, state]) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                    key={label}
                  >
                    <span className="text-sm text-slate-300">{label}</span>
                    <StatusBadge tone="neutral">{state}</StatusBadge>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Send to workflow">
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
                <StatusBadge tone="warning">approval required</StatusBadge>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Convert this answer into a Support Reply workflow. External
                  send remains disabled until a human approves it.
                </p>
              </div>
            </SectionCard>
          </div>

          <EmptyState
            description="When no relevant indexed source exists, the assistant should say so and suggest uploading a source or starting an approval workflow."
            title="No data in knowledge base example"
          />
        </div>
      </div>
    </AppShell>
  );
}
