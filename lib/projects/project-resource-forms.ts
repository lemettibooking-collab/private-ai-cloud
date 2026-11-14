// Form transport only; authority is always resolved by the server composition.
import { isProxy } from "node:util/types";
export function projectResourceFields(form: unknown, names: readonly string[]) {
  if (typeof form !== "object" || form === null || isProxy(form) || Object.getPrototypeOf(form) !== FormData.prototype) return null;
  const data = form as FormData; let count = 0;
  for (const key of FormData.prototype.keys.call(data)) if (++count > 32 || key.length > 128 || (!key.startsWith("$ACTION_") && !names.includes(key))) return null;
  const out: Record<string, FormDataEntryValue> = {};
  for (const name of names) { const values = FormData.prototype.getAll.call(data, name); if (values.length !== 1) return null; out[name] = values[0]; }
  return out;
}
const integer = (raw: unknown) => typeof raw === "string" && /^(0|[1-9][0-9]{0,9})$/u.test(raw) ? Number(raw) : NaN;
export function repositoryBindingForm(form: unknown) {
  const f = projectResourceFields(form, ["projectId", "url", "defaultBranch", "expectedRevision", "requestId"]);
  return f && Object.values(f).every(x => typeof x === "string") ? { ...f, expectedRevision: integer(f.expectedRevision) } : null;
}
export async function knowledgeUploadForm(form: unknown) {
  const f = projectResourceFields(form, ["projectId", "file", "expectedVersion", "requestId"]);
  if (!f || typeof f.projectId !== "string" || typeof f.requestId !== "string" || typeof f.expectedVersion !== "string" || isProxy(f.file) || !(f.file instanceof File)) return null;
  const size = Object.getOwnPropertyDescriptor(Blob.prototype, "size")!.get!.call(f.file) as number;
  if (size < 1 || size > 262144) return null;
  const filename = Object.getOwnPropertyDescriptor(File.prototype, "name")!.get!.call(f.file) as string;
  const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(f.file));
  return { projectId: f.projectId, filename, bytes, expectedVersion: integer(f.expectedVersion), requestId: f.requestId };
}
