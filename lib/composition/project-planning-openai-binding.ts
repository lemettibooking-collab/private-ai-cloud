// Trusted local integration seam. No default SDK construction, key lookup, env or live activation.
import type { OpenAIModelProviderClient,OpenAIModelProviderClientOptions } from '../providers/openai-model-provider';
import type { OpenAIApiCredentialStore } from '../integrations/openai-api/openai-api-credential-store';
import type { ProjectGenerationPolicy } from './project-planning-generation-config';
import type { ModelProvider } from '../contracts/model-provider-adapter';
// @ts-expect-error Direct Node execution requires extension.
import { createOpenAIModelProvider } from '../providers/openai-model-provider.ts';
// @ts-expect-error Direct Node execution requires extension.
import { planDigest } from '../planning/project-planning-contract.ts';
export type PlanningOpenAIFakeBinding=Readonly<{mode:'fake_sdk_only';credentials:OpenAIApiCredentialStore;createClient:(options:OpenAIModelProviderClientOptions)=>OpenAIModelProviderClient}>;
/** Requires caller-held credential lock. Every HTTP-shaped action is an explicitly injected fake SDK.
 * Fixed tier and payload bounds are enforced below the existing adapter, preserving its proof decoder. */
export function createPlanningOpenAIFakeProvider(p:ProjectGenerationPolicy,key:string,binding:PlanningOpenAIFakeBinding,admitCount?:()=>Promise<void>):ModelProvider|null{
 if(!p.api||binding.mode!=='fake_sdk_only'||typeof binding.createClient!=='function'||typeof admitCount!=='function')return null;
 const made=createOpenAIModelProvider({identity:p.identity,timeoutMs:120000,maxInputTokens:p.maxInputTokens,maxOutputTokens:p.maxOutputTokens,inputCostUsdMicrosPerMillionTokens:p.inputCostUsdMicrosPerMillionTokens,outputCostUsdMicrosPerMillionTokens:p.outputCostUsdMicrosPerMillionTokens},{apiKey:key},{createClient(options){
  const client=binding.createClient(options);
  return {models:{async retrieve(){throw Error('planning_discovery_denied');}},responses:{inputTokens:{async count(input){if(Buffer.byteLength(JSON.stringify(input),'utf8')>p.api!.limits.maxContextBytes)throw Error('planning_context_denied');await admitCount();return client.responses.inputTokens.count(input);}},async create(input){const payload={...input,service_tier:'default'};if(Buffer.byteLength(JSON.stringify(payload),'utf8')>p.api!.limits.maxContextBytes)throw Error('planning_context_denied');const r=await client.responses.create(payload as typeof input);if(!r||typeof r!=='object'||Object.getOwnPropertyDescriptor(r,'service_tier')?.value!=='default')throw Error('planning_tier_unknown');return r;}}};
 }});
 return made.provider;
}
export function samePlanningCredentialLimits(p:ProjectGenerationPolicy,limits:unknown){return !!p.api&&planDigest(p.api.limits)===planDigest(limits);}
