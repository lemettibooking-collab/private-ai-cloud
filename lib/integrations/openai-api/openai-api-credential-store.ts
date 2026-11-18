// Node-only infrastructure. No network, database, logging, environment key fallback or public secret projection.
import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { OpenAIApiLimits } from "../../../types/openai-api-access";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "../../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOpenAIApiLimits } from "./openai-api-policy.ts";

type Binding = Readonly<{ ownerUserId: string; domainWorkspaceId: string }>;
type RecordData = Binding & Readonly<{ version: 1; generation: string; apiKey: string; limits: OpenAIApiLimits }>;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const bindingOk = (b: Binding) => uuid(b.ownerUserId) && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(b.domainWorkspaceId);
const keyOk = (v: unknown): v is string => typeof v === "string" && /^sk-[A-Za-z0-9_-]{16,4000}$/u.test(v);
const fail = () => new Error("openai_api_store_unavailable");
export const defaultOpenAIApiDirectory = () => join(homedir(), ".config", "private-ai-cloud", "openai-api");

/** Same protected local file approach as ChatGPT: 0700 directory, 0600 files,
 * O_NOFOLLOW, O_EXCL locks, acknowledged atomic fsync/rename, no stale takeover.
 * The root and its parents must not be concurrently replaced by the OS account owner.
 * This is not an OS-account isolation boundary (same as the existing ChatGPT store). */
export function createOpenAIApiCredentialStore(directory: string) {
  if (typeof window !== "undefined" || !isAbsolute(directory) || resolve(directory) !== directory || directory === parse(directory).root) throw fail();
  const recordPath = join(directory, "credential.json"), lockPath = join(directory, "access.lock");
  const uid = process.getuid?.();
  if (uid === undefined) throw fail();
  async function secureDirectory() {
    // Reject symlinks in every ancestor before mkdir/open; never chmod existing user directories.
    const ancestors: string[] = []; let p = directory;
    while (p !== dirname(p)) { ancestors.unshift(p); p = dirname(p); }
    for (const path of ancestors) {
      try { const s = await fs.lstat(path); if (!s.isDirectory() || s.isSymbolicLink()) throw fail(); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw fail();
        await fs.mkdir(path, { mode: 0o700 });
      }
    }
    const s = await fs.lstat(directory);
    if (s.uid !== uid || (s.mode & 0o777) !== 0o700) throw fail();
  }
  async function read(): Promise<RecordData | null> {
    let h;
    try { h = await fs.open(recordPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw fail(); }
    try {
      const s = await h.stat();
      if (!s.isFile() || s.uid !== uid || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 || s.size > 8192) throw fail();
      const buffer = Buffer.alloc(8193); const { bytesRead } = await h.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 8192) throw fail();
      const r = exactOwnData(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), ["version", "generation", "ownerUserId", "domainWorkspaceId", "apiKey", "limits"]);
      const limits = normalizeOpenAIApiLimits(r?.limits);
      if (!r || r.version !== 1 || !uuid(r.generation) || !uuid(r.ownerUserId) || typeof r.domainWorkspaceId !== "string" || !keyOk(r.apiKey) || !limits) throw fail();
      const b = { ownerUserId: r.ownerUserId, domainWorkspaceId: r.domainWorkspaceId };
      if (!bindingOk(b)) throw fail();
      return { version: 1, generation: r.generation, ...b, apiKey: r.apiKey, limits };
    } catch { throw fail(); } finally { await h.close(); }
  }
  async function locked<T>(work: () => Promise<T>): Promise<T> {
    await secureDirectory();
    // Fail immediately rather than waiting / stealing an unknown process's authority.
    // Manual cleanup: only with ALL PAC processes stopped.
    const token = randomUUID(); let lock;
    try { lock = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch { throw fail(); }
    const owned = await lock.stat();
    try { await lock.writeFile(token); await lock.sync(); return await work(); }
    finally {
      await lock.close();
      // Never remove another process's replacement lock; token AND inode must match.
      const h = await fs.open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
      if (h) {
        try {
          const s = await h.stat(); const b = Buffer.alloc(37); const r = await h.read(b, 0, b.length, 0);
          if (s.isFile() && s.ino === owned.ino && s.dev === owned.dev && r.bytesRead === 36 && b.subarray(0, 36).toString() === token) await fs.unlink(lockPath);
        } finally { await h.close(); }
      }
    }
  }
  async function syncDirectory() { const h = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await h.sync(); } finally { await h.close(); } }
  async function write(r: RecordData) {
    const temporary = join(directory, `credential-${randomUUID()}.tmp`);
    const h = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await h.writeFile(JSON.stringify(r)); await h.sync(); }
    catch { await fs.unlink(temporary).catch(() => undefined); throw fail(); }
    finally { await h.close(); }
    try { await fs.rename(temporary, recordPath); await syncDirectory(); }
    catch { await fs.unlink(temporary).catch(() => undefined); throw fail(); }
  }
  const matches = (r: RecordData, b: Binding) => r.ownerUserId === b.ownerUserId && r.domainWorkspaceId === b.domainWorkspaceId;
  async function facts(b: Binding) {
    if (!bindingOk(b)) throw fail();
    return locked(async () => {
      const r = await read(); if (!r) return null; if (!matches(r, b)) throw fail();
      return Object.freeze({ generation: r.generation, limits: r.limits });
    });
  }
  async function save(b: Binding, apiKey: unknown, rawLimits: unknown) {
    const limits = normalizeOpenAIApiLimits(rawLimits);
    if (!bindingOk(b) || !keyOk(apiKey) || !limits) return false;
    return locked(async () => {
      const r = await read(); if (r && !matches(r, b)) throw fail();
      await write({ ...b, version: 1, generation: randomUUID(), apiKey, limits }); return true;
    });
  }
  async function configure(b: Binding, rawLimits: unknown) {
    const limits = normalizeOpenAIApiLimits(rawLimits); if (!bindingOk(b) || !limits) return false;
    return locked(async () => { const r = await read(); if (!r || !matches(r, b)) return false;
      await write({ ...r, generation: randomUUID(), limits }); return true; });
  }
  async function disconnect(b: Binding) {
    if (!bindingOk(b)) return false;
    return locked(async () => { const r = await read(); if (!r) return true; if (!matches(r, b)) return false;
      await fs.unlink(recordPath); await syncDirectory(); return true; });
  }
  /** Internal only. Generation binds receipts to an exact key/model/limits revision.
   * Future dispatch must initiate synchronously under this lock AFTER a durable financial/start fence. */
  async function withKey<T>(b: Binding, generation: string, work: (key: string, limits: OpenAIApiLimits) => Promise<T>) {
    if (!bindingOk(b) || !uuid(generation)) throw fail();
    return locked(async () => { const r = await read(); if (!r || !matches(r, b) || r.generation !== generation) throw fail();
      return work(r.apiKey, r.limits); });
  }
  return Object.freeze({ facts, save, configure, disconnect, withKey });
}
export type OpenAIApiCredentialStore = ReturnType<typeof createOpenAIApiCredentialStore>;
