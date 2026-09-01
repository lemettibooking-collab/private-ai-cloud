import type {
  WorkflowRuntimeCommandBeginDecision,
  WorkflowRuntimeCommandBeginInput,
  WorkflowRuntimeCommandOwnershipInput,
  WorkflowRuntimeCompareAndSwapDecision,
  WorkflowRuntimeCompareAndSwapInput,
  WorkflowRuntimeExecutionStartDecision,
  WorkflowRuntimeResponse,
  WorkflowRuntimeState,
  WorkflowRuntimeStateStore,
} from "../workflows/workflow-runtime-service";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { workflowRunStatuses } from "../contracts/workflow-run.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { normalizeWorkflowRuntimeState, workflowRuntimeServiceStatuses, workflowRuntimeServiceVerdicts } from "../workflows/workflow-runtime-service.ts";

export type WorkflowRuntimeSqlResult<Row extends Record<string, unknown>> = Readonly<{
  rows: readonly Row[];
  rowCount: number;
}>;

export interface WorkflowRuntimeSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<WorkflowRuntimeSqlResult<Row>>;
  release(): void;
}

export interface WorkflowRuntimeDatabase {
  connect(): Promise<WorkflowRuntimeSqlClient>;
}

export const postgresWorkflowRuntimeStoreLimits = Object.freeze({
  defaultLeaseDurationMs: 5 * 60 * 1_000,
  minimumLeaseDurationMs: 30 * 1_000,
  maximumLeaseDurationMs: 15 * 60 * 1_000,
  defaultCommandLeaseDurationMs: 2 * 60 * 1_000,
  minimumCommandLeaseDurationMs: 30 * 1_000,
  maximumCommandLeaseDurationMs: 15 * 60 * 1_000,
  maxStoredResponseReasons: 256,
});

export type PostgresWorkflowRuntimeStoreOptions = Readonly<{
  database: WorkflowRuntimeDatabase;
  workspaceId: string;
  workspaceDatabaseId: string;
  leaseDurationMs?: number;
  commandLeaseDurationMs?: number;
  recoverAbandonedCommands?: boolean;
  recoverStaleCommands?: boolean;
  now?: () => Date;
}>;

export type CreateWorkflowRuntimeStateInput = Readonly<{
  state: WorkflowRuntimeState;
}>;

type RunRow = Record<string, unknown> & {
  db_run_id: string;
  workspace_database_id: string;
  runtime_id: string;
  status: string;
  revision: string | number;
  runtime_snapshot: unknown;
  runtime_pause: unknown;
  project_registry: unknown;
  model_provider_registry: unknown;
};

type StepRow = Record<string, unknown> & {
  step_key: string;
  status: string;
  attempt_count: number;
  runtime_revision: string | number;
  state_payload: unknown;
};

type CommandRow = Record<string, unknown> & {
  fingerprint: string;
  expected_revision: string | number;
  status: "in_progress" | "completed" | "abandoned";
  response_payload: unknown;
  lease_expires_at: Date | string;
  effect_started_at: Date | string | null;
};

type ClaimRow = Record<string, unknown> & {
  claim_id: string;
  execution_id: string;
  request_fingerprint: string;
  lease_expires_at: Date | string;
  execution_status: "prepared" | "running" | "completed" | "failed" | "outcome_unknown";
};

type ExecutionRow = Record<string, unknown> & {
  status: "prepared" | "running" | "completed" | "failed" | "outcome_unknown";
  lease_expires_at: Date | string;
  claim_status: "active" | "released" | "expired";
  claim_expected_revision: string | number;
  execution_expected_revision: string | number;
  run_revision: string | number;
  runtime_pause: unknown;
  run_status: string;
};

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fingerprintPattern = /^[0-9a-f]{64}$/u;
const forbiddenStoredKeys = new Set([
  "apiKey",
  "credential",
  "credentials",
  "credentialValue",
  "databaseUrl",
  "evidence",
  "evidenceResolverOutput",
  "hiddenProviderPayload",
  "preparedProviderRequest",
  "preparedRequest",
  "providerRequest",
  "secret",
]);

class WorkflowRuntimePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRuntimePersistenceError";
  }
}

class WorkflowRuntimeCommitAmbiguousError extends WorkflowRuntimePersistenceError {
  constructor() {
    super("Workflow runtime transaction commit acknowledgement is ambiguous.");
    this.name = "WorkflowRuntimeCommitAmbiguousError";
  }
}

function persistenceError(message: string): WorkflowRuntimePersistenceError {
  return new WorkflowRuntimePersistenceError(message);
}

function plainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function safeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) >= 0;
}

function databaseInteger(input: string | number): number | null {
  const value = typeof input === "string" ? Number(input) : input;
  return safeInteger(value) ? value : null;
}

function canonicalData(input: unknown): string {
  if (input === null) return "null";
  if (typeof input === "string") return JSON.stringify(input);
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) return `[${input.map(canonicalData).join(",")}]`;
  if (plainRecord(input)) {
    return `{${Object.keys(input).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalData(input[key])}`,
    ).join(",")}}`;
  }
  return "invalid";
}

function safeDate(input: Date | string): Date | null {
  const value = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isFinite(value.getTime()) ? value : null;
}

function containsForbiddenStoredKey(input: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof input !== "object" || input === null) return false;
  if (seen.has(input)) return false;
  seen.add(input);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || forbiddenStoredKeys.has(key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return true;
    if (containsForbiddenStoredKey(descriptor.value, seen)) return true;
  }
  return false;
}

function validatedState(input: unknown, workspaceId: string): WorkflowRuntimeState {
  const state = normalizeWorkflowRuntimeState(input);
  if (!state || state.snapshot.workspaceId !== workspaceId || state.existingRequests.length !== 0
    || containsForbiddenStoredKey(state.projectRegistry)
    || containsForbiddenStoredKey(state.modelProviderRegistry)) {
    throw persistenceError("Workflow runtime state is not safe for durable persistence.");
  }
  return state;
}

function normalizeStoredResponse(input: unknown): WorkflowRuntimeResponse | null {
  const boundary = snapshotModelProviderAdapterInput(input);
  if (!boundary.ok || !plainRecord(boundary.value)
    || !exactFields(boundary.value, [
      "verdict", "status", "reasons", "runId", "revision", "workflowStatus",
      "currentStepIds", "readyStepIds", "waitingApproval", "retryPending", "lastStepResult",
    ])) return null;
  const value = boundary.value;
  if (!workflowRuntimeServiceVerdicts.includes(value.verdict as never)
    || !workflowRuntimeServiceStatuses.includes(value.status as never)
    || (value.runId !== null && (typeof value.runId !== "string" || !stableIdPattern.test(value.runId)))
    || (value.revision !== null && !safeInteger(value.revision))
    || (value.workflowStatus !== null && !workflowRunStatuses.includes(value.workflowStatus as never))
    || !Array.isArray(value.reasons)
    || value.reasons.length > postgresWorkflowRuntimeStoreLimits.maxStoredResponseReasons
    || !Array.isArray(value.currentStepIds) || !value.currentStepIds.every((item) => typeof item === "string")
    || !Array.isArray(value.readyStepIds) || !value.readyStepIds.every((item) => typeof item === "string")) return null;
  for (const reason of value.reasons) {
    if (!plainRecord(reason) || !exactFields(reason, ["code", "path", "message", "runId", "stepId"])
      || typeof reason.code !== "string" || typeof reason.path !== "string"
      || typeof reason.message !== "string"
      || (reason.runId !== null && typeof reason.runId !== "string")
      || (reason.stepId !== null && typeof reason.stepId !== "string")) return null;
  }
  if (value.waitingApproval !== null && (!plainRecord(value.waitingApproval)
    || !exactFields(value.waitingApproval, ["kind", "stepId", "approvalRequestId"])
    || !["workflow_gate", "runtime_risk"].includes(value.waitingApproval.kind as string)
    || typeof value.waitingApproval.stepId !== "string"
    || (value.waitingApproval.approvalRequestId !== null
      && typeof value.waitingApproval.approvalRequestId !== "string"))) return null;
  if (value.retryPending !== null && (!plainRecord(value.retryPending)
    || !exactFields(value.retryPending, ["stepId", "attemptCount", "errorCode"])
    || typeof value.retryPending.stepId !== "string"
    || !safeInteger(value.retryPending.attemptCount)
    || typeof value.retryPending.errorCode !== "string")) return null;
  if (value.lastStepResult !== null && (!plainRecord(value.lastStepResult)
    || !exactFields(value.lastStepResult, [
      "stepId", "outcome", "finishReason", "providerId", "providerModelId",
      "providerModelVersion", "usage", "latencyMs", "costUsdMicros",
    ]) || containsForbiddenStoredKey(value.lastStepResult))) return null;
  return freezeModelProviderAdapterData(cloneModelProviderAdapterData(value as WorkflowRuntimeResponse));
}

function leaseDuration(input: number | undefined): number {
  const value = input ?? postgresWorkflowRuntimeStoreLimits.defaultLeaseDurationMs;
  if (!Number.isSafeInteger(value)
    || value < postgresWorkflowRuntimeStoreLimits.minimumLeaseDurationMs
    || value > postgresWorkflowRuntimeStoreLimits.maximumLeaseDurationMs) {
    throw persistenceError("Workflow runtime lease policy is invalid.");
  }
  return value;
}

function commandLeaseDuration(input: number | undefined): number {
  const value = input ?? postgresWorkflowRuntimeStoreLimits.defaultCommandLeaseDurationMs;
  if (!Number.isSafeInteger(value)
    || value < postgresWorkflowRuntimeStoreLimits.minimumCommandLeaseDurationMs
    || value > postgresWorkflowRuntimeStoreLimits.maximumCommandLeaseDurationMs) {
    throw persistenceError("Workflow runtime command lease policy is invalid.");
  }
  return value;
}

async function rollback(client: WorkflowRuntimeSqlClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // The original operation remains the only externally visible sanitized error.
  }
}

async function transaction<T>(
  database: WorkflowRuntimeDatabase,
  operation: (client: WorkflowRuntimeSqlClient) => Promise<T>,
): Promise<T> {
  let client: WorkflowRuntimeSqlClient | null = null;
  let commitAttempted = false;
  try {
    client = await database.connect();
    await client.query("begin");
    const result = await operation(client);
    commitAttempted = true;
    await client.query("commit");
    return result;
  } catch (error) {
    if (client) await rollback(client);
    if (commitAttempted) throw new WorkflowRuntimeCommitAmbiguousError();
    if (error instanceof WorkflowRuntimePersistenceError) throw error;
    throw persistenceError("Workflow runtime database operation failed.");
  } finally {
    client?.release();
  }
}

function terminalExecutionStatus(state: WorkflowRuntimeState, stepId: string): "completed" | "failed" {
  const step = state.snapshot.stepStates.find((candidate) => candidate.stepId === stepId);
  return step?.status === "success" ? "completed" : "failed";
}

function sameRuntimeState(left: WorkflowRuntimeState, right: WorkflowRuntimeState): boolean {
  return canonicalData(left) === canonicalData(right);
}

export class PostgresWorkflowRuntimeStateStore implements WorkflowRuntimeStateStore {
  readonly #database: WorkflowRuntimeDatabase;
  readonly #workspaceId: string;
  readonly #workspaceDatabaseId: string;
  readonly #leaseDurationMs: number;
  readonly #commandLeaseDurationMs: number;
  readonly #recoverAbandonedCommands: boolean;
  readonly #recoverStaleCommands: boolean;
  readonly #now: () => Date;

  constructor(options: PostgresWorkflowRuntimeStoreOptions) {
    if (!plainRecord(options) || !stableIdPattern.test(options.workspaceId)
      || !uuidPattern.test(options.workspaceDatabaseId)
      || typeof options.database?.connect !== "function"
      || (options.recoverAbandonedCommands !== undefined
        && typeof options.recoverAbandonedCommands !== "boolean")
      || (options.recoverStaleCommands !== undefined
        && typeof options.recoverStaleCommands !== "boolean")
      || (options.now !== undefined && typeof options.now !== "function")) {
      throw persistenceError("Workflow runtime store configuration is invalid.");
    }
    this.#database = options.database;
    this.#workspaceId = options.workspaceId;
    this.#workspaceDatabaseId = options.workspaceDatabaseId;
    this.#leaseDurationMs = leaseDuration(options.leaseDurationMs);
    this.#commandLeaseDurationMs = commandLeaseDuration(options.commandLeaseDurationMs);
    this.#recoverAbandonedCommands = options.recoverAbandonedCommands ?? false;
    this.#recoverStaleCommands = options.recoverStaleCommands ?? false;
    this.#now = options.now ?? (() => new Date());
  }

  #trustedNow(): Date {
    const value = this.#now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw persistenceError("Workflow runtime store clock is invalid.");
    }
    return new Date(value.getTime());
  }

  async create(input: CreateWorkflowRuntimeStateInput): Promise<void> {
    const state = validatedState(input.state, this.#workspaceId);
    await transaction(this.#database, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `/* workflow-runtime:create-run */
         insert into workflow_runs (
           workspace_id, status, runtime_id, project_id, workflow_id, revision,
           runtime_snapshot, runtime_pause, project_registry, model_provider_registry
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id::text as id`,
        [
          this.#workspaceDatabaseId,
          state.snapshot.status,
          state.snapshot.runId,
          state.snapshot.projectId,
          state.snapshot.workflowId,
          state.snapshot.revision,
          state.snapshot,
          state.pause,
          state.projectRegistry,
          state.modelProviderRegistry,
        ],
      );
      if (inserted.rowCount !== 1 || typeof inserted.rows[0]?.id !== "string") {
        throw persistenceError("Workflow runtime Run creation failed closed.");
      }
      const dbRunId = inserted.rows[0].id;
      for (const stepState of state.snapshot.stepStates) {
        const step = state.snapshot.executionProfile.steps.find((candidate) => candidate.id === stepState.stepId);
        if (!step) throw persistenceError("Workflow runtime step projection is invalid.");
        const projected = await client.query(
          `/* workflow-runtime:create-step */
           insert into workflow_step_runs (
             workspace_id, run_id, step_key, type, status, attempt_count,
             agent_id, agent_binding_id, model_profile_id, runtime_revision, state_payload
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            this.#workspaceDatabaseId,
            dbRunId,
            stepState.stepId,
            step.kind,
            stepState.status,
            stepState.attemptCount,
            step.kind === "agent_task" ? step.agentId : null,
            step.kind === "agent_task" ? step.agentBindingId : null,
            step.kind === "agent_task" ? step.modelProfileId : null,
            state.snapshot.revision,
            stepState,
          ],
        );
        if (projected.rowCount !== 1) {
          throw persistenceError("Workflow runtime step projection creation failed closed.");
        }
      }
    });
  }

  async load(input: Readonly<{ runId: string }>): Promise<unknown> {
    if (!stableIdPattern.test(input.runId)) return null;
    let client: WorkflowRuntimeSqlClient | null = null;
    try {
      client = await this.#database.connect();
      const runResult = await client.query<RunRow>(
        `/* workflow-runtime:load-run */
         select id::text as db_run_id, workspace_id::text as workspace_database_id,
                runtime_id, status, revision::text as revision, runtime_snapshot,
                runtime_pause, project_registry, model_provider_registry
         from workflow_runs
         where workspace_id = $1 and runtime_id = $2`,
        [this.#workspaceDatabaseId, input.runId],
      );
      if (runResult.rowCount === 0) return null;
      if (runResult.rowCount !== 1) throw persistenceError("Workflow runtime Run lookup failed closed.");
      const run = runResult.rows[0];
      const stepResult = await client.query<StepRow>(
        `/* workflow-runtime:load-steps */
         select step_key, status, attempt_count, runtime_revision::text as runtime_revision, state_payload
         from workflow_step_runs
         where workspace_id = $1 and run_id = $2 and runtime_revision is not null
         order by step_key`,
        [this.#workspaceDatabaseId, run.db_run_id],
      );
      const state = validatedState({
        snapshot: run.runtime_snapshot,
        projectRegistry: run.project_registry,
        modelProviderRegistry: run.model_provider_registry,
        existingRequests: [],
        pause: run.runtime_pause,
      }, this.#workspaceId);
      const revision = databaseInteger(run.revision);
      if (run.workspace_database_id !== this.#workspaceDatabaseId
        || run.runtime_id !== state.snapshot.runId || revision !== state.snapshot.revision
        || run.status !== state.snapshot.status
        || stepResult.rowCount !== state.snapshot.stepStates.length) {
        throw persistenceError("Persisted Workflow runtime state is inconsistent.");
      }
      for (const row of stepResult.rows) {
        const rowRevision = databaseInteger(row.runtime_revision);
        const step = state.snapshot.stepStates.find((candidate) => candidate.stepId === row.step_key);
        const boundary = snapshotModelProviderAdapterInput(row.state_payload);
        if (!step || !boundary.ok || rowRevision !== revision || row.status !== step.status
          || row.attempt_count !== step.attemptCount
          || canonicalData(boundary.value) !== canonicalData(step)) {
          throw persistenceError("Persisted Workflow step projection is inconsistent.");
        }
      }
      return state;
    } catch (error) {
      if (error instanceof WorkflowRuntimePersistenceError) throw error;
      throw persistenceError("Workflow runtime database load failed.");
    } finally {
      client?.release();
    }
  }

  async beginCommand(input: WorkflowRuntimeCommandBeginInput): Promise<WorkflowRuntimeCommandBeginDecision> {
    if (!stableIdPattern.test(input.runId) || !stableIdPattern.test(input.commandId)
      || !fingerprintPattern.test(input.fingerprint)
      || !safeInteger(input.expectedRevision)) return { status: "conflict" };
    return transaction(this.#database, async (client) => {
      const now = this.#trustedNow();
      const leaseExpiresAt = new Date(now.getTime() + this.#commandLeaseDurationMs);
      const run = await client.query<{ db_run_id: string }>(
        `/* workflow-runtime:command-run */
         select id::text as db_run_id from workflow_runs
         where workspace_id = $1 and runtime_id = $2 for update`,
        [this.#workspaceDatabaseId, input.runId],
      );
      if (run.rowCount !== 1) return { status: "conflict" as const };
      const inserted = await client.query<{ ownership_token: string }>(
        `/* workflow-runtime:begin-command */
         insert into workflow_runtime_commands (
           workspace_id, run_id, command_id, fingerprint, expected_revision,
           status, created_at, updated_at, lease_expires_at
         ) values ($1, $2, $3, $4, $5, 'in_progress', $6, $6, $7)
         on conflict (run_id, command_id) do nothing
         returning lease_token::text as ownership_token`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, input.commandId,
          input.fingerprint, input.expectedRevision, now, leaseExpiresAt,
        ],
      );
      if (inserted.rowCount === 1 && uuidPattern.test(inserted.rows[0]?.ownership_token ?? "")) {
        return { status: "acquired" as const, ownershipToken: inserted.rows[0].ownership_token };
      }
      if (inserted.rowCount !== 0) {
        throw persistenceError("Workflow command ownership creation failed closed.");
      }
      const existing = await client.query<CommandRow>(
        `/* workflow-runtime:read-command */
         select fingerprint, expected_revision::text as expected_revision, status,
                response_payload, lease_expires_at, effect_started_at
         from workflow_runtime_commands
         where workspace_id = $1 and run_id = $2 and command_id = $3
         for update`,
        [this.#workspaceDatabaseId, run.rows[0].db_run_id, input.commandId],
      );
      if (existing.rowCount !== 1 || existing.rows[0].fingerprint !== input.fingerprint
        || databaseInteger(existing.rows[0].expected_revision) !== input.expectedRevision) {
        return { status: "conflict" as const };
      }
      const command = existing.rows[0];
      if (command.status === "completed") {
        const stored = normalizeStoredResponse(command.response_payload);
        if (!stored) throw persistenceError("Stored Workflow runtime response is invalid.");
        return { status: "replay" as const, response: stored };
      }
      if (command.status === "abandoned" && command.effect_started_at === null
        && this.#recoverAbandonedCommands) {
        const recovered = await client.query<{ ownership_token: string }>(
          `/* workflow-runtime:recover-command */
           update workflow_runtime_commands
           set status = 'in_progress', response_payload = null, completed_at = null,
               effect_started_at = null, updated_at = $5, lease_expires_at = $6,
               lease_token = gen_random_uuid()
           where workspace_id = $1 and run_id = $2 and command_id = $3
             and fingerprint = $4 and expected_revision = $7 and status = 'abandoned'
             and effect_started_at is null
           returning lease_token::text as ownership_token`,
          [
            this.#workspaceDatabaseId, run.rows[0].db_run_id, input.commandId,
            input.fingerprint, now, leaseExpiresAt, input.expectedRevision,
          ],
        );
        if (recovered.rowCount !== 1 || !uuidPattern.test(recovered.rows[0]?.ownership_token ?? "")) {
          throw persistenceError("Workflow command recovery failed closed.");
        }
        return { status: "acquired" as const, ownershipToken: recovered.rows[0].ownership_token };
      }
      if (command.status === "abandoned") return { status: "recovery_required" as const };
      if (command.status === "in_progress") {
        const currentLease = safeDate(command.lease_expires_at);
        if (!currentLease) throw persistenceError("Persisted Workflow command lease is invalid.");
        if (currentLease.getTime() > now.getTime()) return { status: "in_progress" as const };
        if (command.effect_started_at !== null || !this.#recoverStaleCommands) {
          return { status: "recovery_required" as const };
        }
        const recovered = await client.query<{ ownership_token: string }>(
          `/* workflow-runtime:recover-stale-command */
           update workflow_runtime_commands
           set updated_at = $5, lease_expires_at = $6, lease_token = gen_random_uuid()
           where workspace_id = $1 and run_id = $2 and command_id = $3
             and fingerprint = $4 and expected_revision = $7
             and status = 'in_progress' and effect_started_at is null
             and lease_expires_at <= $5
           returning lease_token::text as ownership_token`,
          [
            this.#workspaceDatabaseId, run.rows[0].db_run_id, input.commandId,
            input.fingerprint, now, leaseExpiresAt, input.expectedRevision,
          ],
        );
        if (recovered.rowCount !== 1 || !uuidPattern.test(recovered.rows[0]?.ownership_token ?? "")) {
          throw persistenceError("Workflow stale command recovery failed closed.");
        }
        return { status: "acquired" as const, ownershipToken: recovered.rows[0].ownership_token };
      }
      return { status: "recovery_required" as const };
    });
  }

  async completeCommand(input: Readonly<{
    runId: string;
    commandId: string;
    fingerprint: string;
    ownershipToken: string;
    response: WorkflowRuntimeResponse;
  }>): Promise<void> {
    const stored = normalizeStoredResponse(input.response);
    if (!stored || !fingerprintPattern.test(input.fingerprint)
      || !uuidPattern.test(input.ownershipToken)) {
      throw persistenceError("Workflow command response is invalid.");
    }
    await transaction(this.#database, async (client) => {
      const completed = await client.query(
        `/* workflow-runtime:complete-command */
         update workflow_runtime_commands as command
         set status = 'completed', response_payload = $4, completed_at = now(), updated_at = now()
         from workflow_runs as run
         where command.run_id = run.id and command.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2
           and command.command_id = $3 and command.fingerprint = $5
           and command.lease_token = $6 and command.status = 'in_progress'`,
        [
          this.#workspaceDatabaseId, input.runId, input.commandId,
          stored, input.fingerprint, input.ownershipToken,
        ],
      );
      if (completed.rowCount !== 1) throw persistenceError("Workflow command completion failed closed.");
    });
  }

  async abandonCommand(input: WorkflowRuntimeCommandOwnershipInput): Promise<void> {
    await transaction(this.#database, async (client) => {
      const abandoned = await client.query(
        `/* workflow-runtime:abandon-command */
         update workflow_runtime_commands as command
         set status = 'abandoned', updated_at = now()
         from workflow_runs as run
         where command.run_id = run.id and command.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2
           and command.command_id = $3 and command.fingerprint = $4
           and command.expected_revision = $5 and command.lease_token = $6
           and command.status = 'in_progress'`,
        [
          this.#workspaceDatabaseId, input.runId, input.commandId,
          input.fingerprint, input.expectedRevision, input.ownershipToken,
        ],
      );
      if (abandoned.rowCount === 1) return;
      const existing = await client.query<{ status: string }>(
        `/* workflow-runtime:abandon-command-status */
         select command.status
         from workflow_runtime_commands as command
         join workflow_runs as run on run.id = command.run_id
         where command.workspace_id = $1 and run.workspace_id = $1 and run.runtime_id = $2
           and command.command_id = $3 and command.fingerprint = $4
           and command.expected_revision = $5 and command.lease_token = $6`,
        [
          this.#workspaceDatabaseId, input.runId, input.commandId,
          input.fingerprint, input.expectedRevision, input.ownershipToken,
        ],
      );
      if (existing.rowCount !== 1 || !["completed", "abandoned"].includes(existing.rows[0].status)) {
        throw persistenceError("Workflow command abandonment failed closed.");
      }
    });
  }

  async markCommandEffectful(input: WorkflowRuntimeCommandOwnershipInput): Promise<void> {
    await transaction(this.#database, async (client) => {
      const marked = await client.query(
        `/* workflow-runtime:mark-command-effectful */
         update workflow_runtime_commands as command
         set effect_started_at = coalesce(effect_started_at, now()), updated_at = now()
         from workflow_runs as run
         where command.run_id = run.id and command.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2
           and command.command_id = $3 and command.fingerprint = $4
           and command.expected_revision = $5 and command.lease_token = $6
           and command.status = 'in_progress' and command.lease_expires_at > now()`,
        [
          this.#workspaceDatabaseId, input.runId, input.commandId,
          input.fingerprint, input.expectedRevision, input.ownershipToken,
        ],
      );
      if (marked.rowCount !== 1) throw persistenceError("Workflow command effect boundary failed closed.");
    });
  }

  async claim(input: Parameters<WorkflowRuntimeStateStore["claim"]>[0]) {
    if (!stableIdPattern.test(input.runId) || !stableIdPattern.test(input.stepId)
      || !stableIdPattern.test(input.executionId) || !safeInteger(input.expectedRevision)
      || !Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1
      || !fingerprintPattern.test(input.requestFingerprint)) {
      return { status: "conflict" as const, claimId: null };
    }
    return transaction(this.#database, async (client) => {
      const run = await client.query<{
        db_run_id: string;
        revision: string | number;
        runtime_pause: unknown;
      }>(
        `/* workflow-runtime:claim-run */
         select id::text as db_run_id, revision::text as revision, runtime_pause
         from workflow_runs
         where workspace_id = $1 and runtime_id = $2 for update`,
        [this.#workspaceDatabaseId, input.runId],
      );
      if (run.rowCount !== 1 || databaseInteger(run.rows[0].revision) !== input.expectedRevision
        || run.rows[0].runtime_pause !== null) {
        return { status: "conflict" as const, claimId: null };
      }
      const active = await client.query<ClaimRow>(
        `/* workflow-runtime:read-active-claim */
         select claim.id::text as claim_id, claim.execution_id, claim.lease_expires_at,
                execution.status as execution_status, execution.request_fingerprint
         from workflow_runtime_claims as claim
         join workflow_runtime_executions as execution on execution.claim_id = claim.id
         where claim.workspace_id = $1 and claim.run_id = $2 and claim.step_id = $3
           and claim.attempt_number = $4 and claim.expected_revision = $5
           and claim.status = 'active'
         for update of claim, execution`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, input.stepId,
          input.attemptNumber, input.expectedRevision,
        ],
      );
      const now = this.#trustedNow();
      if (active.rowCount === 1) {
        const existing = active.rows[0];
        const expiresAt = safeDate(existing.lease_expires_at);
        if (!expiresAt) throw persistenceError("Persisted Workflow claim lease is invalid.");
        if (expiresAt.getTime() > now.getTime()) {
          return {
            status: existing.execution_id === input.executionId
              && existing.request_fingerprint === input.requestFingerprint
              ? "idempotent" as const
              : "conflict" as const,
            claimId: null,
          };
        }
        if (existing.execution_status === "prepared"
          && existing.execution_id === input.executionId) {
          if (existing.request_fingerprint !== input.requestFingerprint) {
            return { status: "conflict" as const, claimId: null };
          }
          const expired = await client.query(
            `/* workflow-runtime:expire-recovered-claim */
             update workflow_runtime_claims
             set status = 'expired', released_at = $2
             where workspace_id = $1 and id = $3 and status = 'active'
               and lease_expires_at <= $2`,
            [
              this.#workspaceDatabaseId,
              now,
              existing.claim_id,
            ],
          );
          if (expired.rowCount !== 1) {
            throw persistenceError("Workflow prepared execution recovery failed closed.");
          }
          const recoveredClaim = await client.query<{ claim_id: string }>(
            `/* workflow-runtime:insert-recovered-claim */
             insert into workflow_runtime_claims (
               workspace_id, run_id, step_id, attempt_number, expected_revision,
               execution_id, status, acquired_at, lease_expires_at
             ) values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
             returning id::text as claim_id`,
            [
              this.#workspaceDatabaseId, run.rows[0].db_run_id, input.stepId,
              input.attemptNumber, input.expectedRevision, input.executionId, now,
              new Date(now.getTime() + this.#leaseDurationMs),
            ],
          );
          const recoveredClaimId = recoveredClaim.rows[0]?.claim_id;
          if (recoveredClaim.rowCount !== 1 || typeof recoveredClaimId !== "string"
            || !uuidPattern.test(recoveredClaimId) || recoveredClaimId === existing.claim_id) {
            throw persistenceError("Workflow prepared execution ownership recovery failed closed.");
          }
          const rebound = await client.query(
            `/* workflow-runtime:rebind-prepared-execution */
             update workflow_runtime_executions
             set claim_id = $4
             where workspace_id = $1 and run_id = $2 and claim_id = $3
               and step_id = $5 and attempt_number = $6 and expected_revision = $7
               and execution_id = $8 and request_fingerprint = $9 and status = 'prepared'`,
            [
              this.#workspaceDatabaseId, run.rows[0].db_run_id, existing.claim_id,
              recoveredClaimId, input.stepId, input.attemptNumber, input.expectedRevision,
              input.executionId, input.requestFingerprint,
            ],
          );
          if (rebound.rowCount !== 1) {
            throw persistenceError("Workflow prepared execution ownership rebind failed closed.");
          }
          return { status: "acquired" as const, claimId: recoveredClaimId };
        }
        const expired = await client.query(
          `/* workflow-runtime:expire-claim */
           update workflow_runtime_claims
           set status = 'expired', released_at = $2
           where workspace_id = $1 and id = $3 and status = 'active'`,
          [this.#workspaceDatabaseId, now, existing.claim_id],
        );
        if (expired.rowCount !== 1) throw persistenceError("Workflow claim expiry failed closed.");
        if (existing.execution_status === "running") {
          const unknown = await client.query(
            `/* workflow-runtime:unknown-execution */
             update workflow_runtime_executions
             set status = 'outcome_unknown', completed_at = $2
             where workspace_id = $1 and claim_id = $3 and status = 'running'`,
            [this.#workspaceDatabaseId, now, existing.claim_id],
          );
          if (unknown.rowCount !== 1) {
            throw persistenceError("Workflow ambiguous execution recovery failed closed.");
          }
          return { status: "recovery_required" as const, claimId: null };
        }
        if (existing.execution_status === "outcome_unknown") {
          return { status: "recovery_required" as const, claimId: null };
        }
        if (existing.execution_status === "prepared") {
          const failed = await client.query(
            `/* workflow-runtime:expire-prepared-execution */
             update workflow_runtime_executions
             set status = 'failed', completed_at = $2
             where workspace_id = $1 and claim_id = $3 and status = 'prepared'`,
            [this.#workspaceDatabaseId, now, existing.claim_id],
          );
          if (failed.rowCount !== 1) {
            throw persistenceError("Workflow prepared execution retirement failed closed.");
          }
        }
      } else if (active.rowCount > 1) {
        throw persistenceError("Multiple active Workflow claims detected.");
      }
      const matchingIdentity = await client.query<{
        request_fingerprint: string;
        status: ClaimRow["execution_status"];
      }>(
        `/* workflow-runtime:read-existing-execution-identity */
         select request_fingerprint, status
         from workflow_runtime_executions
         where workspace_id = $1 and run_id = $2 and step_id = $3
           and attempt_number = $4 and expected_revision = $5 and execution_id = $6
         for update`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, input.stepId,
          input.attemptNumber, input.expectedRevision, input.executionId,
        ],
      );
      if (matchingIdentity.rowCount > 1) {
        throw persistenceError("Multiple immutable Workflow execution identities detected.");
      }
      if (matchingIdentity.rowCount === 1) {
        const existing = matchingIdentity.rows[0];
        if (existing.request_fingerprint !== input.requestFingerprint) {
          return { status: "conflict" as const, claimId: null };
        }
        if (existing.status === "completed" || existing.status === "failed") {
          return { status: "idempotent" as const, claimId: null };
        }
        return { status: "recovery_required" as const, claimId: null };
      }
      const unresolved = await client.query(
        `/* workflow-runtime:read-unresolved-execution */
         select 1 from workflow_runtime_executions
         where workspace_id = $1 and run_id = $2 and step_id = $3
           and attempt_number = $4 and expected_revision = $5
           and status in ('prepared', 'running', 'outcome_unknown')`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, input.stepId,
          input.attemptNumber, input.expectedRevision,
        ],
      );
      if (unresolved.rowCount > 0) return { status: "recovery_required" as const, claimId: null };
      const expiresAt = new Date(now.getTime() + this.#leaseDurationMs);
      const claim = await client.query<{ claim_id: string }>(
        `/* workflow-runtime:insert-claim */
         insert into workflow_runtime_claims (
           workspace_id, run_id, step_id, attempt_number, expected_revision,
           execution_id, status, acquired_at, lease_expires_at
         ) values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
         returning id::text as claim_id`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, input.stepId,
          input.attemptNumber, input.expectedRevision, input.executionId, now, expiresAt,
        ],
      );
      if (claim.rowCount !== 1 || typeof claim.rows[0]?.claim_id !== "string") {
        throw persistenceError("Workflow claim creation failed closed.");
      }
      const execution = await client.query(
        `/* workflow-runtime:insert-execution */
         insert into workflow_runtime_executions (
           workspace_id, run_id, claim_id, step_id, attempt_number,
           expected_revision, execution_id, request_fingerprint, status, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'prepared', $9)`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, claim.rows[0].claim_id,
          input.stepId, input.attemptNumber, input.expectedRevision,
          input.executionId, input.requestFingerprint, now,
        ],
      );
      if (execution.rowCount !== 1) throw persistenceError("Workflow execution intent creation failed closed.");
      return { status: "acquired" as const, claimId: claim.rows[0].claim_id };
    });
  }

  async startExecution(input: Readonly<{
    runId: string;
    claimId: string;
  }>): Promise<WorkflowRuntimeExecutionStartDecision> {
    if (!stableIdPattern.test(input.runId) || !uuidPattern.test(input.claimId)) {
      return { status: "conflict" };
    }
    return transaction(this.#database, async (client) => {
      const current = await client.query<ExecutionRow>(
        `/* workflow-runtime:read-execution */
         select execution.status, claim.status as claim_status, claim.lease_expires_at,
                claim.expected_revision::text as claim_expected_revision,
                execution.expected_revision::text as execution_expected_revision,
                run.revision::text as run_revision, run.runtime_pause,
                run.status as run_status
         from workflow_runtime_executions as execution
         join workflow_runtime_claims as claim
           on claim.id = execution.claim_id and claim.run_id = execution.run_id
          and claim.step_id = execution.step_id
          and claim.attempt_number = execution.attempt_number
          and claim.expected_revision = execution.expected_revision
          and claim.execution_id = execution.execution_id
         join workflow_runs as run on run.id = claim.run_id
         where execution.workspace_id = $1 and claim.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2 and claim.id = $3
         for update of run, claim, execution`,
        [this.#workspaceDatabaseId, input.runId, input.claimId],
      );
      if (current.rowCount !== 1) return { status: "conflict" as const };
      const value = current.rows[0];
      if (value.status === "running" || value.status === "outcome_unknown") {
        return { status: "recovery_required" as const };
      }
      const expiresAt = safeDate(value.lease_expires_at);
      const now = this.#trustedNow();
      const claimRevision = databaseInteger(value.claim_expected_revision);
      const executionRevision = databaseInteger(value.execution_expected_revision);
      const runRevision = databaseInteger(value.run_revision);
      if (value.status !== "prepared" || value.claim_status !== "active"
        || !expiresAt || expiresAt.getTime() <= now.getTime()
        || claimRevision === null || executionRevision !== claimRevision || runRevision !== claimRevision
        || value.runtime_pause !== null || value.run_status !== "running") {
        return { status: "conflict" as const };
      }
      const started = await client.query(
        `/* workflow-runtime:start-execution */
         update workflow_runtime_executions
         set status = 'running', started_at = $2
         where workspace_id = $1 and claim_id = $3 and status = 'prepared'`,
        [this.#workspaceDatabaseId, now, input.claimId],
      );
      if (started.rowCount !== 1) throw persistenceError("Workflow execution start failed closed.");
      return { status: "started" as const };
    });
  }

  async recordKnownExecutionOutcome(input: Readonly<{
    runId: string;
    claimId: string;
  }>): Promise<void> {
    if (!stableIdPattern.test(input.runId) || !uuidPattern.test(input.claimId)) {
      throw persistenceError("Workflow execution outcome identity is invalid.");
    }
    await transaction(this.#database, async (client) => {
      const now = this.#trustedNow();
      const recorded = await client.query(
        `/* workflow-runtime:record-known-execution */
         update workflow_runtime_executions as execution
         set status = 'failed', completed_at = $4
         from workflow_runtime_claims as claim, workflow_runs as run
         where execution.claim_id = claim.id and execution.run_id = run.id
           and execution.workspace_id = $1 and claim.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2 and claim.id = $3
           and execution.status = 'running'`,
        [this.#workspaceDatabaseId, input.runId, input.claimId, now],
      );
      if (recorded.rowCount === 1) return;
      const existing = await client.query<{ status: string }>(
        `/* workflow-runtime:read-known-execution */
         select execution.status
         from workflow_runtime_executions as execution
         join workflow_runtime_claims as claim on claim.id = execution.claim_id
         join workflow_runs as run on run.id = execution.run_id
         where execution.workspace_id = $1 and claim.workspace_id = $1
           and run.workspace_id = $1 and run.runtime_id = $2 and claim.id = $3`,
        [this.#workspaceDatabaseId, input.runId, input.claimId],
      );
      if (existing.rowCount !== 1 || !["completed", "failed"].includes(existing.rows[0].status)) {
        throw persistenceError("Workflow known execution outcome failed closed.");
      }
    });
  }

  async compareAndSwap(input: WorkflowRuntimeCompareAndSwapInput): Promise<WorkflowRuntimeCompareAndSwapDecision> {
    const state = validatedState(input.nextState, this.#workspaceId);
    const expectedState = validatedState({ ...state, pause: input.expectedPause }, this.#workspaceId);
    const expectedPause = expectedState.pause;
    if (state.snapshot.runId !== input.runId || !safeInteger(input.expectedRevision)
      || state.snapshot.revision < input.expectedRevision
      || state.snapshot.revision > input.expectedRevision + 2) {
      throw persistenceError("Workflow CAS input is invalid.");
    }
    let result: Readonly<{ committed: boolean }>;
    try {
      result = await transaction(this.#database, async (client) => {
      const run = await client.query<{
        db_run_id: string;
        revision: string | number;
        runtime_pause: unknown;
      }>(
        `/* workflow-runtime:cas-run */
         select id::text as db_run_id, revision::text as revision, runtime_pause
         from workflow_runs
         where workspace_id = $1 and runtime_id = $2 for update`,
        [this.#workspaceDatabaseId, input.runId],
      );
      if (run.rowCount !== 1 || databaseInteger(run.rows[0].revision) !== input.expectedRevision
        || canonicalData(run.rows[0].runtime_pause) !== canonicalData(expectedPause)) {
        return { committed: false as const };
      }
      let claimedStepId: string | null = null;
      if (input.claimId !== null) {
        const claim = await client.query<{ step_id: string }>(
          `/* workflow-runtime:cas-claim */
           select step_id from workflow_runtime_claims
           where workspace_id = $1 and run_id = $2 and id = $3 and status = 'active'
           for update`,
          [this.#workspaceDatabaseId, run.rows[0].db_run_id, input.claimId],
        );
        if (claim.rowCount !== 1) throw persistenceError("Workflow CAS claim is invalid.");
        claimedStepId = claim.rows[0].step_id;
      }
      const updated = await client.query(
        `/* workflow-runtime:update-run */
         update workflow_runs
         set status = $3, revision = $4, runtime_snapshot = $5, runtime_pause = $6,
             project_id = $7, workflow_id = $8, project_registry = $9,
             model_provider_registry = $10, updated_at = now()
         where workspace_id = $1 and id = $2 and revision = $11`,
        [
          this.#workspaceDatabaseId, run.rows[0].db_run_id, state.snapshot.status,
          state.snapshot.revision, state.snapshot, state.pause, state.snapshot.projectId,
          state.snapshot.workflowId, state.projectRegistry, state.modelProviderRegistry,
          input.expectedRevision,
        ],
      );
      if (updated.rowCount !== 1) return { committed: false as const };
      for (const stepState of state.snapshot.stepStates) {
        const step = state.snapshot.executionProfile.steps.find((candidate) => candidate.id === stepState.stepId);
        if (!step) throw persistenceError("Workflow CAS step projection is invalid.");
        const projected = await client.query(
          `/* workflow-runtime:update-step */
           update workflow_step_runs
           set status = $3, attempt_count = $4, agent_id = $5, agent_binding_id = $6,
               model_profile_id = $7, runtime_revision = $8, state_payload = $9, updated_at = now()
           where workspace_id = $1 and run_id = $2 and step_key = $10`,
          [
            this.#workspaceDatabaseId, run.rows[0].db_run_id, stepState.status,
            stepState.attemptCount, step.kind === "agent_task" ? step.agentId : null,
            step.kind === "agent_task" ? step.agentBindingId : null,
            step.kind === "agent_task" ? step.modelProfileId : null,
            state.snapshot.revision, stepState, stepState.stepId,
          ],
        );
        if (projected.rowCount !== 1) throw persistenceError("Workflow CAS step synchronization failed closed.");
      }
      await client.query(
        `/* workflow-runtime:remove-extra-steps */
         delete from workflow_step_runs
         where workspace_id = $1 and run_id = $2 and runtime_revision is not null
           and not (step_key = any($3::text[]))`,
        [
          this.#workspaceDatabaseId,
          run.rows[0].db_run_id,
          state.snapshot.stepStates.map((step) => step.stepId),
        ],
      );
      if (claimedStepId !== null && input.claimId !== null) {
        const execution = await client.query(
          `/* workflow-runtime:finish-execution */
           update workflow_runtime_executions
           set status = $4, completed_at = $5
           where workspace_id = $1 and run_id = $2 and claim_id = $3
             and status in ('prepared', 'running')`,
          [
            this.#workspaceDatabaseId,
            run.rows[0].db_run_id,
            input.claimId,
            terminalExecutionStatus(state, claimedStepId),
            this.#trustedNow(),
          ],
        );
        if (execution.rowCount !== 1) throw persistenceError("Workflow execution completion failed closed.");
      }
        return { committed: true as const };
      });
    } catch (error) {
      if (!(error instanceof WorkflowRuntimeCommitAmbiguousError)) throw error;
      let current: WorkflowRuntimeState | null;
      try {
        current = await this.load({ runId: input.runId }) as WorkflowRuntimeState | null;
      } catch {
        return { status: "recovery_required", state: null };
      }
      if (!current) return { status: "recovery_required", state: null };
      if (sameRuntimeState(current, state)) return { status: "committed", state: current };
      if (current.snapshot.revision > input.expectedRevision) {
        return { status: "conflict", state: current };
      }
      if (current.snapshot.revision === input.expectedRevision) {
        throw persistenceError("Workflow CAS commit was not observed.");
      }
      return { status: "recovery_required", state: null };
    }
    if (!result.committed) {
      let current: WorkflowRuntimeState | null = null;
      try {
        current = await this.load({ runId: input.runId }) as WorkflowRuntimeState | null;
      } catch {
        current = null;
      }
      return { status: "conflict", state: current };
    }
    return { status: "committed", state };
  }

  async releaseClaim(input: Readonly<{ runId: string; claimId: string }>): Promise<void> {
    await transaction(this.#database, async (client) => {
      const claim = await client.query<{ status: string }>(
        `/* workflow-runtime:release-read */
         select claim.status
         from workflow_runtime_claims as claim
         join workflow_runs as run on run.id = claim.run_id
         where claim.workspace_id = $1 and run.workspace_id = $1
           and run.runtime_id = $2 and claim.id = $3
         for update of claim`,
        [this.#workspaceDatabaseId, input.runId, input.claimId],
      );
      if (claim.rowCount !== 1) throw persistenceError("Workflow claim release target is invalid.");
      if (claim.rows[0].status !== "active") return;
      const now = this.#trustedNow();
      await client.query(
        `/* workflow-runtime:release-execution */
         update workflow_runtime_executions
         set status = case when status = 'prepared' then 'failed' else 'outcome_unknown' end,
             completed_at = $2
         where workspace_id = $1 and claim_id = $3 and status in ('prepared', 'running')`,
        [this.#workspaceDatabaseId, now, input.claimId],
      );
      const released = await client.query(
        `/* workflow-runtime:release-claim */
         update workflow_runtime_claims
         set status = 'released', released_at = $2
         where workspace_id = $1 and id = $3 and status = 'active'`,
        [this.#workspaceDatabaseId, now, input.claimId],
      );
      if (released.rowCount !== 1) throw persistenceError("Workflow claim release failed closed.");
    });
  }
}
