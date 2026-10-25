import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord } from "../local-handoff/local-handoff-policy.ts";

function requireFact(value: unknown): asserts value { if (!value) throw Error("invalid_executor_predecessor_state"); }
/** Internal predicate ONLY AFTER the workspace budget FOR UPDATE lock. All cooperating
 * start/settlement writers serialize there; this bounded read takes no inverted row locks.
 * Factual tenant + Run + attempt come from the validated store, never request options.
 * No provider/usage/expiry/stop inference. Direct DB-owner bypass is not prevented here. */
export async function executorPredecessorsClear(client: WorkflowRuntimeSqlClient, workspace: string, runId: string, number: number): Promise<boolean> {
  requireFact(Number.isInteger(number) && number >= 1 && number <= 3);
  if (number === 1) return true;
  const r = await client.query(`/* executor:predecessors */ select e.attempt_number,e.state,
    (e.started_at is not null) as started,(e.settled_at is not null) as settled,e.terminal_result_fingerprint,
    exists(select 1 from executor_attempt_results t where t.workspace_id=e.workspace_id and t.development_run_id=e.development_run_id
      and t.attempt_number=e.attempt_number and t.request_fingerprint=e.request_fingerprint
      and t.result_fingerprint=e.terminal_result_fingerprint and t.recorded_at=e.settled_at and t.exposure_state='settled') as terminal_matches,
    exists(select 1 from executor_attempt_events j where j.workspace_id=e.workspace_id and j.development_run_id=e.development_run_id
      and j.attempt_number=e.attempt_number and j.event_version=e.event_version and j.state=e.state) as audit_matches
    from executor_attempt_exposures e where e.workspace_id=$1 and e.development_run_id=$2 and e.attempt_number < $3
    order by e.attempt_number limit 3`, [workspace, runId, number]);
  requireFact(Number.isInteger(r.rowCount) && r.rowCount! >= 0 && r.rowCount! < number && Array.isArray(r.rows) && r.rows.length === r.rowCount);
  const rows = boundedData(r.rows) as unknown[];
  let previous = 0, blocked = false;
  for (const value of rows) {
    const p = exactRecord(value, ["attempt_number", "state", "started", "settled", "terminal_result_fingerprint", "terminal_matches", "audit_matches"]);
    requireFact(Number.isInteger(p.attempt_number) && (p.attempt_number as number) > previous && (p.attempt_number as number) < number);
    previous = p.attempt_number as number;
    requireFact(typeof p.started === "boolean" && typeof p.settled === "boolean" && typeof p.terminal_matches === "boolean" && p.audit_matches === true);
    if (p.state === "settled") {
      // Existing immutable result/exposure/journal constraints establish definitive settlement.
      // No reconstruction with the successor's (possibly different) historical configuration.
      requireFact(p.started && p.settled && p.terminal_matches && typeof p.terminal_result_fingerprint === "string" && /^[a-f0-9]{64}$/u.test(p.terminal_result_fingerprint));
    } else {
      requireFact(!p.settled && p.terminal_result_fingerprint === null && !p.terminal_matches);
      if (p.state === "start_committed" || p.state === "reconciliation_required") {
        requireFact(p.started); blocked = true;
      } else {
        requireFact(["reserved", "prepared", "cancelled"].includes(p.state as string) && !p.started);
      }
    }
  }
  return !blocked;
}
