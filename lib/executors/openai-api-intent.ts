import type { OpenAIApiLimits } from "../../types/openai-api-access";
import type { OpenAIApiPrice } from "../integrations/openai-api/openai-api-policy";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureAI044Data, ai044Fingerprint, ai044Hash, freezeAI044 } from "./ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044SubscriptionContextPath, normalizeSubscriptionRepository } from "./ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOpenAIApiLimits, normalizeOpenAIApiPrice, openAIApiMaximumCost } from "../integrations/openai-api/openai-api-policy.ts";
export const openAIApiExecutorIdentity = Object.freeze({ id: "openai-api-patch", version: "v1" });
export type OpenAIApiIntent = Readonly<{
  schemaVersion: 1; workspaceId: string; workspaceDatabaseId: string; projectId: string; projectTaskId: string;
  planId: string; planRevision: number; planFingerprint: string; taskId: string; invocationId: string;
  attempt: Readonly<{ developmentRunId: string; number: number; kind: "initial" | "corrective" }>;
  executor: typeof openAIApiExecutorIdentity; accessMode: "api_key"; model: string; credentialGeneration: string;
  repository: Readonly<{ id: string; baseline: string }>; contextFingerprint: string;
  allowedWritePaths: readonly string[]; readContextPaths: readonly string[];
  limits: OpenAIApiLimits; pricing: OpenAIApiPrice; maximumCostUsdMicros: number;
  requestFingerprint: string; createdAt: number; expiresAt: number;
}>;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function normalizeOpenAIApiIntent(raw: unknown): OpenAIApiIntent | null {
  try {
    const r = exactOwnData(captureAI044Data(raw), ["schemaVersion", "workspaceId", "workspaceDatabaseId", "projectId", "projectTaskId", "planId", "planRevision", "planFingerprint", "taskId", "invocationId", "attempt", "executor", "accessMode", "model", "credentialGeneration", "repository", "contextFingerprint", "allowedWritePaths", "readContextPaths", "limits", "pricing", "maximumCostUsdMicros", "requestFingerprint", "createdAt", "expiresAt"]);
    if (!r || r.schemaVersion !== 1 || ![r.workspaceId,r.projectId,r.projectTaskId,r.planId,r.taskId,r.invocationId].every(id)
      || !uuid(r.workspaceDatabaseId) || !uuid(r.credentialGeneration) || r.accessMode !== "api_key"
      || !integer(r.planRevision) || r.planRevision < 1 || r.planRevision > 1000000
      || ![r.planFingerprint,r.contextFingerprint,r.requestFingerprint].every(ai044Hash)
      || !integer(r.createdAt) || !integer(r.expiresAt) || r.expiresAt <= r.createdAt || r.expiresAt > r.createdAt + 15 * 60 * 1000) return null;
    const a = exactOwnData(r.attempt, ["developmentRunId","number","kind"]), e = exactOwnData(r.executor,["id","version"]);
    const repository = normalizeSubscriptionRepository(r.repository), limits = normalizeOpenAIApiLimits(r.limits), pricing = normalizeOpenAIApiPrice(r.pricing, r.createdAt);
    if (!a || !id(a.developmentRunId) || !integer(a.number) || a.number < 1 || a.number > 3 || a.kind !== (a.number === 1 ? "initial" : "corrective")
      || !e || e.id !== openAIApiExecutorIdentity.id || e.version !== "v1" || !repository || !limits || !pricing || r.model !== limits.model || r.model !== pricing.model
      || r.expiresAt > pricing.expiresAt || r.maximumCostUsdMicros !== openAIApiMaximumCost(limits, pricing, limits.maxInputTokens, r.createdAt)?.maximumCostUsdMicros) return null;
    for (const [field, max] of [["readContextPaths",20],["allowedWritePaths",12]] as const) {
      const v = r[field]; if (!Array.isArray(v) || !v.length || v.length > max || new Set(v).size !== v.length) return null;
      v.forEach(ai044SubscriptionContextPath);
    }
    return freezeAI044({ ...r, repository, limits, pricing, allowedWritePaths: [...r.allowedWritePaths as string[]].sort() }) as unknown as OpenAIApiIntent;
  } catch { return null; }
}
export const openAIApiIntentFingerprint = (i: OpenAIApiIntent) => ai044Fingerprint(["pac.ai044.api-intent.v1",i]);
export function openAIApiIntentPayload(i: OpenAIApiIntent): string {
  const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;
  return JSON.stringify(sort(i));
}
export function openAIApiIntentCurrent(i: OpenAIApiIntent, now: number) {
  return integer(now) && i.createdAt <= now && now < i.expiresAt && normalizeOpenAIApiPrice(i.pricing, now) !== null;
}
