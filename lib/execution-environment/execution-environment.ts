// Pure internal policy data. No SDK, IO, environment allocation or execution authority.
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep, compare, findProbableSecrets, sha256 } from "../local-handoff/local-handoff-policy.ts";

export const environmentKinds = Object.freeze(["provider_hosted", "openai_hosted", "codex_cloud_if_supported", "local", "vps_self_hosted", "future_provider"] as const);
export type ExecutionEnvironmentKind = typeof environmentKinds[number];
export const managedCapabilities = Object.freeze(["filesystem_isolation", "path_scope_enforcement", "network_policy", "secrets_isolation", "timeout", "resource_bound", "changed_file_limit", "artifact_collection", "verification_collection", "data_residency", "data_handling"] as const);
export type ManagedCapability = typeof managedCapabilities[number];
export const privacyRequirements = Object.freeze(["private_network", "zdr", "no_training", "restricted_data"] as const);
export type PrivacyRequirement = typeof privacyRequirements[number];
export type CapabilityEvidence = Readonly<{ state: "supported" | "unsupported" | "unknown"; fingerprint: string | null }>;
export type ExecutionEnvironment = Readonly<{
  id: string; kind: ExecutionEnvironmentKind;
  capabilities: Readonly<Record<ManagedCapability, CapabilityEvidence>>;
  programmaticInterface: CapabilityEvidence;
  residency: Readonly<{ regions: readonly string[]; evidence: CapabilityEvidence }>;
  privacy: Readonly<Record<PrivacyRequirement, CapabilityEvidence>>;
}>;
export type ManagedEnvironmentRequirements = Readonly<{
  kinds: readonly ExecutionEnvironmentKind[]; capabilities: readonly ManagedCapability[];
  residency: string | null; privacy: readonly PrivacyRequirement[];
}>;
export const routingDataLimits = Object.freeze({ maxCandidates: 32, maxList: 16, maxId: 64, maxCostUsdMicros: 1000000000000, maxLatencyMs: 86400000 });

// All helpers below inspect ONLY a bounded, detached data snapshot. Public boundaries
// must call snapshot first; serialization is never an unknown-input validator.
export function snapshot(value: unknown): unknown { return boundedData(value); }
export function invalid(): never { throw Error("invalid_routing_data"); }
export const record = (v: unknown, keys: readonly string[]) => exactRecord(v, keys);
export function safeAtom(v: unknown, max: number = routingDataLimits.maxId): string {
  if (typeof v !== "string" || v.length > max || !/^[a-z0-9][a-z0-9._-]*$/u.test(v)
    || findProbableSecrets(v).length || /(?:password|credential|secret|token)[_=-]/iu.test(v)) invalid();
  return v;
}
export function enumeration<const T extends string>(v: unknown, values: readonly T[]): T {
  if (typeof v !== "string" || !values.includes(v as T)) invalid(); return v as T;
}
export function list<T>(v: unknown, parse: (v: unknown) => T, max: number = routingDataLimits.maxList): T[] {
  if (!Array.isArray(v) || v.length > max) invalid(); return v.map(parse);
}
export function stringSet<const T extends string>(v: unknown, values: readonly T[]): T[] {
  const a = list(v, x => enumeration(x, values)); if (new Set(a).size !== a.length) invalid(); return a.sort(compare);
}
export function integer(v: unknown, max: number, min = 0): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) invalid(); return v;
}
export function fingerprint(v: unknown): string {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/u.test(v)) invalid(); return v;
}
export function evidence(v: unknown): CapabilityEvidence {
  const r = record(v, ["state", "fingerprint"]), state = enumeration(r.state, ["supported", "unsupported", "unknown"]);
  const f = r.fingerprint === null ? null : fingerprint(r.fingerprint);
  if (state === "supported" && f === null) invalid();
  return { state, fingerprint: f };
}
export function normalizeEnvironment(v: unknown): ExecutionEnvironment {
  const r = record(v, ["id", "kind", "capabilities", "programmaticInterface", "residency", "privacy"]);
  const c = record(r.capabilities, managedCapabilities), p = record(r.privacy, privacyRequirements), residency = record(r.residency, ["regions", "evidence"]);
  const regions = list(residency.regions, x => safeAtom(x, 32)).sort(compare);
  if (new Set(regions).size !== regions.length) invalid();
  return { id: safeAtom(r.id), kind: enumeration(r.kind, environmentKinds),
    capabilities: Object.fromEntries(managedCapabilities.map(k => [k, evidence(c[k])])) as Record<ManagedCapability, CapabilityEvidence>,
    privacy: Object.fromEntries(privacyRequirements.map(k => [k, evidence(p[k])])) as Record<PrivacyRequirement, CapabilityEvidence>,
    programmaticInterface: evidence(r.programmaticInterface), residency: { regions, evidence: evidence(residency.evidence) } };
}
export function normalizeEnvironmentRequirements(v: unknown): ManagedEnvironmentRequirements {
  const r = record(v, ["kinds", "capabilities", "residency", "privacy"]), kinds = stringSet(r.kinds, environmentKinds);
  if (!kinds.length) invalid();
  return { kinds, capabilities: stringSet(r.capabilities, managedCapabilities), residency: r.residency === null ? null : safeAtom(r.residency, 32), privacy: stringSet(r.privacy, privacyRequirements) };
}
export function supported(e: CapabilityEvidence): boolean { return e.state === "supported" && e.fingerprint !== null; }
/** Domain-separated digest of bounded normalized data, including every evidence fingerprint. */
export function routingDigest(domain: string, value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => compare(a, b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return sha256(JSON.stringify([domain, canonical(snapshot(value))]));
}
export { freezeDeep, compare };
