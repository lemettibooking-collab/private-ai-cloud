import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const execute=promisify(execFile),root=new URL("../../",import.meta.url),testPath="tests/pg/development-controller-integrity.test.mts";
const storePath="lib/db/development-controller-store.ts",approvalPath="lib/db/development-controller-approvals.ts",sqlPath="db/migrations/0020_development_controller.sql";
for(const name of ["M12 final Owner acceptance skipped","M17 stale Owner approval accepted"] as const)test(`B3 ${name}: live behavioral mutant killed`,async t=>{
  const temporary=await mkdtemp(join(tmpdir(),"pac-b3-owner-mutant-"));t.after(()=>rm(temporary,{recursive:true,force:true}));
  const store=await readFile(new URL(storePath,root),"utf8"),approval=await readFile(new URL(approvalPath,root),"utf8"),sql=await readFile(new URL(sqlPath,root),"utf8");
  const relocate=(source:string,base:URL)=>source.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu,(_all,from,path)=>`${from}${JSON.stringify(new URL(path,base).href)}`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.B3_CONTROLLER_STORE_MODULE;delete env.B3_CONTROLLER_APPROVALS_MODULE;delete env.B3_CONTROLLER_AUTHORITY_GUARD;
  const args=["--test","--test-reporter=tap","--test-name-pattern",name.startsWith("M12")?"^M12 pending":"^M17 stale",testPath];
  const green=await execute(process.execPath,args,{cwd:root,env,timeout:90000,maxBuffer:4e6});assert.match(green.stdout,/# fail 0/u);assert.match(green.stdout,/# pass 1\b/u);
  if(name.startsWith("M12")){
    const needle='if(approval.rowCount!==1||approval.rows[0].state_fingerprint!==controllerResultAcceptanceFingerprint(state))throw new Conflict();';assert.equal(store.split(needle).length,2);
    const modulePath=join(temporary,"store.mts");await writeFile(modulePath,relocate(store.replace(needle,'if(false)throw new Conflict();'),new URL(storePath,root)));env.B3_CONTROLLER_STORE_MODULE=modulePath;
    const start=sql.indexOf("create function controller_task_authority_guard()"),end=sql.indexOf("end; $$;",start);assert.ok(start>=0&&end>start);
    let fn=sql.slice(start,end+"end; $$;".length);const owner=/\n      or not exists\(select 1 from controller_owner_gate_bindings b[\s\S]*?and r\.resolved_at is not null\)/u;assert.ok(owner.test(fn));
    fn=fn.replace("create function","create or replace function").replace(owner,"\n      or false");const functionPath=join(temporary,"guard.sql");await writeFile(functionPath,fn);env.B3_CONTROLLER_AUTHORITY_GUARD=functionPath;
  }else{
    const needle='const state = await readDevelopmentControllerStateInTransaction(client, tenant, c.projectId, c.taskId);';assert.equal(approval.split(needle).length,2);
    const replacement='const factual = await readDevelopmentControllerStateInTransaction(client, tenant, c.projectId, c.taskId); const state = { ...factual, task: { ...factual.task, status: "waiting_owner" as const, version: c.expectedVersion } };';
    const modulePath=join(temporary,"approvals.mts");await writeFile(modulePath,relocate(approval.replace(needle,replacement),new URL(approvalPath,root)));env.B3_CONTROLLER_APPROVALS_MODULE=modulePath;
  }
  let output="";try{await execute(process.execPath,args,{cwd:root,env,timeout:90000,maxBuffer:4e6});assert.fail("behavioral mutant survived");}catch(error){const e=error as Error&{code?:number;stdout?:string;stderr?:string};assert.equal(e.code,1);output=`${e.stdout}\n${e.stderr}`;}
  assert.match(output,/ERR_ASSERTION/u);assert.doesNotMatch(output,/ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic("Original real-PG scenario exit0; mutant imported/executed actual pipeline then violated Owner assertion; no compile/import-only kill. M12 attacks both service and DB backstop in disposable copies.");
});
