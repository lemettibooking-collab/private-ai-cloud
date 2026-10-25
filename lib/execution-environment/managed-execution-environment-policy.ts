import type { ExecutionEnvironment, ManagedEnvironmentRequirements } from "./execution-environment";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { snapshot, record, normalizeEnvironment, normalizeEnvironmentRequirements, supported, freezeDeep } from "./execution-environment.ts";

export type EnvironmentReason = "invalid_environment_input" | "private_execution_deferred" | "future_environment_unsupported" | "environment_kind_mismatch"
  | "programmatic_interface_unproven" | "managed_capability_unproven" | "residency_mismatch" | "privacy_requirement_unmet";
export type ManagedEnvironmentDecision = Readonly<{
  verdict: "allow" | "deny"; eligibility: "eligible" | "ineligible";
  normalizedEnvironment: ExecutionEnvironment | null; reasons: readonly EnvironmentReason[];
  runtimeDispatchAllowed: false; dispatchAuthorized: false;
}>;
/** No provider claims implied by kind or brand; supported requires explicit evidence. */
function reasonsFor(e: ExecutionEnvironment, r: ManagedEnvironmentRequirements): EnvironmentReason[] {
  const reasons: EnvironmentReason[] = [];
  if (e.kind === "local" || e.kind === "vps_self_hosted") reasons.push("private_execution_deferred");
  if (e.kind === "future_provider") reasons.push("future_environment_unsupported");
  if (!r.kinds.includes(e.kind)) reasons.push("environment_kind_mismatch");
  if (e.kind === "codex_cloud_if_supported" && !supported(e.programmaticInterface)) reasons.push("programmatic_interface_unproven");
  if (r.capabilities.some(k => !supported(e.capabilities[k]))) reasons.push("managed_capability_unproven");
  if (r.residency !== null && (!supported(e.capabilities.data_residency) || !supported(e.residency.evidence) || !e.residency.regions.includes(r.residency))) reasons.push("residency_mismatch");
  if (r.privacy.length && (!supported(e.capabilities.data_handling) || r.privacy.some(k => !supported(e.privacy[k])))) reasons.push("privacy_requirement_unmet");
  return reasons;
}
/** Pure trusted snapshot comparison. Does not allocate anything or enforce provider internals. */
export function evaluateManagedExecutionEnvironment(input: unknown): ManagedEnvironmentDecision {
  try {
    const r = record(snapshot(input), ["environment", "requirements"]), environment = freezeDeep(normalizeEnvironment(r.environment));
    const reasons = reasonsFor(environment, freezeDeep(normalizeEnvironmentRequirements(r.requirements)));
    return freezeDeep({ verdict: reasons.length ? "deny" : "allow", eligibility: reasons.length ? "ineligible" : "eligible",
      normalizedEnvironment: reasons.length ? null : environment, reasons, runtimeDispatchAllowed: false, dispatchAuthorized: false });
  } catch {
    return freezeDeep({ verdict: "deny", eligibility: "ineligible", normalizedEnvironment: null,
      reasons: ["invalid_environment_input"], runtimeDispatchAllowed: false, dispatchAuthorized: false });
  }
}
