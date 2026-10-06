// AI-039 P-1 / AI-039.1 AI-assisted FeaturePlan CANDIDATE (pure; no I/O of its own).
//
//   ProjectTask facts + Owner Planning Interview answers
//     → ONE bounded planning invocation through a PlanningModelPort (AI-039.1: a real persisted
//       planning Workflow Run through the existing runtime — ledger, budget, provider-start fence,
//       usage / cost settlement, outcome_unknown — returning the DURABLE step result text)
//     → strict JSON parse of the untrusted output text (no repair, no fence stripping)
//     → strict field-by-field parse of the untrusted model output
//     → deterministic validation: validateAndNormalizeFeaturePlan + buildDevelopmentTaskWaves
//     → an UNSAVED candidate for Owner review (or a rejection with codes only)
//
// Boundaries:
// * Planning is a bounded direct-model task in the ModelProvider vocabulary (messages in, output text
//   out). It is NOT an executor task: no ExecutorAdapter, no tools, no agent loop, no follow-up turns,
//   no repository or GitHub access. This module has no I/O and no runtime access of its own: the
//   planning Run lives behind the PlanningModelPort binding.
// * The candidate is never saved here. Only the Owner's explicit "save draft revision" (the AI-039
//   save contract, with its own validation) creates a FeaturePlan revision.
// * Repository context: the Project Registry holds a repository URL only, never its contents. With no
//   trusted technical repository context, the planner must not name repository paths: any non-empty
//   allowedPaths in the model output rejects the whole candidate (never trimmed), and every candidate
//   step is marked as needing technical clarification of its allowed paths before it can be saved.
// * Invalid output (unknown fields, cycles, missing / self dependencies, invalid risk or priority,
//   missing required values, oversize lists) rejects the candidate. Nothing is silently repaired.
import { isProxy } from "node:util/types";
import type { DevelopmentTask } from "../contracts/development-plan";
import type { ModelInvocationMessage } from "../contracts/model-invocation";
import type { ProjectTaskType } from "../tasks/project-task";
import type { InterviewAnswers } from "./planning-interview";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { buildDevelopmentTaskWaves, validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { featurePlanBuilderLimits, stepIdPattern } from "./feature-plan-model.ts";

// The Owner's planning request context: the task, its project and the rendered form's idempotency key.
export type PlanningRequestContext = Readonly<{
  taskId: string;
  projectId: string;
  projectName: string;
  idempotencyKey: string;
}>;

// Factual non-candidate outcomes of the planning invocation (never a guess):
//   unavailable          no valid planning policy / provider binding (nothing was attempted)
//   budget_denied        the aggregate planning budget denied generation before any provider spend
//   provider_unavailable the provider failed transiently; the attempt is finished (no hidden retry)
//   failed               the planning Run failed definitively (or could not start; nothing was spent)
//   recovery_required    the outcome is ambiguous (outcome_unknown, ambiguous persistence, in flight):
//                        budget held, never redispatched
//   conflict             the idempotency key was used for a different planning request
//   not_plannable / unauthenticated   re-checked at the durable boundary
export type PlanningModelFailure =
  | "unavailable" | "budget_denied" | "provider_unavailable" | "failed" | "recovery_required" | "conflict" | "not_plannable" | "unauthenticated";

// ONE bounded planning invocation. AI-039.1 production binding: lib/composition/owner-feature-plan-planning
// (a real planning Workflow Run). Never a direct provider SDK call.
export type PlanningModelPort = Readonly<{
  complete(input: Readonly<{ context: PlanningRequestContext; messages: readonly ModelInvocationMessage[]; maxOutputTokens: number }>): Promise<
    Readonly<{ status: "completed"; outputText: string }> | Readonly<{ status: PlanningModelFailure }>
  >;
}>;

export type PlanningTaskFacts = Readonly<{
  taskId: string;
  projectId: string;
  type: ProjectTaskType;
  title: string;
  goal: string | null;
  priority: string | null;
  riskLevel: string | null;
}>;

export type FeaturePlanCandidateStep = Omit<DevelopmentTask, "allowedPaths"> & Readonly<{ allowedPaths: readonly string[] }>;

export type FeaturePlanCandidate = Readonly<{
  title: string;
  goal: string;
  steps: readonly FeaturePlanCandidateStep[];
  // Step ids per dependency wave (logical readiness only; from buildDevelopmentTaskWaves).
  waves: readonly (readonly string[])[];
  // Always true while no trusted repository context exists: allowed paths need technical clarification.
  pathsRequireTechnicalReview: boolean;
}>;

export type CandidateRejection =
  | "malformed_output"
  | "untrusted_repository_paths"
  | "invalid_plan"
  | "invalid_dependency_graph";

export type PlannerOutcome =
  | Readonly<{ status: "candidate"; candidate: FeaturePlanCandidate }>
  | Readonly<{ status: "rejected"; reason: CandidateRejection }>
  | Readonly<{ status: PlanningModelFailure }>;

// maxOutputTextLength: the largest output text the planner parses (a 4000-token JSON plan is far below).
export const plannerLimits = Object.freeze({ maxOutputTokens: 4000, maxSteps: 8, maxOutputTextLength: 65_536 });

const failures: readonly PlanningModelFailure[] = ["unavailable", "budget_denied", "provider_unavailable", "failed", "recovery_required", "conflict", "not_plannable", "unauthenticated"];

const limits = featurePlanBuilderLimits;
const outputFields = ["title", "goal", "steps"] as const;
const stepFields = ["id", "title", "goal", "scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands", "dependencyIds", "riskLevel", "priority", "requiresOwnerApproval"] as const;
const listFields = ["scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands", "dependencyIds"] as const;
// Used ONLY in memory to let the canonical contract check everything else while allowed paths are
// intentionally absent; never shown, never returned, never saved.
const pathsPendingValidationMarker = "(allowed paths pending technical clarification)";

// Plain data only: a Proxy is refused before any trap could run (a real provider returns parsed JSON).
const isPlain = (input: unknown): input is Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input) || isProxy(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
};
const exactKeys = (input: Record<string, unknown>, fields: readonly string[]) => {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => keys.includes(field)) && Object.getOwnPropertySymbols(input).length === 0;
};
const boundedString = (input: unknown, max: number): input is string => typeof input === "string" && input.length <= max;
const stringList = (input: unknown, max: number): input is string[] =>
  Array.isArray(input) && !isProxy(input) && input.length <= max && input.every((item) => boundedString(item, limits.maxListItemLength));

// The model messages: fixed instructions + the task facts and the Owner's answers as data. The plan is
// written in the language of the task and answers (never derived from the UI locale).
export function planningMessages(task: PlanningTaskFacts, answers: InterviewAnswers): readonly ModelInvocationMessage[] {
  const instructions = [
    "You are the planning step of an engineering control plane. Turn the Owner's product intent into a small, reviewable technical development plan.",
    "Return ONLY one JSON object: {\"title\": string, \"goal\": string, \"steps\": [ { \"id\": \"step-1\" | \"step-2\" | ..., \"title\": string, \"goal\": string, \"scope\": string[], \"nonGoals\": string[], \"allowedPaths\": [], \"acceptanceCriteria\": string[], \"verificationCommands\": string[], \"dependencyIds\": string[], \"riskLevel\": \"low\" | \"medium\" | \"high\" | \"critical\", \"priority\": \"P0\" | \"P1\" | \"P2\" | \"P3\" | \"P4\", \"requiresOwnerApproval\": boolean } ] }.",
    `Use 1 to ${plannerLimits.maxSteps} steps, ids step-1, step-2, ... in order. A step may depend only on other steps of this plan; no cycles.`,
    "You have NO access to the repository. allowedPaths MUST be an empty array for every step; do not guess file or directory names.",
    "verificationCommands are proposals for a technical reviewer to confirm. Acceptance criteria must follow from the Owner's answers.",
    "Mark requiresOwnerApproval true for steps with high or critical risk or that touch security, data or compatibility constraints.",
    "Where the Owner answered \"unknown\" or left an answer empty, do not invent facts: keep the step general and say what must be clarified.",
    "Write all text in the same language as the task title and the Owner's answers.",
  ].join("\n");
  const facts = JSON.stringify({ task: { type: task.type, title: task.title, goal: task.goal, priority: task.priority, riskLevel: task.riskLevel }, interview: answers });
  return Object.freeze([
    Object.freeze({ role: "system", content: instructions, toolCallId: null }),
    Object.freeze({ role: "user", content: facts, toolCallId: null }),
  ]) as readonly ModelInvocationMessage[];
}

// Untrusted model output → validated candidate, or a rejection. Strict: exact fields, bounded sizes,
// no repository paths, canonical contract + waves. No repair.
export function candidateFromModelOutput(output: unknown): Readonly<{ ok: true; candidate: FeaturePlanCandidate }> | Readonly<{ ok: false; reason: CandidateRejection }> {
  try {
    if (!isPlain(output) || !exactKeys(output, outputFields) || !boundedString(output.title, limits.maxPlanTitleLength)
      || !boundedString(output.goal, limits.maxPlanGoalLength) || !Array.isArray(output.steps) || isProxy(output.steps)
      || output.steps.length === 0 || output.steps.length > plannerLimits.maxSteps) {
      return { ok: false, reason: "malformed_output" };
    }
    const steps: FeaturePlanCandidateStep[] = [];
    for (const [index, raw] of output.steps.entries()) {
      if (!isPlain(raw) || !exactKeys(raw, stepFields) || typeof raw.id !== "string" || !stepIdPattern.test(raw.id)
        || !boundedString(raw.title, limits.maxStepTitleLength) || !boundedString(raw.goal, limits.maxStepGoalLength)
        || typeof raw.riskLevel !== "string" || typeof raw.priority !== "string" || typeof raw.requiresOwnerApproval !== "boolean"
        || listFields.some((field) => !stringList(raw[field], field === "dependencyIds" ? plannerLimits.maxSteps : limits.maxListItems))) {
        return { ok: false, reason: "malformed_output" };
      }
      // No trusted repository context: any path is a guess presented as fact.
      if ((raw.allowedPaths as string[]).length > 0) return { ok: false, reason: "untrusted_repository_paths" };
      steps.push({
        id: raw.id, sequence: index + 1, title: raw.title as string, goal: raw.goal as string,
        scope: [...raw.scope as string[]], nonGoals: [...raw.nonGoals as string[]], allowedPaths: [],
        acceptanceCriteria: [...raw.acceptanceCriteria as string[]], verificationCommands: [...raw.verificationCommands as string[]],
        dependencyIds: [...raw.dependencyIds as string[]], riskLevel: raw.riskLevel as DevelopmentTask["riskLevel"],
        priority: raw.priority as DevelopmentTask["priority"], requiresOwnerApproval: raw.requiresOwnerApproval,
      });
    }
    const probe = {
      id: "plan-candidate",
      title: output.title,
      goal: output.goal,
      status: "draft",
      tasks: steps.map((step) => ({ ...step, allowedPaths: [pathsPendingValidationMarker] })),
    };
    const validation = validateAndNormalizeFeaturePlan(probe);
    if (!validation.ok) {
      const graph = validation.errors.some((error) => ["missing_dependency", "self_dependency", "dependency_cycle"].includes(error.code));
      return { ok: false, reason: graph ? "invalid_dependency_graph" : "invalid_plan" };
    }
    const waves = buildDevelopmentTaskWaves(validation.value);
    if (!waves.ok) return { ok: false, reason: "invalid_dependency_graph" };
    // The canonical normalized steps, with allowed paths still absent (never the validation marker).
    const normalized = validation.value.tasks.map((task) => Object.freeze({ ...task, allowedPaths: Object.freeze([]) as readonly string[] }));
    return {
      ok: true,
      candidate: Object.freeze({
        title: validation.value.title,
        goal: validation.value.goal,
        steps: Object.freeze(normalized),
        waves: Object.freeze(waves.value.map((wave) => Object.freeze(wave.map((task) => task.id)))),
        pathsRequireTechnicalReview: true,
      }),
    };
  } catch {
    return { ok: false, reason: "malformed_output" };
  }
}

// Untrusted output TEXT → candidate or rejection. The whole text must be exactly one JSON object
// (JSON.parse: no markdown fences, comments, trailing text or repair), within the bounded length.
export function candidateFromOutputText(text: unknown): ReturnType<typeof candidateFromModelOutput> {
  if (typeof text !== "string" || text.length === 0 || text.length > plannerLimits.maxOutputTextLength) return { ok: false, reason: "malformed_output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed_output" };
  }
  return candidateFromModelOutput(parsed);
}

// One planning attempt: exactly one invocation, then deterministic validation. Never saves.
export async function draftFeaturePlanCandidate(input: Readonly<{
  task: PlanningTaskFacts; answers: InterviewAnswers; context: PlanningRequestContext; model: PlanningModelPort | null;
}>): Promise<PlannerOutcome> {
  if (!input.model) return Object.freeze({ status: "unavailable" as const });
  let result: Awaited<ReturnType<PlanningModelPort["complete"]>>;
  try {
    result = await input.model.complete({
      context: input.context,
      messages: planningMessages(input.task, input.answers),
      maxOutputTokens: plannerLimits.maxOutputTokens,
    });
  } catch {
    // The binding owns the provider boundary; an escaped exception cannot prove nothing was spent.
    return Object.freeze({ status: "recovery_required" as const });
  }
  if (typeof result !== "object" || result === null || isProxy(result)) return Object.freeze({ status: "recovery_required" as const });
  if (result.status !== "completed") {
    return Object.freeze({ status: failures.includes(result.status) ? result.status : "recovery_required" as const });
  }
  const parsed = candidateFromOutputText(result.outputText);
  return parsed.ok
    ? Object.freeze({ status: "candidate" as const, candidate: parsed.candidate })
    : Object.freeze({ status: "rejected" as const, reason: parsed.reason });
}
