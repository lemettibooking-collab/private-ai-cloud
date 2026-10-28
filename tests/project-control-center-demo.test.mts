import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/project-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-manifest");

const demo = (await import(
  new URL("../lib/project-control-center-demo.ts", import.meta.url).href
)) as typeof import("../lib/project-control-center-demo");

const {
  evaluateProjectChildScope,
  systemForbiddenProjectActions,
  systemRequiredProjectApprovalActions,
  validateAndNormalizeProjectManifest,
} = contract;

const {
  createProjectControlCenterDemo,
  createProjectControlCenterDepartmentDemo,
  createProjectControlCenterDraftProject,
  projectControlCenterDepartmentCatalog,
  projectControlCenterKnowledgeCollections,
  projectControlCenterModelProfiles,
} = demo;

type DemoManifest = ReturnType<
  typeof createProjectControlCenterDemo
>["projects"][number]["manifest"];

function projectById(id: string) {
  const project = createProjectControlCenterDemo().projects.find(
    (candidate) => candidate.manifest.id === id,
  );
  assert.ok(project, `Expected demo project ${id}`);
  return project;
}

function scopeById(manifest: unknown, id: "development" | "marketing" | "support") {
  const scope = createProjectControlCenterDepartmentDemo(manifest).evaluatedScopes.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(scope, `Expected evaluated scope ${id}`);
  return scope;
}

function deniedScenario(
  manifest: unknown,
  id: "resource-expansion" | "model-expansion" | "capability-expansion" | "budget-expansion",
) {
  const scenario = createProjectControlCenterDepartmentDemo(manifest).deniedScenarios.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(scenario, `Expected denied scenario ${id}`);
  return scenario;
}

function createConcurrentRunBoundaryManifest(): DemoManifest {
  const manifest = projectById("private-ai-cloud").manifest;
  return {
    ...manifest,
    budget: {
      ...manifest.budget,
      maxConcurrentRuns: 16,
    },
  };
}

function evaluateBudgetExpansionDirectly(manifest: DemoManifest) {
  return evaluateProjectChildScope({
    manifest,
    scopeKind: "department",
    scopeId: "department-budget-expansion",
    requestedResources: [],
    requestedModelProfileIds: [],
    requestedKnowledgeCollectionIds: [],
    requestedBudget: {
      maxConcurrentRuns: manifest.budget.maxConcurrentRuns + 1,
      maxAttemptsPerRun: Math.max(1, Math.min(2, manifest.budget.maxAttemptsPerRun)),
      maxRunMinutes: Math.max(1, Math.min(60, manifest.budget.maxRunMinutes)),
      dailyTokenBudget: Math.min(500_000, manifest.budget.dailyTokenBudget),
      monthlyCostBudgetUsdCents: Math.min(
        100_000,
        manifest.budget.monthlyCostBudgetUsdCents,
      ),
    },
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    requiredApprovalActions: manifest.policy.requiredApprovalActions,
    additionalForbiddenActions: ["Ограничения отдела department-budget-expansion"],
  });
}

test("both Project Control Center demo manifests pass the real AI-013 validator", () => {
  const state = createProjectControlCenterDemo();
  assert.deepEqual(
    state.projects.map((project) => project.manifest.name),
    ["Private AI Cloud", "Smart Algorithms"],
  );
  for (const project of state.projects) {
    assert.equal(validateAndNormalizeProjectManifest(project.manifest).ok, true);
  }
});
test("demo factories return fresh projects and deeply fresh manifest collections", () => {
  const first = createProjectControlCenterDemo();
  const second = createProjectControlCenterDemo();
  assert.notEqual(first, second);
  assert.notEqual(first.projects, second.projects);
  assert.notEqual(first.projects[0], second.projects[0]);
  assert.notEqual(first.projects[0].manifest, second.projects[0].manifest);
  assert.notEqual(first.projects[0].manifest.resources, second.projects[0].manifest.resources);
  assert.notEqual(
    first.projects[0].manifest.resources[0].capabilities,
    second.projects[0].manifest.resources[0].capabilities,
  );
  assert.notEqual(first.modelProfiles, second.modelProfiles);
  assert.notEqual(first.knowledgeCollections, second.knowledgeCollections);
});

test("department evaluation does not mutate the manifest", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const before = structuredClone(manifest);
  createProjectControlCenterDepartmentDemo(manifest);
  assert.deepEqual(manifest, before);
});

test("every model profile ID used by demo projects has a presentation mapping", () => {
  const mappedIds = new Set(projectControlCenterModelProfiles.map((profile) => profile.id));
  for (const project of createProjectControlCenterDemo().projects) {
    for (const modelId of project.manifest.allowedModelProfileIds) {
      assert.equal(mappedIds.has(modelId as (typeof projectControlCenterModelProfiles)[number]["id"]), true, modelId);
    }
  }
});

test("all four required model presentations are available", () => {
  assert.deepEqual(
    projectControlCenterModelProfiles.map((profile) => [profile.name, profile.provider]),
    [
      ["Codex", "OpenAI"],
      ["Claude Code", "Anthropic"],
      ["Qwen", "UI mapping"],
      ["DeepSeek", "UI mapping"],
    ],
  );
});

test("every Knowledge Collection ID used by demo projects has a presentation mapping", () => {
  const mappedIds = new Set(
    projectControlCenterKnowledgeCollections.map((collection) => collection.id),
  );
  for (const project of createProjectControlCenterDemo().projects) {
    for (const collectionId of project.manifest.knowledgeCollectionIds) {
      assert.equal(
        mappedIds.has(
          collectionId as (typeof projectControlCenterKnowledgeCollections)[number]["id"],
        ),
        true,
        collectionId,
      );
    }
  }
});

test("demo resource references contain no credential-like material", () => {
  const credentialLike =
    /(?:token|password|secret|api[_-]?key|bearer\s|private key|\$\(|`)/iu;
  for (const project of createProjectControlCenterDemo().projects) {
    for (const resource of project.manifest.resources) {
      assert.equal(credentialLike.test(resource.resourceRef), false, resource.resourceRef);
    }
  }
});

test("demo projects preserve all system approvals and forbidden actions", () => {
  for (const project of createProjectControlCenterDemo().projects) {
    assert.deepEqual(
      project.manifest.policy.requiredApprovalActions.slice(
        0,
        systemRequiredProjectApprovalActions.length,
      ),
      systemRequiredProjectApprovalActions,
    );
    assert.deepEqual(
      project.manifest.policy.forbiddenActions.slice(0, systemForbiddenProjectActions.length),
      systemForbiddenProjectActions,
    );
  }
});

test("Development child scope is allowed by the real evaluator", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scope = scopeById(manifest, "development");
  assert.equal(scope.decision.verdict, "allow", JSON.stringify(scope.decision));
  assert.ok(scope.decision.normalizedScope);
});

test("Support child scope is allowed by the real evaluator", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scope = scopeById(manifest, "support");
  assert.equal(scope.decision.verdict, "allow", JSON.stringify(scope.decision));
  assert.ok(scope.decision.normalizedScope);
});

test("Marketing child scope is allowed only within project resources and allowlists", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scope = scopeById(manifest, "marketing");
  assert.equal(scope.decision.verdict, "allow", JSON.stringify(scope.decision));
  const normalized = scope.decision.normalizedScope;
  assert.ok(normalized);
  assert.ok(normalized.resources.every((resource) => manifest.resources.some((parent) => parent.id === resource.resourceId)));
  assert.ok(normalized.modelProfileIds.every((id) => manifest.allowedModelProfileIds.includes(id)));
});

test("resource expansion returns deny with no normalized scope", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scenario = deniedScenario(manifest, "resource-expansion");
  assert.equal(scenario.decision.verdict, "deny");
  assert.equal(scenario.decision.normalizedScope, null);
  assert.ok(scenario.decision.reasons.some((reason) => reason.code === "resource_not_found"));
});

test("model expansion returns deny with no normalized scope", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scenario = deniedScenario(manifest, "model-expansion");
  assert.equal(scenario.decision.verdict, "deny");
  assert.equal(scenario.decision.normalizedScope, null);
  assert.ok(
    scenario.decision.reasons.some((reason) => reason.code === "model_profile_not_allowed"),
  );
});

test("capability expansion returns deny with no normalized scope", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const scenario = deniedScenario(manifest, "capability-expansion");
  assert.equal(scenario.decision.verdict, "deny");
  assert.equal(scenario.decision.normalizedScope, null);
  assert.ok(
    scenario.decision.reasons.some((reason) => reason.code === "capability_not_allowed"),
  );
});

test("child budgets cannot exceed the project ceiling", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  for (const scope of createProjectControlCenterDepartmentDemo(manifest).evaluatedScopes) {
    assert.ok(scope.requestedBudget.maxConcurrentRuns <= manifest.budget.maxConcurrentRuns);
    assert.ok(scope.requestedBudget.maxAttemptsPerRun <= manifest.budget.maxAttemptsPerRun);
    assert.ok(scope.requestedBudget.maxRunMinutes <= manifest.budget.maxRunMinutes);
    assert.ok(scope.requestedBudget.dailyTokenBudget <= manifest.budget.dailyTokenBudget);
    assert.ok(
      scope.requestedBudget.monthlyCostBudgetUsdCents <=
        manifest.budget.monthlyCostBudgetUsdCents,
    );
  }
  const expansion = deniedScenario(manifest, "budget-expansion");
  assert.equal(expansion.decision.verdict, "deny");
  assert.equal(expansion.decision.normalizedScope, null);
  assert.ok(
    expansion.decision.reasons.some((reason) => reason.code === "budget_ceiling_exceeded"),
  );
});

test("department and deny results are deterministic", () => {
  const manifest = projectById("smart-algorithms").manifest;
  assert.deepEqual(
    createProjectControlCenterDepartmentDemo(manifest),
    createProjectControlCenterDepartmentDemo(manifest),
  );
});

test("budget expansion denies when the project is already at maxConcurrentRuns 16", () => {
  const manifest = createConcurrentRunBoundaryManifest();
  const scenario = deniedScenario(manifest, "budget-expansion");
  assert.equal(scenario.decision.verdict, "deny");
  assert.equal(scenario.decision.normalizedScope, null);
  assert.ok(
    scenario.decision.reasons.some(
      (reason) =>
        reason.code === "budget_ceiling_exceeded" || reason.code === "invalid_scope_input",
    ),
  );
});

test("all four expansion scenarios are real denies for both demo projects", () => {
  for (const project of createProjectControlCenterDemo().projects) {
    const scenarios = createProjectControlCenterDepartmentDemo(
      project.manifest,
    ).deniedScenarios;
    assert.equal(scenarios.length, 4);
    for (const scenario of scenarios) {
      assert.equal(scenario.decision.verdict, "deny", `${project.manifest.id}:${scenario.id}`);
      assert.equal(scenario.decision.normalizedScope, null, scenario.id);
      assert.ok(scenario.decision.reasons.length > 0, scenario.id);
    }
  }
});

test("department demo preserves the exact budget decision returned by the evaluator", () => {
  const manifest = createConcurrentRunBoundaryManifest();
  const scenario = deniedScenario(manifest, "budget-expansion");
  assert.deepEqual(scenario.decision, evaluateBudgetExpansionDirectly(manifest));
});

test("reverse and repeated department evaluation remain deterministic", () => {
  const projects = createProjectControlCenterDemo().projects;
  const evaluateProjects = (manifests: readonly DemoManifest[]) =>
    manifests
      .map((manifest) => ({
        projectId: manifest.id,
        result: createProjectControlCenterDepartmentDemo(manifest),
      }))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const forward = evaluateProjects(projects.map((project) => project.manifest));
  const reverse = evaluateProjects([...projects].reverse().map((project) => project.manifest));
  assert.deepEqual(reverse, forward);
  assert.deepEqual(
    createProjectControlCenterDepartmentDemo(projects[0].manifest),
    createProjectControlCenterDepartmentDemo(projects[0].manifest),
  );
});

test("boundary evaluation does not mutate the manifest or its budget input", () => {
  const manifest = createConcurrentRunBoundaryManifest();
  const budgetReference = manifest.budget;
  const before = structuredClone(manifest);
  createProjectControlCenterDepartmentDemo(manifest);
  assert.deepEqual(manifest, before);
  assert.deepEqual(budgetReference, before.budget);
  assert.equal(manifest.budget, budgetReference);
});

test("create-demo-project returns a deterministic valid local draft", () => {
  const first = createProjectControlCenterDraftProject(3);
  const second = createProjectControlCenterDraftProject(3);
  assert.equal(first.manifest.id, "demo-project-3");
  assert.equal(first.manifest.status, "draft");
  assert.equal(first.manifest.budget.dailyTokenBudget, 0);
  assert.equal(validateAndNormalizeProjectManifest(first.manifest).ok, true);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.manifest, second.manifest);
});

test("department preview contains all ten Product Blueprint departments", () => {
  const manifest = projectById("private-ai-cloud").manifest;
  const previews = createProjectControlCenterDepartmentDemo(manifest).departmentPreviews;
  assert.equal(previews.length, 10);
  assert.deepEqual(
    previews.map((department) => department.name),
    projectControlCenterDepartmentCatalog.map((department) => department.name),
  );
  assert.equal(
    previews.filter((department) => department.configurationStatus === "Проверено контрактом").length,
    3,
  );
});
