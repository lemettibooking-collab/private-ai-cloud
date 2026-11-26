// AI-037.1.1 local Owner/operator recovery tool (no HTTP, no UI, no remote exposure).
//
//   npm run workflow:recovery -- inspect --workspace <domain> --run <runId> --step <stepId> --execution <executionId>
//   npm run workflow:recovery -- authorize-retry --workspace <domain> --run <runId> --step <stepId> \
//     --execution <executionId> --operator <operatorId> \
//     --acknowledge-lost-provider-result-and-duplicate-cost-risk
//
// Only a lost paid provider result is recoverable: a settled provider call that succeeded (HD-12)
// or failed definitively with usage or cost (AI-037.1.2), whose Step result was never committed
// (execution outcome_unknown). `authorize-retry` never calls a provider. It
// lets the next ordinary advance claim the Step again, which may pay for a new provider call.
// Every precondition, the state change and its audit event live in the store
// (PostgresWorkflowRuntimeStateStore.authorizeRetryAfterLostProviderResult), in one transaction.
//
// The database comes from DATABASE_URL, which is never printed. Output is JSON on stdout.
// Exit codes: 0 = inspected / authorized / idempotent, 2 = denied / conflict / recovery_required,
// 1 = usage or configuration error.
// The operator identity is recorded in the audit event but not authenticated: this tool is
// local-only, and transport-level Owner authentication belongs to the future Owner Control boundary.
import { parseArgs } from "node:util";

const postgres = (await import(
  new URL("../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../lib/db/postgres");
const persistenceContract = (await import(
  new URL("../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-persistence");

const acknowledgementFlag = "acknowledge-lost-provider-result-and-duplicate-cost-risk";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  print({ status: "error", message });
  process.exit(1);
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      workspace: { type: "string" },
      run: { type: "string" },
      step: { type: "string" },
      execution: { type: "string" },
      operator: { type: "string" },
      [acknowledgementFlag]: { type: "boolean" },
    },
  });
} catch {
  fail("Invalid arguments. See the usage header of scripts/workflow-runtime-recovery.mts.");
}

const command = parsed.positionals[0];
const option = (name: string): string => {
  const value = parsed.values[name];
  if (typeof value !== "string" || value.length === 0) fail(`--${name} is required.`);
  return value;
};
if (parsed.positionals.length !== 1 || (command !== "inspect" && command !== "authorize-retry")) {
  fail("Command must be `inspect` or `authorize-retry`.");
}

const target = { runId: option("run"), stepId: option("step"), executionId: option("execution") };
let database: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>;
try {
  database = postgres.createWorkflowRuntimePostgresDatabase({ maxConnections: 1 });
} catch {
  fail("PostgreSQL configuration is unavailable or invalid.");
}

let exitCode = 1;
try {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
    database,
    domainWorkspaceId: option("workspace"),
  });
  if (!persistence) {
    print({ status: "denied", reasons: ["workspace_not_found"] });
    exitCode = 2;
  } else if (command === "inspect") {
    print({ status: "inspected", ...await persistence.stateStore.inspectExecutionRecovery(target) });
    exitCode = 0;
  } else {
    // The flag's real value is passed through; the store itself denies anything but literal `true`.
    const request = {
      ...target,
      operatorId: option("operator"),
      acknowledgeLostProviderResultAndDuplicateCostRisk: parsed.values[acknowledgementFlag] === true,
    };
    const decision = await persistence.stateStore.authorizeRetryAfterLostProviderResult(
      request as unknown as Parameters<typeof persistence.stateStore.authorizeRetryAfterLostProviderResult>[0],
    );
    print(decision);
    exitCode = decision.status === "authorized" || decision.status === "idempotent" ? 0 : 2;
  }
} catch {
  print({ status: "error", message: "Workflow execution recovery failed closed." });
  exitCode = 1;
} finally {
  await database.close().catch(() => {});
}
process.exit(exitCode);
