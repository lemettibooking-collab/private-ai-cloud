import assert from 'node:assert/strict';
import test from 'node:test';
const generation = await import(new URL('../lib/composition/project-planning-generation-config.ts',import.meta.url).href);
test('generation rejects real provider configuration and binds every reviewed policy field',()=>{
 assert.equal(generation.projectGenerationPolicy({identity:{providerKind:'openai'}}),null);
 assert.equal(generation.projectGenerationPolicy(null),null);
});
const policy={version:1,purpose:'project_document_planning',destination:'deterministic:local',identity:{providerId:'mock',providerKind:'mock',deploymentId:'mock-deployment',providerModelId:'mock-model',providerRequestModelId:'mock-model-v1',providerModelVersion:'mock-model-v1'},maxInputTokens:1000,maxOutputTokens:1000,maxCostUsdMicros:1000,dailyTokenBudget:10000,monthlyCostBudgetUsdCents:100,inputCostUsdMicrosPerMillionTokens:100,outputCostUsdMicrosPerMillionTokens:200,pricesVerifiedOn:'2020-01-02'};
test('review fingerprint rejects policy, model, prices, destination and preparation substitution',()=>{
 const p=generation.projectGenerationPolicy(policy);assert(p);
 const original=generation.generationOfferFingerprint('a'.repeat(64),p);
 for(const change of [{destination:'deterministic:other'},{maxInputTokens:999},{maxOutputTokens:999},{maxCostUsdMicros:999},{inputCostUsdMicrosPerMillionTokens:101},{outputCostUsdMicrosPerMillionTokens:201},{pricesVerifiedOn:'2020-01-01'},{dailyTokenBudget:9999},{monthlyCostBudgetUsdCents:99},{identity:{...p.identity,providerModelVersion:'other'}}]){
  const updated=generation.projectGenerationPolicy({...p,...change});assert(updated);assert.notEqual(generation.generationOfferFingerprint('a'.repeat(64),updated),original);
 }
 assert.notEqual(generation.generationOfferFingerprint('b'.repeat(64),p),original);
});
const composition=await import(new URL('../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const proposals=await import(new URL('../lib/planning/project-planning-generation.ts',import.meta.url).href);
test('policy calendar dates, future dates and hostile data fail closed without getter evaluation',()=>{
 for(const pricesVerifiedOn of ['2025-02-29','2020-02-30','9999-01-01','2020-01-01Z'])assert.equal(generation.projectGenerationPolicy({...policy,pricesVerifiedOn}),null);
 let calls=0;const hostile={...policy};Object.defineProperty(hostile,'identity',{get(){calls++;throw Error('secret');}});
 assert.equal(generation.projectGenerationPolicy(hostile),null);assert.equal(calls,0);
 const reordered={...policy,identity:Object.fromEntries(Object.entries(policy.identity).reverse())};
 assert.equal(generation.generationOfferFingerprint('x',generation.projectGenerationPolicy(reordered)),generation.generationOfferFingerprint('x',generation.projectGenerationPolicy(policy)));
});
test('consent precedes Run; attempt evidence is latched, never renewed, expired/future/mismatched authority denies',async()=>{
 const ms=Date.now(),authorizedAt=new Date(ms-3000).toISOString(),attemptStartedAt=new Date(ms-2000).toISOString(),evaluatedAt=new Date(ms-1000).toISOString(),expiresAt=new Date(ms+30000).toISOString();
 let allowed=true;
 const input={ownerUserId:'owner',workspaceId:'workspace',projectId:'project',runId:'run',stepId:'step',invocationId:'invocation',expectedIdentity:policy.identity,sourceRequestFingerprint:'sha256:'+'a'.repeat(64),runRevision:2,attemptNumber:1,modelProfileId:'profile',authorizedAt,attemptStartedAt,expiresAt,currentAuthority:async()=>allowed};
 const request={requirement:'approval_required',workspaceId:'workspace',projectId:'project',runId:'run',stepId:'step',invocationId:'invocation',candidateIdentity:policy.identity,sourceRequestFingerprint:input.sourceRequestFingerprint,runRevision:2,attemptNumber:1,modelProfileId:'profile',evaluatedAt};
 const resolver=composition.projectGenerationEgress(input),e=await resolver.resolve(request);assert(e);assert.equal(e.decidedAt,evaluatedAt);assert.equal(e.expiresAt,expiresAt);
 assert.strictEqual(await resolver.resolve({...request,evaluatedAt:new Date(ms).toISOString()}),e);
 for(const update of [{runRevision:3},{attemptNumber:2},{modelProfileId:'other'},{sourceRequestFingerprint:'sha256:'+'b'.repeat(64)},{runId:'other'},{candidateIdentity:{...policy.identity,providerModelVersion:'other'}}])assert.equal(await resolver.resolve({...request,...update}),null);
 allowed=false;assert.equal(await resolver.resolve(request),null);allowed=true;
 assert.equal(await composition.projectGenerationEgress({...input,expiresAt:new Date(ms-1).toISOString()}).resolve(request),null);
 assert.equal(await composition.projectGenerationEgress({...input,authorizedAt:new Date(ms+1000).toISOString()}).resolve(request),null);
 assert.equal(await composition.projectGenerationEgress({...input,expiresAt:new Date(ms+900000).toISOString()}).resolve(request),null);
});
test('generated output validator rejects duplicate keys/IDs, unknown fields, cycles and references outside exact source count',()=>{
 const task={id:'a',title:'Title',goal:'Goal',description:'',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['Check'],scope:['Scope'],sourceReferences:[0]};
 const make=(tasks:unknown[])=>JSON.stringify({schemaVersion:'pac-project-plan/v1',title:'Plan',tasks});
 assert(proposals.validateGeneratedProposal(make([task]),1).plan);
 for(const text of ['{"title":1,"title":2}',make([task,task]),make([{...task,unknown:true}]),make([{...task,dependencyIds:['missing']}]),make([{...task,dependencyIds:['a']}]),make([{...task,sourceReferences:[1]}]),'```json\n'+make([task])+'\n```'])assert.equal(proposals.validateGeneratedProposal(text,1).plan,null);
});
