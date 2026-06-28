import { StatusBadge } from "@/components/ui/status-badge";
import type { AuditEvent } from "@/types/approval";

type AuditTimelineProps = {
  events: AuditEvent[];
};

export function AuditTimeline({ events }: AuditTimelineProps) {
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div
          className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
          key={event.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-100">
                {event.label}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-400">
                {event.detail}
              </p>
            </div>
            <StatusBadge tone={event.tone}>{event.timestamp}</StatusBadge>
          </div>
        </div>
      ))}
    </div>
  );
}
