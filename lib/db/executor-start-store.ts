import { createHash } from "node:crypto";
import type { NormalizedExecutorResult } from "../contracts/executor-adapter";
import type { NormalizedExecutorInvocation, ExecutorAttemptIdentity, ExecutorIdentity, ExecutorRepositoryRef } from "../contracts/executor-adapter";
import type { ExecutorTarget } from "../executors/executor-start-boundary";
import type { ExecutorProviderRequestPolicy } from "../executors/executor-provider-request";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isWorkflowRuntimeSessionBreakingError } from "./postgres.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod, inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, ensureSafeEvidence, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorTarget } from "../executors/executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorRequestPolicyMatches, prepareExecutorProviderRequest, defineTrustedExecutorProviderRequestPolicy } from "../executors/executor-provider-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorAuthorityFacts } from "../executors/executor-current-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockExecutorWorkspaceProject, lockExecutorAuthority, executorAuthorityMatches } from "./executor-current-authority-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { revalidateExecutorOutcome, readExecutorOutcomeEvidence, executorOutcomeJsonLimit } from "../executors/executor-outcome.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorProviderIdentityOperations } from "./executor-provider-identity-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorPredecessorsClear } from "./executor-predecessor-barrier.ts";
import type { ExecutorControllerBinding } from "./executor-controller-binding";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorControllerBinding, lockExecutorControllerBinding } from "./executor-controller-binding.ts";

export type DurableExecutorState = "reserved" | "prepared" | "start_committed" | "cancelled" | "reconciliation_required" | "settled";
export type DurableExecutorSnapshot = Readonly<{
  projectId: string; attempt: ExecutorAttemptIdentity; identity: ExecutorIdentity; invocationId: string;
  planId: string; taskId: string; repository: ExecutorRepositoryRef; capability: string; mode: string; target: ExecutorTarget;
  authorityGeneration: number | null; canonicalRunFingerprint: string | null; admissionFingerprint: string | null;
  // Legacy schema/provider-defense evidence; not a universal hard provider cost bound.
  maximumExposureUsdMicros: number; heldExposureUsdMicros: number; providerSpendLimitCents: number;
  requestFingerprint: string | null; state: DurableExecutorState; reconciliation: string;
  observedUsage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }> | null;
  providerConsumedCents: number | null; observedCostUsdMicros: null;
  createdAt: number; updatedAt: number; expiresAt: number; preparedAt: number | null; startedAt: number | null;
  terminalResultFingerprint: string | null; settledAt: number | null;
}>;
export type DurableExecutorStartCapability = Readonly<{ kind: "durable_executor_start" }>;
export type DurableExecutorDecision = Readonly<{
  verdict: "allow" | "deny";
  status: "reserved" | "prepared" | "start_committed" | "cancelled" | "settled" | "recorded" | "observed" | "idempotent" | "denied" | "conflict" | "recovery_required";
  snapshot: DurableExecutorSnapshot | null; startCapability: DurableExecutorStartCapability | null;
}>;
export type DurableExecutorOutcomeDecision = DurableExecutorDecision & Readonly<{ normalizedResult: NormalizedExecutorResult | null; resultFingerprint: string | null }>;
export type ExecutorFinancialPolicy = Readonly<{ maximumExposureUsdMicros: number; totalExposureUsdMicros: number; reservationTtlMs: number }>;
export type PostgresExecutorConfiguration = Readonly<{
  database: WorkflowRuntimeDatabase; tenant: ResolvedWorkflowRuntimeTenant; projectId: string;
  configuration: unknown; target: ExecutorTarget; requestPolicy: ExecutorProviderRequestPolicy; financialPolicy: ExecutorFinancialPolicy;
  // Trusted synchronous policy decision, not a caller flag. Never provider/slow work.
  authorizeStart(): boolean;
  controllerBinding?: ExecutorControllerBinding;
}>;
const capabilities = new WeakMap<object, { workspace: string; snapshot: DurableExecutorSnapshot; used: boolean }>();
/** Only the acknowledged transaction winner owns this ephemeral reference; never reconstructed from a DB row. */
export function consumeDurableExecutorStartCapability(input: unknown): DurableExecutorSnapshot | null {
  const c = input && typeof input === "object" ? capabilities.get(input) : null;
  if (!c || c.used) return null;
  c.used = true; return freezeDeep(structuredClone(c.snapshot));
}
const integer = (v: unknown, max = 1000000000): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const denied = (status: "denied" | "conflict" | "recovery_required" = "denied"): DurableExecutorDecision =>
  freezeDeep({ verdict: "deny", status, snapshot: null, startCapability: null });
const allowed = (status: DurableExecutorDecision["status"], snapshot: DurableExecutorSnapshot): DurableExecutorDecision =>
  freezeDeep({ verdict: "allow", status, snapshot, startCapability: null });
class InvalidDurableState extends Error {}
const requireFact = (condition: unknown): void => { if (!condition) throw new InvalidDurableState(); };
function numeric(input: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof input === "string" && /^(?:0|[1-9][0-9]*)$/u.test(input) ? Number(input) : input;
  requireFact(integer(n, max)); return n as number;
}
const nullableNumber = (v: unknown, max = Number.MAX_SAFE_INTEGER) => v === null ? null : numeric(v, max);
const rowSelect = `project_key, development_run_id, attempt_number, attempt_kind, plan_id, task_id, executor_id, executor_version,
  invocation_id, repository_id, repository_baseline, capability, mode, provider_id, provider_model_id, account_id, invocation_fingerprint,
  authority_generation, canonical_run_fingerprint, admission_fingerprint,
  maximum_exposure_usd_micros::text, provider_spend_limit_cents::text, request_fingerprint, state, reconciliation, event_version,
  observed_input_tokens::text, observed_output_tokens::text, observed_total_tokens::text, provider_consumed_cents::text,
  floor(extract(epoch from created_at)*1000)::text as created_ms, floor(extract(epoch from updated_at)*1000)::text as updated_ms,
  floor(extract(epoch from expires_at)*1000)::text as expires_ms, floor(extract(epoch from prepared_at)*1000)::text as prepared_ms,
  floor(extract(epoch from started_at)*1000)::text as started_ms,
  terminal_result_fingerprint, floor(extract(epoch from settled_at)*1000)::text as settled_ms`;

/** Trusted server port ONLY. No route, network, credential read, retry or production dispatch. */
export function createPostgresExecutorStartStore(input: unknown) {
  return buildExecutorStore(input).store;
}
/** Internal borrowed-transaction read boundary. No connection/start issuer escapes.
 * Reuses ALL accepted historical locks/validation, not a smaller controller SQL copy.
 * The caller owns BEGIN/COMMIT/ROLLBACK and must roll back if this method throws. */
export function createExecutorHistoricalOutcomeReader(input: unknown) {
  const c = exactOwnData(input, ["tenant", "projectId", "configuration", "target", "financialPolicy"]);
  if (!c) throw Error("invalid_executor_historical_configuration");
  const target = normalizeExecutorTarget(c.target);
  const database: WorkflowRuntimeDatabase = Object.freeze({ async connect(): Promise<never> { throw Error("executor_historical_connection_forbidden"); } });
  // Only historical reads are exposed. Preparation is deliberately unavailable.
  const requestPolicy = defineTrustedExecutorProviderRequestPolicy(target.providerId as "openai" | "anthropic", () => null);
  return buildExecutorStore({ ...c, database, target, requestPolicy, authorizeStart: () => false }).historicalReader;
}
function buildExecutorStore(input: unknown) {
  const fields = ["database", "tenant", "projectId", "configuration", "target", "requestPolicy", "financialPolicy", "authorizeStart"];
  const c = exactOwnData(input, fields) ?? exactOwnData(input, [...fields, "controllerBinding"]);
  const connect = c && capturedMethod(c.database, "connect");
  if (!c || !connect || !isResolvedWorkflowRuntimeTenant(c.tenant) || !id(c.projectId) || typeof c.authorizeStart !== "function") throw Error("invalid_durable_executor_configuration");
  const tenant = c.tenant, workspace = tenant.workspaceDatabaseId, projectId = c.projectId, authorizeStart = c.authorizeStart as () => boolean;
  const configuration = freezeDeep(boundedData(c.configuration));
  const configured = createExecutorAdapterContract(configuration);
  if (!configured.adapter) throw Error("invalid_durable_executor_configuration");
  const contract = configured.adapter;
  const authorityFacts = deriveExecutorAuthorityFacts(c.configuration);
  const controllerBinding = Object.hasOwn(c, "controllerBinding") ? normalizeExecutorControllerBinding(c.controllerBinding) : null;
  const target = normalizeExecutorTarget(c.target);
  if (!executorRequestPolicyMatches(c.requestPolicy, target.providerId)) throw Error("invalid_durable_executor_configuration");
  const requestPolicy = c.requestPolicy;
  const policy = exactRecord(boundedData(c.financialPolicy), ["maximumExposureUsdMicros", "totalExposureUsdMicros", "reservationTtlMs"]);
  if (!integer(policy.maximumExposureUsdMicros) || policy.maximumExposureUsdMicros < 10000
    || !integer(policy.totalExposureUsdMicros) || policy.totalExposureUsdMicros < policy.maximumExposureUsdMicros
    || !integer(policy.reservationTtlMs, 60000) || policy.reservationTtlMs < 1) throw Error("invalid_durable_executor_configuration");
  const maximum = policy.maximumExposureUsdMicros, total = policy.totalExposureUsdMicros, ttl = policy.reservationTtlMs;
  const database: WorkflowRuntimeDatabase = Object.freeze({ async connect() {
    const client = await Reflect.apply(connect, undefined, []) as WorkflowRuntimeSqlClient;
    let broken = false;
    return { async query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      try { return await client.query<Row>(text, values); }
      catch (error) { if (isWorkflowRuntimeSessionBreakingError(error)) broken = true; throw error; }
    }, release(destroy = false) { client.release(destroy || broken); } };
  } });
  // Any DB/commit uncertainty permanently closes this instance. No automatic retry or reopening.
  let uncertain = false;
  const key = (i: NormalizedExecutorInvocation) => [workspace, i.attempt.developmentRunId, i.attempt.number];
  function bindings(i: NormalizedExecutorInvocation): Record<string, unknown> {
    return { project_key: projectId, development_run_id: i.attempt.developmentRunId, attempt_number: i.attempt.number, attempt_kind: i.attempt.kind,
      plan_id: i.planId, task_id: i.taskId, executor_id: i.identity.id, executor_version: i.identity.version, invocation_id: i.invocationId,
      repository_id: i.repository.id, repository_baseline: i.repository.baseline, capability: i.capability, mode: i.mode,
      provider_id: target.providerId, provider_model_id: target.modelId, account_id: target.accountId, invocation_fingerprint: hash(JSON.stringify(i)) };
  }
  async function locks(client: WorkflowRuntimeSqlClient, initialize: boolean): Promise<number | null> {
    // Consistent order: workspace SHARE → project SHARE → authority UPDATE → budget UPDATE → attempt UPDATE.
    if (initialize) await client.query(`/* executor:budget-init */ insert into executor_exposure_budgets
      (workspace_id, maximum_exposure_usd_micros, total_exposure_usd_micros, reservation_ttl_ms) values($1,$2,$3,$4) on conflict do nothing`, [workspace, maximum, total, ttl]);
    const b = await client.query(`/* executor:budget-lock */ select maximum_exposure_usd_micros::text, total_exposure_usd_micros::text,
      reservation_ttl_ms, held_exposure_usd_micros::text from executor_exposure_budgets where workspace_id = $1 for update`, [workspace]);
    if (b.rowCount !== 1) return null;
    const row = b.rows[0];
    requireFact(numeric(row.maximum_exposure_usd_micros) === maximum && numeric(row.total_exposure_usd_micros) === total && row.reservation_ttl_ms === ttl);
    const held = numeric(row.held_exposure_usd_micros, total);
    // Integrity check under the SAME serialization lock, never an unlocked SUM → INSERT race.
    const sum = await client.query(`/* executor:held-integrity */ select coalesce(sum(maximum_exposure_usd_micros),0)::text as held
      from executor_attempt_exposures where workspace_id = $1 and state not in ('cancelled','settled')`, [workspace]);
    requireFact(sum.rowCount === 1 && numeric(sum.rows[0].held, total) === held);
    return held;
  }
  async function read(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation) {
    const result = await client.query(`/* executor:attempt-lock */ select ${rowSelect} from executor_attempt_exposures
      where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 limit 2 for update`, key(i));
    requireFact(result.rowCount <= 1 && result.rows.length === result.rowCount);
    return result.rows[0] ? boundedData(result.rows[0]) as Record<string, unknown> : null;
  }
  function matches(row: Record<string, unknown>, i: NormalizedExecutorInvocation): boolean {
    return Object.entries(bindings(i)).every(([field, value]) => row[field] === value);
  }
  function snapshot(row: Record<string, unknown>, i: NormalizedExecutorInvocation): DurableExecutorSnapshot {
    const state = row.state as DurableExecutorState, amount = numeric(row.maximum_exposure_usd_micros, maximum), cap = numeric(row.provider_spend_limit_cents);
    const created = numeric(row.created_ms), updated = numeric(row.updated_ms), expires = numeric(row.expires_ms);
    const prepared = nullableNumber(row.prepared_ms), started = nullableNumber(row.started_ms);
    const input = nullableNumber(row.observed_input_tokens, 1000000000), output = nullableNumber(row.observed_output_tokens, 1000000000), tokens = nullableNumber(row.observed_total_tokens, 1000000000);
    const consumed = nullableNumber(row.provider_consumed_cents, 1000000000);
    requireFact(amount >= 10000 && cap === Math.floor(amount / 10000) && cap > 0 && created <= updated && expires > created && expires <= created + ttl
      && (prepared === null || (prepared >= created && prepared <= updated)) && (started === null || (prepared !== null && started >= prepared && started <= updated)));
    requireFact(integer(row.event_version, 1000000) && row.event_version > 0);
    requireFact((input === null && output === null && tokens === null) || (input !== null && output !== null && tokens === input + output));
    requireFact((state === "reserved" && row.request_fingerprint === null && prepared === null && started === null)
      || (state === "prepared" && fingerprint(row.request_fingerprint) && prepared !== null && started === null)
      || (["start_committed", "reconciliation_required", "settled"].includes(state) && fingerprint(row.request_fingerprint) && prepared !== null && started !== null)
      || (state === "cancelled" && started === null && ((row.request_fingerprint === null && prepared === null) || (fingerprint(row.request_fingerprint) && prepared !== null))));
    requireFact((["reserved", "prepared", "cancelled"].includes(state) && row.reconciliation === "not_started" && input === null && consumed === null)
      || (["start_committed", "settled"].includes(state) && ((row.reconciliation === "usage_unknown" && input === null) || (row.reconciliation === "partially_observed" && input !== null)))
      || (state === "reconciliation_required" && row.reconciliation === "reconciliation_required"));
    // Missing new columns in old test doubles mean NULL, never settlement authority.
    const settled = nullableNumber(row.settled_ms ?? null), terminal = row.terminal_result_fingerprint ?? null;
    requireFact(state === "settled" ? fingerprint(terminal) && settled !== null && started !== null && settled >= started && settled === updated && (consumed === null || consumed <= cap)
      : terminal === null && settled === null);
    return freezeDeep({ projectId, attempt: { ...i.attempt }, identity: { ...i.identity }, invocationId: i.invocationId, planId: i.planId, taskId: i.taskId,
      authorityGeneration: row.authority_generation as number | null, canonicalRunFingerprint: row.canonical_run_fingerprint as string | null,
      admissionFingerprint: row.admission_fingerprint as string | null,
      repository: { ...i.repository }, capability: i.capability, mode: i.mode, target: { ...target }, maximumExposureUsdMicros: amount,
      heldExposureUsdMicros: ["cancelled", "settled"].includes(state) ? 0 : amount, providerSpendLimitCents: cap, requestFingerprint: row.request_fingerprint as string | null,
      state, reconciliation: row.reconciliation as string, observedUsage: input === null ? null : { inputTokens: input, outputTokens: output!, totalTokens: tokens! },
      providerConsumedCents: consumed, observedCostUsdMicros: null, createdAt: created, updatedAt: updated, expiresAt: expires, preparedAt: prepared, startedAt: started,
      terminalResultFingerprint: terminal as string | null, settledAt: settled });
  }
  async function audit(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, row: Record<string, unknown>, operation: string) {
    const r = await client.query(`/* executor:audit */ insert into executor_attempt_events
      (workspace_id,development_run_id,attempt_number,event_version,state,operation) values($1,$2,$3,$4,$5,$6)`, [...key(i), row.event_version, row.state, operation]);
    requireFact(r.rowCount === 1);
  }
  async function clock(client: WorkflowRuntimeSqlClient) {
    const r = await client.query(`/* executor:clock */ select floor(extract(epoch from clock_timestamp())*1000)::text as now_ms`);
    requireFact(r.rowCount === 1); return numeric(r.rows[0].now_ms);
  }
  async function run(raw: unknown, initialize: boolean, active: boolean,
    operation: (client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, held: number, row: Record<string, unknown> | null,
      authority: import("./executor-current-authority-store").ExecutorCurrentAuthoritySnapshot | null) => Promise<DurableExecutorDecision>, borrowedClient?: WorkflowRuntimeSqlClient) {
    if (uncertain) return denied("recovery_required");
    const d = contract.validateInvocation(raw); if (!d.normalizedInvocation) return denied(); const i = d.normalizedInvocation;
    try {
      const work = async (client: WorkflowRuntimeSqlClient) => {
        if (!await lockExecutorWorkspaceProject(client, tenant, projectId, active)) return denied();
        if (active && !await lockExecutorControllerBinding(client, tenant, projectId, authorityFacts, configuration, controllerBinding,
          { target, financialPolicy: { maximumExposureUsdMicros: maximum, totalExposureUsdMicros: total, reservationTtlMs: ttl }, requestPolicy, invocation: i })) return denied("conflict");
        // Historical operations use the compatible subsequence workspace → Project → budget → exposure.
        // Current authority controls START, never receipt of historical output after revocation/advance.
        const authority = active ? await lockExecutorAuthority(client, workspace, authorityFacts.developmentRunId) : null;
        // Reserve, prepare AND start share the same current-authority predicate under lock.
        // Historical cancel/evidence/read do not reactivate authority and remain usable.
        if (active && (!authority || authority.status !== "active" || !executorAuthorityMatches(authority, projectId, authorityFacts))) return denied("conflict");
        const held = await locks(client, initialize); if (held === null) return denied();
        if (uncertain) return denied("recovery_required");
        // One shared barrier for reserve/prepare/start, AFTER budget serialization.
        // Historical capture/settlement bypasses it and can close the predecessor hold.
        if (active && !await executorPredecessorsClear(client, workspace, i.attempt.developmentRunId, i.attempt.number)) return denied("recovery_required");
        const row = await read(client, i);
        if (row && !matches(row, i)) return denied("conflict");
        if (row) {
          requireFact((row.authority_generation === null && row.canonical_run_fingerprint === null && row.admission_fingerprint === null)
            || (integer(row.authority_generation, 1000000) && row.authority_generation > 0 && fingerprint(row.canonical_run_fingerprint) && fingerprint(row.admission_fingerprint)));
          if (row.authority_generation !== null) requireFact(row.canonical_run_fingerprint === authorityFacts.canonicalRunFingerprint
            && row.admission_fingerprint === authorityFacts.admissionFingerprint);
          if (active && (row.authority_generation !== authority!.generation
            || row.canonical_run_fingerprint !== authority!.canonicalRunFingerprint || row.admission_fingerprint !== authority!.admissionFingerprint)) return denied("conflict");
          snapshot(row, i);
          const a = await client.query(`/* executor:audit-integrity */ select count(*)::int as count from executor_attempt_events
            where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and event_version = $4 and state = $5`, [...key(i), row.event_version, row.state]);
          requireFact(a.rowCount === 1 && a.rows[0].count === 1);
          if (row.state === "settled") await readOutcome(client, i, row);
        }
        return operation(client, i, held, row, authority);
      };
      return borrowedClient ? await work(borrowedClient) : await inTransaction(database, work);
    } catch (error) {
      // Do not swallow a failed statement on a caller-owned transaction: its owner
      // must ROLLBACK/destroy before releasing the same pooled session.
      if (borrowedClient) throw error;
      uncertain = true; return denied("recovery_required");
    }
  }
  async function reserve(raw: unknown, exposureInput: unknown): Promise<DurableExecutorDecision> {
    let amount: number;
    try {
      const e = exactRecord(boundedData(exposureInput), ["maximumExposureUsdMicros"]);
      if (!integer(e.maximumExposureUsdMicros, maximum) || e.maximumExposureUsdMicros < 10000) return denied();
      amount = e.maximumExposureUsdMicros;
    } catch { return denied(); }
    return run(raw, true, true, async (client, i, held, row, authority) => {
      if (row) {
        if (numeric(row.maximum_exposure_usd_micros) !== amount) return denied("conflict");
        if (["start_committed", "reconciliation_required", "settled"].includes(row.state as string)) return denied("recovery_required");
        if (row.state === "cancelled" || await clock(client) >= numeric(row.expires_ms)) return denied();
        return allowed("idempotent", snapshot(row, i));
      }
      if (held + amount > total) return denied();
      const updated = await client.query(`/* executor:budget-reserve */ update executor_exposure_budgets
        set held_exposure_usd_micros = held_exposure_usd_micros + $2, updated_at = clock_timestamp()
        where workspace_id = $1 and held_exposure_usd_micros + $2 <= total_exposure_usd_micros`, [workspace, amount]);
      requireFact(updated.rowCount === 1);
      const b = { ...bindings(i), authority_generation: authority!.generation, canonical_run_fingerprint: authority!.canonicalRunFingerprint,
        admission_fingerprint: authority!.admissionFingerprint }, columns = Object.keys(b), values = Object.values(b);
      const inserted = await client.query(`/* executor:reserve */ insert into executor_attempt_exposures
        (workspace_id, ${columns.join(",")}, maximum_exposure_usd_micros, provider_spend_limit_cents, state, reconciliation, event_version, created_at, updated_at, expires_at)
        select $1, ${values.map((_, n) => `$${n + 2}`).join(",")}, $${values.length + 2}, $${values.length + 3}, 'reserved', 'not_started', 1,
          stamp.time, stamp.time, stamp.time + $${values.length + 4} * interval '1 millisecond' from (select clock_timestamp() as time) stamp`,
        [workspace, ...values, amount, Math.floor(amount / 10000), ttl]);
      requireFact(inserted.rowCount === 1);
      const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "reserve");
      return allowed("reserved", snapshot(fresh!, i));
    });
  }
  async function bindRequest(raw: unknown, contextInput: unknown): Promise<DurableExecutorDecision> {
    // Snapshot context before acquiring locks; arbitrary caller mutation cannot race canonical construction.
    let context: unknown; try { context = boundedData(contextInput); } catch { return denied(); }
    return run(raw, false, true, async (client, i, _held, row) => {
      if (!row || !["reserved", "prepared"].includes(row.state as string)) return denied("recovery_required");
      if (await clock(client) >= numeric(row.expires_ms)) return denied();
      const request = prepareExecutorProviderRequest(requestPolicy, i, context, target, numeric(row.maximum_exposure_usd_micros), workspace);
      if (!request) return denied();
      requireFact(request.providerBudgetDefenseEvidence.limitCents === numeric(row.provider_spend_limit_cents));
      if (row.request_fingerprint !== null) return row.request_fingerprint === request.requestFingerprint ? allowed("idempotent", snapshot(row, i)) : denied("conflict");
      // One statement timestamp for both columns: separate volatile clock_timestamp()
      // expressions may be evaluated in physical column order, not SET text order.
      const u = await client.query(`/* executor:prepare */ update executor_attempt_exposures set state = 'prepared', request_fingerprint = $4,
        prepared_at = statement_timestamp(), updated_at = statement_timestamp(), event_version = event_version + 1
        where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and state = 'reserved' and request_fingerprint is null`, [...key(i), request.requestFingerprint]);
      requireFact(u.rowCount === 1); const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "prepare");
      return allowed("prepared", snapshot(fresh!, i));
    });
  }
  async function commitProviderStart(raw: unknown, requestFingerprint: unknown): Promise<DurableExecutorDecision> {
    if (!fingerprint(requestFingerprint)) return denied();
    try { if (Reflect.apply(authorizeStart, undefined, []) !== true) return denied(); } catch { return denied(); }
    const result = await run(raw, false, true, async (client, i, _held, row) => {
      if (!row) return denied();
      if (["start_committed", "reconciliation_required", "settled"].includes(row.state as string)) return denied("recovery_required");
      if (row.state !== "prepared" || row.request_fingerprint !== requestFingerprint || await clock(client) >= numeric(row.expires_ms)) return denied();
      const u = await client.query(`/* executor:start */ update executor_attempt_exposures set state = 'start_committed', reconciliation = 'usage_unknown',
        started_at = statement_timestamp(), updated_at = statement_timestamp(), event_version = event_version + 1
        where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and state = 'prepared'
          and request_fingerprint = $4 and expires_at > clock_timestamp()`, [...key(i), requestFingerprint]);
      requireFact(u.rowCount === 1); const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "start");
      return allowed("start_committed", snapshot(fresh!, i));
    });
    if (result.status !== "start_committed" || !result.snapshot) return result;
    // ONLY AFTER definite COMMIT acknowledgement. Neither persisted state nor a replay mints this reference.
    const capability: DurableExecutorStartCapability = Object.freeze({ kind: "durable_executor_start" });
    capabilities.set(capability, { workspace, snapshot: result.snapshot, used: false });
    return freezeDeep({ ...result, startCapability: capability });
  }
  async function cancel(raw: unknown): Promise<DurableExecutorDecision> {
    return run(raw, false, false, async (client, i, _held, row) => {
      if (!row) return denied(); if (row.state === "cancelled") return allowed("idempotent", snapshot(row, i));
      if (!["reserved", "prepared"].includes(row.state as string)) return denied("recovery_required");
      const u = await client.query(`/* executor:cancel */ update executor_attempt_exposures set state = 'cancelled', updated_at = clock_timestamp(), event_version = event_version + 1
        where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and state in ('reserved','prepared')`, key(i));
      requireFact(u.rowCount === 1);
      const released = await client.query(`/* executor:budget-release */ update executor_exposure_budgets
        set held_exposure_usd_micros = held_exposure_usd_micros - $2, updated_at = clock_timestamp()
        where workspace_id = $1 and held_exposure_usd_micros >= $2`, [workspace, numeric(row.maximum_exposure_usd_micros)]);
      requireFact(released.rowCount === 1); const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "cancel");
      return allowed("cancelled", snapshot(fresh!, i));
    });
  }
  async function markReconciliationRequired(raw: unknown): Promise<DurableExecutorDecision> {
    return run(raw, false, false, async (client, i, _held, row) => {
      if (!row || !["start_committed", "reconciliation_required"].includes(row.state as string)) return denied();
      if (row.state === "reconciliation_required") return allowed("idempotent", snapshot(row, i));
      const fresh = await reconcile(client, i);
      return allowed("recorded", snapshot(fresh!, i));
    });
  }
  async function reconcile(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation) {
    const u = await client.query(`/* executor:reconcile */ update executor_attempt_exposures set state = 'reconciliation_required', reconciliation = 'reconciliation_required',
      updated_at = clock_timestamp(), event_version = event_version + 1 where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and state = 'start_committed'`, key(i));
    requireFact(u.rowCount === 1); const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "reconcile"); return fresh!;
  }
  async function recordEvidence(raw: unknown, evidenceInput: unknown): Promise<DurableExecutorDecision> {
    let e: Record<string, unknown>;
    try {
      e = exactRecord(boundedData(evidenceInput), ["usage", "providerConsumedCents"]);
      if (e.usage !== null) {
        const u = exactRecord(e.usage, ["inputTokens", "outputTokens", "totalTokens"]);
        if (!integer(u.inputTokens) || !integer(u.outputTokens) || !integer(u.totalTokens) || u.totalTokens !== u.inputTokens + u.outputTokens) return denied();
        e.usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
      }
      if (e.providerConsumedCents !== null && !integer(e.providerConsumedCents)) return denied();
      ensureSafeEvidence(JSON.stringify(e));
    } catch { return denied(); }
    return run(raw, false, false, async (client, i, _held, row) => {
      if (!row || !["start_committed", "reconciliation_required"].includes(row.state as string)) return denied();
      const previous = snapshot(row, i), usage = e.usage as DurableExecutorSnapshot["observedUsage"];
      if ((usage === null && previous.observedUsage !== null) || (usage && previous.observedUsage && (usage.inputTokens < previous.observedUsage.inputTokens || usage.outputTokens < previous.observedUsage.outputTokens))
        || (previous.providerConsumedCents !== null && (e.providerConsumedCents === null || (e.providerConsumedCents as number) < previous.providerConsumedCents))) return denied("conflict");
      if (JSON.stringify(previous.observedUsage) === JSON.stringify(usage) && previous.providerConsumedCents === e.providerConsumedCents) return allowed("idempotent", previous);
      const reconciliation = row.state === "reconciliation_required" ? "reconciliation_required" : usage === null ? "usage_unknown" : "partially_observed";
      const u = await client.query(`/* executor:observe */ update executor_attempt_exposures set observed_input_tokens = $4, observed_output_tokens = $5,
        observed_total_tokens = $6, provider_consumed_cents = $7, reconciliation = $8, updated_at = clock_timestamp(), event_version = event_version + 1
        where workspace_id = $1 and development_run_id = $2 and attempt_number = $3 and state in ('start_committed','reconciliation_required')`,
        [...key(i), usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null, e.providerConsumedCents, reconciliation]);
      requireFact(u.rowCount === 1); const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "observe");
      return allowed("recorded", snapshot(fresh!, i));
    });
  }
  const inspect = (raw: unknown): Promise<DurableExecutorDecision> => run(raw, false, false, async (_client, i, _held, row) => row ? allowed("observed", snapshot(row, i)) : denied());
  // Restart read independently validates canonical payload, derived bindings, digest, metadata
  // and the cyclic DB relation. It never reconstructs provider-start authority.
  async function readOutcome(client: WorkflowRuntimeSqlClient, i: NormalizedExecutorInvocation, row: Record<string, unknown>) {
    const r = await client.query(`/* executor:outcome-read */ select request_fingerprint,result_fingerprint,outcome,failure_code,payload,provenance,exposure_state,
      floor(extract(epoch from recorded_at)*1000)::text as recorded_ms from executor_attempt_results
      where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 limit 2`, key(i));
    requireFact(r.rowCount === 1 && r.rows.length === 1); const saved = r.rows[0];
    requireFact(typeof saved.payload === "string" && Buffer.byteLength(saved.payload as string, "utf8") <= executorOutcomeJsonLimit);
    const validated = revalidateExecutorOutcome(configuration, invocationInput(i), JSON.parse(saved.payload as string));
    requireFact(validated && validated.normalizedResult.status !== "outcome_unknown" && saved.exposure_state === "settled"
      && saved.request_fingerprint === row.request_fingerprint && saved.result_fingerprint === row.terminal_result_fingerprint
      && saved.result_fingerprint === validated.resultFingerprint && saved.payload === validated.canonicalJson
      && saved.outcome === validated.normalizedResult.status && saved.failure_code === validated.normalizedResult.failureCode
      && numeric(saved.recorded_ms) === numeric(row.settled_ms)
      && (saved.provenance === "definitive_terminal" || (saved.provenance === "rejected_before_execution" && saved.outcome === "rejected")
        || (saved.provenance === "not_transmitted" && saved.outcome === "failed")));
    return validated!;
  }
  const invocationInput = (i: NormalizedExecutorInvocation) => ({ schemaVersion: i.schemaVersion, identity: i.identity, invocationId: i.invocationId,
    planId: i.planId, taskId: i.taskId, repository: i.repository, capability: i.capability, mode: i.mode, attempt: i.attempt });
  async function recordDefinitiveOutcomeAndSettle(raw: unknown, requestFingerprint: unknown, receipt: unknown): Promise<DurableExecutorOutcomeDecision> {
    let result: NormalizedExecutorResult | null = null, resultFingerprint: string | null = null;
    const d = !fingerprint(requestFingerprint) ? denied() : await run(raw, false, false, async (client, i, _held, row) => {
      const evidence = readExecutorOutcomeEvidence(receipt, i, requestFingerprint);
      if (!evidence || !row || row.request_fingerprint !== requestFingerprint) return denied("conflict");
      if (row.state === "settled") {
        const saved = await readOutcome(client, i, row);
        if (evidence.terminality === "ambiguous" || saved.resultFingerprint !== evidence.resultFingerprint) return denied("conflict");
        const previous = snapshot(row, i);
        if ((evidence.providerConsumedCents !== null && evidence.providerConsumedCents !== previous.providerConsumedCents)
          || (evidence.usage !== null && JSON.stringify(evidence.usage) !== JSON.stringify(previous.observedUsage))) return denied("conflict");
        result = saved.normalizedResult; resultFingerprint = saved.resultFingerprint;
        return allowed("idempotent", snapshot(row, i));
      }
      if (!["start_committed", "reconciliation_required"].includes(row.state as string)) return denied();
      if (evidence.terminality === "ambiguous") {
        if (row.state === "start_committed") await reconcile(client, i);
        return denied("recovery_required"); // Durable ambiguity, no terminal row, FULL exposure.
      }
      const validated = revalidateExecutorOutcome(configuration, invocationInput(i), evidence.normalizedResult);
      if (!validated || validated.normalizedResult.status === "outcome_unknown" || validated.resultFingerprint !== evidence.resultFingerprint) return denied();
      const previous = snapshot(row, i), usage = evidence.usage ?? previous.observedUsage;
      const consumed = evidence.providerConsumedCents ?? previous.providerConsumedCents;
      if ((usage && previous.observedUsage && (usage.inputTokens < previous.observedUsage.inputTokens || usage.outputTokens < previous.observedUsage.outputTokens))
        || (consumed !== null && (consumed > previous.providerSpendLimitCents || (previous.providerConsumedCents !== null && consumed < previous.providerConsumedCents)))) {
        if (row.state === "start_committed") await reconcile(client, i);
        return denied("recovery_required");
      }
      // INSERT precedes release. Deferred FKs and aggregate integrity require ALL four facts
      // at COMMIT. No success/result escapes if the COMMIT acknowledgement is lost.
      const inserted = await client.query(`/* executor:outcome-insert */ insert into executor_attempt_results
        (workspace_id,development_run_id,attempt_number,request_fingerprint,result_fingerprint,outcome,failure_code,payload,provenance)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...key(i), requestFingerprint, validated.resultFingerprint,
        validated.normalizedResult.status, validated.normalizedResult.failureCode, validated.canonicalJson, evidence.terminality]);
      requireFact(inserted.rowCount === 1);
      const settled = await client.query(`/* executor:settle */ update executor_attempt_exposures set state='settled',terminal_result_fingerprint=$4,
        settled_at=r.recorded_at,updated_at=r.recorded_at,event_version=event_version+1,
        observed_input_tokens=$5,observed_output_tokens=$6,observed_total_tokens=$7,provider_consumed_cents=$8,reconciliation=$9
        from executor_attempt_results r where executor_attempt_exposures.workspace_id=$1 and executor_attempt_exposures.development_run_id=$2
          and executor_attempt_exposures.attempt_number=$3 and executor_attempt_exposures.state in ('start_committed','reconciliation_required')
          and r.workspace_id=$1 and r.development_run_id=$2 and r.attempt_number=$3 and r.result_fingerprint=$4`,
        [...key(i), validated.resultFingerprint, usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null,
          consumed, usage === null ? "usage_unknown" : "partially_observed"]);
      requireFact(settled.rowCount === 1);
      const released = await client.query(`/* executor:settlement-release */ update executor_exposure_budgets
        set held_exposure_usd_micros=held_exposure_usd_micros-$2,updated_at=clock_timestamp()
        where workspace_id=$1 and held_exposure_usd_micros >= $2`, [workspace, previous.maximumExposureUsdMicros]);
      requireFact(released.rowCount === 1);
      const fresh = await read(client, i); requireFact(fresh); await audit(client, i, fresh!, "settle");
      const saved = await readOutcome(client, i, fresh!); result = saved.normalizedResult; resultFingerprint = saved.resultFingerprint;
      return allowed("settled", snapshot(fresh!, i));
    });
    return freezeDeep({ ...d, normalizedResult: d.verdict === "allow" ? result : null, resultFingerprint: d.verdict === "allow" ? resultFingerprint : null });
  }
  async function inspectOutcomeUsing(raw: unknown, borrowedClient?: WorkflowRuntimeSqlClient): Promise<DurableExecutorOutcomeDecision> {
    let result: NormalizedExecutorResult | null = null, resultFingerprint: string | null = null;
    const d = await run(raw, false, false, async (client, i, _held, row) => {
      if (!row || row.state !== "settled") return denied("recovery_required");
      const saved = await readOutcome(client, i, row); result = saved.normalizedResult; resultFingerprint = saved.resultFingerprint;
      return allowed("observed", snapshot(row, i));
    }, borrowedClient);
    return freezeDeep({ ...d, normalizedResult: d.verdict === "allow" ? result : null, resultFingerprint: d.verdict === "allow" ? resultFingerprint : null });
  }
  const inspectOutcome = (raw: unknown) => inspectOutcomeUsing(raw);
  const providerIdentity = createExecutorProviderIdentityOperations({ workspace, target, requestPolicy,
    run: (raw, operation) => run(raw, false, false, (client, i, _held, row) => row ? operation(client, i, snapshot(row, i)) : Promise.resolve(denied())),
    takeStart(capability) {
      const c = capability && typeof capability === "object" ? capabilities.get(capability) : null;
      return c?.workspace === workspace ? consumeDurableExecutorStartCapability(capability) : null;
    },
    async markUnknown(client, i, exposure) { if (exposure.state === "start_committed") await reconcile(client, i); },
  });
  const store = Object.freeze({ reserve, bindRequest, commitProviderStart, cancel, markReconciliationRequired, recordEvidence, inspect, ...providerIdentity,
    recordDefinitiveOutcomeAndSettle, inspectOutcome, realDispatch: "blocked" as const });
  const historicalReader = Object.freeze({ inspectOutcomeInTransaction: (client: WorkflowRuntimeSqlClient, raw: unknown) => inspectOutcomeUsing(raw, client) });
  return Object.freeze({ store, historicalReader });
}
