import assert from 'node:assert/strict';
import test from 'node:test';
const config=await import(new URL('../lib/composition/project-planning-generation-config.ts',import.meta.url).href);
const binding=await import(new URL('../lib/composition/project-planning-openai-binding.ts',import.meta.url).href);
const now=Date.now(),model='gpt-test-2026-01-01';
const policy={version:2,purpose:'project_document_planning',destination:'https://api.openai.com/v1/responses',identity:{providerId:'openai',providerKind:'openai',deploymentId:'project-planner',providerModelId:model,providerRequestModelId:model,providerModelVersion:model},maxInputTokens:1000,maxOutputTokens:1000,maxCostUsdMicros:1000,dailyTokenBudget:10000,monthlyCostBudgetUsdCents:100,inputCostUsdMicrosPerMillionTokens:100,outputCostUsdMicrosPerMillionTokens:200,pricesVerifiedOn:'2020-01-01',api:{mode:'fake_sdk_only',credentialGeneration:'00000000-0000-4000-8000-000000000001',limits:{model,maxContextBytes:10000,maxInputTokens:1000,maxOutputTokens:1000,maxInvocationCostUsdMicros:1000,dailyBudgetUsdMicros:10000},pricing:{model,inputUsdMicrosPerMillionTokens:100,outputUsdMicrosPerMillionTokens:200,verifiedAt:now-1000,expiresAt:now+10000,source:'https://developers.openai.com/api/docs/pricing'},maxPreflightCostUsdMicros:10}};
test('OpenAI offer binds exact credential/limits/full price/preflight evidence; live mode always denied',()=>{
 const p=config.projectGenerationPolicy(policy,now);assert(p);const fp=config.generationOfferFingerprint('a'.repeat(64),p);
 for(const api of [{...policy.api,credentialGeneration:'00000000-0000-4000-8000-000000000002'},{...policy.api,maxPreflightCostUsdMicros:11},{...policy.api,pricing:{...policy.api.pricing,verifiedAt:now-500}},{...policy.api,limits:{...policy.api.limits,dailyBudgetUsdMicros:9999}}]){
  const updated=config.projectGenerationPolicy({...policy,api},now);assert(updated);assert.notEqual(config.generationOfferFingerprint('a'.repeat(64),updated),fp);
 }
 for(const api of [{...policy.api,mode:'live'},{...policy.api,maxPreflightCostUsdMicros:0},{...policy.api,pricing:{...policy.api.pricing,expiresAt:now}},{...policy.api,limits:{...policy.api.limits,model:'alias'}}])assert.equal(config.projectGenerationPolicy({...policy,api},now),null);
});
test('historical pricing can validate durable read at original authorization without renewing current authority',()=>{
 assert(config.projectGenerationPolicy(policy,now));assert.equal(config.projectGenerationPolicy(policy,now+20000),null);
});
test('fake SDK binding cannot default to a real SDK or discover models',()=>{
 const p=config.projectGenerationPolicy(policy,now);assert(p);assert.equal(binding.createPlanningOpenAIFakeProvider(p,'synthetic',{mode:'fake_sdk_only'}),null);
});
test('hostile generation transport is rejected before credential access, DB or SDK',async()=>{
 const composition=await import(new URL('../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
 let getters=0,connections=0,credentials=0,sdk=0;
 const service=composition.createProjectPlanningGeneration({database:{async connect(){connections++;throw Error('must not connect');}},domainWorkspaceId:'workspace-test',session:{pacIdentity:{provider:'github',providerSubject:'123'}},policy:()=>policy,provider:{identity:policy.identity},openAIFake:{mode:'fake_sdk_only',credentials:{async withKey(){credentials++;throw Error('must not read');}},createClient(){sdk++;throw Error('must not construct');}}});
 const raw={};Object.defineProperty(raw,'projectId',{get(){getters++;throw Error('secret');}});
 assert.equal((await service.generate(raw)).status,'invalid_input');assert.deepEqual([getters,connections,credentials,sdk],[0,0,0,0]);
});

test('fake SDK binding requires a trusted final count admission callback',()=>{
 const p=config.projectGenerationPolicy(policy,now);assert(p);let clients=0;
 assert.equal(binding.createPlanningOpenAIFakeProvider(p,'synthetic',{mode:'fake_sdk_only',createClient(){clients++;throw Error('must not construct');}}),null);
 assert.equal(clients,0);
});
