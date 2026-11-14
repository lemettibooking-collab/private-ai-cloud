// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeInvalid } from "./claude-managed-request.ts";

/** Explicit deterministic simulation only. No callback, SDK, URL, credential or IO injection. */
type Start = Readonly<{ kind: "claude_fake_start" }>;
type Read = Readonly<{ kind: "claude_fake_read" }>;
type Script = { session: unknown; pages: unknown[]; createOutcome: "reply" | "timeout" | "error"; delayMs: number };
type State = { script: Script; creates: number; reads: number; transmittedFingerprint: string | null };
const starts = new WeakMap<object, State>(), reads = new WeakMap<object, State>();
export function createClaudeManagedFakeProvider(input: unknown) {
  const s = exactRecord(boundedData(input), ["session", "pages", "createOutcome", "delayMs"]);
  if (!Array.isArray(s.pages) || s.pages.length > 5 || !["reply", "timeout", "error"].includes(s.createOutcome as string)
    || !Number.isInteger(s.delayMs) || (s.delayMs as number) < 0 || (s.delayMs as number) > 50) claudeInvalid();
  const state: State = { script: freezeDeep(s) as unknown as Script, creates: 0, reads: 0, transmittedFingerprint: null };
  const start: Start = Object.freeze({ kind: "claude_fake_start" }), retrieval: Read = Object.freeze({ kind: "claude_fake_read" });
  starts.set(start, state); reads.set(retrieval, state);
  return Object.freeze({ start, retrieval, stats: () => Object.freeze({ creates: state.creates, reads: state.reads, transmittedFingerprint: state.transmittedFingerprint }) });
}
export function openClaudeFakeStart(handle: unknown) {
  const state = handle && typeof handle === "object" ? starts.get(handle) : null;
  if (!state) return null;
  return Object.freeze({ async createSession(body: string) {
    if (typeof body !== "string" || Buffer.byteLength(body) > 65536) claudeInvalid();
    state.creates++;
    state.transmittedFingerprint = sha256(body);
    if (state.script.delayMs) await new Promise(resolve => setTimeout(resolve, state.script.delayMs));
    if (state.script.createOutcome !== "reply") claudeInvalid();
    return freezeDeep(boundedData(state.script.session));
  } });
}
export function openClaudeFakeRead(handle: unknown) {
  const state = handle && typeof handle === "object" ? reads.get(handle) : null;
  if (!state) return null;
  return Object.freeze({
    async retrieveSession(id: string) {
      state.reads++; const s = state.script.session as { id?: unknown } | null;
      if (!s || s.id !== id) claudeInvalid(); return freezeDeep(boundedData(s));
    },
    async listEvents(id: string, after: string | null) {
      state.reads++; const s = state.script.session as { id?: unknown } | null;
      if (!s || s.id !== id) claudeInvalid();
      const page = state.script.pages.find(p => (p as { after?: unknown })?.after === after);
      if (!page) claudeInvalid(); return freezeDeep(boundedData(page));
    },
  });
}
