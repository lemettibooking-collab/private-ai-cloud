import { randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";
import type { CreateTaskResult } from "../tasks/owner-task-mutations";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createOwnerTaskMutations } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { projectScopedHref } from "../projects/project-context.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isProjectKey } from "../projects/project-registry.ts";

// AI-038.4b Quick Create binding (server-side; the ONLY importer of lib/tasks/owner-task-mutations).
//
//   "use server" action (app/tasks/new/actions.ts)
//     → ./owner-task-create.server (real Auth.js auth(), per-request PostgreSQL pool, trusted workspace)
//     → createOwnerQuickCreate().submit(FormData)      ← untrusted form → exact plain createTask input
//     → createGitHubOwnerTaskCreate().createTask        ← GitHub session identity → AI-038.4a contract
//     → owner-task-mutations createTask (one transaction, Owner + project locks, audit, idempotency)
//
// Only createTask is exposed: attachRun is NOT bound here. The browser never supplies the workspace,
// user, actor, role, task id or status; the form idempotency key is untrusted input that the mutation
// contract validates. Outcomes are public statuses or a redirect to the factual Task Detail; no SQL,
// UUID, key, fingerprint or raw error leaves. Nothing here starts a run, model, executor or GitHub action.

export type OwnerTaskCreate = Readonly<{ createTask(input: unknown): Promise<CreateTaskResult> }>;

export type QuickCreateOutcome =
  | Readonly<{ status: "redirect"; href: string }>
  | Readonly<{ status: "invalid_input" | "conflict" | "unavailable" | "unauthenticated" }>;

export type OwnerQuickCreateDependencies = Readonly<{
  // Trusted server configuration only (APP_DEMO_WORKSPACE_SLUG). Never request data.
  workspaceSlug: unknown;
  // Opens ONE request-scoped authenticated task-create binding for the trusted workspace, runs
  // `create`, and releases its resources before returning.
  withTaskCreate<T>(domainWorkspaceId: string, create: (binding: OwnerTaskCreate) => Promise<T>): Promise<T>;
}>;

// The form field names (the hidden idempotency key included). Nothing else is accepted.
export const quickCreateFormFields = Object.freeze(["idempotencyKey", "projectId", "title", "goal", "type", "priority", "riskLevel"] as const);

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const outcome = (status: "invalid_input" | "conflict" | "unavailable" | "unauthenticated"): QuickCreateOutcome => Object.freeze({ status });

function ownData(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || isProxy(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

// Request-scoped composition: GitHub session identity → AI-038.4a mutation contract, createTask ONLY.
// Throws on an invalid configuration (callers map any throw to "unavailable").
export function createGitHubOwnerTaskCreate(input: unknown): OwnerTaskCreate {
  if (typeof window !== "undefined") throw new Error("Owner task create is server-only.");
  const database = ownData(input, "database");
  const domainWorkspaceId = ownData(input, "domainWorkspaceId");
  const sessionResolver = ownData(input, "sessionResolver");
  if (typeof input !== "object" || input === null || isProxy(input) || Reflect.ownKeys(input).length !== 3
    || database === undefined || sessionResolver === undefined || typeof domainWorkspaceId !== "string") {
    throw new Error("Owner task create configuration is invalid.");
  }
  const identitySource = createGitHubSessionIdentitySource({ sessionResolver, database });
  const mutations = createOwnerTaskMutations({ database, domainWorkspaceId, identitySource });
  const createTask = mutations.createTask;
  return Object.freeze({ createTask: (task: unknown) => createTask(task) });
}

// A fresh opaque key for ONE rendered Quick Create form. It is embedded as a hidden field, so every
// retry / double submit of that form carries the same key; a new form render gets a new key.
// 128 bits of CSPRNG entropy; never a counter, title, project, timestamp or task id.
export function newQuickCreateFormKey(): string {
  return `qc-${randomBytes(16).toString("hex")}`;
}

// Untrusted FormData → the exact plain createTask input, or null. Each field must appear exactly once
// as a string; any other field (other than React's own `$ACTION_*` transport fields) is refused, so a
// browser cannot smuggle taskId / workspaceId / status / actor. Optional fields: "" → null.
export function quickCreateInputFromForm(form: unknown): Readonly<Record<(typeof quickCreateFormFields)[number], string | null>> | null {
  try {
    if (typeof FormData === "undefined" || !(form instanceof FormData) || isProxy(form)) return null;
    for (const key of new Set(form.keys())) {
      if (!key.startsWith("$ACTION_") && !(quickCreateFormFields as readonly string[]).includes(key)) return null;
    }
    const value = (name: string): string | null => {
      const values = form.getAll(name);
      return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
    };
    const [idempotencyKey, projectId, title, goal, type, priority, riskLevel] = quickCreateFormFields.map(value);
    if (idempotencyKey === null || projectId === null || title === null || goal === null || type === null || priority === null || riskLevel === null) return null;
    const trimmedGoal = goal.trim();
    return Object.freeze({
      idempotencyKey,
      projectId,
      title: title.trim(),
      goal: trimmedGoal === "" ? null : trimmedGoal,
      type,
      priority: priority === "" ? null : priority,
      riskLevel: riskLevel === "" ? null : riskLevel,
    });
  } catch {
    return null;
  }
}

// Public mutation result → UI outcome. created / replayed go to the factual Task Detail (read again
// through the existing read path); the href is built only from validated ids and the trusted helper.
export function quickCreateOutcome(result: unknown): QuickCreateOutcome {
  const status = ownData(result, "status");
  if (status === "created" || status === "replayed") {
    const task = ownData(result, "task");
    const taskId = ownData(task, "taskId");
    const projectId = ownData(task, "projectId");
    if (!isTaskKey(taskId) || !isProjectKey(projectId)) return outcome("unavailable");
    const scoped = projectScopedHref("/tasks", projectId) as string;
    return Object.freeze({ status: "redirect" as const, href: `/tasks/${encodeURIComponent(taskId)}${scoped.slice("/tasks".length)}` });
  }
  if (status === "invalid_input" || status === "conflict" || status === "unauthenticated") return outcome(status);
  return outcome("unavailable");
}

export function createOwnerQuickCreate(dependencies: OwnerQuickCreateDependencies) {
  const workspaceSlug = typeof dependencies.workspaceSlug === "string" && slugPattern.test(dependencies.workspaceSlug)
    ? dependencies.workspaceSlug : null;
  const withTaskCreate = dependencies.withTaskCreate;
  return Object.freeze({
    async submit(form: unknown): Promise<QuickCreateOutcome> {
      const input = quickCreateInputFromForm(form);
      if (!input) return outcome("invalid_input");
      if (!workspaceSlug) return outcome("unavailable");
      try {
        return quickCreateOutcome(await withTaskCreate(workspaceSlug, (binding) => binding.createTask(input)));
      } catch {
        return outcome("unavailable");
      }
    },
  });
}
