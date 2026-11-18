// Behavioral mutation infrastructure only. Mutated files exist solely inside disposable /tmp copies;
// the working tree is never edited, and no provider or credential-bearing environment is inherited.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
type Mutation = Readonly<{ id: string; target: string; from: string; to: string; testFile?: string; pattern?: string; custom?: boolean }>;
const intent = "lib/executors/ai044-subscription-intent.ts", executor = "lib/executors/chatgpt-plan-patch-executor.ts";
const approval = "lib/db/ai044-subscription-approvals.ts", run = "lib/composition/ai044-subscription-run.ts";
const replayPost = `await transport(chatGPTPlanResponsesEndpoint, { method: "POST", headers: { authorization: \`Bearer \${token}\`, "content-type": "application/json", accept: "text/event-stream" }, body: p.body, redirect: "error", credentials: "omit", cache: "no-store", signal: abort.signal });`;
export const subscriptionUnitMutations: readonly Mutation[] = [
  { id: "M16", target: "lib/executors/ai044-subscription-patch.ts", from: 'context.binding.allowedWritePaths', to: 'context.orderedPaths', testFile: "tests/ai044-subscription-patch.test.mts", pattern: "read-only reference cannot be patched" },
  { id: "M17", target: "lib/executors/ai044-subscription-context.ts", from: 'if (ai044Fingerprint(orderedPaths) !== ai044Fingerprint(binding.readContextPaths)) invalid();', to: '/* mutant: arbitrary repository context read */', testFile: "tests/ai044-subscription-context.test.mts", pattern: "arbitrary path outside exact read set" },
  { id: "M1", target: "lib/integrations/chatgpt/chatgpt-connection.ts", from: 'active.status === "plan_usage_missing" || !active.grantedScopes.includes(chatgptOAuth.planScope)', to: 'active.status === "plan_usage_missing"', testFile: "tests/chatgpt-subscription-connection.test.mts", pattern: "active credentials without direct grant" },
  { id: "M2", target: intent, from: 'i.accessMode !== "subscription_session"', to: '!["subscription_session", "api_key"].includes(i.accessMode as string)', testFile: "tests/ai044-subscription-approvals.test.mts", pattern: "fails closed: api$" },
  { id: "M3", target: intent, from: 'p.creditsEnabled !== false || ', to: '', testFile: "tests/ai044-subscription-approvals.test.mts", pattern: "fails closed: credits$" },
  { id: "M4", target: intent, from: 'const i = exactAI044Record(captureAI044Data(raw),', to: 'const object = raw as Record<string, unknown>; const i = exactAI044Record(captureAI044Data({ ...object, preflight: object.preflight ?? { receiptId: "fabricated", observedAt: 1000, expiresAt: 61000, appLimitPercent: 50, creditsEnabled: false, automaticPurchaseReliedUpon: false, registrationFingerprint: subscriptionRegistrationFingerprint(object.registration as SubscriptionRegistration) } }),', custom: true },
  { id: "M5", target: intent, from: 'p.appLimitPercent >= 100', to: 'p.appLimitPercent > 100', testFile: "tests/ai044-subscription-approvals.test.mts", pattern: "fails closed: limit-100$" },
  { id: "M9", target: executor, from: 'context.fingerprint !== intent.contextFingerprint || ', to: '', testFile: "tests/chatgpt-plan-patch-executor.test.mts", pattern: "each changed factual binding" },
  { id: "M10", target: "lib/executors/ai044-subscription-context.ts", from: 'contexts.has(value)', to: 'true', testFile: "tests/chatgpt-plan-patch-executor.test.mts", pattern: "rejects copied context" },
  { id: "M12", target: "lib/executors/chatgpt-plan-response.ts", from: 'terminal = evidence("failed", "incomplete", id);', to: 'terminal = evidence("completed", "completed", id, JSON.parse((r.output as { content: { text: string }[] }[])[0].content[0].text));', testFile: "tests/chatgpt-plan-response.test.mts", pattern: "response.incomplete is factual" },
  { id: "M14", target: "lib/composition/development-executor.server.ts", from: 'verdict: "deny" as const, reason: "durable_executor_fence_required"', to: 'verdict: "allow" as const, reason: "durable_executor_fence_required"', custom: true },
];
export const subscriptionPgMutations: readonly Mutation[] = [
  { id: "M15", target: executor, from: '], store: false, stream: true });', to: '], store: false, stream: true, max_output_tokens: 32768 });', testFile: "tests/pg/ai044-subscription-run.test.mts", pattern: "SIWC preview request" },
  { id: "M6", target: approval, from: 'fact(subscriptionIntentCurrent(i, await now(client))); return a!;', to: 'void await now(client); return a!;', testFile: "tests/pg/ai044-subscription-approvals.test.mts", pattern: "stale one-shot approval" },
  { id: "M7", target: approval, from: 'if (b.state !== "ready") return deny("recovery_required");', to: '/* mutant: reuse consumed approval */', testFile: "tests/pg/ai044-subscription-approvals.test.mts", pattern: "consumed approval replay" },
  { id: "M8", target: run, from: 'const consumed = await approvals.consume({ approvalRequestId: r.approvalRequestId, intent: p.intent });', to: 'await Reflect.apply(withAccess!, undefined, [{ registration: p.intent.registration, ownerUserId: p.ownerUserId, domainWorkspaceId: p.intent.workspaceId, modelId: p.intent.model }, async () => ({ pending: Promise.resolve(null) })]); const consumed = await approvals.consume({ approvalRequestId: r.approvalRequestId, intent: p.intent });', testFile: "tests/pg/ai044-subscription-run.test.mts", pattern: "all final gates precede" },
  { id: "M11", target: executor, from: 'if (evidence.state === "outcome_unknown") return deny(evidence.code, "outcome_unknown");', to: `if (evidence.state === "outcome_unknown") { ${replayPost} return deny(evidence.code, "outcome_unknown"); }`, testFile: "tests/pg/ai044-subscription-run.test.mts", pattern: "PhaseS ambiguous persists" },
  { id: "M13", target: executor, from: 'const evidence = await readSubscriptionResponse(response, p.intent.model, abort.signal);', to: `const evidence = await readSubscriptionResponse(response, p.intent.model, abort.signal); if (evidence.code === "usage_limit_exceeded") { ${replayPost} }`, testFile: "tests/pg/ai044-subscription-run.test.mts", pattern: "PhaseS limit persists" },
];

async function child(directory: string, mutation: Mutation) {
  const args = mutation.custom ? ["--input-type=module", "-e", `const m = await import('./tests/fixtures/ai044-subscription-mutation-case.mts'); await m.runSubscriptionMutationCase(${JSON.stringify(mutation.id)});`]
    : ["--test", "--test-reporter=tap", `--test-name-pattern=${mutation.pattern}`, mutation.testFile!];
  // Deliberately omit DATABASE_URL, OPENAI_API_KEY, OAuth/session material and all ambient provider env.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test", NODE_NO_WARNINGS: "1" };
  if (mutation.testFile?.includes("/pg/")) { env.LIVE_PG_TESTS = process.env.LIVE_PG_TESTS; env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL; }
  return new Promise<{ status: number | null; output: string; timeout: boolean }>((resolve) => {
    const process = spawn(globalThis.process.execPath, args, { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", timeout = false;
    const timer = setTimeout(() => { timeout = true; process.kill("SIGKILL"); }, 120_000);
    process.stdout.on("data", bytes => { output += bytes.toString(); }); process.stderr.on("data", bytes => { output += bytes.toString(); });
    process.on("close", status => { clearTimeout(timer); resolve({ status, output, timeout }); });
    process.on("error", () => { clearTimeout(timer); resolve({ status: null, output: "isolated child unavailable", timeout: false }); });
  });
}
export async function killSubscriptionMutation(mutation: Mutation) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), `pac-ai044-${mutation.id}-`));
  try {
    await Promise.all(["lib", "tests", "db"].map(path => cp(join(root, path), join(directory, path), { recursive: true })));
    await copyFile(join(root, "package.json"), join(directory, "package.json"));
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    const baseline = await child(directory, mutation);
    assert.equal(baseline.timeout, false, `${mutation.id} baseline must not time out`);
    assert.equal(baseline.status, 0, `${mutation.id} unchanged behavioral control failed: ${baseline.output}`);
    const target = join(directory, mutation.target), source = await readFile(target, "utf8");
    assert.equal(source.split(mutation.from).length - 1, 1, `${mutation.id} must change exactly one intended security guard`);
    await writeFile(target, source.replace(mutation.from, mutation.to));
    const mutated = await child(directory, mutation);
    assert.equal(mutated.timeout, false, `${mutation.id} mutant must fail a behavioral assertion, not hang`);
    assert.equal(mutated.status, 1, `${mutation.id} survived: ${mutated.output}`);
    assert.match(mutated.output, /ERR_ASSERTION|AssertionError/u, `${mutation.id} must be killed by an executed assertion, not import/parse/runtime infrastructure failure: ${mutated.output}`);
    assert.doesNotMatch(mutated.output, /SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNKNOWN_FILE_EXTENSION/u, `${mutation.id} invalid mutant is not evidence`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
