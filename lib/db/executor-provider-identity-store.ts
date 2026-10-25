import type { NormalizedExecutorInvocation } from "../contracts/executor-adapter";
import type { ExecutorTarget } from "../executors/executor-start-boundary";
import type { ExecutorProviderRequestPolicy } from "../executors/executor-provider-request";
import type { ExecutorProviderIdentityObserver } from "../executors/executor-provider-identity";
import type { DurableExecutorDecision, DurableExecutorSnapshot } from "./executor-start-store";
import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorProviderCorrelation, validExecutorProviderId } from "../executors/executor-provider-identity.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorRequestPolicyMatches, prepareExecutorProviderRequest } from "../executors/executor-provider-request.ts";

export type ExecutorProviderIdentitySnapshot = Readonly<{
  attempt: NormalizedExecutorInvocation["attempt"]; target: ExecutorTarget; executorIdentity: NormalizedExecutorInvocation["identity"];
  requestFingerprint: string; baseRequestFingerprint: string; correlationFingerprint: string;
  sessionId: string | null; turnId: string | null;
  identityState: "correlation_prepared" | "session_observed" | "turn_observed";
  recoveryRequired: boolean; createdAt: number; updatedAt: number;
}>;
export type ExecutorProviderStartCapability = Readonly<{ kind: "executor_provider_start" }>;
export type ExecutorProviderIdentityDecision = DurableExecutorDecision & Readonly<{
  providerIdentity: ExecutorProviderIdentitySnapshot | null; providerCapability: ExecutorProviderStartCapability | null;
}>;
type Operation = (client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, exposure: DurableExecutorSnapshot) => Promise<DurableExecutorDecision>;
type Ports = Readonly<{
  workspace: string; target: ExecutorTarget; requestPolicy: ExecutorProviderRequestPolicy;
  run(raw: unknown, operation: Operation): Promise<DurableExecutorDecision>;
  takeStart(capability: unknown): DurableExecutorSnapshot | null;
  markUnknown(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, exposure: DurableExecutorSnapshot): Promise<void>;
}>;
const pending = new WeakMap<object, { owner: object; workspace: string; invocation: string; identity: ExecutorProviderIdentitySnapshot; used: boolean }>();
const fp = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const deny = (status: "denied" | "conflict" | "recovery_required" = "denied"): DurableExecutorDecision =>
  freezeDeep({ verdict: "deny", status, snapshot: null, startCapability: null });
const allow = (status: "prepared" | "recorded" | "idempotent" | "observed", snapshot: DurableExecutorSnapshot): DurableExecutorDecision =>
  freezeDeep({ verdict: "allow", status, snapshot, startCapability: null });
function requireFact(v: unknown): asserts v { if (!v) throw Error("invalid_executor_provider_identity"); }
function timestamp(value: unknown): number {
  requireFact(typeof value === "string" && /^[0-9]{1,16}$/u.test(value));
  const n = Number(value); requireFact(Number.isSafeInteger(n) && n >= 0); return n;
}

/** Executor-internal operations. Reuses the START store's historical transaction runner:
 * workspace SHARE → Project SHARE → budget UPDATE → exposure UPDATE → identity UPDATE.
 * No second connection, current-authority requirement, credential, network or retry. */
export function createExecutorProviderIdentityOperations(ports: Ports) {
  if (!executorRequestPolicyMatches(ports.requestPolicy, ports.target.providerId)) throw Error("invalid_executor_request_policy");
  const requestPolicy = ports.requestPolicy;
  const owner = Object.freeze({});
  const key = (i: NormalizedExecutorInvocation) => [ports.workspace, i.attempt.developmentRunId, i.attempt.number];
  async function read(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, exposure: DurableExecutorSnapshot) {
    const r = await client.query(`/* executor:provider-identity-lock */ select provider_id,account_id,provider_model_id,executor_id,executor_version,
      request_fingerprint,base_request_fingerprint,correlation_fingerprint,session_id,turn_id,identity_state,recovery_required,event_version,
      floor(extract(epoch from created_at)*1000)::text as created_ms,floor(extract(epoch from updated_at)*1000)::text as updated_ms
      from executor_provider_executions where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 limit 2 for update`, key(i));
    requireFact(r.rowCount <= 1 && r.rowCount === r.rows.length); if (!r.rowCount) return null;
    const p = exactRecord(boundedData(r.rows[0]), ["provider_id", "account_id", "provider_model_id", "executor_id", "executor_version", "request_fingerprint",
      "base_request_fingerprint", "correlation_fingerprint", "session_id", "turn_id", "identity_state", "recovery_required", "event_version", "created_ms", "updated_ms"]);
    requireFact(p.provider_id === ports.target.providerId && p.account_id === ports.target.accountId && p.provider_model_id === ports.target.modelId
      && p.executor_id === i.identity.id && p.executor_version === i.identity.version && p.request_fingerprint === exposure.requestFingerprint
      && fp(p.request_fingerprint) && fp(p.base_request_fingerprint) && fp(p.correlation_fingerprint));
    requireFact(p.correlation_fingerprint === deriveExecutorProviderCorrelation({ workspaceIdentity: ports.workspace, developmentRunId: i.attempt.developmentRunId,
      attemptNumber: i.attempt.number, requestFingerprint: p.base_request_fingerprint, ...ports.target, executorIdentity: i.identity }));
    requireFact((p.identity_state === "correlation_prepared" && p.session_id === null && p.turn_id === null)
      || (p.identity_state === "session_observed" && validExecutorProviderId(p.session_id) && p.turn_id === null)
      || (p.identity_state === "turn_observed" && validExecutorProviderId(p.session_id) && validExecutorProviderId(p.turn_id)));
    requireFact(typeof p.recovery_required === "boolean" && Number.isInteger(p.event_version) && (p.event_version as number) >= 1 && (p.event_version as number) <= 1000000);
    const createdAt = timestamp(p.created_ms), updatedAt = timestamp(p.updated_ms);
    requireFact(exposure.startedAt !== null && createdAt >= exposure.startedAt && updatedAt >= createdAt);
    const journal = await client.query(`/* executor:provider-identity-integrity */ select count(*)::int as count from executor_provider_identity_events
      where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 and event_version=$4 and identity_state=$5 and recovery_required=$6
        and session_id is not distinct from $7 and turn_id is not distinct from $8`, [...key(i), p.event_version, p.identity_state, p.recovery_required, p.session_id, p.turn_id]);
    requireFact(journal.rowCount === 1 && journal.rows[0].count === 1);
    return freezeDeep({ attempt: { ...i.attempt }, target: { ...ports.target }, executorIdentity: { ...i.identity },
      requestFingerprint: p.request_fingerprint as string, baseRequestFingerprint: p.base_request_fingerprint as string,
      correlationFingerprint: p.correlation_fingerprint as string, sessionId: p.session_id as string | null, turnId: p.turn_id as string | null,
      identityState: p.identity_state as ExecutorProviderIdentitySnapshot["identityState"], recoveryRequired: p.recovery_required as boolean, createdAt, updatedAt });
  }
  async function journal(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation) {
    const r = await client.query(`/* executor:provider-identity-audit */ insert into executor_provider_identity_events
      (workspace_id,development_run_id,attempt_number,event_version,identity_state,recovery_required,session_id,turn_id,created_at)
      select workspace_id,development_run_id,attempt_number,event_version,identity_state,recovery_required,session_id,turn_id,updated_at
      from executor_provider_executions where workspace_id=$1 and development_run_id=$2 and attempt_number=$3`, key(i));
    requireFact(r.rowCount === 1);
  }
  async function unknown(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, exposure: DurableExecutorSnapshot, p: ExecutorProviderIdentitySnapshot) {
    if (!p.recoveryRequired) {
      const r = await client.query(`/* executor:provider-identity-unknown */ update executor_provider_executions set recovery_required=true,
        event_version=event_version+1,updated_at=clock_timestamp() where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 and not recovery_required`, key(i));
      requireFact(r.rowCount === 1); await journal(client, i);
    }
    await ports.markUnknown(client, i, exposure);
  }
  async function evaluate(raw: unknown, operation: (client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, e: DurableExecutorSnapshot,
    p: ExecutorProviderIdentitySnapshot | null) => Promise<DurableExecutorDecision>): Promise<ExecutorProviderIdentityDecision> {
    let identity: ExecutorProviderIdentitySnapshot | null = null;
    const d = await ports.run(raw, async (client, i, e) => {
      if (!["start_committed", "reconciliation_required", "settled"].includes(e.state)) return deny("recovery_required");
      const p = await read(client, i, e), result = await operation(client, i, e, p);
      if (result.verdict === "allow") identity = await read(client, i, e);
      return result;
    });
    // Mutable closure observations never escape on failed/uncertain COMMIT.
    return freezeDeep({ ...d, providerIdentity: d.verdict === "allow" ? identity : null, providerCapability: null });
  }
  async function prepareProviderCorrelation(raw: unknown, contextInput: unknown, startCapability?: unknown): Promise<ExecutorProviderIdentityDecision> {
    let context: unknown;
    try { context = boundedData(contextInput); } catch { return freezeDeep({ ...deny(), providerIdentity: null, providerCapability: null }); }
    const start = ports.takeStart(startCapability);
    const d = await evaluate(raw, async (client, i, e, p) => {
      const request = prepareExecutorProviderRequest(requestPolicy, i, context, ports.target, e.maximumExposureUsdMicros, ports.workspace);
      requireFact(request);
      if (request.requestFingerprint !== e.requestFingerprint) return deny("conflict");
      if (p) return p.correlationFingerprint === request.correlationFingerprint ? allow("idempotent", e) : deny("conflict");
      if (!start || e.state !== "start_committed" || start.requestFingerprint !== e.requestFingerprint || start.projectId !== e.projectId
        || start.invocationId !== i.invocationId || start.attempt.developmentRunId !== i.attempt.developmentRunId || start.attempt.number !== i.attempt.number
        || start.target.providerId !== ports.target.providerId || start.target.modelId !== ports.target.modelId || start.target.accountId !== ports.target.accountId) return deny("recovery_required");
      const r = await client.query(`/* executor:provider-correlation-prepare */ insert into executor_provider_executions
        (workspace_id,development_run_id,attempt_number,provider_id,account_id,provider_model_id,executor_id,executor_version,
          request_fingerprint,base_request_fingerprint,correlation_fingerprint,identity_state,recovery_required,event_version,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'correlation_prepared',false,1,statement_timestamp(),statement_timestamp())`,
        [...key(i), ports.target.providerId, ports.target.accountId, ports.target.modelId, i.identity.id, i.identity.version,
          request.requestFingerprint, request.baseRequestFingerprint, request.correlationFingerprint]);
      requireFact(r.rowCount === 1); await journal(client, i); return allow("prepared", e);
    });
    if (d.status !== "prepared" || !d.providerIdentity) return d;
    const capability: ExecutorProviderStartCapability = Object.freeze({ kind: "executor_provider_start" });
    pending.set(capability, { owner, workspace: ports.workspace, invocation: JSON.stringify(boundedData(raw)), identity: d.providerIdentity, used: false });
    return freezeDeep({ ...d, providerCapability: capability });
  }
  function observation(input: unknown, turn: boolean) {
    try {
      const o = exactRecord(boundedData(input), turn ? ["requestFingerprint", "correlationFingerprint", "target", "sessionId", "turnId"]
        : ["requestFingerprint", "correlationFingerprint", "target", "sessionId"]);
      const t = exactRecord(o.target, ["providerId", "modelId", "accountId"]);
      if (!fp(o.requestFingerprint) || !fp(o.correlationFingerprint) || !validExecutorProviderId(o.sessionId)
        || (turn && !validExecutorProviderId(o.turnId)) || t.providerId !== ports.target.providerId || t.modelId !== ports.target.modelId || t.accountId !== ports.target.accountId) return null;
      return o;
    } catch { return null; }
  }
  async function record(raw: unknown, input: unknown, turn: boolean): Promise<ExecutorProviderIdentityDecision> {
    const o = observation(input, turn);
    if (!o) return freezeDeep({ ...deny(), providerIdentity: null, providerCapability: null });
    return evaluate(raw, async (client, i, e, p) => {
      if (!p || e.requestFingerprint !== o.requestFingerprint || p.correlationFingerprint !== o.correlationFingerprint) return deny("conflict");
      if ((p.sessionId !== null && p.sessionId !== o.sessionId) || (turn && p.turnId !== null && p.turnId !== o.turnId)) {
        await unknown(client, i, e, p); return deny("recovery_required");
      }
      if (turn && p.sessionId === null) return deny();
      if (turn ? p.turnId === o.turnId : p.sessionId === o.sessionId) return allow("idempotent", e);
      const r = turn
        ? await client.query(`/* executor:provider-turn */ update executor_provider_executions set turn_id=$5,identity_state='turn_observed',
          updated_at=clock_timestamp(),event_version=event_version+1 where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 and session_id=$4 and turn_id is null`, [...key(i), o.sessionId, o.turnId])
        : await client.query(`/* executor:provider-session */ update executor_provider_executions set session_id=$4,identity_state='session_observed',
          updated_at=clock_timestamp(),event_version=event_version+1 where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 and session_id is null`, [...key(i), o.sessionId]);
      requireFact(r.rowCount === 1); await journal(client, i); return allow("recorded", e);
    });
  }
  const inspectProviderIdentity = (raw: unknown) => evaluate(raw, async (_client, _i, e, p) => p ? allow("observed", e) : deny("recovery_required"));
  const markProviderIdentityUnknown = (raw: unknown) => evaluate(raw, async (client, i, e, p) => {
    if (!p) return deny("recovery_required"); await unknown(client, i, e, p); return deny("recovery_required");
  });
  /** Acknowledged start+correlation capability only. Reads/replay/clones never mint one. */
  function createProviderIdentityObserver(rawInput: unknown, capability: unknown): ExecutorProviderIdentityObserver {
    const raw = freezeDeep(boundedData(rawInput)); let authorized = false;
    return Object.freeze({ async beforeTransmission(requestFingerprint: string) {
      const c = capability && typeof capability === "object" ? pending.get(capability) : null;
      if (!c || c.used || c.owner !== owner || c.workspace !== ports.workspace || c.invocation !== JSON.stringify(raw) || c.identity.requestFingerprint !== requestFingerprint) return false;
      c.used = true;
      const d = await inspectProviderIdentity(raw), p = d.providerIdentity;
      authorized = d.verdict === "allow" && d.snapshot?.state === "start_committed" && p?.identityState === "correlation_prepared"
        && !p.recoveryRequired && p.correlationFingerprint === c.identity.correlationFingerprint && p.requestFingerprint === requestFingerprint;
      return authorized;
    }, async observe(value) {
      if (!authorized) return false;
      const o = exactRecord(boundedData(value), ["sessionId", "turnId"]), c = pending.get(capability as object)!;
      const input = { requestFingerprint: c.identity.requestFingerprint, correlationFingerprint: c.identity.correlationFingerprint,
        target: c.identity.target, sessionId: o.sessionId };
      const d = o.turnId === null ? await record(raw, input, false) : await record(raw, { ...input, turnId: o.turnId }, true);
      return d.verdict === "allow";
    }, async uncertain() { authorized = false; await markProviderIdentityUnknown(raw); } });
  }
  return Object.freeze({ prepareProviderCorrelation, inspectProviderIdentity, markProviderIdentityUnknown,
    recordProviderSession: (raw: unknown, input: unknown) => record(raw, input, false),
    recordProviderTurn: (raw: unknown, input: unknown) => record(raw, input, true), createProviderIdentityObserver });
}
