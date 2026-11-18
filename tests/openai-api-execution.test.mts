import assert from "node:assert/strict";
import {test} from "node:test";
import {promises as fs,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {createSubscriptionFixture} from "./fixtures/ai044-subscription.mts";
const api=await import(new URL("../lib/executors/openai-api-intent.ts",import.meta.url).href) as typeof import("../lib/executors/openai-api-intent");
const executor=await import(new URL("../lib/executors/openai-api-patch-executor.ts",import.meta.url).href) as typeof import("../lib/executors/openai-api-patch-executor");
const proof=await import(new URL("../lib/composition/owner-openai-api-proof.ts",import.meta.url).href) as typeof import("../lib/composition/owner-openai-api-proof");
const pricing=await import(new URL("../lib/integrations/openai-api/openai-api-pricing.server.ts",import.meta.url).href) as typeof import("../lib/integrations/openai-api/openai-api-pricing.server");
const response=await import(new URL("../lib/providers/openai-model-provider.ts",import.meta.url).href) as typeof import("../lib/providers/openai-model-provider");
const NOW=Date.parse("2026-10-28T12:00:00Z"),model="gpt-test-2026-10-01";
const limits={model,maxContextBytes:64000,maxInputTokens:8192,maxOutputTokens:2048,maxInvocationCostUsdMicros:20000,dailyBudgetUsdMicros:1000000};
const price={model,inputUsdMicrosPerMillionTokens:1000000,outputUsdMicrosPerMillionTokens:5000000,verifiedAt:NOW-1000,expiresAt:NOW+3600000,source:"https://developers.openai.com/api/docs/pricing" as const};
async function fixture() {
  const f=await createSubscriptionFixture({now:()=>NOW}),configuration={...f.configuration,identity:api.openAIApiExecutorIdentity},invocation={...f.rawInvocation,identity:api.openAIApiExecutorIdentity} as import("../lib/contracts/executor-adapter").ExecutorInvocationInput;
  const prepared=executor.prepareOpenAIApiRequest(configuration,invocation,f.context,model,2048);assert.ok(prepared);
  const s=f.intent;
  const intent=api.normalizeOpenAIApiIntent({schemaVersion:1,workspaceId:s.workspaceId,workspaceDatabaseId:s.workspaceDatabaseId,projectId:s.projectId,projectTaskId:s.projectTaskId,planId:s.planId,planRevision:s.planRevision,
    planFingerprint:s.planFingerprint,taskId:s.taskId,invocationId:s.invocationId,attempt:s.attempt,executor:api.openAIApiExecutorIdentity,accessMode:"api_key",model,credentialGeneration:"00000000-0000-4000-8000-000000009999",
    repository:s.repository,contextFingerprint:f.context.fingerprint,allowedWritePaths:s.allowedWritePaths,readContextPaths:s.readContextPaths,limits,pricing:price,maximumCostUsdMicros:18432,
    requestFingerprint:prepared.requestFingerprint,createdAt:NOW,expiresAt:NOW+60000});assert.ok(intent);
  return {...f,configuration,invocation,intent,prepared};
}
test("API: exact immutable minimal request, no tools/conversation/credits/OAuth and bounded output ceiling",async t=>{
  const f=await fixture();t.after(f.cleanup);const b=f.prepared.body;
  assert.deepEqual(Object.keys(b).sort(),["input","max_output_tokens","model","service_tier","store","stream"]);assert.equal(b.max_output_tokens,2048);assert.equal(b.service_tier,"default");assert.equal(b.store,false);assert.equal(b.stream,false);
  assert.ok(Object.isFrozen(b)&&Object.isFrozen(b.input)&&Object.isFrozen(b.input[0]));
  assert.deepEqual(executor.prepareOpenAIApiRequest(f.configuration,f.invocation,f.context,model,2048),f.prepared);
  assert.equal(api.openAIApiIntentCurrent(f.intent,NOW),true);assert.equal(api.openAIApiIntentCurrent(f.intent,NOW+60000),false);
});
for(const field of ["taskId","invocationId","credentialGeneration","requestFingerprint","contextFingerprint","accessMode","model","pricing","maximumCostUsdMicros","expiresAt"] as const) {
  test(`API intent malformed ${field} fails closed`,async t=>{const f=await fixture();t.after(f.cleanup);assert.equal(api.normalizeOpenAIApiIntent({...f.intent,[field]:null}),null);});
}
test("API intent: bounded hostile snapshot, getters/proxies/extra fields cannot grant anything",async t=>{
  const f=await fixture();t.after(f.cleanup);
  assert.equal(api.normalizeOpenAIApiIntent({...f.intent,key:"sk-FAKE_SECRET"}),null);
  assert.equal(api.normalizeOpenAIApiIntent({...f.intent,get pricing(){throw Error("SECRET");}}),null);
  assert.equal(api.normalizeOpenAIApiIntent(new Proxy(f.intent,{ownKeys(){throw Error("SECRET");}})),null);
  const a=api.normalizeOpenAIApiIntent(f.intent),b=api.normalizeOpenAIApiIntent(f.intent);assert.deepEqual(a,b);assert.notEqual(a,b);assert.ok(Object.isFrozen(a)&&Object.isFrozen(a?.limits));
});
test("API: a fabricated start capability cannot produce an inference POST",async t=>{
  const f=await fixture();t.after(f.cleanup);let count=0,post=0;
  const transport:typeof fetch=async url=>{if(String(url).endsWith("/input_tokens")){count++;return Response.json({object:"response.input_tokens",input_tokens:100});}post++;throw Error("unexpected POST");};
  const result=await executor.createOpenAIApiPatchExecutor(f.configuration,transport,()=>NOW).execute({invocation:f.invocation,context:f.context,intent:f.intent,key:"FAKE_KEY",approvalCapability:Object.freeze({kind:"openai_api_approval"}),fence:async()=>Object.freeze({kind:"openai_api_start"})});
  assert.equal(result,null);assert.equal(count,0);assert.equal(post,0);
  assert.equal(executor.readOpenAIApiOutcome(Object.freeze({kind:"openai_api_outcome"})),null);
});
for(const action of ["prepare","request","approve","reject","invoke"]) {
  test(`API ${action}: missing Owner produces zero raw/context/key/pricing/provider accesses`,async()=>{
    let touched=0;const no=async()=>{touched++;throw Error("must not read");};
    const p=proof.createOwnerOpenAIApiProof({domainWorkspaceId:"workspace-primary",identitySource:{resolve:()=>null},database:{connect:no},
      policy:{projectId:"project-a",projectTaskId:"task-a",developmentRunId:"run-a",planRevision:1,planFingerprint:"a".repeat(64),repository:{id:"feature",baseline:"b".repeat(40)},repositoryRoot:"/tmp/no-read",repositoryAllowlist:["lib/feature"],readContextPaths:["lib/feature/a.ts"]},
      credentials:{facts:no,save:no,configure:no,disconnect:no,withKey:no},pricing:no,contextSource:{readExactObject:no},transport:no,clock:()=>NOW} as import("../lib/composition/owner-openai-api-proof").OwnerOpenAIApiProofDependencies);
    assert.deepEqual(await p.act({mode:"openai_api",action,selection:"a".repeat(64)}),{status:"unavailable"});assert.deepEqual(await p.load(),{status:"unavailable"});assert.equal(touched,0);
  });
}
test("API form: exact explicit mode; duplicates, missing mode, extra identity, files and aliases deny",()=>{
  const form=()=>{const f=new FormData();f.set("mode","openai_api");f.set("action","invoke");f.set("selection","a".repeat(64));return f;};
  assert.deepEqual(proof.ownerOpenAIApiProofInput(form()),{mode:"openai_api",action:"invoke",selection:"a".repeat(64)});
  for(const change of [(f:FormData)=>f.delete("mode"),(f:FormData)=>f.set("mode","chatgpt_plan"),(f:FormData)=>f.set("model","other"),(f:FormData)=>f.append("mode","openai_api"),(f:FormData)=>f.set("selection","x".repeat(65)),(f:FormData)=>f.set("action",new Blob(["invoke"]))]) {const f=form();change(f);assert.equal(proof.ownerOpenAIApiProofInput(f),null);}
});
test("API pricing: protected server-only catalog, exact verified dates, no browser/model-output/credential pricing",async t=>{
  const directory=await fs.realpath(await fs.mkdtemp(join(tmpdir(),"pac-api-price-")));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const path=join(directory,"prices.json");
  await fs.writeFile(path,JSON.stringify({version:1,prices:[price]}),{mode:0o600});assert.deepEqual(await pricing.readOpenAIApiPricing(model,NOW,path),price);
  assert.equal(await pricing.readOpenAIApiPricing("gpt-latest",NOW,path),null);assert.equal(await pricing.readOpenAIApiPricing(model,NOW+3600000,path),null);
  await fs.chmod(path,0o644);assert.equal(await pricing.readOpenAIApiPricing(model,NOW,path),null);await fs.chmod(path,0o600);
  await fs.writeFile(path,JSON.stringify({version:1,prices:[price,price]}));assert.equal(await pricing.readOpenAIApiPricing(model,NOW,path),null);
  await fs.writeFile(path,"x".repeat(16385));assert.equal(await pricing.readOpenAIApiPricing(model,NOW,path),null);
});
test("API protocol decoder reuses accepted bounded Responses semantics and never leaks raw refusal/error",()=>{
  const config={identity:{providerId:"openai",providerKind:"openai",deploymentId:"api-patch",providerModelId:model,providerRequestModelId:model,providerModelVersion:model} as const,timeoutMs:120000,maxInputTokens:8192,maxOutputTokens:2048,inputCostUsdMicrosPerMillionTokens:1000000,outputCostUsdMicrosPerMillionTokens:5000000};
  const good={model,status:"completed",error:null,incomplete_details:null,output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"test"}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}};
  assert.equal(response.readOpenAIPatchResponse(good,config,100)?.text,"test");
  for(const change of [{status:"in_progress"},{model:"other"},{error:{message:"SECRET"}},{incomplete_details:{reason:"other"}},{usage:{input_tokens:100,output_tokens:20,total_tokens:121}},{output:[{type:"function_call"}]}])assert.equal(response.readOpenAIPatchResponse({...good,...change},config,100),null);
  const filtered=response.readOpenAIPatchResponse({...good,output:[{type:"message",role:"assistant",status:"completed",content:[{type:"refusal",refusal:"RAW_SECRET_ERROR"}]}]},config,100);
  assert.equal(filtered?.text,null);assert.ok(!JSON.stringify(filtered).includes("RAW_SECRET_ERROR"));
});
test("API runner: explicit selection, no automatic fallback, no key/SDK/DB in browser, RU/EN parity",async()=>{
  const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
  const page=read("app/workflows/development-execution/proof/page.tsx");assert.match(page,/mode==="openai_api"/u);assert.match(page,/mode!=="chatgpt_plan"/u);
  const component=read("components/domain/owner-console/openai-api-production-proof.tsx");assert.doesNotMatch(component,/fetch\(|apiKey|accessToken|startCapability|lib\/db|useEffect|setInterval|requestSubmit/u);
  const root=read("lib/composition/owner-openai-api-proof.server.ts");assert.match(root,/^import "server-only"/u);assert.doesNotMatch(root,/OPENAI_API_KEY|api\.openai\.com|new OpenAI|withSubscriptionAccess/u);
  const {openAIApiProofCopy}=await import(new URL("../lib/i18n/openai-api-proof-copy.ts",import.meta.url).href) as typeof import("../lib/i18n/openai-api-proof-copy");
  assert.deepEqual(Object.keys(openAIApiProofCopy.ru),Object.keys(openAIApiProofCopy.en));
});
