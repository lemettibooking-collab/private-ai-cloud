import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionIntent } from "./ai044-subscription-approval.mts";
export async function runSubscriptionMutationCase(id: string) {
  if (id === "M4") {
    const api = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
    const input = { ...subscriptionIntent() } as Record<string, unknown>; delete input.preflight;
    assert.equal(api.normalizeSubscriptionIntent(input), null, "omitted external-settings preflight must not be fabricated");
    return;
  }
  if (id === "M14") {
    const source = await readFile(new URL("../../lib/composition/development-executor.server.ts", import.meta.url), "utf8");
    const loaded = { exports: {} as Record<string, (...args: unknown[]) => { invoke(): { verdict: string }; realDispatch: string }> };
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(js, { exports: loaded.exports, require(name: string) {
      if (name === "server-only") return {};
      if (name.includes("executor-start-boundary")) return { createExecutorStartBoundary: () => ({ validateInvocation: () => ({ normalizedInvocation: null }) }) };
      if (name.includes("openai-agents-executor")) return { createOpenAIAgentsTransport: () => ({ prepare() { assert.fail("global facade may not prepare provider dispatch"); } }) };
      throw Error("unexpected isolated composition dependency");
    } });
    const facade = loaded.exports.createDevelopmentExecutorComposition({}, {}, {});
    assert.equal(facade.realDispatch, "blocked");
    assert.equal(facade.invoke().verdict, "deny", "the existing global production execution path must remain locked");
    return;
  }
  assert.fail("unknown behavioral mutation case");
}
