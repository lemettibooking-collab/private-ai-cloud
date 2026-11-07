import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {promises as fs} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {LiveDatabase} from "../pg/helpers/live-pg";
import type {OwnerOpenAIApiProofView} from "../../types/openai-api-proof";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {subscriptionApprovalPgFixture} from "./ai044-subscription-approval-pg.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {createOwnerOpenAIApiProof} from "../../lib/composition/owner-openai-api-proof.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {createOpenAIApiCredentialStore} from "../../lib/integrations/openai-api/openai-api-credential-store.ts";
import type {OwnerOpenAIApiProofDependencies} from "../../lib/composition/owner-openai-api-proof";
export function apiAvailable(v:OwnerOpenAIApiProofView):asserts v is Extract<OwnerOpenAIApiProofView,{status:"available"}>{assert.equal(v.status,"available");}
export async function apiProofPgFixture(db:LiveDatabase,label:string,options:{shared?:Awaited<ReturnType<typeof subscriptionApprovalPgFixture>>["foundation"];daily?:number;path?:string}={}) {
  const path=options.path??"src/server/terminal/account/analytics.ts",text="export const analytics = 1;\n";
  const x=await subscriptionApprovalPgFixture(db,`api-${label}`,{registerAuthority:false,writePaths:[path],foundation:options.shared});
  assert.equal((await x.controller.createRun({...await x.command(),developmentRunId:x.intent.attempt.developmentRunId,developmentTaskId:x.intent.taskId,admission:x.configuration.admission})).status,"applied");
  let state=await x.controller.read("project-a",x.task.taskId);assert.ok(state);
  assert.equal((await x.controller.transitionRun({...await x.command(),developmentRunId:state.runs[0].run.id,expectedRunRevision:state.runs[0].revision,event:{type:"start_attempt"}})).status,"applied");
  state=await x.controller.read("project-a",x.task.taskId);assert.ok(state?.approvedPlan);
  const directory=await fs.realpath(await fs.mkdtemp(join(tmpdir(),"pac-api-proof-pg-"))),root=join(directory,"credentials");
  const credentials=createOpenAIApiCredentialStore(root),key="sk-FAKE_ONLY_NOT_A_CREDENTIAL_00000001";
  const limits={model:"gpt-test-2026-10-01",maxContextBytes:64000,maxInputTokens:8192,maxOutputTokens:2048,maxInvocationCostUsdMicros:20000,dailyBudgetUsdMicros:options.daily??1000000};
  assert.equal(await credentials.save({ownerUserId:x.ownerId,domainWorkspaceId:x.tenant.workspaceId},key,limits),true);
  let now=Date.now(),pricing:unknown={model:limits.model,inputUsdMicrosPerMillionTokens:1000000,outputUsdMicrosPerMillionTokens:5000000,verifiedAt:now-1000,expiresAt:now+3600000,source:"https://developers.openai.com/api/docs/pricing"};
  let posts=0,counts=0,identity:unknown={userId:x.ownerId};
  const bodies:unknown[]=[],readPaths:string[]=[];
  let proposal:unknown={patch:`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const analytics = 1;\n+export const analytics = 2;\n`,changedPaths:[path],summary:"Bounded proposal for independent review."};
  let response:(body:Record<string,unknown>)=>Promise<Response>=async body=>Response.json({id:"resp_fake",model:body.model,service_tier:"default",status:"completed",error:null,incomplete_details:null,
    output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(proposal)}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}});
  let countResponse:()=>Promise<Response>=async()=>Response.json({object:"response.input_tokens",input_tokens:100});
  const transport:typeof fetch=async(url,init)=>{
    assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");assert.equal(init?.headers&&new Headers(init.headers).get("authorization"),`Bearer ${key}`);
    const b=JSON.parse(String(init?.body)) as Record<string,unknown>;
    if(String(url)==="https://api.openai.com/v1/responses/input_tokens"){counts++;bodies.push({count:b});return countResponse();}
    assert.equal(String(url),"https://api.openai.com/v1/responses");posts++;bodies.push({create:b});return response(b);
  };
  const dependencies:OwnerOpenAIApiProofDependencies={database:x.database,domainWorkspaceId:x.tenant.workspaceId,identitySource:{resolve:()=>identity as {userId:string}|null},
    policy:{projectId:"project-a",projectTaskId:x.task.taskId,developmentRunId:state.runs[0].run.id,planRevision:state.approvedPlan.revision,planFingerprint:state.approvedPlan.draftFingerprint,
      repository:x.configuration.repository,repositoryRoot:"/tmp/never-read-exact-port",repositoryAllowlist:x.configuration.admission.repositoryAllowlist as string[],readContextPaths:[path]},
    credentials,pricing:async()=>pricing as Awaited<ReturnType<OwnerOpenAIApiProofDependencies["pricing"]>>,clock:()=>now,transport,
    contextSource:{async readExactObject(r){readPaths.push(r.path);assert.equal(r.baseline,x.configuration.repository.baseline);
      const bytes=Buffer.from(text);return {kind:"blob",mode:"100644",blobId:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),bytes};}}};
  const load=()=>createOwnerOpenAIApiProof(dependencies).load();
  async function action(action:string,view?:OwnerOpenAIApiProofView,mode="openai_api") {const v=view??await load();apiAvailable(v);return createOwnerOpenAIApiProof(dependencies).act({mode,action,selection:v.selection});}
  async function ready(){await action("prepare");await action("request");const v=await action("approve");apiAvailable(v);assert.equal(v.phase,"APPROVED");return v;}
  async function facts(){return (await db.admin.query(`select state,reserved_cost_usd_micros::text,actual_cost_usd_micros::text,actual_input_tokens::text,actual_output_tokens::text from ai044_api_approval_bindings where workspace_id=$1 order by created_at`,[x.tenant.workspaceDatabaseId])).rows;}
  return {...x,directory,key,limits,credentials,dependencies,load,action,ready,facts,readPaths,bodies,posts:()=>posts,counts:()=>counts,
    setResponse:(f:typeof response)=>{response=f;},setCount:(f:typeof countResponse)=>{countResponse=f;},setProposal:(p:unknown)=>{proposal=p;},setPricing:(p:unknown)=>{pricing=p;},
    pricing:()=>structuredClone(pricing),setIdentity:(i:unknown)=>{identity=i;},expire:()=>{now+=16*60*1000;},cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
}
