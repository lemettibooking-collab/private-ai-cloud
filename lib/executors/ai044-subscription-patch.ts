import { types } from "node:util";
import type { ExecutorChange, ExecutorReport } from "../contracts/executor-adapter";
import type { AI044SubscriptionContext } from "./ai044-subscription-context";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorAdapterLimits } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isAI044SubscriptionContext } from "./ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAI044AdmittedUnifiedPatch } from "./ai044-artifact-recovery.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044SafeText, captureAI044Data, ai044Sha256, freezeAI044 } from "./ai044-proof-binding.ts";

export type AI044SubscriptionPatchProposal = Readonly<{
  patch: string; patchSha256: string; contextFingerprint: string; changedPaths: readonly string[]; addedLines: number; removedLines: number;
  changes: readonly ExecutorChange[]; report: ExecutorReport; ownerDecisionRequired: true; verificationStatus: "not_run"; automaticRetryAllowed: false;
}>;
const invalid = (): never => { throw Error("subscription_patch_unavailable"); };
const deny = () => freezeAI044({ verdict: "deny" as const, reasons: [{ code: "invalid_subscription_patch", path: "proposal" }], proposal: null });
/** Pure exact-baseline application in memory only. No Git apply, filesystem writes, fuzzy matching or QA claims. */
export function validateAI044SubscriptionPatch(contextInput: unknown, raw: unknown) {
  try {
    if (!isAI044SubscriptionContext(contextInput) || !raw || typeof raw !== "object" || types.isProxy(raw)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
    const fields = ["patch", "changedPaths", "summary"], keys = Reflect.ownKeys(raw as object);
    if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) invalid();
    const values: Record<string, unknown> = {};
    for (const key of fields) { const d = Object.getOwnPropertyDescriptor(raw, key); if (!d || !("value" in d) || !d.enumerable) invalid(); values[key] = d!.value; }
    const context = contextInput as AI044SubscriptionContext;
    const patch = validateAI044AdmittedUnifiedPatch(values.patch, context.binding.allowedWritePaths), paths = captureAI044Data(values.changedPaths);
    if (!patch || !Array.isArray(paths) || new Set(paths).size !== paths.length || paths.length !== patch.changedPaths.length
      || [...paths].sort().some((path, index) => path !== patch.changedPaths[index])
      || !ai044SafeText(values.summary, 4096) || !(values.summary as string).trim()
      || /(?:\b(?:all\s+)?(?:tests?|checks?|verification|security|qa)\s+(?:have\s+)?(?:passed|succeeded)|\b(?:verified|approved)\s+by\s+(?:qa|security))/iu.test(values.summary as string)) invalid();
    const changes: ExecutorChange[] = patch!.files.map((file): ExecutorChange => {
      const base = context.files.find(item => item.path === file.path);
      if (!base || (file.operation === "add" ? base.kind !== "absent" : base.kind !== "blob")
        || (base.kind === "blob" && base.text.length > 0 && !base.text.endsWith("\n"))) invalid();
      const original = base!.text ?? "", lines = original.length ? original.slice(0, -1).split("\n") : [];
      const output: string[] = []; let cursor = 0;
      for (const hunk of file.hunks) {
        const oldIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
        const newIndex = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
        if (oldIndex < cursor || oldIndex > lines.length) invalid();
        output.push(...lines.slice(cursor, oldIndex)); cursor = oldIndex;
        if (output.length !== newIndex) invalid();
        for (const line of hunk.lines) {
          // This initial profile admits LF text only. Unsupported newline shape is denied, never repaired.
          if (line === "\\ No newline at end of file") invalid();
          const prefix = line[0], text = line.slice(1);
          if (prefix === " " || prefix === "-") { if (cursor >= lines.length || lines[cursor] !== text) invalid(); cursor++; }
          if (prefix === " " || prefix === "+") output.push(text);
        }
      }
      output.push(...lines.slice(cursor));
      const content = output.length ? `${output.join("\n")}\n` : "";
      if (file.operation === "delete") { if (content !== "") invalid(); return { path: file.path, operation: "delete", content: null, sha256: null }; }
      if (Buffer.byteLength(content) > executorAdapterLimits.maxContentBytes || (content.length && !ai044SafeText(content, executorAdapterLimits.maxContentBytes))) invalid();
      return { path: file.path, operation: file.operation, content, sha256: ai044Sha256(content) };
    }).sort((a, b) => a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
    const summary = values.summary as string;
    const proposal: AI044SubscriptionPatchProposal = { patch: patch!.patch, patchSha256: ai044Sha256(patch!.patch), contextFingerprint: context.fingerprint,
      changedPaths: [...patch!.changedPaths], addedLines: patch!.addedLines, removedLines: patch!.removedLines, changes,
      report: { content: summary, sha256: ai044Sha256(summary) }, ownerDecisionRequired: true, verificationStatus: "not_run", automaticRetryAllowed: false };
    return freezeAI044({ verdict: "allow" as const, reasons: [], proposal });
  } catch { return deny(); }
}
