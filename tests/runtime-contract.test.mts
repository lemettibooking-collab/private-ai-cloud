import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domainContracts = (await import(
  new URL("../lib/contracts/domain.ts", import.meta.url).href
)) as typeof import("../lib/contracts/domain");

const {
  approvalStatuses,
  isApprovalStatus,
  isRiskLevel,
  isRoleCode,
  isTaskStatus,
  isWorkflowRunStatus,
  mapLegacyRoleCode,
  parseApprovalStatus,
  parseRiskLevel,
  parseRoleCode,
  parseTaskStatus,
  parseWorkflowRunStatus,
  riskLevels,
  roleCodes,
  taskStatuses,
  workflowRunStatuses,
} = domainContracts;

type RuntimeContractPackage = {
  packageManager?: string;
  engines?: {
    node?: string;
    npm?: string;
  };
  scripts?: Record<string, string>;
};

const expectedScripts = {
  dev: "next dev",
  build: "next build",
  start: "next start",
  lint: "eslint",
  typecheck: "tsc --noEmit --incremental false",
  test: "node --test tests/runtime-contract.test.mts",
} as const;

function validateRuntimeContract(packageJson: RuntimeContractPackage): string[] {
  const errors: string[] = [];

  if (packageJson.packageManager !== "npm@11.8.0") {
    errors.push("packageManager must be npm@11.8.0");
  }

  if (packageJson.engines?.node !== "24.13.x") {
    errors.push("Node.js engine must be pinned to 24.13.x");
  }

  if (packageJson.engines?.npm !== "11.8.x") {
    errors.push("npm engine must be pinned to 11.8.x");
  }

  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      errors.push(`script ${name} must be ${command}`);
    }
  }

  return errors;
}

test("runtime and verification metadata matches the supported contract", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as RuntimeContractPackage;

  assert.deepEqual(validateRuntimeContract(packageJson), []);
  assert.match(process.versions.node, /^24\.13\./);
  assert.match(process.env.npm_config_user_agent ?? "", /^npm\/11\.8\.0(?:\s|$)/);
});

test("TaskStatus values match the orchestrator lifecycle", () => {
  assert.deepEqual(taskStatuses, [
    "draft",
    "classified",
    "policy_checked",
    "queued",
    "running",
    "awaiting_approval",
    "approved",
    "executing",
    "review",
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ]);
});

test("WorkflowRunStatus values preserve the existing workflow lifecycle", () => {
  assert.deepEqual(workflowRunStatuses, [
    "draft",
    "queued",
    "running",
    "generated",
    "waiting_approval",
    "approved",
    "rejected",
    "executed",
    "failed",
    "cancelled",
  ]);
});

test("ApprovalStatus values preserve the persistence contract", () => {
  assert.deepEqual(approvalStatuses, [
    "pending",
    "approved",
    "rejected",
    "edited",
    "expired",
    "cancelled",
  ]);
});

test("RiskLevel values use critical instead of blocked", () => {
  assert.deepEqual(riskLevels, ["low", "medium", "high", "critical"]);
  assert.equal(isRiskLevel("critical"), true);
  assert.equal(parseRiskLevel("critical"), "critical");
  assert.equal(isRiskLevel("blocked"), false);
  assert.equal(parseRiskLevel("blocked"), null);
});

test("RoleCode values use stable persistence codes", () => {
  assert.deepEqual(roleCodes, [
    "owner",
    "admin",
    "support_operator",
    "marketing_operator",
    "product_manager",
    "developer_reviewer",
    "viewer",
    "demo_viewer",
  ]);
});

test("status parsers accept valid values and fail closed", () => {
  assert.equal(isTaskStatus("classified"), true);
  assert.equal(parseTaskStatus("classified"), "classified");
  assert.equal(parseTaskStatus("unknown"), null);

  assert.equal(isWorkflowRunStatus("generated"), true);
  assert.equal(parseWorkflowRunStatus("generated"), "generated");
  assert.equal(parseWorkflowRunStatus("unknown"), null);

  assert.equal(isApprovalStatus("edited"), true);
  assert.equal(parseApprovalStatus("edited"), "edited");
  assert.equal(parseApprovalStatus("changes_requested"), null);
});

test("TaskStatus and WorkflowRunStatus remain distinct", () => {
  assert.equal(isTaskStatus("classified"), true);
  assert.equal(isWorkflowRunStatus("classified"), false);
  assert.equal(isWorkflowRunStatus("generated"), true);
  assert.equal(isTaskStatus("generated"), false);
  assert.equal(isWorkflowRunStatus("executed"), true);
  assert.equal(isTaskStatus("executed"), false);
});

test("legacy role aliases map explicitly to canonical RoleCode values", () => {
  assert.deepEqual(
    ["support", "marketing", "product", "reviewer", "demo-viewer"].map(
      mapLegacyRoleCode,
    ),
    [
      "support_operator",
      "marketing_operator",
      "product_manager",
      "developer_reviewer",
      "demo_viewer",
    ],
  );
});

test("unknown role aliases fail closed", () => {
  assert.equal(mapLegacyRoleCode("super_admin"), null);
  assert.equal(mapLegacyRoleCode(42), null);
  assert.equal(parseRoleCode("support"), null);
});

test("canonical RoleCode values pass through unchanged", () => {
  for (const roleCode of roleCodes) {
    assert.equal(isRoleCode(roleCode), true);
    assert.equal(parseRoleCode(roleCode), roleCode);
    assert.equal(mapLegacyRoleCode(roleCode), roleCode);
  }
});
