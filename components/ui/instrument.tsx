import { toneText, type Tone } from "@/components/ui/tone";

// AI-038.5 instrument strip: compact factual readouts separated by thin dividers (not cards).
// Every value shown here must already exist in the page's read model; nothing is synthesized.

export function InstrumentStrip({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className="pac-surface flex overflow-hidden">
      <dl className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col divide-x divide-line">{children}</dl>
    </section>
  );
}

type InstrumentProps = {
  label: string;
  value: React.ReactNode;
  detail: string;
  // Tone applies to the value only when the reading is non-neutral; `state` is its text equivalent.
  tone?: Tone;
  state?: string;
};

export function Instrument({ label, value, detail, tone = "neutral", state }: InstrumentProps) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="flex items-center justify-between gap-2">
        <span className="pac-label truncate">{label}</span>
        {state && (
          <span className={`text-[10.5px] font-medium uppercase tracking-[0.06em] ${toneText[tone]}`}>
            {state}
          </span>
        )}
      </dt>
      <dd>
        <p className={`mt-1.5 font-mono text-[26px] font-medium leading-none tracking-tight ${toneText[tone]}`}>{value}</p>
        <p className="mt-1.5 truncate text-[11px] text-ink-3" title={detail}>{detail}</p>
      </dd>
    </div>
  );
}
