import { ChatMessage } from "@/components/domain/chat-message";
import { ChatThreadList } from "@/components/domain/chat-thread-list";
import { SourceCitationCard } from "@/components/domain/source-citation-card";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

export default async function ChatPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].chat;
  const { chatMessages, chatThreads, sourceCitations, labels } = prototypeMock[locale];
  const assistantProfiles = prototypeContent[locale].assistants.profiles;
  const selectedCollections = c.collections;
  return (
    <AppShell>
      <PageHeader
        action={<ActionButton disabled>{c.sendToWorkflow}</ActionButton>}
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title={c.threads}>
            <ChatThreadList threads={[...chatThreads]} />
          </SectionCard>

          <SectionCard title={c.assistantSelector}>
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

          <SectionCard title={c.selectedCollections}>
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
            action={<StatusBadge tone="info">{c.sourceGrounded}</StatusBadge>}
            title={c.messages}
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

          <SectionCard title={c.askTitle}>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <textarea
                className="min-h-24 w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                disabled
                placeholder={c.askPlaceholder}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                <div className="flex flex-wrap gap-2">
                  {selectedCollections.map((collection) => (
                    <StatusBadge key={collection} tone="info">
                      {collection}
                    </StatusBadge>
                  ))}
                </div>
                <ActionButton disabled>{c.sendDisabled}</ActionButton>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {c.mockedNote}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton disabled variant="secondary">
                {c.sendSupport}
              </ActionButton>
              <ActionButton disabled variant="secondary">
                {c.sendTelegram}
              </ActionButton>
              <ActionButton disabled variant="secondary">
                {c.saveAnswer}
              </ActionButton>
            </div>
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-3">
            <SectionCard title={c.citations}>
              <div className="space-y-3">
                {sourceCitations.map((citation) => (
                  <SourceCitationCard citation={citation} confidenceLabel={labels.confidence[citation.confidence]} key={citation.id} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={c.answerActions}>
              <div className="grid gap-3">
                {c.actionRows.map(([label, state]) => (
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

            <SectionCard title={c.sendToWorkflow}>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
                <StatusBadge tone="warning">{c.approvalRequired}</StatusBadge>
                <p className="mt-3 text-sm leading-6 text-slate-300">{c.convertBody}</p>
              </div>
            </SectionCard>
          </div>

          <EmptyState
            description={c.noDataBody}
            title={c.noDataTitle}
          />
        </div>
      </div>
    </AppShell>
  );
}
