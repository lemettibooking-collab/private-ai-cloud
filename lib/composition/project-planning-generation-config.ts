import type { FeaturePlanPlanningPolicy } from '../development/feature-plan-planning-run';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { exactOwnData } from '../db/executor-start-transaction.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { planDigest } from '../planning/project-planning-contract.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { validateAndNormalizeModelProviderIdentity } from '../contracts/model-provider-adapter.ts';
export type ProjectGenerationPolicy = FeaturePlanPlanningPolicy & Readonly<{version:number;destination:string;purpose:'project_document_planning'}>;
export function projectGenerationPolicy(raw:unknown):ProjectGenerationPolicy|null {
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
 return planDigest(['pac.project-generation-offer.v1',preparationFingerprint,policy.version,policy.purpose,policy.destination,['providerId','providerKind','deploymentId','providerModelId','providerRequestModelId','providerModelVersion'].map(key=>policy.identity[key as keyof typeof policy.identity]),policy.maxInputTokens,policy.maxOutputTokens,policy.maxCostUsdMicros,policy.inputCostUsdMicrosPerMillionTokens,policy.outputCostUsdMicrosPerMillionTokens,policy.pricesVerifiedOn,policy.dailyTokenBudget,policy.monthlyCostBudgetUsdCents]);
}
