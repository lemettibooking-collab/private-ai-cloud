import type { FeaturePlanPlanningPolicy } from '../development/feature-plan-planning-run';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { exactOwnData } from '../db/executor-start-transaction.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { planDigest } from '../planning/project-planning-contract.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { validateAndNormalizeModelProviderIdentity } from '../contracts/model-provider-adapter.ts';
import type { OpenAIApiLimits } from '../../types/openai-api-access';
import type { OpenAIApiPrice } from '../integrations/openai-api/openai-api-policy';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { normalizeOpenAIApiLimits,normalizeOpenAIApiPrice,openAIApiMaximumCost } from '../integrations/openai-api/openai-api-policy.ts';
export type PlanningApiEvidence=Readonly<{mode:'fake_sdk_only';credentialGeneration:string;limits:OpenAIApiLimits;pricing:OpenAIApiPrice;maxPreflightCostUsdMicros:number}>;
export type ProjectGenerationPolicy = FeaturePlanPlanningPolicy & Readonly<{version:number;destination:string;purpose:'project_document_planning';api?:PlanningApiEvidence}>;
export function projectGenerationPolicy(raw:unknown,now=Date.now()):ProjectGenerationPolicy|null {
 const real=exactOwnData(raw,['version','destination','purpose','identity','maxInputTokens','maxOutputTokens','inputCostUsdMicrosPerMillionTokens','outputCostUsdMicrosPerMillionTokens','maxCostUsdMicros','dailyTokenBudget','monthlyCostBudgetUsdCents','pricesVerifiedOn','api']);
 if(real){
  const a=exactOwnData(real.api,['mode','credentialGeneration','limits','pricing','maxPreflightCostUsdMicros']);
  const limits=normalizeOpenAIApiLimits(a?.limits),pricing=normalizeOpenAIApiPrice(a?.pricing,now);
  const identity=validateAndNormalizeModelProviderIdentity(real.identity).normalizedIdentity;
  if(real.version!==2||real.destination!=='https://api.openai.com/v1/responses'||!a||a.mode!=='fake_sdk_only'||typeof a.credentialGeneration!=='string'||! /^(?:[a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(a.credentialGeneration)||!limits||!pricing||!identity||identity.providerKind!=='openai'||identity.providerModelId!==limits.model||identity.providerRequestModelId!==limits.model||identity.providerModelVersion!==limits.model||pricing.model!==limits.model||!Number.isSafeInteger(a.maxPreflightCostUsdMicros)||Number(a.maxPreflightCostUsdMicros)<1||Number(a.maxPreflightCostUsdMicros)>1000000)return null;
  const common={...real};delete common.api;
  const base=projectGenerationPolicy({...common,version:1,destination:'deterministic:validation',identity:{...identity,providerKind:'mock'}});
  // Validate the common policy without admitting api into the v1 exact parser.
  if(!base)return null;
  if(limits.maxInputTokens!==real.maxInputTokens||limits.maxOutputTokens!==real.maxOutputTokens||limits.maxInvocationCostUsdMicros!==real.maxCostUsdMicros||pricing.inputUsdMicrosPerMillionTokens!==real.inputCostUsdMicrosPerMillionTokens||pricing.outputUsdMicrosPerMillionTokens!==real.outputCostUsdMicrosPerMillionTokens||!openAIApiMaximumCost(limits,pricing,limits.maxInputTokens,now))return null;
  return Object.freeze({...base,version:2,destination:real.destination,identity,api:Object.freeze({mode:'fake_sdk_only',credentialGeneration:a.credentialGeneration,limits,pricing,maxPreflightCostUsdMicros:a.maxPreflightCostUsdMicros as number})});
 }
 const f=exactOwnData(raw,['version','destination','purpose','identity','maxInputTokens','maxOutputTokens','inputCostUsdMicrosPerMillionTokens','outputCostUsdMicrosPerMillionTokens','maxCostUsdMicros','dailyTokenBudget','monthlyCostBudgetUsdCents','pricesVerifiedOn']);
 if(!f||f.version!==1||f.purpose!=='project_document_planning'||typeof f.destination!=='string'||!/^deterministic:[a-z0-9_-]{1,64}$/u.test(f.destination))return null;
 const identity=validateAndNormalizeModelProviderIdentity(f.identity).normalizedIdentity;
 if(!identity||identity.providerKind!=='mock')return null;
 for(const key of ['maxInputTokens','maxOutputTokens','maxCostUsdMicros','dailyTokenBudget','monthlyCostBudgetUsdCents'])if(!Number.isSafeInteger(f[key])||Number(f[key])<1||Number(f[key])>10000000)return null;
 for(const key of ['inputCostUsdMicrosPerMillionTokens','outputCostUsdMicrosPerMillionTokens'])if(!Number.isSafeInteger(f[key])||Number(f[key])<0||Number(f[key])>1000000000)return null;
 if(Number(f.maxInputTokens)>16000||Number(f.maxOutputTokens)>16000||Number(f.maxCostUsdMicros)>1000000||Number(f.maxInputTokens)+Number(f.maxOutputTokens)>Number(f.dailyTokenBudget)||Number(f.maxCostUsdMicros)>Number(f.monthlyCostBudgetUsdCents)*10000||typeof f.pricesVerifiedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(f.pricesVerifiedOn))return null;
 const date=Date.parse(f.pricesVerifiedOn+'T00:00:00.000Z');
 if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==f.pricesVerifiedOn||date>Date.now())return null;
 return Object.freeze({...f,identity}) as ProjectGenerationPolicy;
}
export function generationOfferFingerprint(preparationFingerprint:string,policy:ProjectGenerationPolicy){
 return planDigest(['pac.project-generation-offer.v1',preparationFingerprint,policy.version,policy.purpose,policy.destination,['providerId','providerKind','deploymentId','providerModelId','providerRequestModelId','providerModelVersion'].map(key=>policy.identity[key as keyof typeof policy.identity]),policy.maxInputTokens,policy.maxOutputTokens,policy.maxCostUsdMicros,policy.inputCostUsdMicrosPerMillionTokens,policy.outputCostUsdMicrosPerMillionTokens,policy.pricesVerifiedOn,policy.dailyTokenBudget,policy.monthlyCostBudgetUsdCents,...(policy.api?[policy.api]:[])]);
}
