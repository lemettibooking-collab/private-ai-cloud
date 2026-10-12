import { randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";
import type { SaveFeaturePlanResult } from "../development/feature-plan-mutations";
import type { PublicPlanError } from "../development/feature-plan-revision";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { featurePlanInputFromForm } from "../development/feature-plan-form.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { developmentHref } from "../development/feature-plan-model.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createOwnerFeaturePlanMutations } from "../development/feature-plan-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { maxPublicPlanErrors } from "../development/feature-plan-revision.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isProjectKey } from "../projects/project-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";

// AI-039 Plan Builder binding (server-side; the ONLY importer of lib/development/feature-plan-mutations).
//
//   "use server" action (app/tasks/[taskId]/development/actions.ts)
//     → ./owner-feature-plan-save.server (real Auth.js auth(), per-request PostgreSQL pool, trusted workspace)
//     → createOwnerFeaturePlanSave().submit(FormData)   ← untrusted form → bounded plain save input
//     → createGitHubOwnerFeaturePlanSave()               ← GitHub session identity → AI-039 contract
//     → feature-plan-mutations saveDraftRevision (one transaction, Owner / task / project locks, audit)
//
// The browser never supplies the workspace, user, project, plan id, status or revision; the task id is
// an untrusted lookup key and the form idempotency key is untrusted input, both validated by the
// contract. Outcomes are public statuses, bounded public plan errors or a redirect to the factual
// Development Workflow page; no SQL, UUID, key, fingerprint or raw error leaves. Nothing here starts a
// run, model, executor, GitHub or repository action.

export type OwnerFeaturePlanSave = Readonly<{ saveDraftRevision(input: unknown): Promise<SaveFeaturePlanResult> }>;

export type FeaturePlanSaveOutcome =
  | Readonly<{ status: "redirect"; href: string }>
  | Readonly<{ status: "invalid_plan"; errors: readonly PublicPlanError[] }>
  | Readonly<{ status: "invalid_input" | "not_plannable" | "conflict" | "unavailable" | "unauthenticated" }>;

export type OwnerFeaturePlanSaveDependencies = Readonly<{
  // Trusted server configuration only (APP_DEMO_WORKSPACE_SLUG). Never request data.
  workspaceSlug: unknown;
  withPlanSave<T>(domainWorkspaceId: string, save: (binding: OwnerFeaturePlanSave) => Promise<T>): Promise<T>;
}>;

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const errorFields = new Set(["planTitle", "planGoal", "tasks", "title", "goal", "scope", "nonGoals", "allowedPaths", "acceptanceCriteria",
  "verificationCommands", "dependencyIds", "riskLevel", "priority", "requiresOwnerApproval", "id", "sequence", "plan"]);
const errorCodes = new Set(["invalid_type", "invalid_input", "required", "invalid_id", "invalid_sequence", "invalid_status", "invalid_priority",
  "invalid_risk_level", "too_long", "too_many_items", "duplicate_task_id", "duplicate_sequence", "missing_dependency", "self_dependency", "dependency_cycle"]);
const outcome = (status: "invalid_input" | "not_plannable" | "conflict" | "unavailable" | "unauthenticated"): FeaturePlanSaveOutcome => Object.freeze({ status });

function ownData(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || isProxy(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

// Request-scoped composition: GitHub session identity → AI-039 contract, saveDraftRevision ONLY.
export function createGitHubOwnerFeaturePlanSave(input: unknown): OwnerFeaturePlanSave {
  if (typeof window !== "undefined") throw new Error("Owner FeaturePlan save is server-only.");
  const database = ownData(input, "database");
  const domainWorkspaceId = ownData(input, "domainWorkspaceId");
  const sessionResolver = ownData(input, "sessionResolver");
  if (typeof input !== "object" || input === null || isProxy(input) || Reflect.ownKeys(input).length !== 3
    || database === undefined || sessionResolver === undefined || typeof domainWorkspaceId !== "string") {
    throw new Error("Owner FeaturePlan save configuration is invalid.");
  }
  const identitySource = createGitHubSessionIdentitySource({ sessionResolver, database });
  const mutations = createOwnerFeaturePlanMutations({ database, domainWorkspaceId, identitySource });
  const saveDraftRevision = mutations.saveDraftRevision;
  return Object.freeze({ saveDraftRevision: (plan: unknown) => saveDraftRevision(plan) });
}

// A fresh opaque key for ONE rendered Plan Builder form (hidden field): every retry / double submit of
// that form carries the same key. 128 bits of CSPRNG entropy; never a counter, task, plan or time.
export function newFeaturePlanFormKey(): string {
  return `fp-${randomBytes(16).toString("hex")}`;
}

// Public mutation result → UI outcome. created / replayed redirect to the Development Workflow page,
// which reads the persisted revision again (no optimistic result). Plan errors pass through only as
// known codes / fields / step positions.
export function featurePlanSaveOutcome(result: unknown): FeaturePlanSaveOutcome {
  const status = ownData(result, "status");
  if (status === "created" || status === "replayed") {
    const revision = ownData(result, "revision");
    const taskId = ownData(revision, "taskId");
    const projectId = ownData(revision, "projectId");
    if (!isTaskKey(taskId) || !isProjectKey(projectId)) return outcome("unavailable");
    return Object.freeze({ status: "redirect" as const, href: developmentHref(taskId, projectId) });
  }
  if (status === "invalid_plan") {
    const raw = ownData(result, "errors");
    if (!Array.isArray(raw)) return outcome("invalid_input");
    const errors: PublicPlanError[] = [];
    for (const item of raw.slice(0, maxPublicPlanErrors)) {
      const code = ownData(item, "code");
      const field = ownData(item, "field");
      const step = ownData(item, "step");
      if (typeof code !== "string" || !errorCodes.has(code) || typeof field !== "string" || !errorFields.has(field)
        || !(step === null || (Number.isSafeInteger(step) && (step as number) >= 0 && (step as number) < 256))) continue;
      errors.push(Object.freeze({ code, field, step } as PublicPlanError));
    }
    return Object.freeze({ status: "invalid_plan" as const, errors: Object.freeze(errors) });
  }
  if (status === "invalid_input" || status === "not_plannable" || status === "conflict" || status === "unauthenticated") return outcome(status);
  return outcome("unavailable");
}

export function createOwnerFeaturePlanSave(dependencies: OwnerFeaturePlanSaveDependencies) {
  const workspaceSlug = typeof dependencies.workspaceSlug === "string" && slugPattern.test(dependencies.workspaceSlug)
    ? dependencies.workspaceSlug : null;
  const withPlanSave = dependencies.withPlanSave;
  return Object.freeze({
    async submit(form: unknown): Promise<FeaturePlanSaveOutcome> {
      const input = featurePlanInputFromForm(form);
      if (!input) return outcome("invalid_input");
      if (!workspaceSlug) return outcome("unavailable");
      try {
        return featurePlanSaveOutcome(await withPlanSave(workspaceSlug, (binding) => binding.saveDraftRevision(input)));
      } catch {
        return outcome("unavailable");
      }
    },
  });
}
