import type { OpenAIApiAccessView } from "../../../types/openai-api-access";
import type { OpenAIApiCredentialStore } from "./openai-api-credential-store";

/** Owner-authorized application boundary. Authorization precedes ALL local credential I/O.
 * This object has no provider dependency: connect/change/model selection cannot invoke inference.
 * An API credential is configuration only, never an approval or dispatch capability. */
export function createOpenAIApiAccess(input: Readonly<{
  store: OpenAIApiCredentialStore;
  owner(): Promise<Readonly<{ ownerUserId: string; domainWorkspaceId: string }> | null>;
}>) {
  const unavailable = (): OpenAIApiAccessView => Object.freeze({ state: "temporarily_unavailable", limits: null, executionAvailable: false });
  async function status(): Promise<OpenAIApiAccessView> {
    try {
      const owner = await input.owner(); if (!owner) return unavailable();
      const facts = await input.store.facts(owner);
      return Object.freeze({ state: facts ? "connected" : "not_connected", limits: facts?.limits ?? null, executionAvailable: false });
    } catch { return unavailable(); }
  }
  async function mutate(work: (owner: Readonly<{ ownerUserId: string; domainWorkspaceId: string }>) => Promise<boolean>) {
    try {
      const owner = await input.owner(); if (!owner) return "denied" as const;
      return await work(owner) ? "saved" as const : "configuration_invalid" as const;
    } catch { return "temporarily_unavailable" as const; }
  }
  return Object.freeze({ status,
    connect: (apiKey: unknown, limits: unknown) => mutate(owner => input.store.save(owner, apiKey, limits)),
    configure: (limits: unknown) => mutate(owner => input.store.configure(owner, limits)),
    disconnect: () => mutate(owner => input.store.disconnect(owner)),
  });
}
