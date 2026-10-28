import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionPgMutations, killSubscriptionMutation } from "../fixtures/ai044-subscription-mutations.mts";
for (const mutation of subscriptionPgMutations) test(`PG AI044 Phase S behavioral ${mutation.id} killed in isolated copy`, { timeout: 180_000 }, () => killSubscriptionMutation(mutation));
