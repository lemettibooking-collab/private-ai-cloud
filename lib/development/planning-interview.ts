// AI-039 P-1 Owner Planning Interview (pure; no I/O; safe for client components).
//
// The Owner answers PRODUCT questions only — the desired result, where behavior changes, what must not
// break, how success is recognized, special constraints. Technical decomposition (development steps,
// dependencies, repository paths, verification commands) is the RESULT of planning, never an Owner
// input: no question here asks for files, directories, commands, step ids or dependencies. "Not sure"
// is a valid answer wherever it is offered. Question texts are localized in lib/i18n/messages.ts
// (taskDevelopment.interview); this module holds only stable ids and option tokens.
import type { ProjectTaskType } from "../tasks/project-task";

export type InterviewQuestion = Readonly<{
  id: string;
  // text: free answer; choice: exactly one option; multi: zero or more options.
  kind: "text" | "choice" | "multi";
  required: boolean;
  options: readonly string[];
}>;

export const interviewLimits = Object.freeze({ maxTextLength: 1200, maxQuestions: 7, minQuestions: 3 });

const text = (id: string, required: boolean): InterviewQuestion => Object.freeze({ id, kind: "text", required, options: Object.freeze([]) });
const choice = (id: string, options: readonly string[]): InterviewQuestion => Object.freeze({ id, kind: "choice", required: true, options: Object.freeze([...options]) });
const multi = (id: string, options: readonly string[]): InterviewQuestion => Object.freeze({ id, kind: "multi", required: false, options: Object.freeze([...options]) });

// Shared product questions.
const mustNotChange = text("mustNotChange", false);
const constraints = multi("constraints", ["security", "data", "performance", "compatibility", "none"]);

// Task-type aware sets (3–7 questions each). "unknown" is the explicit "Not sure" option.
export const planningInterviews: Readonly<Record<ProjectTaskType, readonly InterviewQuestion[]>> = Object.freeze({
  feature: Object.freeze([
    text("outcome", true),
    choice("surface", ["one_screen", "several_places", "whole_product", "backend", "unknown"]),
    mustNotChange,
    text("doneWhen", true),
    constraints,
  ]),
  fix: Object.freeze([
    text("currentBehavior", true),
    text("expectedBehavior", true),
    choice("occurrence", ["always", "sometimes", "specific_case", "unknown"]),
    mustNotChange,
    constraints,
  ]),
  investigation: Object.freeze([
    text("question", true),
    choice("deliverable", ["summary", "recommendation", "estimate", "unknown"]),
    mustNotChange,
    constraints,
  ]),
  roadmap: Object.freeze([
    text("endGoal", true),
    choice("sequencing", ["strict_order", "parallel_ok", "unknown"]),
    mustNotChange,
    constraints,
  ]),
});

export type InterviewAnswers = Readonly<Record<string, string | readonly string[]>>;

const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

// Raw answers (from the bounded form parser) → validated answers for THIS task type, or null. Unknown
// question ids, unknown options, oversize text and missing required answers fail closed.
export function validateInterviewAnswers(taskType: ProjectTaskType, raw: Readonly<Record<string, readonly string[]>>): InterviewAnswers | null {
  const questions = planningInterviews[taskType];
  if (!questions) return null;
  const known = new Set(questions.map((question) => question.id));
  for (const id of Object.keys(raw)) if (!known.has(id)) return null;
  const answers: Record<string, string | readonly string[]> = {};
  for (const question of questions) {
    const values = raw[question.id] ?? [];
    if (question.kind === "text") {
      if (values.length > 1) return null;
      const value = (values[0] ?? "").replace(/\r\n?/gu, "\n").trim();
      if (value.length > interviewLimits.maxTextLength || control.test(value)) return null;
      if (question.required && value.length === 0) return null;
      answers[question.id] = value;
    } else if (question.kind === "choice") {
      if (values.length !== 1 || !question.options.includes(values[0])) return null;
      answers[question.id] = values[0];
    } else {
      if (values.length > question.options.length || new Set(values).size !== values.length || values.some((value) => !question.options.includes(value))) return null;
      // "none" is exclusive: it cannot be combined with a real constraint.
      if (values.includes("none") && values.length > 1) return null;
      answers[question.id] = Object.freeze([...values]);
    }
  }
  return Object.freeze(answers);
}
