// M2.0 Real Provider composition root (server-only, local). Assembles the EXISTING components into
// one object graph; it owns no business rule of its own:
//
//   ProviderClaimLeaseTiming (one trusted decision, composeProviderWithinClaimLease)
//     ├── OpenAI provider   (createOpenAIModelProvider, timeoutMs = timing.providerTimeoutMs)
//     └── PostgreSQL store  (createPostgresWorkflowRuntimePersistence, providerExecutionTiming = timing)
//   one RuntimeOperationalSignalCollector
//     ├── PostgreSQL adapter, ├── persistence/store, └── WorkflowRuntimeService
//
// Order is fail-closed and side-effect free until everything static is valid: timing, provider
// config and credentials are validated (and the provider built) before any database pool exists.
// The API key enters only here, through `credentials`, and is handed to the provider factory; it is
// never stored on the returned object, never part of a reason, and never read from the environment.
// Until AI-037.5 (TLS / config allowlist) lands, only a loopback PostgreSQL is accepted.
import type { OpenAIModelProviderClient, OpenAIModelProviderClientOptions } from "../providers/openai-model-provider";
import type { ModelProvider, ModelProviderIdentity } from "../contracts/model-provider-adapter";
import type { ModelInvocationDataHandlingEvidenceResolver } from "../contracts/model-invocation-execution";
import type { ProviderClaimLeaseTiming } from "../contracts/provider-claim-lease-policy";
import type { RuntimeOperationalSignalSnapshot } from "../contracts/runtime-operational-signals";
import type {
  AgentStepCapabilityRequirementsResolver,
  AgentStepRuntimeContext,
} from "../workflows/agent-step-runtime";
import type {
  WorkflowRuntimeCommandAuthorizer,
  WorkflowRuntimeService,
} from "../workflows/workflow-runtime-service";
import type { PostgresWorkflowRuntimeStateStore } from "../db/workflow-runtime-store";
import type { PostgresWorkflowRuntimeReadModel } from "../db/workflow-runtime-read-model";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { composeProviderWithinClaimLease } from "../contracts/provider-claim-lease-policy.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createRuntimeOperationalSignalCollector } from "../contracts/runtime-operational-signals.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createOpenAIModelProvider } from "../providers/openai-model-provider.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimePersistence } from "../db/workflow-runtime-persistence.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { postgresWorkflowRuntimeStoreLimits } from "../db/workflow-runtime-store.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createWorkflowRuntimeService } from "../workflows/workflow-runtime-service.ts";

export type RealProviderRuntimeReasonCode =
  | "invalid_input"
  | "database_not_loopback"
  | "unsafe_provider_timing"
  | "provider_config_rejected"
  | "credentials_rejected"
  | "database_unavailable"
  | "persistence_unavailable";

export type RealProviderRuntimeReason = Readonly<{ code: RealProviderRuntimeReasonCode; path: string }>;

export type RealProviderRuntimeInput = Readonly<{
  database: Readonly<{ connectionString: string; maxConnections?: number }>;
  domainWorkspaceId: string;
  // The only timing input: provider timeout and claim lease are one composition decision.
  timing: Readonly<{ providerTimeoutMs: number; claimLeaseDurationMs: number }>;
  // OpenAI adapter config WITHOUT timeoutMs (derived from the trusted timing above).
  openAI: Readonly<{
    identity: ModelProviderIdentity;
    maxInputTokens: number;
    maxOutputTokens: number;
    inputCostUsdMicrosPerMillionTokens: number;
    outputCostUsdMicrosPerMillionTokens: number;
  }>;
  credentials: Readonly<{ apiKey: string }>;
  authorizer: WorkflowRuntimeCommandAuthorizer;
  requirementsResolver: AgentStepCapabilityRequirementsResolver;
  evidenceResolver: ModelInvocationDataHandlingEvidenceResolver;
  runtimeContext: AgentStepRuntimeContext;
  // Test / rehearsal seam: the OpenAI SDK client below the adapter. Omitted = the real SDK.
  dependencies?: Readonly<{
    createOpenAIClient?: (options: OpenAIModelProviderClientOptions) => OpenAIModelProviderClient;
    monotonicNow?: () => number;
    observedAt?: () => string;
  }>;
}>;

export type RealProviderRuntime = Readonly<{
  service: WorkflowRuntimeService;
  stateStore: PostgresWorkflowRuntimeStateStore;
  readModel: PostgresWorkflowRuntimeReadModel;
  timing: ProviderClaimLeaseTiming;
  providerIdentity: ModelProviderIdentity;
  signals(): RuntimeOperationalSignalSnapshot;
  close(): Promise<void>;
}>;

export type RealProviderRuntimeDecision =
  | Readonly<{ verdict: "allow"; reasons: readonly []; runtime: RealProviderRuntime }>
  | Readonly<{ verdict: "deny"; reasons: readonly RealProviderRuntimeReason[]; runtime: null }>;

const inputFields = [
  "database", "domainWorkspaceId", "timing", "openAI", "credentials", "authorizer",
  "requirementsResolver", "evidenceResolver", "runtimeContext",
] as const;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function deny(code: RealProviderRuntimeReasonCode, path: string): RealProviderRuntimeDecision {
  return Object.freeze({
    verdict: "deny" as const,
    reasons: Object.freeze([Object.freeze({ code, path })]),
    runtime: null,
  });
}

// Own data properties of an ordinary object only; getters, proxies and extra keys fail closed.
function ownData(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)))
      || !required.every((key) => keys.includes(key))) return null;
    const values: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function loopbackConnectionString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    // A `host` query parameter overrides the URL host in libpq-style strings; refuse it.
    if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === "host" || key.toLowerCase() === "hostaddr")) return null;
    return loopbackHosts.has(url.hostname.toLowerCase()) ? value : null;
  } catch {
    return null;
  }
}

export async function composeRealProviderRuntime(input: unknown): Promise<RealProviderRuntimeDecision> {
  const fields = ownData(input, inputFields, ["dependencies"]);
  if (!fields) return deny("invalid_input", "$");
  const database = ownData(fields.database, ["connectionString"], ["maxConnections"]);
  if (!database) return deny("invalid_input", "database");
  const connectionString = loopbackConnectionString(database.connectionString);
  if (!connectionString) return deny("database_not_loopback", "database.connectionString");
  if (typeof fields.domainWorkspaceId !== "string") return deny("invalid_input", "domainWorkspaceId");
  // Provider timeout is never configured separately from the claim lease.
  const openAI = ownData(fields.openAI, [
    "identity", "maxInputTokens", "maxOutputTokens",
    "inputCostUsdMicrosPerMillionTokens", "outputCostUsdMicrosPerMillionTokens",
  ]);
  if (!openAI) return deny("provider_config_rejected", "openAI");
  const dependencies = fields.dependencies === undefined
    ? {}
    : ownData(fields.dependencies, [], ["createOpenAIClient", "monotonicNow", "observedAt"]);
  if (!dependencies) return deny("invalid_input", "dependencies");
  for (const key of ["authorizer", "requirementsResolver", "evidenceResolver", "runtimeContext"] as const) {
    if (typeof fields[key] !== "object" || fields[key] === null) return deny("invalid_input", key);
  }

  // 1. One trusted timing decision builds the provider (and later binds the store). The claim lease
  //    must also be one the store accepts, so an unusable timing never constructs a client.
  const lease = ownData(fields.timing, ["providerTimeoutMs", "claimLeaseDurationMs"])?.claimLeaseDurationMs;
  if (typeof lease !== "number" || lease < postgresWorkflowRuntimeStoreLimits.minimumLeaseDurationMs
    || lease > postgresWorkflowRuntimeStoreLimits.maximumLeaseDurationMs) {
    return deny("unsafe_provider_timing", "timing.claimLeaseDurationMs");
  }
  let credentialsRejected = false;
  const composed = composeProviderWithinClaimLease(fields.timing, (timing: ProviderClaimLeaseTiming) => {
    const factory = createOpenAIModelProvider(
      { ...openAI, timeoutMs: timing.providerTimeoutMs },
      fields.credentials,
      {
        ...(dependencies.createOpenAIClient === undefined ? {} : { createClient: dependencies.createOpenAIClient }),
        ...(dependencies.monotonicNow === undefined ? {} : { monotonicNow: dependencies.monotonicNow }),
        ...(dependencies.observedAt === undefined ? {} : { observedAt: dependencies.observedAt }),
      } as never,
    );
    if (factory.verdict !== "allow" || !factory.provider) {
      credentialsRejected = factory.reasons.some((reason: { code: string }) => reason.code === "invalid_credentials");
      throw new Error("provider rejected");
    }
    return factory.provider as ModelProvider;
  });
  if (composed.verdict !== "allow") {
    const factoryFailed = composed.reasons.some((reason: { code: string }) => reason.code === "provider_factory_failed");
    if (!factoryFailed) return deny("unsafe_provider_timing", "timing");
    return credentialsRejected
      ? deny("credentials_rejected", "credentials")
      : deny("provider_config_rejected", "openAI");
  }
  const timing = composed.timing as ProviderClaimLeaseTiming;
  const provider = composed.provider as ModelProvider;

  // 2. One operational signal collector for every layer.
  const collector = createRuntimeOperationalSignalCollector();
  let db: ReturnType<typeof createWorkflowRuntimePostgresDatabase>;
  try {
    db = createWorkflowRuntimePostgresDatabase({
      connectionString,
      ...(database.maxConnections === undefined ? {} : { maxConnections: database.maxConnections as number }),
      signals: collector.sink,
    });
  } catch {
    return deny("database_unavailable", "database");
  }
  let persistence: Awaited<ReturnType<typeof createPostgresWorkflowRuntimePersistence>>;
  try {
    persistence = await createPostgresWorkflowRuntimePersistence({
      database: db,
      domainWorkspaceId: fields.domainWorkspaceId,
      providerExecutionTiming: timing,
      signals: collector.sink,
    });
  } catch {
    persistence = null;
  }
  if (!persistence) {
    // Unknown workspace, or the database could not be reached; the factory does not distinguish.
    await db.close().catch(() => {});
    return deny("persistence_unavailable", "domainWorkspaceId");
  }

  // 3. The existing service, with the composed provider, evidence resolver and signals.
  const service = createWorkflowRuntimeService({
    store: persistence.stateStore,
    authorizer: fields.authorizer as WorkflowRuntimeCommandAuthorizer,
    providers: [provider],
    requirementsResolver: fields.requirementsResolver as AgentStepCapabilityRequirementsResolver,
    evidenceResolver: fields.evidenceResolver as ModelInvocationDataHandlingEvidenceResolver,
    runtimeContext: fields.runtimeContext as AgentStepRuntimeContext,
    signals: collector.sink,
  });

  let closing: Promise<void> | null = null;
  const runtime: RealProviderRuntime = Object.freeze({
    service,
    stateStore: persistence.stateStore,
    readModel: persistence.readModel,
    timing,
    providerIdentity: provider.identity,
    signals: () => collector.snapshot(),
    close: () => {
      closing ??= db.close().catch(() => {});
      return closing;
    },
  });
  return Object.freeze({ verdict: "allow" as const, reasons: Object.freeze([]) as readonly [], runtime });
}
