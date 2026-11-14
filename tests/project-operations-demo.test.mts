import assert from "node:assert/strict";
import test from "node:test";

const projectContract = (await import(
  new URL("../lib/contracts/project-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-manifest");
const departmentContract = (await import(
  new URL("../lib/contracts/department-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/department-manifest");
const contextContract = (await import(
  new URL("../lib/contracts/project-context.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-context");
const schedulerContract = (await import(
  new URL("../lib/contracts/multi-project-run-scheduler.ts", import.meta.url).href
)) as typeof import("../lib/contracts/multi-project-run-scheduler");
const controlCenter = (await import(
  new URL("../lib/project-control-center-demo.ts", import.meta.url).href
)) as typeof import("../lib/project-control-center-demo");
const operations = (await import(
  new URL("../lib/project-operations-demo.ts", import.meta.url).href
)) as typeof import("../lib/project-operations-demo");

const {
  validateAndNormalizeProjectManifest,
} = projectContract;
const {
  evaluateDepartmentManifest,
  validateAndNormalizeDepartmentManifest,
} = departmentContract;
const {
  evaluateWorkspaceProjectContexts,
} = contextContract;
const {
  buildMultiProjectRunDispatchPlan,
} = schedulerContract;
const { createProjectControlCenterDemo } = controlCenter;
const {
  createProjectOperationsDemo,
  createProjectOperationsView,
  projectOperationsScopeKinds,
} = operations;

type Demo = ReturnType<typeof createProjectOperationsDemo>;
type Scope = import("../lib/project-operations-demo").ProjectOperationsScope;
type AvailableView =
  import("../lib/project-operations-demo").AvailableProjectOperationsView;

function availableView(
  demo: Demo = createProjectOperationsDemo(),
  scope: Scope = { kind: "workspace" },
): AvailableView {
  const view = createProjectOperationsView(demo, scope);
  if (!view.available) assert.fail(JSON.stringify(view));
  return view;
}

function projectContext(demo: Demo, projectId: string) {
  const context = demo.registryInput.projects.find(
    (candidate) => candidate.projectManifest.id === projectId,
  );
  assert.ok(context, `Expected context ${projectId}`);
  return context;
}

function projectIds(rows: readonly Readonly<{ projectId: string }>[]) {
  return [...new Set(rows.map((row) => row.projectId))].sort();
}

function assertOnlyProject(view: AvailableView, projectId: string) {
  const collections: readonly (readonly Readonly<{ projectId: string }>[])[] = [
    view.projects,
    view.departments,
    view.agents,
    view.workflows,
    view.queued,
    view.running,
    view.dispatches,
    view.blocked,
  ];
  for (const collection of collections) {
    assert.ok(
      collection.every((row) => row.projectId === projectId),
      JSON.stringify(collection),
    );
  }
}

function assertProjectionUnavailable(demo: Demo) {
  const view = createProjectOperationsView(demo, { kind: "workspace" });
  assert.equal(view.available, false, JSON.stringify(view));
  if (view.available) throw new Error("Expected unavailable projection");
  assert.ok(view.reasons.length > 0);
  assert.ok(view.reasons.every((reason) => reason.source === "projection"));
  assert.equal("summary" in view, false);
  assert.equal("projects" in view, false);
  assert.equal("departments" in view, false);
  assert.equal("agents" in view, false);
  assert.equal("workflows" in view, false);
  assert.equal("queued" in view, false);
  assert.equal("running" in view, false);
  return view;
}

function collectKeys(input: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(input)) {
    for (const item of input) collectKeys(item, keys);
  } else if (input !== null && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      keys.add(key);
      collectKeys(value, keys);
    }
  }
  return keys;
}

test("exports the canonical workspace and project scope kinds", () => {
  assert.deepEqual(projectOperationsScopeKinds, ["workspace", "project"]);
});

test("uses exactly the two AI-014 demo projects", () => {
  const demo = createProjectOperationsDemo();
  assert.equal(demo.registryInput.projects.length, 2);
});

test("project names and IDs match createProjectControlCenterDemo", () => {
  const source = createProjectControlCenterDemo().projects.map((project) => ({
    id: project.manifest.id,
    name: project.manifest.name,
  }));
  const actual = createProjectOperationsDemo().registryInput.projects.map((project) => ({
    id: project.projectManifest.id,
    name: project.projectManifest.name,
  }));
  assert.deepEqual(actual, source);
});

test("both Operations ProjectManifests pass the real AI-013 validator", () => {
  for (const project of createProjectOperationsDemo().registryInput.projects) {
    assert.equal(validateAndNormalizeProjectManifest(project.projectManifest).ok, true);
  }
});

test("every DepartmentManifest passes the real AI-015 structural validator", () => {
  for (const project of createProjectOperationsDemo().registryInput.projects) {
    for (const department of project.departmentManifests) {
      assert.equal(validateAndNormalizeDepartmentManifest(department).ok, true);
    }
  }
});

test("every DepartmentManifest is allowed through its real ProjectManifest", () => {
  for (const project of createProjectOperationsDemo().registryInput.projects) {
    for (const department of project.departmentManifests) {
      assert.equal(
        evaluateDepartmentManifest({
          projectManifest: project.projectManifest,
          departmentManifest: department,
        }).verdict,
        "allow",
      );
    }
  }
});

test("every workflow binding points to an enabled Department workflow", () => {
  for (const project of createProjectOperationsDemo().registryInput.projects) {
    for (const binding of project.bindings.filter((candidate) => candidate.kind === "workflow")) {
      const department = project.departmentManifests.find(
        (candidate) => candidate.id === binding.departmentId,
      );
      assert.ok(department);
      assert.ok(department.enabledWorkflowIds.includes(binding.subjectId));
    }
  }
});

test("all agent and workflow bindings resolve through the real AI-016 API", () => {
  const demo = createProjectOperationsDemo();
  assert.equal(demo.bindingResolutions.length, 4);
  for (const resolution of demo.bindingResolutions) {
    assert.equal(resolution.decision.verdict, "allow");
    assert.notEqual(resolution.decision.snapshot, null);
  }
});

test("the real AI-016 Workspace Registry verdict is allow", () => {
  assert.equal(createProjectOperationsDemo().registryDecision.verdict, "allow");
});

test("the real AI-016 normalized Registry is present", () => {
  assert.notEqual(createProjectOperationsDemo().registryDecision.normalizedRegistry, null);
});

test("the stored Registry decision equals a repeated real evaluation", () => {
  const demo = createProjectOperationsDemo();
  assert.deepEqual(
    demo.registryDecision,
    evaluateWorkspaceProjectContexts(demo.registryInput),
  );
});

test("the real AI-017 dispatch verdict is allow", () => {
  assert.equal(createProjectOperationsDemo().schedulerDecision.verdict, "allow");
});

test("the real AI-017 dispatch plan is present", () => {
  assert.notEqual(createProjectOperationsDemo().schedulerDecision.plan, null);
});

test("the stored scheduler decision equals a repeated full AI-017 evaluation", () => {
  const demo = createProjectOperationsDemo();
  assert.deepEqual(
    demo.schedulerDecision,
    buildMultiProjectRunDispatchPlan(demo.schedulerInput),
  );
});

test("scheduler input uses the exact full Registry object", () => {
  const demo = createProjectOperationsDemo();
  assert.strictEqual(demo.schedulerInput.registry, demo.registryInput);
  assert.equal(demo.schedulerInput.registry.projects.length, 2);
});

test("the shared queue contains requests from both projects", () => {
  assert.deepEqual(projectIds(createProjectOperationsDemo().schedulerInput.queuedRequests), [
    "private-ai-cloud",
    "smart-algorithms",
  ]);
});

test("the shared state contains at least one running run", () => {
  assert.ok(createProjectOperationsDemo().schedulerInput.runningRuns.length >= 1);
});

test("queued requests use multiple priorities", () => {
  const priorities = new Set(
    createProjectOperationsDemo().schedulerInput.queuedRequests.map(
      (request) => request.priority,
    ),
  );
  assert.ok(priorities.size >= 2);
});

test("the factual plan contains at least one planned dispatch", () => {
  const plan = createProjectOperationsDemo().schedulerDecision.plan;
  assert.ok(plan && plan.dispatches.length >= 1);
});

test("the factual plan contains at least one retained blocked request", () => {
  const plan = createProjectOperationsDemo().schedulerDecision.plan;
  assert.ok(plan && plan.retainedRequestIds.length >= 1);
  assert.ok(plan && plan.blockedRequests.length >= 1);
});

test("blocked rows preserve the exact factual AI-017 reason codes and paths", () => {
  const demo = createProjectOperationsDemo();
  const view = availableView(demo);
  const actual = view.blocked.flatMap((row) =>
    row.reasons.map((reason) => ({ code: reason.code, path: reason.path })),
  );
  const expected = demo.schedulerDecision.plan?.blockedRequests.flatMap((row) =>
    row.reasons.map((reason) => ({ code: reason.code, path: reason.path })),
  );
  assert.deepEqual(actual, expected);
});

test("a blocked Private AI Cloud request does not prevent Smart Algorithms dispatch", () => {
  const view = availableView();
  assert.ok(view.blocked.some((row) => row.projectId === "private-ai-cloud"));
  assert.ok(view.dispatches.some((row) => row.projectId === "smart-algorithms"));
});

test("running rows come only from runningRuns and are never queued as running", () => {
  const demo = createProjectOperationsDemo();
  const view = availableView(demo);
  assert.deepEqual(
    view.running.map((row) => row.runId),
    demo.schedulerInput.runningRuns.map((run) => run.runId),
  );
  assert.deepEqual(
    [...new Set(view.queued.map((row) => row.factualStatus))].sort(),
    ["blocked", "planned"],
  );
});

test("workspace view contains both projects", () => {
  assert.deepEqual(projectIds(availableView().projects), [
    "private-ai-cloud",
    "smart-algorithms",
  ]);
});

test("Private AI Cloud view contains no Smart Algorithms entity", () => {
  assertOnlyProject(
    availableView(createProjectOperationsDemo(), {
      kind: "project",
      projectId: "private-ai-cloud",
    }),
    "private-ai-cloud",
  );
});

test("Smart Algorithms view contains no Private AI Cloud entity", () => {
  assertOnlyProject(
    availableView(createProjectOperationsDemo(), {
      kind: "project",
      projectId: "smart-algorithms",
    }),
    "smart-algorithms",
  );
});

test("Department filtering is exact for each project", () => {
  const privateView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "private-ai-cloud",
  });
  const smartView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "smart-algorithms",
  });
  assert.deepEqual(privateView.departments.map((row) => row.departmentId), [
    "pac-development",
    "pac-qa-review",
  ]);
  assert.deepEqual(smartView.departments.map((row) => row.departmentId), [
    "sa-marketing",
    "sa-product",
  ]);
});

test("Agent filtering is exact for each project", () => {
  const privateView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "private-ai-cloud",
  });
  const smartView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "smart-algorithms",
  });
  assert.deepEqual(privateView.agents.map((row) => row.bindingId), ["pac-qa-agent"]);
  assert.deepEqual(smartView.agents.map((row) => row.bindingId), ["sa-product-agent"]);
});

test("Workflow filtering is exact for each project", () => {
  const privateView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "private-ai-cloud",
  });
  const smartView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "smart-algorithms",
  });
  assert.deepEqual(privateView.workflows.map((row) => row.bindingId), ["pac-dev-workflow"]);
  assert.deepEqual(smartView.workflows.map((row) => row.bindingId), ["sa-marketing-workflow"]);
});

test("queue filtering is exact for each project", () => {
  const workspace = availableView();
  for (const project of workspace.projects) {
    const scoped = availableView(createProjectOperationsDemo(), {
      kind: "project",
      projectId: project.projectId,
    });
    assert.deepEqual(
      scoped.queued.map((row) => row.requestId),
      workspace.queued
        .filter((row) => row.projectId === project.projectId)
        .map((row) => row.requestId),
    );
  }
});

test("running filtering is exact for each project", () => {
  const workspace = availableView();
  const privateView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "private-ai-cloud",
  });
  const smartView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "smart-algorithms",
  });
  assert.deepEqual(privateView.running, workspace.running);
  assert.deepEqual(smartView.running, []);
});

test("dispatch filtering is exact for each project", () => {
  const workspace = availableView();
  for (const project of workspace.projects) {
    const scoped = availableView(createProjectOperationsDemo(), {
      kind: "project",
      projectId: project.projectId,
    });
    assert.deepEqual(
      scoped.dispatches.map((row) => row.requestId),
      workspace.dispatches
        .filter((row) => row.projectId === project.projectId)
        .map((row) => row.requestId),
    );
  }
});

test("blocked filtering is exact for each project", () => {
  const workspace = availableView();
  const privateView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "private-ai-cloud",
  });
  const smartView = availableView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "smart-algorithms",
  });
  assert.deepEqual(privateView.blocked, workspace.blocked);
  assert.deepEqual(smartView.blocked, []);
});

test("unknown projectId returns unavailable without fallback project data", () => {
  const view = createProjectOperationsView(createProjectOperationsDemo(), {
    kind: "project",
    projectId: "unknown-project",
  });
  assert.equal(view.available, false);
  if (view.available) throw new Error("Expected unavailable view");
  assert.equal(view.title, "Контекст проекта недоступен");
  assert.equal(view.reasons[0]?.projectId, "unknown-project");
  assert.equal("projects" in view, false);
});

test("every presentation entity carries projectId", () => {
  const view = availableView();
  const collections = [
    view.projects,
    view.departments,
    view.agents,
    view.workflows,
    view.queued,
    view.running,
    view.dispatches,
    view.blocked,
  ];
  for (const collection of collections) {
    assert.ok(collection.every((row) => typeof row.projectId === "string"));
  }
});

test("workspace summary counts are computed from factual collections", () => {
  const view = availableView();
  assert.deepEqual(
    {
      projects: view.summary.projects,
      queued: view.summary.queued,
      running: view.summary.running,
      planned: view.summary.planned,
      blocked: view.summary.blocked,
    },
    {
      projects: view.projects.length,
      queued: view.queued.length,
      running: view.running.length,
      planned: view.dispatches.length,
      blocked: view.blocked.length,
    },
  );
});

test("sum of project counters equals workspace counters", () => {
  const view = availableView();
  assert.equal(view.projects.reduce((sum, row) => sum + row.queuedCount, 0), view.summary.queued);
  assert.equal(view.projects.reduce((sum, row) => sum + row.runningCount, 0), view.summary.running);
  assert.equal(view.projects.reduce((sum, row) => sum + row.plannedCount, 0), view.summary.planned);
  assert.equal(view.projects.reduce((sum, row) => sum + row.blockedCount, 0), view.summary.blocked);
});

test("one Model Profile ID is validly shared by both projects", () => {
  const demo = createProjectOperationsDemo();
  for (const projectId of ["private-ai-cloud", "smart-algorithms"]) {
    assert.ok(
      projectContext(demo, projectId).projectManifest.allowedModelProfileIds.includes(
        "model-codex-openai",
      ),
    );
  }
});

test("project resources and Knowledge Collections do not cross project boundaries", () => {
  const demo = createProjectOperationsDemo();
  const [privateContext, smartContext] = demo.registryInput.projects;
  assert.ok(privateContext && smartContext);
  const privateResources = new Set(
    privateContext.projectManifest.resources.map(
      (resource) => `${resource.kind}:${resource.resourceRef}`,
    ),
  );
  assert.ok(
    smartContext.projectManifest.resources.every(
      (resource) => !privateResources.has(`${resource.kind}:${resource.resourceRef}`),
    ),
  );
  const privateKnowledge = new Set(privateContext.projectManifest.knowledgeCollectionIds);
  assert.ok(
    smartContext.projectManifest.knowledgeCollectionIds.every(
      (collection) => !privateKnowledge.has(collection),
    ),
  );
});

test("AI-017 input contains no UI-selected project control field", () => {
  const forbidden = new Set([
    "selectedProjectId",
    "activeProjectId",
    "currentProjectId",
  ]);
  const keys = collectKeys(createProjectOperationsDemo().schedulerInput);
  for (const field of forbidden) assert.equal(keys.has(field), false, field);
});

test("changing UI scope leaves the full scheduler decision unchanged", () => {
  const demo = createProjectOperationsDemo();
  const before = structuredClone(demo.schedulerDecision);
  createProjectOperationsView(demo, { kind: "workspace" });
  createProjectOperationsView(demo, { kind: "project", projectId: "private-ai-cloud" });
  createProjectOperationsView(demo, { kind: "project", projectId: "smart-algorithms" });
  assert.deepEqual(demo.schedulerDecision, before);
});

test("replacing scheduler Registry while keeping stale decisions fails closed", () => {
  const demo = createProjectOperationsDemo();
  const invalidSubsetRegistry = {
    workspaceId: demo.workspaceId,
    projects: [],
  } as unknown as Demo["schedulerInput"]["registry"];
  const projectedDemo: Demo = {
    ...demo,
    schedulerInput: {
      ...demo.schedulerInput,
      registry: invalidSubsetRegistry,
    },
  };
  assertProjectionUnavailable(projectedDemo);
});

test("queued projectId, bindingId, or modelProfileId mutation with stable requestId fails closed", () => {
  const demo = createProjectOperationsDemo();
  const original = demo.schedulerInput.queuedRequests[0];
  assert.ok(original);
  const replacements = [
    { ...original, projectId: "smart-algorithms" },
    { ...original, bindingId: "sa-marketing-workflow" },
    { ...original, modelProfileId: "model-qwen-reviewer" },
  ];
  for (const replacement of replacements) {
    assertProjectionUnavailable({
      ...demo,
      schedulerInput: {
        ...demo.schedulerInput,
        queuedRequests: [replacement, ...demo.schedulerInput.queuedRequests.slice(1)],
      },
    });
  }
});

test("queued priority or sequence mutation with stable requestId fails closed", () => {
  const demo = createProjectOperationsDemo();
  const original = demo.schedulerInput.queuedRequests[0];
  assert.ok(original);
  for (const replacement of [
    { ...original, priority: "P4" as const },
    { ...original, sequence: original.sequence + 100 },
  ]) {
    assertProjectionUnavailable({
      ...demo,
      schedulerInput: {
        ...demo.schedulerInput,
        queuedRequests: [replacement, ...demo.schedulerInput.queuedRequests.slice(1)],
      },
    });
  }
});

test("running run payload mutation fails closed", () => {
  const demo = createProjectOperationsDemo();
  const original = demo.schedulerInput.runningRuns[0];
  assert.ok(original);
  assertProjectionUnavailable({
    ...demo,
    schedulerInput: {
      ...demo.schedulerInput,
      runningRuns: [{ ...original, bindingId: "pac-dev-workflow" }],
    },
  });
});

test("Registry, scheduler policy, or cursor mutation fails closed", () => {
  const demo = createProjectOperationsDemo();
  const mutations: Demo[] = [
    {
      ...demo,
      registryInput: { ...demo.registryInput, workspaceId: "changed-workspace" },
    },
    {
      ...demo,
      schedulerInput: {
        ...demo.schedulerInput,
        policy: { ...demo.schedulerInput.policy, maxQueuedRuns: 7 },
      },
    },
    {
      ...demo,
      schedulerInput: {
        ...demo.schedulerInput,
        lastDispatchedProjectId: null,
      },
    },
  ];
  for (const mutation of mutations) assertProjectionUnavailable(mutation);
});

test("replacing schedulerDecision or registryDecision fails closed", () => {
  const demo = createProjectOperationsDemo();
  const otherSchedulerDecision = buildMultiProjectRunDispatchPlan({
    ...demo.schedulerInput,
    queuedRequests: demo.schedulerInput.queuedRequests.slice(0, 2),
  });
  const otherRegistryDecision = evaluateWorkspaceProjectContexts({
    ...demo.registryInput,
    projects: demo.registryInput.projects.slice(0, 1),
  });
  assertProjectionUnavailable({ ...demo, schedulerDecision: otherSchedulerDecision });
  assertProjectionUnavailable({ ...demo, registryDecision: otherRegistryDecision });
});

test("one requestId has one projectId and bindingId across queue, dispatch, and blocked rows", () => {
  const view = availableView();
  for (const queued of view.queued) {
    const related = [
      queued,
      ...view.dispatches.filter((row) => row.requestId === queued.requestId),
      ...view.blocked.filter((row) => row.requestId === queued.requestId),
    ];
    assert.deepEqual(
      [...new Set(related.map((row) => `${row.projectId}:${row.bindingId}`))],
      [`${queued.projectId}:${queued.bindingId}`],
    );
  }
});

test("canonical snapshot is immutable, coherent, and deterministic", () => {
  const first = createProjectOperationsDemo();
  const second = createProjectOperationsDemo();
  assert.equal(first.projectionSnapshot.state, "available");
  assert.equal(Object.isFrozen(first.projectionSnapshot), true);
  if (first.projectionSnapshot.state !== "available") throw new Error("Expected snapshot");
  assert.equal(Object.isFrozen(first.projectionSnapshot.queued), true);
  assert.equal(Object.isFrozen(first.projectionSnapshot.queued[0]), true);
  assert.deepEqual(first.projectionSnapshot, second.projectionSnapshot);
  assert.equal(availableView(first).available, true);
});

test("replacing canonical snapshot presentation payload fails closed", () => {
  const demo = createProjectOperationsDemo();
  assert.equal(demo.projectionSnapshot.state, "available");
  if (demo.projectionSnapshot.state !== "available") throw new Error("Expected snapshot");
  const first = demo.projectionSnapshot.queued[0];
  assert.ok(first);
  assertProjectionUnavailable({
    ...demo,
    projectionSnapshot: {
      ...demo.projectionSnapshot,
      queued: [{ ...first, projectId: "smart-algorithms" }, ...demo.projectionSnapshot.queued.slice(1)],
    },
  });
});

test("workspace and project scope preserve one canonical snapshot without subset scheduling", () => {
  const demo = createProjectOperationsDemo();
  const snapshot = demo.projectionSnapshot;
  const schedulerDecision = structuredClone(demo.schedulerDecision);
  assert.equal(createProjectOperationsView(demo, { kind: "workspace" }).available, true);
  assert.equal(
    createProjectOperationsView(demo, {
      kind: "project",
      projectId: "private-ai-cloud",
    }).available,
    true,
  );
  assert.strictEqual(demo.projectionSnapshot, snapshot);
  assert.deepEqual(demo.schedulerDecision, schedulerDecision);
  assert.equal(demo.schedulerInput.registry.projects.length, 2);
});

test("totals label follows workspace versus project scope", () => {
  const demo = createProjectOperationsDemo();
  assert.equal(availableView(demo, { kind: "workspace" }).totalsLabel, "Workspace totals");
  assert.equal(
    availableView(demo, { kind: "project", projectId: "private-ai-cloud" }).totalsLabel,
    "Project totals",
  );
});

test("queued factual statuses are derived only from dispatches and blockedRequests", () => {
  const demo = createProjectOperationsDemo();
  const view = availableView(demo);
  const dispatched = new Set(
    demo.schedulerDecision.plan?.dispatches.map((item) => item.request.id),
  );
  const blocked = new Set(
    demo.schedulerDecision.plan?.blockedRequests.map((item) => item.requestId),
  );
  for (const row of view.queued) {
    assert.equal(row.factualStatus, dispatched.has(row.requestId) ? "planned" : "blocked");
    assert.equal(blocked.has(row.requestId), row.factualStatus === "blocked");
  }
});

test("demo factory is deterministic", () => {
  assert.deepEqual(createProjectOperationsDemo(), createProjectOperationsDemo());
});

test("demo factory returns fresh arrays and nested objects", () => {
  const first = createProjectOperationsDemo();
  const second = createProjectOperationsDemo();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.registryInput, second.registryInput);
  assert.notStrictEqual(first.registryInput.projects, second.registryInput.projects);
  assert.notStrictEqual(
    first.registryInput.projects[0]?.projectManifest,
    second.registryInput.projects[0]?.projectManifest,
  );
  assert.notStrictEqual(first.schedulerInput.queuedRequests, second.schedulerInput.queuedRequests);
  assert.notStrictEqual(first.schedulerDecision.plan, second.schedulerDecision.plan);
});

test("repeated projections are deterministic and deeply fresh", () => {
  const demo = createProjectOperationsDemo();
  const first = availableView(demo);
  const second = availableView(demo);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.projects, second.projects);
  assert.notStrictEqual(first.projects[0], second.projects[0]);
  assert.notStrictEqual(first.blocked[0]?.reasons, second.blocked[0]?.reasons);
});

test("projection does not mutate demo inputs or decisions", () => {
  const demo = createProjectOperationsDemo();
  const before = structuredClone(demo);
  createProjectOperationsView(demo, { kind: "project", projectId: "private-ai-cloud" });
  assert.deepEqual(demo, before);
});

test("presentation projection excludes raw manifests, references, connections, and credentials", () => {
  const keys = collectKeys(availableView());
  for (const forbidden of [
    "projectManifest",
    "manifest",
    "resourceRef",
    "connectionId",
    "credentials",
    "credential",
    "secret",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});

test("replacing the canonical AI-016 decision produces projection deny without partial view", () => {
  const demo = createProjectOperationsDemo();
  const denied = evaluateWorkspaceProjectContexts({
    workspaceId: demo.workspaceId,
    projects: [],
  });
  assert.equal(denied.verdict, "deny");
  const view = createProjectOperationsView(
    { ...demo, registryDecision: denied },
    { kind: "workspace" },
  );
  assert.equal(view.available, false);
  if (view.available) throw new Error("Expected unavailable view");
  assert.ok(view.reasons.every((reason) => reason.source === "projection"));
  assert.equal("summary" in view, false);
});

test("replacing the canonical AI-017 decision produces projection deny without partial view", () => {
  const demo = createProjectOperationsDemo();
  const denied = buildMultiProjectRunDispatchPlan({
    ...demo.schedulerInput,
    queuedRequests: [{}],
  });
  assert.equal(denied.verdict, "deny");
  const view = createProjectOperationsView(
    { ...demo, schedulerDecision: denied },
    { kind: "workspace" },
  );
  assert.equal(view.available, false);
  if (view.available) throw new Error("Expected unavailable view");
  assert.ok(view.reasons.every((reason) => reason.source === "projection"));
  assert.equal("summary" in view, false);
});

test("demo and projection expose configuration only, with no runtime or persistence actions", () => {
  const keys = collectKeys({
    demo: createProjectOperationsDemo().schedulerInput,
    view: availableView(),
  });
  for (const forbidden of [
    "execute",
    "send",
    "publish",
    "deploy",
    "persist",
    "database",
    "localStorage",
    "cookie",
    "network",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});
