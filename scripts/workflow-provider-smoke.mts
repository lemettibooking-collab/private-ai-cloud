// M2 local provider smoke runner (no HTTP, no UI, no remote exposure). ONE generation attempt.
//
//   Rehearsal, no network, no credential, no spend (built-in fake OpenAI SDK client):
//   npm run workflow:provider-smoke -- --simulate <model and Owner flags>
//
//   M2.2 — the single Owner-approved paid call (real OpenAI SDK; needs OPENAI_API_KEY):
//   npm run workflow:provider-smoke -- --execute-one-real-provider-call --acknowledge-paid-provider-call \
//     <model and Owner flags>
//
//   Model and Owner flags (all required):
//     --workspace <domain> --owner <ownerId> --approve-data-egress
//     --provider-model-id <alias> --provider-request-model-id <pinned request model>
//     --provider-model-version <exact model string the provider returns in responses>
//     --input-price-usd-micros-per-million <n> --output-price-usd-micros-per-million <n>
//     --prices-verified-on <YYYY-MM-DD>   (date the Owner checked the prices against the provider)
//
// Environment: DATABASE_URL (loopback PostgreSQL only; never printed) and, for the real call only,
// OPENAI_API_KEY (read here and nowhere else; never printed). --simulate never reads OPENAI_API_KEY.
// Output is sanitized JSON. Exit codes: 0 completed, 2 refused before any provider call,
// 3 attempt made but not completed — STOP (never retry automatically), 1 unexpected failure.
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";

const composition = (await import(
  new URL("../lib/composition/real-provider-runtime.ts", import.meta.url).href
)) as typeof import("../lib/composition/real-provider-runtime");
const smoke = (await import(
  new URL("../lib/composition/real-provider-smoke.ts", import.meta.url).href
)) as typeof import("../lib/composition/real-provider-smoke");

// One trusted timing decision for the smoke (claim lease 5 min, provider timeout 20 s).
const timing = Object.freeze({ providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 });
const stopRule = "One generation attempt only. On anything but completed: STOP. Do not issue a second paid call; "
  + "inspect with `npm run workflow:recovery -- inspect` and wait for an Owner decision.";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function refuse(message: string, reasons: readonly string[] = []): never {
  print({ status: "refused", message, reasons });
  process.exit(2);
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      "simulate": { type: "boolean" },
      "execute-one-real-provider-call": { type: "boolean" },
      "acknowledge-paid-provider-call": { type: "boolean" },
      "approve-data-egress": { type: "boolean" },
      "workspace": { type: "string" },
      "owner": { type: "string" },
      "provider-model-id": { type: "string" },
      "provider-request-model-id": { type: "string" },
      "provider-model-version": { type: "string" },
      "input-price-usd-micros-per-million": { type: "string" },
      "output-price-usd-micros-per-million": { type: "string" },
      "prices-verified-on": { type: "string" },
    },
  });
} catch {
  refuse("Invalid arguments. See the usage header of scripts/workflow-provider-smoke.mts.");
}
const values = parsed.values;
const text = (name: string): string => {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 128) refuse(`--${name} is required.`);
  return value;
};
const price = (name: string): number => {
  const raw = text(name);
  if (!/^[0-9]{1,12}$/u.test(raw)) refuse(`--${name} must be a non-negative integer.`);
  return Number(raw);
};

const simulate = values["simulate"] === true;
const real = values["execute-one-real-provider-call"] === true;
if (simulate === real) refuse("Choose exactly one of --simulate or --execute-one-real-provider-call.");
if (real && values["acknowledge-paid-provider-call"] !== true) {
  refuse("A real provider call spends money: --acknowledge-paid-provider-call is required.");
}
if (values["approve-data-egress"] !== true) {
  refuse("The smoke prompt leaves this machine: --approve-data-egress is required (Owner data-egress approval).");
}
const verifiedOn = text("prices-verified-on");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(verifiedOn) || Number.isNaN(Date.parse(verifiedOn))
  || Date.parse(verifiedOn) > Date.now()) {
  refuse("--prices-verified-on must be the past or present date on which the Owner verified the prices.");
}
const workspaceId = text("workspace");
const ownerId = text("owner");
const model = {
  identity: {
    providerId: "provider-openai",
    providerKind: "openai" as const,
    deploymentId: "deployment-openai-smoke",
    providerModelId: text("provider-model-id"),
    providerRequestModelId: text("provider-request-model-id"),
    providerModelVersion: text("provider-model-version"),
  },
  maxInputTokens: smoke.realProviderSmokeLimits.maxInputTokens,
  maxOutputTokens: smoke.realProviderSmokeLimits.maxOutputTokens,
  inputCostUsdMicrosPerMillionTokens: price("input-price-usd-micros-per-million"),
  outputCostUsdMicrosPerMillionTokens: price("output-price-usd-micros-per-million"),
};

const connectionString = process.env.DATABASE_URL;
if (typeof connectionString !== "string" || connectionString.length === 0) refuse("DATABASE_URL is required.");
let apiKey = "simulation-placeholder-not-a-credential";
if (real) {
  const key = process.env.OPENAI_API_KEY;
  if (typeof key !== "string" || key.length === 0) refuse("OPENAI_API_KEY is required for the real call.");
  apiKey = key;
}

// --simulate: a deterministic in-memory SDK client below the real adapter. Nothing can reach the
// network; any path other than one token count and one generation throws.
function simulatedClient() {
  let generations = 0;
  return {
    responses: {
      async create(input: { model: string; max_output_tokens: number }) {
        generations += 1;
        if (generations > 1) throw new Error("simulation: a second generation is never expected");
        return {
          model: model.identity.providerModelVersion,
          status: "completed",
          error: null,
          incomplete_details: null,
          output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK" }] }],
          usage: { input_tokens: 21, output_tokens: Math.min(1, input.max_output_tokens), total_tokens: 22 },
        };
      },
      inputTokens: { async count() { return { object: "response.input_tokens", input_tokens: 21 }; } },
    },
    models: { async retrieve() { throw new Error("simulation: model lookup is not expected"); } },
  };
}

const runId = `m2-smoke-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
let exitCode = 1;
let runtime: import("../lib/composition/real-provider-runtime").RealProviderRuntime | null = null;
try {
  const decision = await composition.composeRealProviderRuntime({
    database: { connectionString, maxConnections: 2 },
    domainWorkspaceId: workspaceId,
    timing,
    openAI: model,
    credentials: { apiKey },
    authorizer: smoke.realProviderSmokeAuthorizer(ownerId),
    requirementsResolver: smoke.realProviderSmokeRequirementsResolver,
    evidenceResolver: smoke.realProviderSmokeEgressApproval({ ownerId, runId, expectedIdentity: model.identity }),
    runtimeContext: { now: () => new Date().toISOString() },
    ...(simulate ? { dependencies: { createOpenAIClient: simulatedClient } } : {}),
  });
  apiKey = "";
  if (decision.verdict !== "allow") {
    refuse("Composition failed closed before any provider call.", decision.reasons.map((reason) => reason.code));
  }
  runtime = decision.runtime;
  const outcome = await smoke.runRealProviderSmokeAttempt(runtime, {
    workspaceId, runId, ownerId, model, now: new Date().toISOString(),
  });
  print({
    mode: simulate ? "simulate" : "real",
    runId,
    pricesVerifiedOn: verifiedOn,
    limits: {
      maxOutputTokens: smoke.realProviderSmokeLimits.maxOutputTokens,
      maxCostUsdMicros: smoke.realProviderSmokeLimits.maxCostUsdMicros,
      timing,
    },
    status: outcome.status,
    responseStatus: outcome.responseStatus,
    responseReasons: outcome.responseReasons,
    evidence: outcome.evidence,
    ...(outcome.status === "completed" ? {} : { stopRule }),
  });
  exitCode = outcome.status === "completed" ? 0 : 3;
} catch {
  print({ status: "error", message: "Provider smoke failed closed.", stopRule });
  exitCode = 1;
} finally {
  await runtime?.close().catch(() => {});
}
process.exit(exitCode);
