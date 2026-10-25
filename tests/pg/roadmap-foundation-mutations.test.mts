import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const execute=promisify(execFile),root=new URL("../../",import.meta.url);
const files=["lib/roadmap/roadmap-contract.ts","lib/db/roadmap-store.ts","lib/roadmap/roadmap-owner-commands.ts","lib/db/roadmap-approvals.ts","tests/pg/roadmap-foundation.test.mts"];
const mutations:Array<{name:string;pattern:string;edits:Array<[number,string,string]>}>=[
  {name:"A1 incomplete dependency ignored",pattern:"^dependency incomplete",edits:[[1,'deps.rows.some(d => d.status !== "completed")','false']]},
  {name:"A2 two ready claims accepted",pattern:"^atomic claim",edits:[[1,'task.status !== "ready" || task.version !== command.expectedVersion','false'],[1,' || task.version !== command.expectedVersion || !roadmapTaskTransitions[task.status].includes(next)',''],[1,' and state_version=$5 returning task_key',' and $5::integer>=0 returning task_key']]},
  {name:"A4 stale immutable plan revision accepted",pattern:"^latest plan revision",edits:[[3,'order by revision desc limit 1','order by revision asc limit 1']]},
  {name:"A5 CAS ignored",pattern:"^stale expected version",edits:[[1,' || task.version !== command.expectedVersion',''],[1,' || task.version !== command.expectedVersion',''],[1,' and state_version=$5 returning task_key',' and $5::integer>=0 returning task_key']]},
  {name:"A6 changed command intent replayed",pattern:"^claim replay",edits:[[1,' || r.intent_fingerprint !== fingerprint','']]},
  {name:"A7 ambiguous COMMIT blindly reenters work",pattern:"^(lost COMMIT ACK|unknown commit outcome)",edits:[[1,'async c => {if(authorizeReconciliation)await authorizeReconciliation(c);return await roadmapReplay(c, tenant, command, fingerprint) ?? Object.freeze({ status: "recovery_required" as const });}','work']]},
];
for(const m of mutations)test(`B3 ${m.name}: executing behavioral mutant killed`,async t=>{
  const temp=await mkdtemp(join(tmpdir(),"pac-b3-a-mutant-"));t.after(()=>rm(temp,{recursive:true,force:true}));
  const map=new Map(files.map((p,i)=>[new URL(p,root).href,pathToFileURL(join(temp,`${i}.mts`)).href]));
  const relocate=(source:string,base:URL)=>source.replace(/(from\s+)["'](\.[^"']+\.m?ts)["']/gu,(_all,from,path)=>{const target=new URL(path,base).href;return `${from}${JSON.stringify(map.get(target)??target)}`;})
    .replace(/new URL\("(\.[^"]+)",import\.meta\.url\)/gu,(_all,path)=>{const target=new URL(path,base).href;return `new URL(${JSON.stringify(map.get(target)??target)})`;});
  const originals=await Promise.all(files.map(p=>readFile(new URL(p,root),"utf8")));
  async function materialize(sources:readonly string[]){for(const [i,p]of files.entries())await writeFile(new URL(map.get(new URL(p,root).href)!),relocate(sources[i],new URL(p,root)));}
  await materialize(originals);const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const args=["--test","--test-reporter=tap","--test-name-pattern",m.pattern,join(temp,"4.mts")];
  const green=await execute(process.execPath,args,{env,timeout:90000,maxBuffer:4e6});assert.match(green.stdout,/# fail 0/u);assert.match(green.stdout,/# pass [1-9]/u);
  const changed=[...originals];for(const [which,needle,replacement]of m.edits){assert.ok(changed[which].includes(needle),"live mutation anchor");changed[which]=changed[which].replace(needle,replacement);}await materialize(changed);
  let output="";try{await execute(process.execPath,args,{env,timeout:90000,maxBuffer:4e6});assert.fail("behavioral mutant survived");}catch(error){const e=error as Error&{code?:number;stdout?:string;stderr?:string};assert.equal(e.code,1);output=`${e.stdout}\n${e.stderr}`;}
  assert.match(output,/ERR_ASSERTION/u);assert.doesNotMatch(output,/ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);t.diagnostic("Original exit0; mutant imported/executed real PG and assertion failed; no source edits.");
});
