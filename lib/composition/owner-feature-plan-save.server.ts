// AI-039: application-facing entry for the Plan Builder (server-only).
//
//   "use server" action → submitOwnerFeaturePlan(FormData) → per-request PostgreSQL pool
//     → createGitHubOwnerFeaturePlanSave (real Auth.js auth() of THIS request) → AI-039 saveDraftRevision
//
// The workspace is the trusted server configuration APP_DEMO_WORKSPACE_SLUG, never request data.
// Only draft revision saving is exposed. Every call re-authenticates and re-authorizes.
import "server-only";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createGitHubOwnerFeaturePlanSave, createOwnerFeaturePlanSave, newFeaturePlanFormKey } from "./owner-feature-plan-save";

export type { FeaturePlanSaveOutcome } from "./owner-feature-plan-save";

const planSave = createOwnerFeaturePlanSave({
  workspaceSlug: process.env.APP_DEMO_WORKSPACE_SLUG,
  async withPlanSave(domainWorkspaceId, save) {
    const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    try {
      return await save(createGitHubOwnerFeaturePlanSave({ database, domainWorkspaceId, sessionResolver: { resolve: () => auth() } }));
    } finally {
      await database.close().catch(() => undefined);
    }
  },
});

export async function submitOwnerFeaturePlan(form: FormData) {
  return planSave.submit(form);
}

// One opaque idempotency key per rendered Plan Builder form (see newFeaturePlanFormKey).
export function issueFeaturePlanFormKey(): string {
  return newFeaturePlanFormKey();
}
