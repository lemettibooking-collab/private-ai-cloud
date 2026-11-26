import { createHash } from "node:crypto";
import { types } from "node:util";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Path, ai044Id, ai044Hash, ai044SafeText, ai044Fingerprint, captureAI044Data, exactAI044Record, freezeAI044 } from "./ai044-proof-binding.ts";

export const ai044SubscriptionContextLimits = Object.freeze({ files: 20, aggregateBytes: 1024 * 1024, fileBytes: 256 * 1024 });
export type AI044SubscriptionContextBinding = Readonly<{
  repository: Readonly<{ id: string; baseline: string }>;
  projectTaskId: string; planId: string; planRevision: number; planFingerprint: string; taskId: string;
  attempt: Readonly<{ developmentRunId: string; number: number; kind: "initial" | "corrective" }>;
  allowedWritePaths: readonly string[]; readContextPaths: readonly string[];
}>;
export type AI044SubscriptionContextFile = Readonly<{
  kind: "blob"; path: string; mode: "100644" | "100755"; blobId: string; sha256: string; byteCount: number; text: string;
}> | Readonly<{ kind: "absent"; path: string; mode: null; blobId: null; sha256: null; byteCount: 0; text: null }>;
export type AI044SubscriptionContext = Readonly<{
  binding: AI044SubscriptionContextBinding; files: readonly AI044SubscriptionContextFile[]; orderedPaths: readonly string[]; aggregateBytes: number; fingerprint: string;
}>;
export type AI044SubscriptionContextManifest = Readonly<{
  binding: AI044SubscriptionContextBinding; files: readonly Omit<AI044SubscriptionContextFile, "text">[]; orderedPaths: readonly string[]; aggregateBytes: number; fingerprint: string;
}>;
export type AI044ExactObjectRequest = Readonly<{ repositoryId: string; baseline: string; path: string }>;
export type AI044ExactObjectPort = Readonly<{ readExactObject(input: AI044ExactObjectRequest): Promise<unknown> }>;
const contexts = new WeakSet<object>();
export function isAI044SubscriptionContext(value: unknown): value is AI044SubscriptionContext { return !!value && typeof value === "object" && contexts.has(value); }
const metadata = (file: AI044SubscriptionContextFile) => ({ kind: file.kind, path: file.path, mode: file.mode, blobId: file.blobId, sha256: file.sha256, byteCount: file.byteCount });
/** Durable non-secret metadata only. This projection does not recreate private source provenance. */
export function ai044SubscriptionContextManifest(value: unknown): AI044SubscriptionContextManifest | null {
  return isAI044SubscriptionContext(value) ? freezeAI044({ binding: value.binding, files: value.files.map(metadata), orderedPaths: [...value.orderedPaths], aggregateBytes: value.aggregateBytes, fingerprint: value.fingerprint }) : null;
}
const invalid = (): never => { throw Error("subscription_context_unavailable"); };
const denied = () => freezeAI044({ verdict: "deny" as const, reasons: [{ code: "invalid_subscription_context", path: "context" }], context: null });
function own(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || types.isProxy(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
  const keys = Reflect.ownKeys(raw as object); if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of fields) { const d = Object.getOwnPropertyDescriptor(raw, key); if (!d || !("value" in d) || !d.enumerable) invalid(); copy[key] = d!.value; }
  return copy;
}
function contextPath(raw: unknown): string {
  const path = ai044Path(raw);
  if (!path || path.split("/").length > 32 || /(?:^|\/)(?:scanner|alerts|hot|events|market-?pulse|secrets?|credentials?)(?:\/|\.|$)/iu.test(path)
    || /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.netrc|\.yarnrc(?:\.yml)?)$/iu.test(path)
    || /(?:^|\/)(?:id_rsa|id_ed25519|\.ssh)(?:\/|\.|$)|\.(?:pem|p12|pfx)$/iu.test(path)) invalid();
  return path!;
}
/** Shared bounded pure guards. Importing this module never imports a physical Git reader. */
export { own as ai044SubscriptionOwnData, contextPath as ai044SubscriptionContextPath };
export function normalizeSubscriptionRepository(raw: unknown): AI044SubscriptionContextBinding["repository"] | null {
  try {
    const r = exactAI044Record(captureAI044Data(raw), ["id", "baseline"]);
    if (!ai044Id(r.id) || typeof r.baseline !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(r.baseline)) return null;
    return freezeAI044({ id: r.id, baseline: r.baseline });
  } catch { return null; }
}
export function normalizeAI044SubscriptionContextBinding(raw: unknown): AI044SubscriptionContextBinding | null {
  try {
    const b = exactAI044Record(captureAI044Data(raw), ["repository", "projectTaskId", "planId", "planRevision", "planFingerprint", "taskId", "attempt", "allowedWritePaths", "readContextPaths"]);
    const repository = normalizeSubscriptionRepository(b.repository), attempt = exactAI044Record(b.attempt, ["developmentRunId", "number", "kind"]);
    if (!repository || ![b.projectTaskId, b.planId, b.taskId, attempt.developmentRunId].every(ai044Id)
      || !Number.isSafeInteger(b.planRevision) || (b.planRevision as number) < 1 || (b.planRevision as number) > 1_000_000 || !ai044Hash(b.planFingerprint)
      || !Number.isSafeInteger(attempt.number) || (attempt.number as number) < 1 || (attempt.number as number) > 3
      || !["initial", "corrective"].includes(attempt.kind as string) || (attempt.number === 1 ? attempt.kind !== "initial" : attempt.kind !== "corrective")
      || !Array.isArray(b.allowedWritePaths) || !b.allowedWritePaths.length || b.allowedWritePaths.length > 12 || new Set(b.allowedWritePaths).size !== b.allowedWritePaths.length
      || !Array.isArray(b.readContextPaths) || !b.readContextPaths.length || b.readContextPaths.length > ai044SubscriptionContextLimits.files || new Set(b.readContextPaths).size !== b.readContextPaths.length) invalid();
    const allowedWritePaths = (b.allowedWritePaths as unknown[]).map(contextPath).sort(), readContextPaths = (b.readContextPaths as unknown[]).map(contextPath);
    return freezeAI044({ ...b, repository, attempt, allowedWritePaths, readContextPaths }) as unknown as AI044SubscriptionContextBinding;
  } catch { return null; }
}
/** Independent persisted metadata integrity check; not an exact-object receipt issuer. */
export function normalizeAI044SubscriptionContextManifest(raw: unknown): AI044SubscriptionContextManifest | null {
  try {
    const m = exactAI044Record(captureAI044Data(raw), ["binding", "files", "orderedPaths", "aggregateBytes", "fingerprint"]), binding = normalizeAI044SubscriptionContextBinding(m.binding);
    if (!binding || !ai044Hash(m.fingerprint) || !Array.isArray(m.files) || !m.files.length || m.files.length > ai044SubscriptionContextLimits.files
      || !Array.isArray(m.orderedPaths) || m.orderedPaths.length !== m.files.length || new Set(m.orderedPaths).size !== m.orderedPaths.length) invalid();
    const orderedPaths = m.orderedPaths as unknown[]; let aggregateBytes = 0;
    const files = (m.files as unknown[]).map((raw, index) => {
      const f = exactAI044Record(raw, ["kind", "path", "mode", "blobId", "sha256", "byteCount"]), path = contextPath(f.path);
      if (orderedPaths[index] !== path || binding!.readContextPaths[index] !== path || binding!.readContextPaths.length !== orderedPaths.length) invalid();
      if (f.kind === "absent") { if (f.mode !== null || f.blobId !== null || f.sha256 !== null || f.byteCount !== 0) invalid(); }
      else if (f.kind !== "blob" || !["100644", "100755"].includes(f.mode as string) || typeof f.blobId !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(f.blobId)
        || !ai044Hash(f.sha256) || !Number.isSafeInteger(f.byteCount) || (f.byteCount as number) < 0 || (f.byteCount as number) > ai044SubscriptionContextLimits.fileBytes) invalid();
      aggregateBytes += f.byteCount as number; if (aggregateBytes > ai044SubscriptionContextLimits.aggregateBytes) invalid();
      return { ...f };
    });
    if (m.aggregateBytes !== aggregateBytes || m.fingerprint !== ai044Fingerprint({ binding, orderedPaths: m.orderedPaths, aggregateBytes, files })) invalid();
    return freezeAI044({ binding, orderedPaths: m.orderedPaths, aggregateBytes, files, fingerprint: m.fingerprint }) as unknown as AI044SubscriptionContextManifest;
  } catch { return null; }
}
function exactBytes(raw: unknown): Buffer {
  if (!raw || typeof raw !== "object" || types.isProxy(raw) || !types.isUint8Array(raw)
    || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(raw))) invalid();
  const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(raw) as number;
  if (length > ai044SubscriptionContextLimits.fileBytes) invalid();
  const copy = Buffer.alloc(length); Uint8Array.prototype.set.call(copy, raw as Uint8Array); return copy;
}
/** Server-only trusted object reader configuration, never a caller repository registration surface.
 * Receipt provenance is private; copying/re-hashing caller checkout bytes cannot create a context. */
export function createAI044SubscriptionContextSource(portInput: AI044ExactObjectPort) {
  const p = own(portInput, ["readExactObject"]);
  if (typeof p.readExactObject !== "function" || types.isProxy(p.readExactObject)) invalid();
  const read = p.readExactObject as AI044ExactObjectPort["readExactObject"];
  return Object.freeze({ async prepare(bindingInput: unknown, pathsInput: unknown) {
    try {
      const binding = normalizeAI044SubscriptionContextBinding(bindingInput); if (!binding) return denied();
      const paths = captureAI044Data(pathsInput);
      if (!Array.isArray(paths) || !paths.length || paths.length > ai044SubscriptionContextLimits.files || new Set(paths).size !== paths.length) invalid();
      const orderedPaths = (paths as unknown[]).map(contextPath);
      if (ai044Fingerprint(orderedPaths) !== ai044Fingerprint(binding.readContextPaths)) invalid();
      const files: AI044SubscriptionContextFile[] = []; let aggregateBytes = 0;
      for (const path of orderedPaths) {
        const raw = await Reflect.apply(read, undefined, [Object.freeze({ repositoryId: binding!.repository.id, baseline: binding!.repository.baseline, path })]);
        // Inspect kind as own data, never invoke an unknown accessor.
        if (!raw || typeof raw !== "object" || types.isProxy(raw)) invalid();
        const kind = Object.getOwnPropertyDescriptor(raw, "kind"); if (!kind || !("value" in kind)) invalid();
        if (kind!.value === "absent") { own(raw, ["kind"]); files.push({ kind: "absent", path, mode: null, blobId: null, sha256: null, byteCount: 0, text: null }); continue; }
        const f = own(raw, ["kind", "mode", "blobId", "bytes"]);
        if (f.kind !== "blob" || !["100644", "100755"].includes(f.mode as string) || typeof f.blobId !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(f.blobId)) invalid();
        const bytes = exactBytes(f.bytes); aggregateBytes += bytes.length; if (aggregateBytes > ai044SubscriptionContextLimits.aggregateBytes) invalid();
        const gitHash = createHash((f.blobId as string).length === 40 ? "sha1" : "sha256").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        if (gitHash !== f.blobId) invalid();
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if ((text.length && !ai044SafeText(text, ai044SubscriptionContextLimits.fileBytes)) || text.includes("\r") || Buffer.byteLength(text) !== bytes.length) invalid();
        files.push({ kind: "blob", path, mode: f.mode as "100644" | "100755", blobId: f.blobId as string, sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length, text });
      }
      // Fingerprint bounded metadata, not the potentially1MiB source-text envelope.
      const fingerprint = ai044Fingerprint({ binding, orderedPaths, aggregateBytes, files: files.map(metadata) });
      const context = freezeAI044({ binding: binding!, orderedPaths, aggregateBytes, files, fingerprint }); contexts.add(context);
      return freezeAI044({ verdict: "allow" as const, reasons: [], context });
    } catch { return denied(); }
  } });
}
