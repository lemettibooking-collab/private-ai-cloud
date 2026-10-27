import { test } from "node:test";
// Reuse the accepted isolated-copy behavioral harness. Never mutate the candidate.
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { killSubscriptionMutation } from "../fixtures/ai044-subscription-mutations.mts";

test("Owner proof M18: missing in-transaction Owner recheck killed by actual revocation/enrollment assertion", { timeout: 180_000 }, () => killSubscriptionMutation({
  id: "M18-owner-proof", target: "lib/composition/owner-ai044-proof.ts",
  from: String.raw`if (/^(?:\/\*[^]*?\*\/\s*)?begin\s*$/iu.test(sql.trim())) await lockOwnerAuthority(client, tenant, actor);`,
  to: '/* mutant: no Owner lock in existing mutation transaction */',
  testFile: "tests/pg/owner-ai044-proof.test.mts", pattern: "revocation between exact-context",
}));
test("Owner proof M19: automatic invoke on APPROVE killed by executed zero-POST assertion", { timeout: 180_000 }, () => killSubscriptionMutation({
  id: "M19-owner-proof", target: "lib/composition/owner-ai044-proof.ts",
  from: 'decision: r.action === "approve" ? "approved" : "rejected" }); requireFact(decision.verdict === "allow");',
  to: 'decision: r.action === "approve" ? "approved" : "rejected" }); requireFact(decision.verdict === "allow"); if (r.action === "approve") await root.invoke({ prepared: prepared.prepared, approvalRequestId: before.approvalRequestId });',
  testFile: "tests/pg/owner-ai044-proof.test.mts", pattern: "fresh requests prepare/request/approve",
}));
