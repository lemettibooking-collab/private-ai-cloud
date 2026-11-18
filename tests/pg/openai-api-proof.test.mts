import assert from "node:assert/strict";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {apiProofPgFixture,apiAvailable} from "../fixtures/openai-api-proof-pg.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {createOwnerOpenAIApiProof} from "../../lib/composition/owner-openai-api-proof.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import {createOpenAIApiCredentialStore} from "../../lib/integrations/openai-api/openai-api-credential-store.ts";
import {join} from "node:path";
const live=await import(new URL("./helpers/live-pg.ts",import.meta.url).href) as typeof import("./helpers/live-pg");
const db=await live.useLiveDatabase("openai_api_proof");
const barrier=await import(new URL("../../lib/db/executor-predecessor-barrier.ts",import.meta.url).href) as typeof import("../../lib/db/executor-predecessor-barrier");
const transaction=await import(new URL("../../lib/db/executor-start-transaction.ts",import.meta.url).href) as typeof import("../../lib/db/executor-start-transaction");
const apiApprovals=await import(new URL("../../lib/db/openai-api-approvals.ts",import.meta.url).href) as typeof import("../../lib/db/openai-api-approvals");
const apiIntents=await import(new URL("../../lib/executors/openai-api-intent.ts",import.meta.url).href) as typeof import("../../lib/executors/openai-api-intent");

test("API PG: factual PREPARE/request/approve zero calls; explicit invoke exactly one POST; actual usage settles max reserve",async t=>{
  const x=await apiProofPgFixture(db,"flow");t.after(x.cleanup);
  let v=await x.load();apiAvailable(v);assert.equal(v.phase,"NOT_PREPARED");assert.equal(v.maximumCostUsdMicros,18432);
  v=await x.action("prepare",v);apiAvailable(v);assert.equal(v.phase,"PREPARED");
  v=await x.action("request",v);apiAvailable(v);assert.equal(v.phase,"AWAITING_OWNER_APPROVAL");
  assert.deepEqual(await x.action("invoke",v),{status:"unavailable"});
  v=await x.action("approve",v);apiAvailable(v);assert.equal(v.phase,"APPROVED");assert.equal(x.counts(),0);assert.equal(x.posts(),0);
  v=await x.action("invoke",v);apiAvailable(v);assert.equal(v.phase,"COMPLETED",JSON.stringify({rows:await x.facts(),counts:x.counts(),posts:x.posts()}));assert.equal(x.counts(),1);assert.equal(x.posts(),1);
  assert.deepEqual(await x.facts(),[{state:"completed",reserved_cost_usd_micros:"18432",actual_cost_usd_micros:"200",actual_input_tokens:"100",actual_output_tokens:"20"}]);
  assert.equal(v.remainingDailyBudgetUsdMicros,999800);assert.equal(v.runtimeDispatchAllowed,false);assert.equal(v.productionLiveDispatch,"BLOCKED");
  assert.equal(await transaction.inTransaction(x.database,c=>barrier.executorPredecessorsClear(c,x.workspaceId,x.intent.attempt.developmentRunId,2)),true);
  assert.deepEqual(v.result?.changedPaths,[x.dependencies.policy.readContextPaths[0]]);assert.equal(v.result?.ownerDecisionRequired,true);assert.equal(v.result?.automaticRetryAllowed,false);
  const pair=x.bodies as {count?:Record<string,unknown>;create?:Record<string,unknown>}[];
  assert.deepEqual(pair[0].count,{model:pair[1].create!.model,input:pair[1].create!.input});
  assert.deepEqual(Object.keys(pair[1].create!).sort(),["input","max_output_tokens","model","service_tier","store","stream"]);assert.equal(pair[1].create!.max_output_tokens,2048);assert.equal(pair[1].create!.service_tier,"default");
  assert.equal(pair[1].create!.store,false);assert.equal(pair[1].create!.stream,false);
  assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.result)&&Object.isFrozen(v.readContextPaths));assert.deepEqual(await x.load(),v);
  assert.deepEqual(await x.action("invoke",v),{status:"unavailable"});assert.equal(x.posts(),1);
  const rows=await db.admin.query(`select b.intent_payload,b.normalized_result_payload,a.metadata::text from ai044_api_approval_bindings b left join audit_events a on a.workspace_id=b.workspace_id where b.workspace_id=$1`,[x.tenant.workspaceDatabaseId]);
  assert.ok(!JSON.stringify([v,rows.rows]).includes(x.key));
  // The same canonical result is consumable by the EXISTING controller/QA pipeline.
  const state=await x.controller.read("project-a",x.task.taskId);assert.ok(state);
  assert.equal((await x.controller.transitionRun({...await x.command(),developmentRunId:state.runs[0].run.id,expectedRunRevision:state.runs[0].revision,event:{type:"submit_patch",changedPaths:v.result!.changedPaths}})).status,"applied");
});
test("API PG: REJECT never counts/dispatches and cannot become approved",async t=>{
  const x=await apiProofPgFixture(db,"reject");t.after(x.cleanup);await x.action("prepare");await x.action("request");const v=await x.action("reject");apiAvailable(v);assert.equal(v.phase,"REJECTED");
  assert.deepEqual(await x.action("approve",v),{status:"unavailable"});assert.deepEqual(await x.action("invoke",v),{status:"unavailable"});assert.equal(x.counts(),0);assert.equal(x.posts(),0);
});
test("API PG: concurrent invoke/double click at most one POST, reconstructed roots cannot redispatch",async t=>{
  const x=await apiProofPgFixture(db,"double");t.after(x.cleanup);const v=await x.ready();
  await Promise.all([x.action("invoke",v),x.action("invoke",v)]);assert.equal(x.posts(),1);assert.equal(x.counts(),1);
  const reconstructed=createOwnerOpenAIApiProof({...x.dependencies,credentials:createOpenAIApiCredentialStore(join(x.directory,"credentials"))});
  const loaded=await reconstructed.load();apiAvailable(loaded);assert.equal(loaded.phase,"COMPLETED");
  assert.deepEqual(await reconstructed.act({mode:"openai_api",action:"invoke",selection:loaded.selection}),{status:"unavailable"});assert.equal(x.posts(),1);
});
test("API PG: ambiguous provider outcome durably holds full maximum across restart/new command",async t=>{
  const x=await apiProofPgFixture(db,"unknown");t.after(x.cleanup);const v=await x.ready();
  x.setResponse(async()=>{throw Error(x.key);});await x.action("invoke",v);
  assert.equal(x.posts(),1);assert.equal((await x.facts())[0].state,"outcome_unknown");assert.equal((await x.facts())[0].actual_cost_usd_micros,null);
  const loaded=await x.load();apiAvailable(loaded);assert.equal(loaded.phase,"RECOVERY_REQUIRED");assert.equal(loaded.remainingDailyBudgetUsdMicros,1000000-18432);
  assert.deepEqual(await x.action("invoke",loaded),{status:"unavailable"});assert.equal(x.posts(),1);assert.equal(x.counts(),1);
  assert.equal(await transaction.inTransaction(x.database,c=>barrier.executorPredecessorsClear(c,x.workspaceId,x.intent.attempt.developmentRunId,2)),false);
});
for(const kind of ["unknown-price","stale-price","wrong-model","low-cost","context-bound","wrong-mode"] as const) {
  test(`API PG: ${kind} denies before any provider/count request`,async t=>{
    const x=await apiProofPgFixture(db,kind);t.after(x.cleanup);
    if(kind==="unknown-price")x.setPricing(null);
    if(kind==="stale-price")x.setPricing({...x.pricing() as object,expiresAt:Date.now()-1000});
    if(kind==="wrong-model")x.setPricing({...x.pricing() as object,model:"other-2026-10-01"});
    if(kind==="low-cost"||kind==="context-bound")await x.credentials.configure({ownerUserId:x.ownerId,domainWorkspaceId:x.tenant.workspaceId},{...x.limits,...(kind==="low-cost"?{maxInvocationCostUsdMicros:1}:{maxContextBytes:1})});
    const v=await x.load();
    const result=v.status==="available"?await x.action("prepare",v,kind==="wrong-mode"?"chatgpt_plan":"openai_api"):v;
    assert.deepEqual(result,{status:"unavailable"});assert.equal(x.posts(),0);assert.equal(x.counts(),0);
  });
}
for(const kind of ["model","key","limits","expired","revoked","missing-session","changed-read-context"] as const) {
  test(`API PG: approved ${kind} change cannot reuse an approval`,async t=>{
    const x=await apiProofPgFixture(db,`change-${kind}`);t.after(x.cleanup);const v=await x.ready();
    if(kind==="model"||kind==="limits")await x.credentials.configure({ownerUserId:x.ownerId,domainWorkspaceId:x.tenant.workspaceId},{...x.limits,...(kind==="model"?{model:"other-2026-10-01"}:{maxOutputTokens:1000})});
    if(kind==="key")await x.credentials.save({ownerUserId:x.ownerId,domainWorkspaceId:x.tenant.workspaceId},`${x.key}2`,x.limits);
    if(kind==="expired")x.expire();if(kind==="missing-session")x.setIdentity(null);
    if(kind==="revoked")await db.admin.query(`update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2`,[x.tenant.workspaceDatabaseId,x.ownerId]);
    let result;
    if(kind==="changed-read-context")result=await createOwnerOpenAIApiProof({...x.dependencies,policy:{...x.dependencies.policy,readContextPaths:["docs/other.md"]}}).act({mode:"openai_api",action:"invoke",selection:v.selection});
    else result=await x.action("invoke",v);
    assert.deepEqual(result,{status:"unavailable"});assert.equal(x.counts(),0);assert.equal(x.posts(),0);
  });
}
test("API PG: daily reservation atomic for two distinct factual tasks in the same workspace",async t=>{
  const a=await apiProofPgFixture(db,"budget-a",{daily:20000,path:"src/server/terminal/account/a.ts"});t.after(a.cleanup);
  const b=await apiProofPgFixture(db,"budget-b",{shared:a.foundation,daily:20000,path:"src/server/terminal/account/b.ts"});t.after(b.cleanup);
  const av=await a.ready(),bv=await b.ready();
  let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  a.setResponse(async()=>{entered();await held;throw Error("ambiguous");});
  const pending=a.action("invoke",av);await Promise.race([started,pending.then(async()=>{throw Error(`Provider never started: ${JSON.stringify(await a.facts())}`);})]);
  await b.action("invoke",bv);assert.equal(b.posts(),0);assert.equal(b.counts(),0);release();await pending;
  assert.equal(a.posts(),1);const facts=await a.facts();assert.equal(facts.filter((r:{state:string})=>r.state==="outcome_unknown").length,1);
  assert.equal(facts.filter((r:{state:string})=>r.state==="ready").length,1);
});
test("API PG: native count overflow releases safely before inference; full accounting row is factual zero",async t=>{
  const x=await apiProofPgFixture(db,"count-limit");t.after(x.cleanup);const v=await x.ready();x.setCount(async()=>Response.json({object:"response.input_tokens",input_tokens:1000000}));
  const result=await x.action("invoke",v);apiAvailable(result);assert.equal(result.phase,"FAILED");assert.equal(x.posts(),0);assert.equal(x.counts(),1);
  assert.equal((await x.facts())[0].actual_cost_usd_micros,"0");assert.equal(result.remainingDailyBudgetUsdMicros,1000000);
});
test("API PG: cancel after reservation before fence denies inference, retains unresolved hold",async t=>{
  const x=await apiProofPgFixture(db,"cancel-fence");t.after(x.cleanup);const v=await x.ready();
  x.setCount(async()=>{const state=await x.controller.read("project-a",x.task.taskId);assert.ok(state);
    assert.equal((await x.controller.transitionRun({...await x.command(),developmentRunId:state.runs[0].run.id,expectedRunRevision:state.runs[0].revision,event:{type:"cancel"}})).status,"applied");
    return Response.json({object:"response.input_tokens",input_tokens:100});});
  await x.action("invoke",v);assert.equal(x.posts(),0);assert.equal((await x.facts())[0].state,"consumed");
});
test("API PG: read-only context cannot become writable; malformed patch is paid canonical failure",async t=>{
  const x=await apiProofPgFixture(db,"readonly");t.after(x.cleanup);
  const dependencies={...x.dependencies,policy:{...x.dependencies.policy,readContextPaths:[...x.dependencies.policy.readContextPaths,"docs/context.md"]}};
  const load=()=>createOwnerOpenAIApiProof(dependencies).load();
  const act=async(action:string)=>{const v=await load();apiAvailable(v);return createOwnerOpenAIApiProof(dependencies).act({mode:"openai_api",action,selection:v.selection});};
  await act("prepare");await act("request");await act("approve");
  x.setProposal({patch:"diff --git a/docs/context.md b/docs/context.md\n--- a/docs/context.md\n+++ b/docs/context.md\n@@ -1 +1 @@\n-export const analytics = 1;\n+bad\n",changedPaths:["docs/context.md"],summary:"Unauthorized reference modification."});
  const v=await act("invoke");apiAvailable(v);assert.equal(v.phase,"FAILED");assert.deepEqual(v.result?.changedPaths,[]);assert.equal(x.posts(),1);assert.equal((await x.facts())[0].actual_cost_usd_micros,"200");
});
test("API PG: a different task/attempt/payload cannot reuse persisted immutable approval",async t=>{
  const x=await apiProofPgFixture(db,"identity");t.after(x.cleanup);await x.ready();
  const b=(await db.admin.query(`select * from ai044_api_approval_bindings where workspace_id=$1`,[x.tenant.workspaceDatabaseId])).rows[0];
  for(const sql of [`update ai044_api_approval_bindings set project_task_key='other' where approval_request_id=$1`,`update ai044_api_approval_bindings set attempt_number=2 where approval_request_id=$1`,
    `update ai044_api_approval_bindings set intent_payload='{}' where approval_request_id=$1`,`delete from ai044_api_approval_bindings where approval_request_id=$1`])await assert.rejects(db.admin.query(sql,[b.approval_request_id]));
  assert.equal(x.posts(),0);assert.equal(x.counts(),0);
  assert.deepEqual(await x.action("invoke",{...await x.load(),selection:randomUUID()} as Awaited<ReturnType<typeof x.load>>),{status:"unavailable"});
  await assert.rejects(db.admin.query(`insert into approval_requests(workspace_id,action_type,status,risk_level) values($1,'ai044_openai_api_executor','pending','high')`,[x.workspaceId]));
});

test("API PG: direct store cannot approve a changed model/context under the old factual controller binding",async t=>{
  const x=await apiProofPgFixture(db,"exact-policy");t.after(x.cleanup);await x.action("prepare");
  const state=await x.controller.read("project-a",x.task.taskId);assert.ok(state);const stored=state.attempts[0];
  const i=apiIntents.normalizeOpenAIApiIntent((stored.executionPolicy as {intent:unknown}).intent);assert.ok(i);
  const store=apiApprovals.createOpenAIApiApprovals({database:x.database,tenant:x.tenant,projectId:"project-a",projectTaskId:x.task.taskId,configuration:stored.configuration as import("../../lib/contracts/executor-adapter").ExecutorAdapterConfiguration,
    identitySource:x.identitySource,controllerBinding:{projectTaskId:x.task.taskId,intentFingerprint:stored.intentFingerprint}});
  for(const change of [{contextFingerprint:"c".repeat(64)},{requestFingerprint:"d".repeat(64)},
    {model:"other-2026-10-01",limits:{...i.limits,model:"other-2026-10-01"},pricing:{...i.pricing,model:"other-2026-10-01"}}]) {
    const changed=apiIntents.normalizeOpenAIApiIntent({...i,...change});assert.ok(changed);assert.equal((await store.request(changed)).verdict,"deny");
  }
  assert.equal((await x.facts()).length,0);assert.equal(x.counts(),0);assert.equal(x.posts(),0);
});

test("API PG: real non-Owner member cannot use an approved Owner selection or read the key",async t=>{
  const x=await apiProofPgFixture(db,"non-owner");t.after(x.cleanup);const v=await x.ready(),member=randomUUID();
  await db.admin.query(`insert into users(id,email,name,status) values($1,$2,'Member','active')`,[member,`${member}@test.invalid`]);
  await db.admin.query(`insert into workspace_members(workspace_id,user_id,status) values($1,$2,'active')`,[x.workspaceId,member]);
  let reads=0;
  const app=createOwnerOpenAIApiProof({...x.dependencies,identitySource:{resolve:()=>({userId:member})},credentials:{...x.credentials,async facts(b){reads++;return x.credentials.facts(b);}}});
  assert.deepEqual(await app.load(),{status:"unavailable"});assert.deepEqual(await app.act({mode:"openai_api",action:"invoke",selection:v.selection}),{status:"unavailable"});
  assert.equal(reads,0);assert.equal(x.posts(),0);assert.equal(x.counts(),0);
});

for(const boundary of ["consumed","started"] as const) {
  test(`API PG: lost ${boundary} COMMIT acknowledgement never issues provider right or redispatch`,async t=>{
    const x=await apiProofPgFixture(db,`ack-${boundary}`);t.after(x.cleanup);const v=await x.ready();let lost=false;
    const database:typeof x.database={...x.database,async connect(){const c=await x.database.connect();let targeted=false;return {
      async query<T extends Record<string,unknown>=Record<string,unknown>>(sql:string,values?:readonly unknown[]){
        if(sql.includes(`update ai044_api_approval_bindings set state='${boundary}'`))targeted=true;
        const r=await c.query<T>(sql,values);
        if(targeted&&!lost&&/commit\s*$/iu.test(sql)){lost=true;throw Error("SYNTHETIC_ACK_LOSS");}return r;
      },release(destroy?:boolean){c.release(destroy);}};}};
    const result=await createOwnerOpenAIApiProof({...x.dependencies,database}).act({mode:"openai_api",action:"invoke",selection:v.selection});
    assert.ok(lost);assert.equal(x.posts(),0);assert.equal(x.counts(),boundary==="started"?1:0);
    assert.equal((await x.facts())[0].state,boundary);assert.equal((await x.facts())[0].actual_cost_usd_micros,null);
    const loaded=await x.load();apiAvailable(loaded);assert.equal(loaded.phase,"RECOVERY_REQUIRED");
    assert.deepEqual(await x.action("invoke",loaded),{status:"unavailable"});assert.equal(x.posts(),0);assert.ok(!JSON.stringify(result).includes("ACK_LOSS"));
  });
}
test("API PG: cancellation after fence permits factual cost settlement, never overwrites cancelled DevelopmentRun",async t=>{
  const x=await apiProofPgFixture(db,"late-cancel");t.after(x.cleanup);const v=await x.ready();
  x.setResponse(async body=>{
    const state=await x.controller.read("project-a",x.task.taskId);assert.ok(state);
    assert.equal((await x.controller.transitionRun({...await x.command(),developmentRunId:state.runs[0].run.id,expectedRunRevision:state.runs[0].revision,event:{type:"cancel"}})).status,"applied");
    return Response.json({model:body.model,service_tier:"default",status:"completed",error:null,incomplete_details:null,output:[{type:"message",role:"assistant",status:"completed",content:[{type:"refusal",refusal:"RAW_PRIVATE_REFUSAL"}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}});
  });
  const result=await x.action("invoke",v);assert.equal(x.posts(),1);assert.equal((await x.facts())[0].actual_cost_usd_micros,"200");
  const state=await x.controller.read("project-a",x.task.taskId);assert.equal(state?.runs[0].run.status,"cancelled");assert.ok(!JSON.stringify(result).includes("RAW_PRIVATE_REFUSAL"));
});

test("API PG: non-default actual provider billing tier cannot release the standard-price reservation",async t=>{
  const x=await apiProofPgFixture(db,"wrong-tier");t.after(x.cleanup);const v=await x.ready();
  x.setResponse(async body=>Response.json({model:body.model,service_tier:"priority",status:"completed",error:null,incomplete_details:null,output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"unexpected tier"}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}}));
  const result=await x.action("invoke",v);apiAvailable(result);assert.equal(result.phase,"RECOVERY_REQUIRED");assert.equal(x.posts(),1);
  assert.equal((await x.facts())[0].state,"outcome_unknown");assert.equal((await x.facts())[0].actual_cost_usd_micros,null);
});
