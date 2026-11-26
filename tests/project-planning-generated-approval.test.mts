import assert from 'node:assert/strict';
import test from 'node:test';
const domain=await import(new URL('../lib/planning/project-planning.ts',import.meta.url).href);
test('generated save accepts only bounded selectors before authority or reads',async()=>{
 let calls=0;const access={run:async()=>{calls++;throw Error('unexpected read');}};
 const planning=domain.createProjectPlanning(access as never);
 assert.equal(typeof planning.saveGenerated,'function');
 for(const raw of [null,{}, {projectId:'p',operationKey:'pp-'+ 'a'.repeat(32),planFingerprint:'a'.repeat(64),expectedRevision:0,plan:{}}])assert.equal((await planning.saveGenerated(raw)).status,'invalid_input');
 assert.equal(calls,0);
});
test('generated save transport rejects extra authority/plan fields and duplicate selectors',async()=>{
 const forms=await import(new URL('../lib/planning/project-planning-form.ts',import.meta.url).href);
 const f=new FormData();for(const[k,v]of Object.entries({projectId:'project-a',operationKey:'pp-'+'a'.repeat(32),planFingerprint:'b'.repeat(64),expectedRevision:'0'}))f.set(k,v);
 assert.equal(forms.projectPlanningForm(f,'saveGenerated')?.expectedRevision,0);
 f.append('expectedRevision','0');assert.equal(forms.projectPlanningForm(f,'saveGenerated'),null);f.delete('expectedRevision');f.set('expectedRevision','0');f.set('plan','{}');assert.equal(forms.projectPlanningForm(f,'saveGenerated'),null);
});
test('actual generated save action invalidates only factual successful mutations',async()=>{
 const{createRequire}=await import('node:module');const{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript');
 const code=ts.transpileModule(readFileSync(new URL('../app/projects/[projectId]/planning/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 for(const status of ['saved','replayed','unavailable','conflict']){
 const paths:string[]=[],calls:string[]=[];const mod={exports:{}};
 new Function('require','module','exports',code)((name:string)=>name==='next/cache'?{revalidatePath:(path:string)=>paths.push(path)}:{submitProjectPlanning:async(op:string)=>{calls.push(op);return{status};}},mod,mod.exports);
 const r=await (mod.exports as {saveGeneratedProjectPlanAction:(p:unknown,f:FormData)=>Promise<unknown>}).saveGeneratedProjectPlanAction(null,new FormData());assert.deepEqual(r,{status});assert.deepEqual(calls,['saveGenerated']);assert.equal(paths.length,['saved','replayed'].includes(status)?3:0);
 }
});
test('actual EN/RU immediate and durable proposal views offer separate escaped save forms',async()=>{
 const{createRequire}=await import('node:module');const{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const copy=await import(new URL('../lib/i18n/project-planning-copy.ts',import.meta.url).href);
 const code=ts.transpileModule(readFileSync(new URL('../components/domain/owner-console/project-planning-forms.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const save=async()=>({status:'idle'}),read=async()=>({status:'idle'}),generate=async()=>({status:'idle'}),prepare=async()=>({status:'idle'});
 const proposal={schemaVersion:'pac-project-plan/v1',title:'<img src=x>',tasks:[{id:'a',title:'Review',goal:'Goal',description:'<script>secret</script>',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['Check'],scope:['Review'],sourceReferences:[0]}]};
 const sources=[{filename:'context.md',version:1,sha256:'a'.repeat(64)}],operationKey='pp-'+'a'.repeat(32),state={status:'proposal_available',operationKey,proposal,sources,planFingerprint:'b'.repeat(64),expectedRevision:0};
 const mod:{exports:Record<string,unknown>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>name==='react'?{...React,useActionState:(action:unknown)=>[action===read||action===generate?state:{status:'idle'},()=>{},false]}:require(name),mod,mod.exports);
 for(const locale of ['en','ru'] as const)for(const immediate of [true,false]){
 const c=copy.projectPlanningCopy(locale),g=copy.projectGenerationCopy(locale);
 const props={projectId:'project-a',sources,c,g,prepareAction:prepare,generateAction:generate,readAction:read,saveAction:save,expectedRevision:0,operationKey};
 const offer={sources,preparationFingerprint:'a'.repeat(64),offerFingerprint:'a'.repeat(64),policy:{identity:{},maxInputTokens:100,maxOutputTokens:100}};
 const html=renderToStaticMarkup(React.createElement(mod.exports[immediate?'GenerationAuthorizationForm':'ProjectPlanningGenerationForm'],{...props,offer}));
 assert(html.includes(c.saveGenerated));assert(html.includes('name="planFingerprint"'));assert(html.includes('name="expectedRevision"'));assert(html.includes('&lt;script&gt;secret&lt;/script&gt;'));assert(!html.includes('<script>secret</script>'));
 let depth=0;for(const tag of html.matchAll(/<\/?form\b[^>]*>/gu)){depth+=tag[0].startsWith('</')?-1:1;assert(depth>=0&&depth<=1,'no nested forms');}assert.equal(depth,0);
 }
});

test('existing proposal validator defines binary64 reference normalization including signed zero',async()=>{
 const{validateGeneratedProposal}=await import(new URL('../lib/planning/project-planning-generation.ts',import.meta.url).href);
 const raw=(refs:string)=>`{"schemaVersion":"pac-project-plan/v1","title":"Numeric proposal","tasks":[{"id":"t","title":"Review","goal":"Verify","description":"","type":"feature","priority":"P2","dependencyIds":[],"acceptanceCriteria":["Verified"],"scope":["Review"],"sourceReferences":[${refs}]}]}`;
 for(const [lexeme,index] of [['1.0000000000000001',1],['1e-99999999999999999999',0],['-0',0],['-1e-400',0],['2.4703282292062327e-324',0]] as const){const r=validateGeneratedProposal(raw(lexeme),4);assert(r.plan,lexeme);assert.equal(JSON.stringify(r.plan.tasks[0].sourceReferences),JSON.stringify([index]));}
 for(const refs of ['1,1.0000000000000001','0,-0','0.5','4','-1','2.4703282292062328e-324','"1"'])assert.equal(validateGeneratedProposal(raw(refs),4).plan,null,refs);
});

test('proposal root titles enforce persistable Unicode without changing valid text',async()=>{
 const {validateGeneratedProposal}=await import(new URL('../lib/planning/project-planning-generation.ts',import.meta.url).href);
 const make=(title:string)=>JSON.stringify({schemaVersion:'pac-project-plan/v1',title,tasks:[{id:'t',title:'Review',goal:'Verify',description:'',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['Verified'],scope:['Review'],sourceReferences:[0]}]});
 for(const title of ['\ud800','\udc00','abc\ud800xyz','\udc00\ud800','a\0b','a\u0001b'])assert.equal(validateGeneratedProposal(make(title),1).plan,null,JSON.stringify(title));
 for(const title of ['𐐀 😀','Проверка проекта','日本語 العربية Français'])assert.equal(validateGeneratedProposal(make(title),1).plan?.title,title);
});

test('unsupported historical encoding transport and EN/RU render never expose save controls',async()=>{
 const {createProjectGenerationActions}=await import(new URL('../lib/composition/owner-project-planning-generation-action.ts',import.meta.url).href);
 const form=new FormData();form.set('projectId','project-a');form.set('operationKey','pp-'+'a'.repeat(32));
 const state=await createProjectGenerationActions({authorize:async()=> 'ok',read:async()=>({status:'proposal_encoding_unsupported',storedStatus:'proposal_available',proposal:null})})('read',form);
 assert.equal(state.status,'proposal_encoding_unsupported');assert(!state.proposal);
 const {createRequire}=await import('node:module');const {readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const copy=await import(new URL('../lib/i18n/project-planning-copy.ts',import.meta.url).href);
 const code=ts.transpileModule(readFileSync(new URL('../components/domain/owner-console/project-planning-forms.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod:{exports:Record<string,unknown>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>name==='react'?{...React,useActionState:()=>[state,()=>{},false]}:require(name),mod,mod.exports);
 for(const locale of ['en','ru'] as const){const c=copy.projectPlanningCopy(locale),g=copy.projectGenerationCopy(locale),html=renderToStaticMarkup(React.createElement(mod.exports.ProjectPlanningGenerationForm,{projectId:'project-a',sources:[],c,g,prepareAction:async()=>state,generateAction:async()=>state,readAction:async()=>state,saveAction:async()=>state,operationKey:state.operationKey}));assert(html.includes(g.proposal_encoding_unsupported));assert(!html.includes(c.saveGenerated));assert(!html.includes('name="planFingerprint"'));}
});

test('all proposal string fields preserve valid Unicode and reject unsupported encoding',async()=>{
 const {validateGeneratedProposal}=await import(new URL('../lib/planning/project-planning-generation.ts',import.meta.url).href);
 const make=()=>({schemaVersion:'pac-project-plan/v1',title:'План 😀',tasks:[{id:'t',title:'Задача 😀',goal:'Цель 😀',description:'Описание 😀',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['確認 😀'],scope:['نطاق 😀'],sourceReferences:[0]}]});
 assert(validateGeneratedProposal(JSON.stringify(make()),1).plan);
 for(const field of ['title','goal','description','acceptanceCriteria','scope'])for(const bad of ['x\ud800y','x\udc00y','x\0y']){const p=make();Object.assign(p.tasks[0],{[field]:['acceptanceCriteria','scope'].includes(field)?[bad]:bad});assert.equal(validateGeneratedProposal(JSON.stringify(p),1).plan,null,field);}
});
