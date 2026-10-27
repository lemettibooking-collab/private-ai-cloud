import "server-only";
import type { ExecutorAdapterConfiguration } from "../contracts/executor-adapter";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { AuthenticatedIdentitySource } from "./authenticated-owner-read-runtime";
import type { ExecutorControllerBinding } from "../db/executor-controller-binding";
import { normalizeExecutorControllerBinding } from "../db/executor-controller-binding";
import { createAI044SubscriptionRun } from "./ai044-subscription-run";
import type { AI044SubscriptionReadPolicy } from "./ai044-subscription-run";
import { createChatGPTCredentialStore, defaultCredentialDirectory } from "../integrations/chatgpt/chatgpt-credential-store";
import { createChatGPTConnection } from "../integrations/chatgpt/chatgpt-connection";
import { verifyOwner } from "../integrations/chatgpt/chatgpt-owner-authority";
import { createAI044SubscriptionGitObjectReader } from "../executors/ai044-subscription-git-context";
import type { FetchLike } from "../integrations/chatgpt/chatgpt-oauth";

/** Exact local Owner-operated AI044 use case only. The AI044.2 Owner action is the
 * only UI binding; never a generic controller port, worker or environment boolean.
 * Construction does not read tokens or contact a provider. Future invocation still needs
 * the exact current manual receipt and one-shot PostgreSQL Owner decision. */
export function createOwnerAI044SubscriptionRun(input: Readonly<{
  database: WorkflowRuntimeDatabase; tenant: ResolvedWorkflowRuntimeTenant; projectId: string; projectTaskId: string;
  configuration: ExecutorAdapterConfiguration; identitySource: AuthenticatedIdentitySource;
  repositoryRoot: string; controllerBinding: ExecutorControllerBinding; readContextPolicy?: AI044SubscriptionReadPolicy;
}>) {
  // Production slice requires the factual saved AI043 attempt intent. The legacy
  // unmapped-authority path remains test/internal only and cannot dispatch through this root.
  const controllerBinding = normalizeExecutorControllerBinding(input.controllerBinding);
  const connect = input.database.connect.bind(input.database);
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect });
  const store = createChatGPTCredentialStore({ directory: defaultCredentialDirectory() });
  const connection = createChatGPTConnection({ store, fetch: globalThis.fetch as unknown as FetchLike, callbackPort: 3000,
    ownerAuthority: { verify: owner => verifyOwner(database, owner) }, now: () => new Date() });
  return createAI044SubscriptionRun({ database, tenant: input.tenant, projectId: input.projectId, projectTaskId: input.projectTaskId,
    configuration: input.configuration, identitySource: input.identitySource, connection,
    contextSource: createAI044SubscriptionGitObjectReader({ repositoryRoot: input.repositoryRoot, repositoryId: input.configuration.repository.id }), transport: globalThis.fetch, clock: Date.now,
    controllerBinding, ...(input.readContextPolicy ? { readContextPolicy: input.readContextPolicy } : {}) });
}

/** Enrollment preparation only: cannot expose request/decision/consume/start/invoke.
 * The Owner bridge must persist the returned intent in the existing controller and
 * enroll its factual authority before constructing the bound execution root above. */
export function createOwnerAI044SubscriptionPreparation(input: Omit<Parameters<typeof createOwnerAI044SubscriptionRun>[0], "controllerBinding">) {
  const store = createChatGPTCredentialStore({ directory: defaultCredentialDirectory() });
  const connection = createChatGPTConnection({ store, fetch: globalThis.fetch as unknown as FetchLike, callbackPort: 3000,
    ownerAuthority: { verify: owner => verifyOwner(input.database, owner) }, now: () => new Date() });
  const root = createAI044SubscriptionRun({ database: input.database, tenant: input.tenant, projectId: input.projectId, projectTaskId: input.projectTaskId,
    configuration: input.configuration, identitySource: input.identitySource, connection,
    contextSource: createAI044SubscriptionGitObjectReader({ repositoryRoot: input.repositoryRoot, repositoryId: input.configuration.repository.id }),
    transport: globalThis.fetch, clock: Date.now, ...(input.readContextPolicy ? { readContextPolicy: input.readContextPolicy } : {}) });
  return Object.freeze({ prepare: root.prepare });
}
