// AI-039 P-1 / AI-039.1: application-facing entry for AI-assisted planning (server-only).
//
//   "use server" action → submitOwnerFeaturePlanDraft(FormData)
//     → loadOwnerTaskDevelopment (real Auth.js auth() of THIS request, trusted workspace)
//     → draftFeaturePlanCandidate with the run-backed planning port (./owner-feature-plan-planning):
//         planning request (Owner identity of THIS request) → ONE real planning Workflow Run through
//         the composed real-provider runtime (./real-provider-runtime) → durable step result
//
// Production binding ONLY when the trusted configuration is complete and valid: the
// `feature_plan_planning` policy (PAC_PLANNER_*, ./feature-plan-planner-config.ts), the
// provider credential and the trusted workspace. Otherwise `planner: null` → `planner_unavailable`.
// The credential is read here and nowhere else in the planning path, handed only to the provider
// factory inside composeRealProviderRuntime, and never stored, logged, audited or sent to the client.
// The real-provider composition accepts loopback PostgreSQL only (AI-037.5 pending); any other
// DATABASE_URL makes the runtime uncomposable and the request settles as `planning_failed` before
// any provider call.
import "server-only";
import { auth } from "../auth/next-auth.server";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createFeaturePlanPlanningRequests, newPlanningFormKey } from "../development/feature-plan-planning-requests";
import { parseFeaturePlanPlannerPolicy } from "./feature-plan-planner-config";
import { loadOwnerTaskDevelopment } from "./owner-console-read.server";
import { createOwnerFeaturePlanDraft } from "./owner-feature-plan-draft";
import { createRunBackedPlanningModel } from "./owner-feature-plan-planning";
import { composeRealProviderRuntime } from "./real-provider-runtime";

export type { FeaturePlanDraftOutcome } from "./owner-feature-plan-draft";

// One trusted timing decision for planning: provider timeout 120 s inside a 5 min claim lease.
const planningTiming = Object.freeze({ providerTimeoutMs: 120_000, claimLeaseDurationMs: 300_000 });
const workspacePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function plannerBinding() {
  const policy = parseFeaturePlanPlannerPolicy(process.env);
  const apiKey = process.env.OPENAI_API_KEY;
  const domainWorkspaceId = process.env.APP_DEMO_WORKSPACE_SLUG;
  if (!policy || typeof apiKey !== "string" || apiKey.length === 0
    || typeof domainWorkspaceId !== "string" || !workspacePattern.test(domainWorkspaceId)) return null;
  return { policy, apiKey, domainWorkspaceId };
}

function planningModel() {
  const binding = plannerBinding();
  if (!binding) return null;
  // Built per submission: the binding (and the credential in it) lives for ONE request only.
  const { policy, domainWorkspaceId, apiKey } = binding;
  return createRunBackedPlanningModel({
    policy,
    domainWorkspaceId,
    async withRequests(work) {
      const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
      try {
        const identitySource = createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => auth() }, database });
        return await work(createFeaturePlanPlanningRequests({ database, domainWorkspaceId, identitySource }));
      } finally {
        await database.close().catch(() => undefined);
      }
    },
    async composeRuntime(parts) {
      const composed = await composeRealProviderRuntime({
        database: { connectionString: process.env.DATABASE_URL, maxConnections: 2 },
        domainWorkspaceId,
        timing: planningTiming,
        openAI: {
          identity: policy.identity,
          maxInputTokens: policy.maxInputTokens,
          maxOutputTokens: policy.maxOutputTokens,
          inputCostUsdMicrosPerMillionTokens: policy.inputCostUsdMicrosPerMillionTokens,
          outputCostUsdMicrosPerMillionTokens: policy.outputCostUsdMicrosPerMillionTokens,
        },
        credentials: { apiKey },
        ...parts,
      });
      return composed.verdict === "allow" ? composed.runtime : null;
    },
    now: () => new Date().toISOString(),
  });
}

export async function submitOwnerFeaturePlanDraft(form: FormData) {
  return createOwnerFeaturePlanDraft({
    loadDevelopment: (taskId) => loadOwnerTaskDevelopment(taskId, undefined),
    planner: planningModel(),
  }).submit(form);
}

// Whether AI-assisted planning is bound right now, and the non-secret model identity the Owner
// approves the data egress to (presentation only; every submission re-checks the configuration).
export function featurePlanPlannerStatus(): Readonly<{ available: false } | { available: true; provider: string; model: string }> {
  const binding = plannerBinding();
  return binding
    ? Object.freeze({ available: true as const, provider: binding.policy.identity.providerKind, model: binding.policy.identity.providerModelId })
    : Object.freeze({ available: false as const });
}

// One opaque planning idempotency key per rendered Planning Interview form / per action result.
export function issuePlanningFormKey(): string {
  return newPlanningFormKey();
}
