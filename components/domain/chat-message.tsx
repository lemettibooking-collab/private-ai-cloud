type ChatMessageProps = {
  role: string;
  author: string;
  body: string;
  timestamp: string;
};

export function ChatMessage({
  role,
  author,
  body,
  timestamp,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-2xl rounded-xl border p-4 ${
          isUser
            ? "border-cyan-400/30 bg-cyan-400/10"
            : "border-slate-800 bg-slate-900/70"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            {author}
          </p>
          <p className="text-xs text-slate-600">{timestamp}</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-200">{body}</p>
      </article>
    </div>
  );
}
