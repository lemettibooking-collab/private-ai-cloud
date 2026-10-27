import "server-only";
import { open, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { auth } from "../auth/next-auth.server";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority";
import { createChatGPTCredentialStore, defaultCredentialDirectory } from "../integrations/chatgpt/chatgpt-credential-store";
import { createOwnerAI044SubscriptionRun, createOwnerAI044SubscriptionPreparation } from "./ai044-subscription-run.server";
import { createOwnerAI044Proof, normalizeOwnerAI044ProofPolicy, ownerAI044ProofInput } from "./owner-ai044-proof";
import type { OwnerAI044ProofView } from "./owner-ai044-proof";

/** Owner-maintained nonsecret exact-plan policy, not an environment enable flag.
 * Never written by PAC. No browser root/path/allowlist/configuration is accepted. */
async function localPolicy() {
  const file = await open(join(homedir(), ".config/private-ai-cloud/ai044-production-proof.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > 32 * 1024 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw Error("proof_unavailable");
    const buffer = Buffer.alloc(32 * 1024 + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) throw Error("proof_unavailable");
    return normalizeOwnerAI044ProofPolicy(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
  } finally { await file.close(); }
}
async function withProof(work: (proof: ReturnType<typeof createOwnerAI044Proof>) => Promise<OwnerAI044ProofView>): Promise<OwnerAI044ProofView> {
  let database: ReturnType<typeof createWorkflowRuntimePostgresDatabase> | null = null;
  try {
    const domainWorkspaceId = process.env.APP_DEMO_WORKSPACE_SLUG;
    if (!domainWorkspaceId) return { status: "unavailable" };
    database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    const identitySource = createGitHubSessionIdentitySource({ database, sessionResolver: { resolve: () => auth() } });
    // Before local config/facts/raw business reads, including on every Server Action.
    if ((await resolveSessionOwner(database, domainWorkspaceId, identitySource)).status !== "owner") return { status: "unavailable" };
    const policy = await localPolicy();
    const store = createChatGPTCredentialStore({ directory: defaultCredentialDirectory() });
    return await work(createOwnerAI044Proof({ database, domainWorkspaceId, identitySource, policy, clock: Date.now,
      readSubscriptionFacts: () => store.readSubscriptionFacts(),
      preparation: createOwnerAI044SubscriptionPreparation, execution: createOwnerAI044SubscriptionRun }));
  } catch { return { status: "unavailable" }; }
  finally { await database?.close().catch(() => undefined); }
}
export async function loadOwnerAI044Proof() { return withProof(proof => proof.load()); }

/** Strict bounded FormData projection. React action metadata is not business input;
 * duplicate business fields/files/extra identity or configuration fields deny. */
export async function submitOwnerAI044Proof(form: FormData) {
  const input = ownerAI044ProofInput(form);
  return input ? withProof(proof => proof.act(input)) : { status: "unavailable" } as const;
}
