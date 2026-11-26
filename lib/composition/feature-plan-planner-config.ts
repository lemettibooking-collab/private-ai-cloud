// AI-039.1 trusted `feature_plan_planning` budget policy (pure parser; the caller passes the server
// environment). Provider-specific configuration lives here, in the composition layer, so the planning
// domain (lib/development) stays provider-neutral. Fails closed: any missing, malformed or out-of-bounds value → null, and the production
// planner stays unbound (`planner_unavailable`). Never reads, accepts or returns a credential; the API
// key is checked for presence only by the server binding and handed to the provider factory there.
//
//   PAC_PLANNER_PROVIDER                              "openai" (the only provider route implemented)
//   PAC_PLANNER_MODEL_ID                              provider model alias (display / audit)
//   PAC_PLANNER_REQUEST_MODEL_ID                      pinned model sent in the request
//   PAC_PLANNER_MODEL_VERSION                         exact model string the provider returns
//   PAC_PLANNER_INPUT_PRICE_USD_MICROS_PER_MILLION    price per 1M input tokens (USD micros)
//   PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION   price per 1M output tokens (USD micros)
//   PAC_PLANNER_PRICES_VERIFIED_ON                    YYYY-MM-DD the Owner verified the prices (not future)
//   PAC_PLANNER_MAX_INPUT_TOKENS                      per-call input ceiling
//   PAC_PLANNER_MAX_OUTPUT_TOKENS                     per-call output ceiling (≤ plannerLimits.maxOutputTokens)
//   PAC_PLANNER_MAX_COST_USD_MICROS                   per-call cost ceiling (≤ USD 1)
//   PAC_PLANNER_DAILY_TOKEN_BUDGET                    aggregate daily token window of the planning binding
//   PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS         aggregate monthly cost window of the planning binding
//
// The daily window must hold MAX_INPUT + MAX_OUTPUT tokens and the monthly window MAX_COST.
import type { FeaturePlanPlanningPolicy } from "../development/feature-plan-planning-run";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { plannerLimits } from "../development/feature-plan-planner.ts";

export const plannerConfigLimits = Object.freeze({
  maxInputTokens: 16_000,
  maxCostUsdMicros: 1_000_000, // USD 1.00 per planning call, hard ceiling
  maxPriceUsdMicrosPerMillionTokens: 1_000_000_000, // USD 1000 per 1M tokens
  maxDailyTokenBudget: 10_000_000,
  maxMonthlyCostBudgetUsdCents: 100_000, // USD 1000
});

export const plannerProviderIdentity = Object.freeze({
  providerId: "provider-openai",
  deploymentId: "deployment-openai-feature-planning",
});

const modelNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const integerPattern = /^[0-9]{1,12}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

type Environment = Readonly<Record<string, string | undefined>>;

function text(env: Environment, name: string): string | null {
  const value = env[name];
  return typeof value === "string" && modelNamePattern.test(value) ? value : null;
}

function integer(env: Environment, name: string, min: number, max: number): number | null {
  const value = env[name];
  if (typeof value !== "string" || !integerPattern.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function verifiedOn(env: Environment, today: Date): string | null {
  const value = env.PAC_PLANNER_PRICES_VERIFIED_ON;
  if (typeof value !== "string" || !datePattern.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return parsed <= today.getTime() ? value : null;
}

export function parseFeaturePlanPlannerPolicy(env: Environment, today: Date = new Date()): FeaturePlanPlanningPolicy | null {
  try {
    if (env.PAC_PLANNER_PROVIDER !== "openai") return null;
    const providerModelId = text(env, "PAC_PLANNER_MODEL_ID");
    const providerRequestModelId = text(env, "PAC_PLANNER_REQUEST_MODEL_ID");
    const providerModelVersion = text(env, "PAC_PLANNER_MODEL_VERSION");
    const inputPrice = integer(env, "PAC_PLANNER_INPUT_PRICE_USD_MICROS_PER_MILLION", 0, plannerConfigLimits.maxPriceUsdMicrosPerMillionTokens);
    const outputPrice = integer(env, "PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION", 0, plannerConfigLimits.maxPriceUsdMicrosPerMillionTokens);
    const pricesVerifiedOn = verifiedOn(env, today);
    const maxInputTokens = integer(env, "PAC_PLANNER_MAX_INPUT_TOKENS", 1, plannerConfigLimits.maxInputTokens);
    const maxOutputTokens = integer(env, "PAC_PLANNER_MAX_OUTPUT_TOKENS", 1, plannerLimits.maxOutputTokens);
    const maxCostUsdMicros = integer(env, "PAC_PLANNER_MAX_COST_USD_MICROS", 1, plannerConfigLimits.maxCostUsdMicros);
    const dailyTokenBudget = integer(env, "PAC_PLANNER_DAILY_TOKEN_BUDGET", 1, plannerConfigLimits.maxDailyTokenBudget);
    const monthlyCostBudgetUsdCents = integer(env, "PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS", 1, plannerConfigLimits.maxMonthlyCostBudgetUsdCents);
    if (providerModelId === null || providerRequestModelId === null || providerModelVersion === null || inputPrice === null
      || outputPrice === null || pricesVerifiedOn === null || maxInputTokens === null || maxOutputTokens === null
      || maxCostUsdMicros === null || dailyTokenBudget === null || monthlyCostBudgetUsdCents === null) return null;
    // The aggregate windows must be able to hold ONE call at its ceilings (the runtime's capability
    // fit rule); a policy that can never plan is a configuration error, not a budget outcome.
    if (maxInputTokens + maxOutputTokens > dailyTokenBudget || maxCostUsdMicros > monthlyCostBudgetUsdCents * 10_000) return null;
    return Object.freeze({
      identity: Object.freeze({
        providerId: plannerProviderIdentity.providerId,
        providerKind: "openai" as const,
        deploymentId: plannerProviderIdentity.deploymentId,
        providerModelId,
        providerRequestModelId,
        providerModelVersion,
      }),
      maxInputTokens,
      maxOutputTokens,
      inputCostUsdMicrosPerMillionTokens: inputPrice,
      outputCostUsdMicrosPerMillionTokens: outputPrice,
      maxCostUsdMicros,
      dailyTokenBudget,
      monthlyCostBudgetUsdCents,
      pricesVerifiedOn,
    });
  } catch {
    return null;
  }
}

// Worst-case cost of ONE planning call under this policy (USD micros, rounded up), before the
// per-call ceiling: every input token at the input price plus every output token at the output price.
// The runtime's preflight additionally caps generation so the reserved cost never exceeds
// maxCostUsdMicros.
export function worstCasePlanningCallCostUsdMicros(policy: FeaturePlanPlanningPolicy): number {
  const numerator = BigInt(policy.maxInputTokens) * BigInt(policy.inputCostUsdMicrosPerMillionTokens)
    + BigInt(policy.maxOutputTokens) * BigInt(policy.outputCostUsdMicrosPerMillionTokens);
  return Number((numerator + BigInt(999_999)) / BigInt(1_000_000));
}
