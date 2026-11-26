import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
const repo = (await import(new URL("../lib/projects/repository-binding.ts", import.meta.url).href)) as typeof import("../lib/projects/repository-binding");
const kb = (await import(new URL("../lib/projects/project-knowledge.ts", import.meta.url).href)) as typeof import("../lib/projects/project-knowledge");
const forms = (await import(new URL("../lib/projects/project-resource-forms.ts", import.meta.url).href)) as typeof import("../lib/projects/project-resource-forms");
const auth = (await import(new URL("../lib/projects/project-owner-access.ts", import.meta.url).href)) as typeof import("../lib/projects/project-owner-access");

test("canonical GitHub locators are configuration only; credentials/SSRF/redirect-style URLs are rejected", () => {
  assert.equal(repo.canonicalGitHubRepository("https://github.com/Example/Repo.git"),"https://github.com/example/repo");
  for (const url of ["http://github.com/o/r","https://github.com.evil.test/o/r","https://127.0.0.1/o/r","https://user:secret@github.com/o/r","https://github.com/o/r?token=x","https://github.com/o/r#x","https://github.com/o/%2e%2e","https://github.com/o/../r","https://github.com/o/r/extra","https://github.com/o/ghp_secret","https://github.com/o/r\n"," https://github.com/o/r","git@github.com:o/r.git","file:///etc/passwd"]) assert.equal(repo.canonicalGitHubRepository(url),null,url);
});
test("filenames accept only bounded path-free Markdown/YAML basenames", () => {
  for (const name of ["README.md","spec.yaml","roadmap-v1.yml"]) assert(kb.isDocumentFilename(name));
  for (const name of ["../README.md","a/README.md","a\\x.md",".md","x..md","x.md\n","x.md ","x.pdf","x.zip","x.md.exe","x".repeat(129)+".md","x\0.md"]) assert(!kb.isDocumentFilename(name),name);
});
test("exact UTF-8 bytes, BOM, newlines and SHA survive snapshot without interpreting YAML", () => {
  for (const text of ["# Doc\r\nПривет\n","\ufeff# BOM\n","!!js/function >\n  function () { throw 'never executed'; }\n","<script>alert(1)</script>"]) {
    const bytes=Buffer.from(text); const result=kb.documentSnapshot(bytes);assert(result);
    assert.equal(result.text,text);assert.equal(result.sha256,createHash("sha256").update(bytes).digest("hex"));
    bytes.fill(0);assert.equal(Buffer.from(result.bytes).toString(),text);
  }
});
test("malformed UTF-8, NUL/binary, empty, oversized and hostile bytes fail closed", () => {
  let calls=0;
  const proxy=new Proxy(new Uint8Array([65]),{get(){calls++;throw Error("secret");}});
  for (const bytes of [new Uint8Array([0xc3,0x28]),new Uint8Array([0]),new Uint8Array(0),new Uint8Array(262145),proxy,"private",null,Buffer.from("  \n")]) assert.equal(kb.documentSnapshot(bytes),null);
  assert.equal(calls,0);
});
test("invalid resource intents cannot reach any authorization or SQL callback", async () => {
  let calls=0;
  const access={async run(){calls++;throw Error("must not run");}} as unknown as Parameters<typeof repo.createRepositoryBinding>[0];
  const service=repo.createRepositoryBinding(access), knowledge=kb.createProjectKnowledge(access);
  const binding={projectId:"project-a",url:"https://github.com/o/r",defaultBranch:"main",expectedRevision:0,requestId:"request-123"};
  for (const change of [{url:"http://localhost/a/b"},{defaultBranch:"main\n"},{expectedRevision:-1},{requestId:"request-123\n"},{verifiedBaselineSha:"a".repeat(40)},{projectId:{toJSON(){throw Error("secret");}}}]) assert.equal((await service.bind({...binding,...change})).status,"invalid_input");
  assert.equal((await knowledge.upload({projectId:"project-a",filename:"x.md",bytes:Buffer.from("x"),expectedVersion:50,requestId:"request-123"})).status,"invalid_input");
  assert.equal((await knowledge.read("project-a","../x.md",1)).status,"invalid_input");assert.equal(calls,0);
});
function form(fields: Record<string,string>) {const result=new FormData();for(const[k,v]of Object.entries(fields))result.set(k,v);return result;}
test("form transport rejects authority fields, duplicate inputs and oversized files", async () => {
  const f=form({projectId:"project-a",url:"https://github.com/o/r",defaultBranch:"main",expectedRevision:"0",requestId:"request-123"});
  assert.equal(forms.repositoryBindingForm(f)?.expectedRevision,0);
  f.append("workspaceId","secret-workspace");assert.equal(forms.repositoryBindingForm(f),null);f.delete("workspaceId");
  f.append("url","https://github.com/other/repo");assert.equal(forms.repositoryBindingForm(f),null);
  const upload=form({projectId:"project-a",expectedVersion:"0",requestId:"request-123"});upload.set("file",new Blob(["# safe"]),"spec.md");
  const parsed=await forms.knowledgeUploadForm(upload);assert(parsed);assert.equal(parsed.filename,"spec.md");assert.equal(Buffer.from(parsed.bytes).toString(),"# safe");
  upload.set("file",new Blob([new Uint8Array(262145)]),"x.md");assert.equal(await forms.knowledgeUploadForm(upload),null);
});
test("UI views document text through React escaping and never render executable markup/config", () => {
  const source=readFileSync(new URL("../app/knowledge/page.tsx",import.meta.url),"utf8");
  assert.match(source,/<pre[^>]*>\{view\.selected\.content\}<\/pre>/u);
  assert(!/dangerouslySetInnerHTML|yaml\.load|eval\(|iframe/u.test(source));
  assert.match(source, /key=\{view\.binding\.projectId\}/u, "file state must reset when project changes");
  for (const file of ["lib/projects/project-knowledge.ts","lib/projects/repository-binding.ts","lib/projects/project-owner-access.ts"]) {
    const code=readFileSync(new URL(`../${file}`,import.meta.url),"utf8");assert(!/fetch\(|https\.request|child_process|readFile|writeFile|openai|anthropic/u.test(code),file);
  }
});
test("absent/invalid sessions cause zero database access",async()=>{
 let connections=0;
 for(const session of [null,{},new Proxy({},{})]){
  const a=auth.createProjectOwnerAccess({database:{async connect(){connections++;throw Error("private connection");}},domainWorkspaceId:"workspace-a",session});
  assert.deepEqual(await a.run("project-a",false,async()=>{throw Error("must not read");}),{status:"unauthenticated"});
 }
 assert.equal(connections,0);
});

test("project resource copy has EN/RU key parity and explicit unverified states",async()=>{
  const {projectResourcesCopy}=await import(new URL("../lib/i18n/project-resources-copy.ts",import.meta.url).href);
  const en=projectResourcesCopy("en"),ru=projectResourcesCopy("ru");
  assert.deepEqual(Object.keys(ru).sort(),Object.keys(en).sort());
  for(const key of Object.keys(en)) {assert.equal(typeof ru[key],"string");assert.ok(ru[key].trim().length>0);}
  assert.match(en.configured_unverified,/unverified/u);assert.match(ru.configured_unverified,/не проверено/u);
  assert.match(en.uploaded_unverified,/unverified/u);assert.match(ru.uploaded_unverified,/не проверен/u);
});
