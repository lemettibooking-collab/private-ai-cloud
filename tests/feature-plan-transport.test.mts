// AI-039 L-1: the Plan Builder's maximum browser-generated form must fit well inside Next.js's default
// Server Action transport limit (1 MB, unchanged), so a form the builder accepts always reaches our
// bounded parser and its localized errors instead of being cut off by the framework first.
//
// Measured with a REAL multipart/form-data serialization (Node's Request + FormData, CRLF line breaks
// like browsers), worst-case UTF-8: every builder field filled to its HTML maxLength with a 3-byte
// character (the maximum bytes per UTF-16 code unit that `maxLength` counts), every step depending on
// every other step, plus an allowance for React / Next.js Server Action metadata.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const model = (await import(new URL("../lib/development/feature-plan-model.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-model");
const form = (await import(new URL("../lib/development/feature-plan-form.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-form");
const revision = (await import(new URL("../lib/development/feature-plan-revision.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-revision");
const contract = (await import(new URL("../lib/contracts/development-plan.ts", import.meta.url).href)) as typeof import("../lib/contracts/development-plan");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");

const KiB = 1024;
const frameworkLimitBytes = 1024 * 1024; // Next.js default serverActions.bodySizeLimit ("1mb"), unchanged.
const safetyCeilingBytes = 800 * KiB; // our envelope, well below the framework limit
// React / Next.js Server Action metadata: action id / reference fields and per-field prefixes.
const metadataAllowanceBytes = (fields: number) => 4 * KiB + fields * 16;

const wide = "界"; // U+754C: 1 UTF-16 code unit, 3 UTF-8 bytes
const fill = (codeUnits: number) => wide.repeat(codeUnits);
const limits = model.featurePlanBuilderLimits;
// The builder's HTML maxLength per field (components/domain/owner-console/feature-plan-builder.tsx).
const listMaxLength = limits.maxListItems * (limits.maxListItemLength + 1);
const lists = ["scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands"] as const;
const stepIds = Array.from({ length: limits.maxSteps }, (_, index) => `step-${index + 1}`);

function maximumForm(mode: "transport" | "valid"): { data: FormData; fields: number } {
  const data = new FormData();
  data.append(`$ACTION_ID_${"f".repeat(42)}`, "");
  data.append("idempotencyKey", `fp-${"a".repeat(32)}`);
  data.append("taskId", `task-${"b".repeat(59)}`);
  data.append("planTitle", fill(limits.maxPlanTitleLength));
  data.append("planGoal", fill(limits.maxPlanGoalLength));
  for (const id of stepIds) data.append("steps", id);
  for (const [index, id] of stepIds.entries()) {
    data.append(`step.${id}.title`, fill(limits.maxStepTitleLength));
    data.append(`step.${id}.goal`, fill(limits.maxStepGoalLength));
    for (const list of lists) {
      // transport: the full HTML maxLength of 3-byte characters (the byte maximum a browser can send);
      // valid: the maximum the parser accepts (maxListItems lines of maxListItemLength).
      data.append(`step.${id}.${list}`, mode === "transport" ? fill(listMaxLength) : Array.from({ length: limits.maxListItems }, () => fill(limits.maxListItemLength)).join("\n"));
    }
    data.append(`step.${id}.riskLevel`, "critical");
    data.append(`step.${id}.priority`, "P0");
    data.append(`step.${id}.requiresOwnerApproval`, "yes");
    // transport: every other step (the most checkboxes); valid: every earlier step (acyclic).
    for (const other of mode === "transport" ? stepIds.filter((value) => value !== id) : stepIds.slice(0, index)) data.append(`step.${id}.dependsOn`, other);
  }
  return { data, fields: [...data.keys()].length };
}

async function multipartBytes(data: FormData): Promise<number> {
  return (await new Request("http://localhost/action", { method: "POST", body: data }).arrayBuffer()).byteLength;
}

test("L-1 transport budget: the maximum browser-generated Plan Builder form stays well below the 1 MB Server Action limit", async () => {
  const { data, fields } = maximumForm("transport");
  const measured = await multipartBytes(data);
  const worstCase = measured + metadataAllowanceBytes(fields);
  assert.ok(worstCase <= safetyCeilingBytes,
    `worst case ${worstCase} bytes (${(worstCase / KiB).toFixed(1)} KiB; multipart ${measured} + metadata allowance) exceeds the ${safetyCeilingBytes / KiB} KiB safety ceiling`);
  assert.ok(frameworkLimitBytes - worstCase >= 200 * KiB, "at least 200 KiB of margin to the framework limit");
});

test("L-1: the maximum VALID builder plan is accepted by the bounded parser and the canonical contract", () => {
  const parsed = form.featurePlanInputFromForm(maximumForm("valid").data);
  assert.ok(parsed, "the parser accepts the maximum builder plan");
  assert.equal(parsed!.plan.tasks.length, limits.maxSteps);
  assert.ok(parsed!.plan.tasks.every((task) => task.scope.length === limits.maxListItems && task.scope.every((item) => item.length === limits.maxListItemLength)));
  const normalized = revision.normalizeDraftPlan(parsed!.plan, "plan-0123456789abcdef0123");
  assert.equal(normalized.ok, true, JSON.stringify(normalized).slice(0, 200));
});

test("L-1: one source of limits — builder ⊆ domain contract, and the UI maxLength / parser both read featurePlanBuilderLimits", () => {
  const domain = contract.developmentPlanLimits;
  assert.ok(limits.maxSteps <= domain.maxTasks && limits.maxListItems <= domain.maxListItems && limits.maxListItemLength <= domain.maxListItemLength);
  assert.ok(limits.maxPlanTitleLength <= domain.maxTitleLength && limits.maxStepTitleLength <= domain.maxTitleLength);
  assert.ok(limits.maxPlanGoalLength <= domain.maxGoalLength && limits.maxStepGoalLength <= domain.maxGoalLength);
  const builder = source("components/domain/owner-console/feature-plan-builder.tsx");
  for (const expression of ["maxLength={props.limits.maxPlanTitleLength}", "maxLength={props.limits.maxPlanGoalLength}", "maxLength={props.limits.maxStepTitleLength}",
    "maxLength={props.limits.maxStepGoalLength}", "maxLength={props.limits.maxListItems * (props.limits.maxListItemLength + 1)}"]) {
    assert.ok(builder.includes(expression), `builder uses ${expression}`);
  }
  assert.ok(!/maxLength=\{\d/u.test(builder), "no hard-coded maxLength in the builder");
  assert.match(source("app/tasks/[taskId]/development/page.tsx"), /limits: featurePlanBuilderLimits,/u, "the page passes the shared limits");
  assert.match(source("lib/development/feature-plan-form.ts"), /const limits = featurePlanBuilderLimits;/u, "the parser reads the same limits");
  // The framework transport guard stays at its default.
  assert.ok(!/bodySizeLimit|serverActions/u.test(source("next.config.ts")), "next.config.ts does not raise the Server Action body limit");
});
