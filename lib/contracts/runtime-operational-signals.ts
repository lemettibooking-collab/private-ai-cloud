// AI-037.4a: minimum operational signals for the workflow runtime (M1).
//
// A fixed, bounded set of counter names with no labels or payloads: a signal carries only its name,
// so SQL, prompts, model output, credentials, connection strings, error text and identifiers can
// never reach a sink. A future composition root (Real Provider Gate) creates one collector and gives
// the same sink to the DB adapter, the store and the runtime service. Components without a sink
// behave exactly as before. Emission is fail-open: a throwing or malformed sink is ignored and never
// changes the result of the operation being observed.

export const runtimeOperationalSignalNames = Object.freeze([
  "db_failure",
  "db_session_destroyed",
  "recovery_required",
  "outcome_unknown",
  "ambiguous_commit",
  "provider_redispatch",
] as const);

export type RuntimeOperationalSignalName = (typeof runtimeOperationalSignalNames)[number];

export interface RuntimeOperationalSignalSink {
  emit(signal: RuntimeOperationalSignalName): void;
}

export type RuntimeOperationalSignalSnapshot = Readonly<Record<RuntimeOperationalSignalName, number>>;

const knownSignals = new Set<string>(runtimeOperationalSignalNames);

// Never throws and never lets the sink observe anything but a known signal name.
export function emitRuntimeOperationalSignal(sink: unknown, signal: RuntimeOperationalSignalName): void {
  if (!knownSignals.has(signal)) return;
  try {
    if (typeof sink !== "object" || sink === null) return;
    const emit = (sink as { emit?: unknown }).emit;
    if (typeof emit === "function") emit.call(sink, signal);
  } catch {
    // Telemetry is fail-open: the observed operation keeps its original result.
  }
}

// In-process counters; enough for M1 tests and for a future composition root to read.
export function createRuntimeOperationalSignalCollector(): Readonly<{
  sink: RuntimeOperationalSignalSink;
  snapshot(): RuntimeOperationalSignalSnapshot;
}> {
  const counts = new Map<RuntimeOperationalSignalName, number>(runtimeOperationalSignalNames.map((name) => [name, 0]));
  const sink: RuntimeOperationalSignalSink = Object.freeze({
    emit(signal: RuntimeOperationalSignalName) {
      if (!knownSignals.has(signal)) return;
      const current = counts.get(signal) ?? 0;
      if (current < Number.MAX_SAFE_INTEGER) counts.set(signal, current + 1);
    },
  });
  return Object.freeze({
    sink,
    snapshot: () => Object.freeze(Object.fromEntries(
      runtimeOperationalSignalNames.map((name) => [name, counts.get(name) ?? 0]),
    ) as Record<RuntimeOperationalSignalName, number>),
  });
}
