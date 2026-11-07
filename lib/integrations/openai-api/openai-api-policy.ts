import type { OpenAIApiLimits } from "../../../types/openai-api-access";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "../../db/executor-start-transaction.ts";

export const openAIApiBounds = Object.freeze({
  maxContextBytes: 1024 * 1024, maxInputTokens: 128_000, maxOutputTokens: 16_384,
  maxInvocationCostUsdMicros: 10_000_000, dailyBudgetUsdMicros: 100_000_000,
  priceFreshnessMs: 24 * 60 * 60 * 1000,
});
const modelId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(v);
const positive = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max;
export function normalizeOpenAIApiLimits(raw: unknown): OpenAIApiLimits | null {
  const r = exactOwnData(raw, ["model", "maxContextBytes", "maxInputTokens", "maxOutputTokens", "maxInvocationCostUsdMicros", "dailyBudgetUsdMicros"]);
  if (!r || !modelId(r.model) || !/-\d{4}-\d{2}-\d{2}$/u.test(r.model)) return null;
  for (const k of ["maxContextBytes", "maxInputTokens", "maxOutputTokens", "maxInvocationCostUsdMicros", "dailyBudgetUsdMicros"] as const) {
    if (!positive(r[k], openAIApiBounds[k])) return null;
  }
  if ((r.maxInvocationCostUsdMicros as number) > (r.dailyBudgetUsdMicros as number)) return null;
  return Object.freeze({ model: r.model, maxContextBytes: r.maxContextBytes as number, maxInputTokens: r.maxInputTokens as number,
    maxOutputTokens: r.maxOutputTokens as number, maxInvocationCostUsdMicros: r.maxInvocationCostUsdMicros as number, dailyBudgetUsdMicros: r.dailyBudgetUsdMicros as number });
}

/** Trusted, operator-reviewed pricing evidence, NOT a field supplied by an invocation or browser.
 * Exact model snapshot only; standard uncached input price is the conservative input rate.
 * No free tiers, credits, cached discounts, batch or priority/service-tier assumptions. */
export type OpenAIApiPrice = Readonly<{
  model: string; inputUsdMicrosPerMillionTokens: number; outputUsdMicrosPerMillionTokens: number;
  verifiedAt: number; expiresAt: number; source: "https://developers.openai.com/api/docs/pricing";
}>;
export function normalizeOpenAIApiPrice(raw: unknown, now: number): OpenAIApiPrice | null {
  const p = exactOwnData(raw, ["model", "inputUsdMicrosPerMillionTokens", "outputUsdMicrosPerMillionTokens", "verifiedAt", "expiresAt", "source"]);
  if (!p || !modelId(p.model) || !/-\d{4}-\d{2}-\d{2}$/u.test(p.model)
    || !positive(p.inputUsdMicrosPerMillionTokens, 1_000_000_000) || !positive(p.outputUsdMicrosPerMillionTokens, 1_000_000_000)
    || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(p.verifiedAt) || !Number.isSafeInteger(p.expiresAt)
    || (p.verifiedAt as number) < 0 || (p.verifiedAt as number) > now || (p.expiresAt as number) <= now
    || (p.expiresAt as number) - (p.verifiedAt as number) > openAIApiBounds.priceFreshnessMs
    || p.source !== "https://developers.openai.com/api/docs/pricing") return null;
  return Object.freeze({ model: p.model, inputUsdMicrosPerMillionTokens: p.inputUsdMicrosPerMillionTokens,
    outputUsdMicrosPerMillionTokens: p.outputUsdMicrosPerMillionTokens, verifiedAt: p.verifiedAt as number,
    expiresAt: p.expiresAt as number, source: p.source });
}

/** Pure ceiling arithmetic, not an approval, reservation or dispatch capability.
 * The input count MUST come from native count for the exact immutable provider payload.
 * Charges are rounded upward independently; hidden reasoning tokens are inside max_output_tokens. */
export function openAIApiMaximumCost(rawLimits: unknown, rawPrice: unknown, inputTokenCount: unknown, now: number) {
  const limits = normalizeOpenAIApiLimits(rawLimits), price = normalizeOpenAIApiPrice(rawPrice, now);
  if (!limits || !price || limits.model !== price.model || !positive(inputTokenCount, limits.maxInputTokens)) return null;
  const maximum = BigInt(openAIApiUsageCost(price, inputTokenCount, limits.maxOutputTokens)!);
  if (maximum > BigInt(limits.maxInvocationCostUsdMicros) || maximum > BigInt(limits.dailyBudgetUsdMicros)) return null;
  return Object.freeze({ inputTokenCount, effectiveMaxOutputTokens: limits.maxOutputTokens, maximumCostUsdMicros: Number(maximum) });
}

/** Standard uncached rates, integer USD micros, rounded up independently. No discount assumptions. */
export function openAIApiUsageCost(price: OpenAIApiPrice, input: number, output: number): number | null {
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000)) return null;
  const cost = (tokens: number, rate: number) => (BigInt(tokens) * BigInt(rate) + BigInt(999_999)) / BigInt(1_000_000);
  const n = cost(input, price.inputUsdMicrosPerMillionTokens) + cost(output, price.outputUsdMicrosPerMillionTokens);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}
