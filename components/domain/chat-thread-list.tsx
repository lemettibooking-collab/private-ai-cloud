type ChatThread = {
  id: string;
  title: string;
  assistant: string;
  updatedAt: string;
};

type ChatThreadListProps = {
  threads: ChatThread[];
};

export function ChatThreadList({ threads }: ChatThreadListProps) {
  return (
    <div className="space-y-2">
      {threads.map((thread, index) => (
        <button
          className={`w-full rounded-lg border p-3 text-left transition ${
            index === 0
              ? "border-cyan-400/30 bg-cyan-400/10"
              : "border-slate-800 bg-slate-950/70 hover:bg-slate-900/70"
          }`}
          key={thread.id}
          type="button"
        >
          <p className="text-sm font-medium text-slate-100">{thread.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            {thread.assistant} / {thread.updatedAt}
          </p>
        </button>
      ))}
    </div>
  );
}
