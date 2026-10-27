// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureAI044Data, exactAI044Record, freezeAI044, ai044Fingerprint, ai044Hash, ai044SafeText } from "./ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044SubscriptionContextPath, normalizeSubscriptionRepository } from "./ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { issuedClientIdPattern, chatgptOAuth } from "../integrations/chatgpt/chatgpt-oauth.ts";

export const subscriptionExecutorIdentity = Object.freeze({ id: "chatgpt-plan-patch", version: "v1" });
export const subscriptionReceiptMaximumAgeMs = 15 * 60 * 1000;
export type SubscriptionRegistration = Readonly<{ label: string; clientId: string; subjectHash: string }>;
export type SubscriptionIntent = Readonly<{
  schemaVersion: 1; workspaceId: string; workspaceDatabaseId: string; projectId: string; projectTaskId: string;
  planId: string; planRevision: number; planFingerprint: string; taskId: string; invocationId: string;
  attempt: Readonly<{ developmentRunId: string; number: number; kind: "initial" | "corrective" }>;
  executor: typeof subscriptionExecutorIdentity; accessMode: "subscription_session";
  registration: SubscriptionRegistration; model: string;
  repository: Readonly<{ id: string; baseline: string }>;
  contextFingerprint: string; allowedWritePaths: readonly string[]; readContextPaths: readonly string[];
  patchBounds: Readonly<{ files: 12; changedLines: 1200 }>;
  preflight: Readonly<{ receiptId: string; observedAt: number; expiresAt: number; appLimitPercent: number;
    creditsEnabled: false; automaticPurchaseReliedUpon: false; registrationFingerprint: string }>;
  expiresAt: number;
}>;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
export function normalizeSubscriptionRegistration(raw: unknown): SubscriptionRegistration | null {
  try {
    const r = exactAI044Record(captureAI044Data(raw), ["label", "clientId", "subjectHash"]);
    if (typeof r.label !== "string" || !/^chatgpt-[a-f0-9]{16}$/u.test(r.label) || typeof r.clientId !== "string"
      || !issuedClientIdPattern.test(r.clientId) || r.clientId === chatgptOAuth.dynamicClientId || !ai044SafeText(r.clientId, 128) || !ai044Hash(r.subjectHash)) return null;
    return freezeAI044({ ...r }) as SubscriptionRegistration;
  } catch { return null; }
}
export const subscriptionRegistrationFingerprint = (r: SubscriptionRegistration): string => ai044Fingerprint(["pac.ai044.subscription-registration.v1", r]);
/** A bounded data binding, never Owner approval, credential access or dispatch authority. */
export function normalizeSubscriptionIntent(raw: unknown): SubscriptionIntent | null {
  try {
    const i = exactAI044Record(captureAI044Data(raw), ["schemaVersion", "workspaceId", "workspaceDatabaseId", "projectId", "projectTaskId", "planId", "planRevision", "planFingerprint", "taskId", "invocationId", "attempt", "executor", "accessMode", "registration", "model", "repository", "contextFingerprint", "allowedWritePaths", "readContextPaths", "patchBounds", "preflight", "expiresAt"]);
    if (i.schemaVersion !== 1 || ![i.workspaceId, i.projectId, i.projectTaskId, i.planId, i.taskId, i.invocationId].every(id) || !uuid(i.workspaceDatabaseId)
      || !integer(i.planRevision) || i.planRevision < 1 || i.planRevision > 1000000 || !ai044Hash(i.planFingerprint) || !ai044Hash(i.contextFingerprint)
      || i.accessMode !== "subscription_session" || typeof i.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(i.model)) return null;
    const a = exactAI044Record(i.attempt, ["developmentRunId", "number", "kind"]), e = exactAI044Record(i.executor, ["id", "version"]), r = normalizeSubscriptionRepository(i.repository);
    const b = exactAI044Record(i.patchBounds, ["files", "changedLines"]), p = exactAI044Record(i.preflight, ["receiptId", "observedAt", "expiresAt", "appLimitPercent", "creditsEnabled", "automaticPurchaseReliedUpon", "registrationFingerprint"]);
    const registration = normalizeSubscriptionRegistration(i.registration);
    if (!registration || !id(a.developmentRunId) || !integer(a.number) || a.number < 1 || a.number > 3 || a.kind !== (a.number === 1 ? "initial" : "corrective")
      || e.id !== subscriptionExecutorIdentity.id || e.version !== subscriptionExecutorIdentity.version || !r
      || b.files !== 12 || b.changedLines !== 1200 || !id(p.receiptId) || !integer(p.observedAt) || !integer(p.expiresAt) || p.expiresAt <= p.observedAt
      || p.expiresAt > p.observedAt + subscriptionReceiptMaximumAgeMs || !integer(p.appLimitPercent) || p.appLimitPercent < 1 || p.appLimitPercent >= 100
      || p.creditsEnabled !== false || p.automaticPurchaseReliedUpon !== false || p.registrationFingerprint !== subscriptionRegistrationFingerprint(registration)
      || !integer(i.expiresAt) || i.expiresAt <= p.observedAt || i.expiresAt > p.expiresAt) return null;
    if (!Array.isArray(i.allowedWritePaths) || !i.allowedWritePaths.length || i.allowedWritePaths.length > 12 || new Set(i.allowedWritePaths).size !== i.allowedWritePaths.length
      || !Array.isArray(i.readContextPaths) || !i.readContextPaths.length || i.readContextPaths.length > 20 || new Set(i.readContextPaths).size !== i.readContextPaths.length) return null;
    const allowedWritePaths = i.allowedWritePaths.map(ai044SubscriptionContextPath).sort(), readContextPaths = i.readContextPaths.map(ai044SubscriptionContextPath);
    return freezeAI044({ ...i, repository: r, registration, allowedWritePaths, readContextPaths }) as unknown as SubscriptionIntent;
  } catch { return null; }
}
export function subscriptionIntentPayload(i: SubscriptionIntent): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => [k, canonical(value)])) : v;
  return JSON.stringify(canonical(i));
}
export const subscriptionIntentFingerprint = (i: SubscriptionIntent): string => ai044Fingerprint(["pac.ai044.subscription-intent.v1", i]);
/** Clock is supplied by trusted root/DB, never taken from the submitted intent. */
export function subscriptionIntentCurrent(i: SubscriptionIntent, now: number): boolean {
  return integer(now) && i.preflight.observedAt <= now && now < i.preflight.expiresAt && now < i.expiresAt;
}
