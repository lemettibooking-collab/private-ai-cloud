// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, ensureSafeEvidence, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";

export type ExecutorProviderObservation = Readonly<{ sessionId: string; turnId: string | null }>;
export type ExecutorProviderId = "openai" | "anthropic";
export function isExecutorProviderId(value: unknown): value is ExecutorProviderId {
  return value === "openai" || value === "anthropic";
}
/** Internal trusted port, not a caller endpoint. A false/unavailable acknowledgement stops
 * parsing; raw events and provider output never enter this port. No DB dependency here. */
export type ExecutorProviderIdentityObserver = Readonly<{
  beforeTransmission(requestFingerprint: string): Promise<boolean>;
  observe(identity: ExecutorProviderObservation): Promise<boolean>;
  uncertain(): Promise<void>;
}>;
export function validExecutorProviderId(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) return false;
  try { ensureSafeEvidence(value); return true; } catch { return false; }
}
/** The request fingerprint here is the digest BEFORE correlation metadata. The final byte
 * digest binds this correlation in turn; a final-digest-in-its-own-metadata fixed point is
 * neither required nor claimed. No random caller correlation is accepted as authority. */
export function deriveExecutorProviderCorrelation(input: unknown): string | null {
  try {
    const r = exactRecord(boundedData(input), ["workspaceIdentity", "developmentRunId", "attemptNumber", "requestFingerprint", "providerId", "modelId", "accountId", "executorIdentity"]);
    const e = exactRecord(r.executorIdentity, ["id", "version"]);
    if (!validExecutorProviderId(r.workspaceIdentity) || !validExecutorProviderId(r.developmentRunId)
      || !Number.isInteger(r.attemptNumber) || (r.attemptNumber as number) < 1 || (r.attemptNumber as number) > 3
      || typeof r.requestFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(r.requestFingerprint)
      || !isExecutorProviderId(r.providerId) || !validExecutorProviderId(r.modelId) || !validExecutorProviderId(r.accountId)
      || !validExecutorProviderId(e.id) || !validExecutorProviderId(e.version)) return null;
    // Every component is bounded ASCII without newlines; this domain-separated encoding
    // is unambiguous and independently checkable by PostgreSQL without JSON formatting.
    return sha256(["pac.executor.provider-correlation.v1", r.workspaceIdentity, r.developmentRunId,
      r.attemptNumber, r.requestFingerprint, r.providerId, r.modelId, r.accountId, e.id, e.version].join("\n"));
  } catch { return null; }
}
export function providerObservation(sessionId: unknown, turnId: unknown): ExecutorProviderObservation | null {
  return validExecutorProviderId(sessionId) && (turnId === null || validExecutorProviderId(turnId))
    ? freezeDeep({ sessionId, turnId }) : null;
}
