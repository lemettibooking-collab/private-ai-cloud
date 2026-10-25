import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../../", import.meta.url);
const modules = ["lib/executors/claude-managed-request.ts", "lib/executors/claude-managed-fake-provider.ts", "lib/executors/claude-managed-protocol.ts", "lib/executors/claude-managed-executor.ts",
  "tests/fixtures/claude-managed.mts", "tests/fixtures/executor-portability.mts", "tests/claude-managed-executor.test.mts", "tests/executor-portability.test.mts", "lib/db/executor-start-store.ts", "tests/pg/executor-portability.test.mts"];
type Mutation = { name: string; test: number; pattern: string; edits: Array<[number, string, string]> };
const cases: Mutation[] = [
  { name: "M1 Claude provider omitted from correlation", test: 6, pattern: "C canonical", edits: [[0, "requestFingerprint: baseRequestFingerprint, ...target, executorIdentity: i.identity", "requestFingerprint: baseRequestFingerprint, modelId: target.modelId, accountId: target.accountId, executorIdentity: i.identity"]] },
  { name: "M2 Claude policy accepts OpenAI target", test: 6, pattern: "C canonical", edits: [[0, 'defineTrustedExecutorProviderRequestPolicy("anthropic"', 'defineTrustedExecutorProviderRequestPolicy("openai"'], [0, 'target.providerId !== "anthropic"', 'target.providerId !== "openai"'], [0, 'return { providerId: "anthropic", target, body', 'return { providerId: "openai", target, body']] },
  { name: "M3 unknown outcome fallback duplicates Create", test: 6, pattern: "C timeout holds", edits: [[3, 'e.snapshot?.state !== "start_committed"', '!e.snapshot'], [3, 'if (!c.providerCapability || !p ||', 'if (!c.providerCapability) { await b.start!.createSession(r.body); return decision(); }\n        if (!p ||']] },
  { name: "M4 known-ID read client gains mutation capability", test: 7, pattern: "D known-ID read port", edits: [[1, 'async retrieveSession(id: string) {', 'async createSession() { state.creates++; return state.script.session; },\n    async retrieveSession(id: string) {']] },
  { name: "M5 missing ID becomes retryable", test: 6, pattern: "C missing-id holds", edits: [[3, 'if (transmitted) { try { await b.store.markProviderIdentityUnknown(raw); } catch { /* full hold */ } }\n        return decision();', 'if (transmitted) { try { await b.store.markProviderIdentityUnknown(raw); } catch { /* full hold */ } }\n        return { ...decision(), automaticRetryAllowed: true };']] },
  { name: "M6 idle becomes unconditional terminal success", test: 6, pattern: "C session idle", edits: [[2, 'if (session.status !== "idle" || session.stopReason !== "end_turn" || session.quiescent !== true || session.budgetOvershoot !== false) claudeInvalid();', '']] },
  { name: "M7 conflicting duplicate silently ignored", test: 6, pattern: "C history conflicting", edits: [[2, 'if (prior !== bytes) claudeInvalid();', '']] },
  { name: "M8 configuration drift ignored", test: 6, pattern: "C session config", edits: [[2, ' || s.configurationDigest !== canonical.metadata.pac_configuration', '']] },
  { name: "M9 provider switch bypasses predecessor", test: 9, pattern: "D PG switch", edits: [[8, 'active && !await executorPredecessorsClear', 'false && !await executorPredecessorsClear']] },
  { name: "M10 common Owner/verification/retry result semantics weakened", test: 6, pattern: "C one acknowledged", edits: [[3, 'normalizedResult: result, startCapability: null', 'normalizedResult: result ? { ...result, ownerDecisionRequired: false, verificationStatus: "passed", automaticRetryAllowed: true } : null, startCapability: null']] },
];
for (const mutation of cases) test(`${mutation.name}: original GREEN, behavioral mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-portability-mutant-")); t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const map = new Map(modules.map((p, i) => [new URL(p, root).href, pathToFileURL(join(temp, `${i}.mts`)).href]));
  const relocate = (s: string, location: URL) => s.replace(/(from\s+)["'](\.[^"']+\.m?ts)["']/gu, (_m, from, p) => { const u = new URL(p, location).href; return `${from}${JSON.stringify(map.get(u) ?? u)}`; })
    .replace(/new URL\("(\.[^"]+)", import\.meta\.url\)/gu, (_m, p) => { const u = new URL(p, location).href; return `new URL(${JSON.stringify(map.get(u) ?? u)})`; });
  const original = await Promise.all(modules.map(p => readFile(new URL(p, root), "utf8")));
  async function materialize(sources: string[]) { for (const [i, p] of modules.entries()) await writeFile(new URL(map.get(new URL(p, root).href)!), relocate(sources[i], new URL(p, root))); }
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; await materialize(original);
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", mutation.pattern, join(temp, `${mutation.test}.mts`)];
  const green = await exec(process.execPath, args, { env, timeout: 90000, maxBuffer: 4e6 }); assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  const sources = [...original]; for (const [i, needle, replacement] of mutation.edits) { assert.equal(sources[i].split(needle).length, 2, "unique mutation anchor"); sources[i] = sources[i].replace(needle, replacement); }
  await materialize(sources); let output = "";
  try { await exec(process.execPath, args, { env, timeout: 90000, maxBuffer: 4e6 }); assert.fail("mutant survived"); }
  catch (error) { const e = error as Error & { code?: number; stdout?: string; stderr?: string }; assert.equal(e.code, 1); output = `${e.stdout}\n${e.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic("Original exit0; mutant exit1/ERR_ASSERTION after actual execution; no repository source mutation.");
});
