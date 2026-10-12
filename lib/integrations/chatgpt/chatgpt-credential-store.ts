// AI-039.2 local credential store for the ChatGPT plan integration (server / local host only).
//
// ChatGPT OAuth material NEVER goes to PostgreSQL, browser storage, cookies, source control, .env files,
// audit events or logs. It lives in ONE protected directory on the PAC host
// (default ~/.config/private-ai-cloud/chatgpt, override PAC_CHATGPT_CREDENTIAL_DIR):
//   host-id.json          stable ext_agent_host_id (urn:uuid; not a secret)
//   registrations.json    issued client ids, validated account metadata, token sets, selected model
//   pending/<hash>.json   one pending OAuth attempt per state hash (PKCE verifier, nonce, Owner binding)
//   refresh.lock          cross-process refresh serialization
//
// Rules: the directory must be a real directory owned by this uid with mode 0700 (created so; an
// existing wider mode owned by us is tightened); files are regular files owned by this uid with mode
// 0600, opened with O_NOFOLLOW, size-bounded and strictly schema-validated — anything else fails
// closed. Writes are atomic: O_EXCL temp file (0600) → fsync → rename over the target → fsync dir.
// A pending attempt is consumed exactly once by an atomic rename (a replay finds nothing).
import { constants, promises as fs } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatGPTModel } from "./chatgpt-oauth";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { hostIdPattern, issuedClientIdPattern } from "./chatgpt-oauth.ts";

// The credential lock has NO automatic stale takeover (a takeover after an age check is a TOCTOU race:
// the observed lock may be released and re-taken before the unlink). A waiter polls for at most
// lockWaitMs and then fails closed. A lock left behind by a crashed process blocks credential
// operations (fail closed) until it is removed manually: stop every PAC process, delete only
// `<credential dir>/refresh.lock`, restart PAC. Accepted availability debt for the local MVP.
export const credentialStoreLimits = Object.freeze({
  maxFileBytes: 256 * 1024,
  maxRegistrations: 8,
  lockWaitMs: 20_000,
  lockPollMs: 100,
});

// active                    usable plan connection: access AND rotating refresh token present
// plan_usage_missing        identity only: the grant lacked chatgpt.tokens.use.direct (no tokens kept)
// reauthorization_required  refresh failed terminally: token material cleared, mapping kept
// signed_out                explicit disconnect: ALL token material (incl. the ID token) cleared; the
//                           issued client id, validated subject, label / email and host id are kept so a
//                           later sign-in reuses the issued registration (never dynamic_agent_client)
export type RegistrationStatus = "active" | "plan_usage_missing" | "reauthorization_required" | "signed_out";

export type StoredRegistration = Readonly<{
  label: string;
  clientId: string;
  subject: string;
  email: string | null;
  hostId: string;
  idToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  earliestRefreshAt: string | null;
  grantedScopes: readonly string[];
  status: RegistrationStatus;
  savedAt: string;
  selectedModel: string | null;
  availableModels: readonly ChatGPTModel[];
  modelsCheckedAt: string | null;
}>;

export type StoredRegistrations = Readonly<{ version: 1; active: string | null; registrations: readonly StoredRegistration[] }>;

export type PendingAttempt = Readonly<{
  version: 1;
  stateKey: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  hostId: string;
  // null = first registration with dynamic_agent_client; otherwise the issued client id reused.
  requestedClientId: string | null;
  registrationLabel: string | null;
  ownerUserId: string;
  domainWorkspaceId: string;
  returnOrigin: string;
  createdAt: string;
  expiresAt: string;
}>;

export class CredentialStoreError extends Error {}

const labelPattern = /^chatgpt-[0-9a-f]{16}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const stateKeyPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const tokenPattern = /^[\x21-\x7e]{1,16384}$/u;
const scopePattern = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/u;
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const plain = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype;
const exact = (input: Record<string, unknown>, fields: readonly string[]) => {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
};
const iso = (input: unknown): input is string => typeof input === "string" && isoPattern.test(input) && Number.isFinite(Date.parse(input));
const isoOrNull = (input: unknown) => input === null || iso(input);
const tokenOrNull = (input: unknown) => input === null || (typeof input === "string" && tokenPattern.test(input));

const registrationFields = ["label", "clientId", "subject", "email", "hostId", "idToken", "accessToken", "refreshToken", "accessTokenExpiresAt",
  "earliestRefreshAt", "grantedScopes", "status", "savedAt", "selectedModel", "availableModels", "modelsCheckedAt"] as const;

function validRegistration(input: unknown): input is StoredRegistration {
  if (!plain(input) || !exact(input, registrationFields)) return false;
  const value = input;
  return typeof value.label === "string" && labelPattern.test(value.label)
    && typeof value.clientId === "string" && issuedClientIdPattern.test(value.clientId) && value.clientId !== "dynamic_agent_client"
    && typeof value.subject === "string" && value.subject.length >= 1 && value.subject.length <= 256
    && (value.email === null || (typeof value.email === "string" && value.email.length <= 320))
    && typeof value.hostId === "string" && hostIdPattern.test(value.hostId)
    && tokenOrNull(value.idToken) && tokenOrNull(value.accessToken) && tokenOrNull(value.refreshToken)
    && isoOrNull(value.accessTokenExpiresAt) && isoOrNull(value.earliestRefreshAt)
    && (value.accessToken === null) === (value.accessTokenExpiresAt === null)
    && Array.isArray(value.grantedScopes) && value.grantedScopes.length <= 32 && value.grantedScopes.every((item) => typeof item === "string" && scopePattern.test(item))
    && ["active", "plan_usage_missing", "reauthorization_required", "signed_out"].includes(value.status as string)
    // Plan usage tokens exist only on an active registration, which must be refreshable (a rotating
    // refresh token is part of the promised lifecycle); the others keep identity metadata only, and a
    // signed-out registration does not even keep the ID token.
    && (value.status === "active"
      ? value.accessToken !== null && value.refreshToken !== null && value.idToken !== null
      : value.accessToken === null && value.refreshToken === null && value.earliestRefreshAt === null)
    && (value.status !== "signed_out" || value.idToken === null)
    && iso(value.savedAt)
    && (value.selectedModel === null || (typeof value.selectedModel === "string" && slugPattern.test(value.selectedModel)))
    && Array.isArray(value.availableModels) && value.availableModels.length <= 64
    && value.availableModels.every((model) => plain(model) && exact(model, ["slug", "displayName"]) && typeof model.slug === "string" && slugPattern.test(model.slug)
      && typeof model.displayName === "string" && model.displayName.length >= 1 && model.displayName.length <= 128)
    && isoOrNull(value.modelsCheckedAt);
}

export function validRegistrations(input: unknown): input is StoredRegistrations {
  if (!plain(input) || !exact(input, ["version", "active", "registrations"]) || input.version !== 1 || !Array.isArray(input.registrations)
    || input.registrations.length > credentialStoreLimits.maxRegistrations || !input.registrations.every(validRegistration)) return false;
  const labels = (input.registrations as StoredRegistration[]).map((item) => item.label);
  if (new Set(labels).size !== labels.length) return false;
  return input.active === null || (typeof input.active === "string" && labels.includes(input.active));
}

const attemptFields = ["version", "stateKey", "nonce", "codeVerifier", "redirectUri", "hostId", "requestedClientId", "registrationLabel", "ownerUserId",
  "domainWorkspaceId", "returnOrigin", "createdAt", "expiresAt"] as const;

function validAttempt(input: unknown): input is PendingAttempt {
  if (!plain(input) || !exact(input, attemptFields) || input.version !== 1) return false;
  const value = input;
  return typeof value.stateKey === "string" && stateKeyPattern.test(value.stateKey)
    && typeof value.nonce === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value.nonce)
    && typeof value.codeVerifier === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value.codeVerifier)
    && typeof value.redirectUri === "string" && /^http:\/\/127\.0\.0\.1:\d{1,5}\/integrations\/chatgpt\/callback$/u.test(value.redirectUri)
    && typeof value.hostId === "string" && hostIdPattern.test(value.hostId)
    && (value.requestedClientId === null || (typeof value.requestedClientId === "string" && issuedClientIdPattern.test(value.requestedClientId)))
    && (value.registrationLabel === null || (typeof value.registrationLabel === "string" && labelPattern.test(value.registrationLabel)))
    && (value.requestedClientId === null) === (value.registrationLabel === null)
    && typeof value.ownerUserId === "string" && uuidPattern.test(value.ownerUserId)
    && typeof value.domainWorkspaceId === "string" && stableIdPattern.test(value.domainWorkspaceId)
    && typeof value.returnOrigin === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/u.test(value.returnOrigin)
    && iso(value.createdAt) && iso(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.createdAt);
}

export const emptyRegistrations: StoredRegistrations = Object.freeze({ version: 1, active: null, registrations: Object.freeze([]) });

export function defaultCredentialDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env.PAC_CHATGPT_CREDENTIAL_DIR;
  if (typeof override === "string" && override.length > 0) return override;
  return join(homedir(), ".config", "private-ai-cloud", "chatgpt");
}

export type ChatGPTCredentialStore = Readonly<{
  directory: string;
  hostId(): Promise<string>;
  readRegistrations(): Promise<StoredRegistrations>;
  writeRegistrations(next: StoredRegistrations): Promise<void>;
  putAttempt(attempt: PendingAttempt): Promise<void>;
  consumeAttempt(stateKey: string): Promise<PendingAttempt | null>;
  hasLiveAttempt(now: Date): Promise<boolean>;
  withRefreshLock<T>(work: () => Promise<T>): Promise<T>;
}>;

// `lockTiming` exists for deterministic tests only (a shorter bounded WAIT); there is no stale takeover to configure.
export function createChatGPTCredentialStore(input: Readonly<{ directory: string; lockTiming?: Readonly<{ waitMs: number; pollMs: number }> }>): ChatGPTCredentialStore {
  const directory = input.directory;
  const lockWaitMs = input.lockTiming?.waitMs ?? credentialStoreLimits.lockWaitMs;
  const lockPollMs = input.lockTiming?.pollMs ?? credentialStoreLimits.lockPollMs;
  const pendingDirectory = join(directory, "pending");
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  let refreshChain: Promise<unknown> = Promise.resolve();

  async function secureDirectory(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)) throw new CredentialStoreError("Credential directory is not safe.");
    if ((stat.mode & 0o077) !== 0) await fs.chmod(path, 0o700);
    const again = await fs.lstat(path);
    if ((again.mode & 0o077) !== 0) throw new CredentialStoreError("Credential directory is not safe.");
  }

  async function readJson(path: string): Promise<unknown | undefined> {
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new CredentialStoreError("Credential file is not readable safely.");
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (uid !== null && stat.uid !== uid) || (stat.mode & 0o777) !== 0o600 || stat.size > credentialStoreLimits.maxFileBytes) {
        throw new CredentialStoreError("Credential file is not safe.");
      }
      const text = await handle.readFile({ encoding: "utf8" });
      if (Buffer.byteLength(text, "utf8") > credentialStoreLimits.maxFileBytes) throw new CredentialStoreError("Credential file is too large.");
      try {
        return JSON.parse(text);
      } catch {
        throw new CredentialStoreError("Credential file is malformed.");
      }
    } finally {
      await handle.close();
    }
  }

  async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text, "utf8") > credentialStoreLimits.maxFileBytes) throw new CredentialStoreError("Credential file would be too large.");
    const temporary = join(dir, `.${name}.${randomBytes(8).toString("hex")}.tmp`);
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(text, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // rename() replaces the directory entry itself; a symlink planted at the target is replaced, never followed.
      await fs.rename(temporary, join(dir, name));
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
    const dirHandle = await fs.open(dir, constants.O_RDONLY);
    try {
      await dirHandle.sync();
    } catch {
      // directory fsync is unsupported on some platforms; the rename itself is atomic
    } finally {
      await dirHandle.close();
    }
  }

  async function hostId(): Promise<string> {
    await secureDirectory(directory);
    const existing = await readJson(join(directory, "host-id.json"));
    if (existing !== undefined) {
      if (!plain(existing) || !exact(existing, ["version", "hostId"]) || existing.version !== 1 || typeof existing.hostId !== "string" || !hostIdPattern.test(existing.hostId)) {
        throw new CredentialStoreError("Host id file is malformed.");
      }
      return existing.hostId;
    }
    const created = `urn:uuid:${randomUUID()}`;
    // O_EXCL-based creation: two first-time callers converge on whichever file was written first.
    const temporary = join(directory, `.host-id.${randomBytes(8).toString("hex")}.tmp`);
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, hostId: created }), { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, join(directory, "host-id.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
    return hostId();
  }

  async function readRegistrations(): Promise<StoredRegistrations> {
    await secureDirectory(directory);
    const value = await readJson(join(directory, "registrations.json"));
    if (value === undefined) return emptyRegistrations;
    if (!validRegistrations(value)) throw new CredentialStoreError("Registrations file is malformed.");
    return value;
  }

  async function writeRegistrations(next: StoredRegistrations): Promise<void> {
    if (!validRegistrations(next)) throw new CredentialStoreError("Registrations are invalid.");
    await secureDirectory(directory);
    await writeJson(directory, "registrations.json", next);
  }

  async function putAttempt(attempt: PendingAttempt): Promise<void> {
    if (!validAttempt(attempt)) throw new CredentialStoreError("Attempt is invalid.");
    await secureDirectory(directory);
    await secureDirectory(pendingDirectory);
    await writeJson(pendingDirectory, `${attempt.stateKey}.json`, attempt);
  }

  // Exactly once: the atomic rename claims the attempt; a replay (or a concurrent consumer) finds nothing.
  async function consumeAttempt(stateKey: string): Promise<PendingAttempt | null> {
    if (!stateKeyPattern.test(stateKey)) return null;
    await secureDirectory(directory);
    await secureDirectory(pendingDirectory);
    const claimed = join(pendingDirectory, `.${stateKey}.${randomBytes(8).toString("hex")}.consumed`);
    try {
      await fs.rename(join(pendingDirectory, `${stateKey}.json`), claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new CredentialStoreError("Attempt could not be claimed.");
    }
    try {
      const value = await readJson(claimed);
      return validAttempt(value) && value.stateKey === stateKey ? value : null;
    } finally {
      await fs.unlink(claimed).catch(() => undefined);
    }
  }

  async function hasLiveAttempt(now: Date): Promise<boolean> {
    await secureDirectory(directory);
    await secureDirectory(pendingDirectory);
    for (const name of await fs.readdir(pendingDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      try {
        const value = await readJson(join(pendingDirectory, name));
        if (validAttempt(value) && Date.parse(value.expiresAt) > now.getTime()) return true;
        // Expired / invalid attempts are removed (they can never be consumed successfully).
        await fs.unlink(join(pendingDirectory, name)).catch(() => undefined);
      } catch {
        await fs.unlink(join(pendingDirectory, name)).catch(() => undefined);
      }
    }
    return false;
  }

  // Serializes every credential critical section (refresh, connect, model selection, disconnect):
  // in-process (promise chain) and across processes (O_CREAT | O_EXCL lock file holding a random owner
  // token). While the lock exists nobody else enters — whatever its age: a waiter polls for at most
  // lockWaitMs and then fails closed. Another holder's lock is NEVER unlinked; release removes the lock
  // only if it still holds this holder's own token.
  async function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await secureDirectory(directory);
      const lockPath = join(directory, "refresh.lock");
      const ownerToken = randomBytes(16).toString("hex");
      const deadline = Date.now() + lockWaitMs;
      for (;;) {
        try {
          const handle = await fs.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try {
            await handle.writeFile(ownerToken, { encoding: "utf8" });
          } finally {
            await handle.close();
          }
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new CredentialStoreError("Refresh lock failed.");
          if (Date.now() > deadline) throw new CredentialStoreError("Refresh lock timed out.");
          await new Promise((resolve) => setTimeout(resolve, lockPollMs));
        }
      }
      try {
        return await work();
      } finally {
        const current = await fs.readFile(lockPath, { encoding: "utf8", flag: constants.O_RDONLY | constants.O_NOFOLLOW }).catch(() => null);
        if (current === ownerToken) await fs.unlink(lockPath).catch(() => undefined);
      }
    };
    const next = refreshChain.then(run, run);
    refreshChain = next.catch(() => undefined);
    return next;
  }

  return Object.freeze({ directory, hostId, readRegistrations, writeRegistrations, putAttempt, consumeAttempt, hasLiveAttempt, withRefreshLock });
}
