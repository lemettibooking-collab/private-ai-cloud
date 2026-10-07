// AI-039.2: application-facing entry for the ChatGPT plan integration (server-only).
//
//   Settings → Integrations (RSC)         → loadChatGPTIntegration()      (safe status projection only)
//   app/settings/integrations/actions.ts  → start / disconnect / models / select (Owner of THIS request)
//   app/integrations/chatgpt/callback     → completeChatGPTCallback(url)  (attempt binding, Owner re-check)
//
// Trusted configuration: APP_DEMO_WORKSPACE_SLUG (workspace), PAC_CHATGPT_CALLBACK_PORT (the loopback port
// PAC serves on; default 3000), PAC_CHATGPT_CREDENTIAL_DIR (optional; default
// ~/.config/private-ai-cloud/chatgpt). Credentials stay in the local protected store; nothing here returns
// a token, an ID token, a subject or a client id. Nothing here performs inference.
import "server-only";
import { auth } from "../auth/next-auth.server";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import type { CallbackDiagnostic, ChatGPTConnection, ChatGPTConnectionStatus } from "../integrations/chatgpt/chatgpt-connection";
import { createChatGPTConnection } from "../integrations/chatgpt/chatgpt-connection";
import { createChatGPTCredentialStore, defaultCredentialDirectory } from "../integrations/chatgpt/chatgpt-credential-store";
import type { FetchLike } from "../integrations/chatgpt/chatgpt-oauth";
import { resolveSessionOwner, verifyOwner } from "../integrations/chatgpt/chatgpt-owner-authority";

export type { ChatGPTConnectionStatus } from "../integrations/chatgpt/chatgpt-connection";

const workspacePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function callbackPort(): number {
  const raw = process.env.PAC_CHATGPT_CALLBACK_PORT ?? "3000";
  const port = /^[0-9]{1,5}$/u.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : 3000;
}

function workspace(): string | null {
  const value = process.env.APP_DEMO_WORKSPACE_SLUG;
  return typeof value === "string" && workspacePattern.test(value) ? value : null;
}

async function withConnection<T>(work: (context: Readonly<{ connection: ChatGPTConnection; owner: () => Promise<Awaited<ReturnType<typeof resolveSessionOwner>>> }>) => Promise<T>, onCallbackDiagnostic?: (event: CallbackDiagnostic) => void): Promise<T> {
  const domainWorkspaceId = workspace();
  const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
  try {
    const connection = createChatGPTConnection({
      store: createChatGPTCredentialStore({ directory: defaultCredentialDirectory() }),
      fetch: globalThis.fetch as unknown as FetchLike,
      ownerAuthority: { verify: (input) => verifyOwner(database, input) },
      callbackPort: callbackPort(),
      now: () => new Date(),
      onCallbackDiagnostic,
    });
    const owner = async () => domainWorkspaceId === null
      ? { status: "denied" as const }
      : resolveSessionOwner(database, domainWorkspaceId, createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => auth() }, database }));
    return await work({ connection, owner });
  } finally {
    await database.close().catch(() => undefined);
  }
}

export type ChatGPTIntegrationView =
  | Readonly<{ state: "available"; status: ChatGPTConnectionStatus; manageUsageUrl: string }>
  | Readonly<{ state: "unauthenticated" | "unavailable" }>;

// Owner-only safe status (no network: the local store only).
export async function loadChatGPTIntegration(): Promise<ChatGPTIntegrationView> {
  try {
    return await withConnection(async ({ connection, owner }) => {
      const resolved = await owner();
      if (resolved.status === "unauthenticated") return { state: "unauthenticated" as const };
      if (resolved.status !== "owner") return { state: "unavailable" as const };
      return { state: "available" as const, status: await connection.status(), manageUsageUrl: "https://chatgpt.com/settings/usage" };
    });
  } catch {
    return { state: "unavailable" };
  }
}

export async function startChatGPTConnection(returnOrigin: string): Promise<Readonly<{ status: "redirect"; url: string }> | Readonly<{ status: "unauthenticated" | "denied" | "unavailable" }>> {
  try {
    return await withConnection(async ({ connection, owner }) => {
      const resolved = await owner();
      if (resolved.status !== "owner") return { status: resolved.status === "unauthenticated" ? "unauthenticated" as const : "denied" as const };
      return connection.start({ ownerUserId: resolved.ownerUserId, domainWorkspaceId: resolved.domainWorkspaceId, returnOrigin });
    });
  } catch {
    return { status: "unavailable" };
  }
}

// The loopback callback: no PAC cookie is trusted or needed; the pending attempt carries the binding.
export async function completeChatGPTCallback(requestUrl: URL) {
  let diagnostic: CallbackDiagnostic = Object.freeze({ event: "callback_failed", outcome: "temporarily_unavailable", stage: "composition", failure: "internal_unavailable", exchange: null });
  try {
    return await withConnection(({ connection }) => connection.complete(requestUrl), (event) => { diagnostic = event; });
  } catch {
    return { outcome: "temporarily_unavailable" as const, returnOrigin: `http://127.0.0.1:${callbackPort()}` };
  } finally {
    recordChatGPTCallbackOutcome(diagnostic);
  }
}

// Only internally constructed fixed-enum / bounded-schema events, never requests, tokens, claims or
// exceptions. One final server event; the callback result and UI keep their existing safe projection.
export function recordChatGPTCallbackOutcome(event: CallbackDiagnostic): void {
  try {
    console.info("[chatgpt-oauth]", event);
  } catch { /* A logging failure must not change a validated / persisted connection. */ }
}

export async function disconnectChatGPT() {
  try {
    return await withConnection(async ({ connection, owner }) => {
      if ((await owner()).status !== "owner") return { status: "denied" as const };
      return connection.disconnect();
    });
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function refreshChatGPTModels() {
  try {
    return await withConnection(async ({ connection, owner }) => {
      if ((await owner()).status !== "owner") return "denied" as const;
      return connection.refreshModels();
    });
  } catch {
    return "temporarily_unavailable" as const;
  }
}

export async function selectChatGPTModel(slug: unknown) {
  try {
    return await withConnection(async ({ connection, owner }) => {
      if ((await owner()).status !== "owner") return "denied" as const;
      return connection.selectModel(slug);
    });
  } catch {
    return "temporarily_unavailable" as const;
  }
}

export function chatgptCallbackPort(): number {
  return callbackPort();
}
