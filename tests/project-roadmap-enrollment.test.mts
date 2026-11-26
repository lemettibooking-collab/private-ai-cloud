import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectRoadmapPreview } from '../lib/planning/project-roadmap-enrollment';
const core=await import(new URL('../lib/planning/project-roadmap-enrollment.ts',import.meta.url).href);
test('project roadmap transport and domain reject caller authority before reads',async()=>{
 let reads=0;const access={run:async()=>{reads++;throw Error('unexpected');},runActiveShare:async()=>{reads++;throw Error('unexpected');}};
 const service=core.createProjectRoadmapEnrollment(access as never);
 for(const input of [null,{}, {projectId:'p',revision:1,planFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),previewFingerprint:'c'.repeat(64),plan:{}}])assert.equal((await service.enroll(input)).status,'invalid_input');
 assert.equal(reads,0);
});

test('selector transport rejects duplicate, unknown, oversized and stale integer forms',async()=>{
 const {projectRoadmapForm}=await import(new URL('../lib/planning/project-roadmap-form.ts',import.meta.url).href);
 const f=new FormData();const fields={projectId:'project-a',revision:'1',planFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),previewFingerprint:'c'.repeat(64)};for(const [k,v] of Object.entries(fields))f.set(k,v);
 assert(projectRoadmapForm(f,'enroll'));f.append('revision','1');assert.equal(projectRoadmapForm(f,'enroll'),null);f.set('revision','1');f.set('workspace','caller');assert.equal(projectRoadmapForm(f,'enroll'),null);f.delete('workspace');f.set('projectId','x'.repeat(129));assert.equal(projectRoadmapForm(f,'enroll'),null);f.set('projectId','project-a');f.set('revision','01');assert.equal(projectRoadmapForm(f,'enroll'),null);
});
test('actual EN/RU controls render separate enrollment and exact-plan readiness forms with escaped source IDs',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {projectRoadmapCopy}=await import(new URL('../lib/i18n/project-roadmap-copy.ts',import.meta.url).href);
 const source=readFileSync(new URL('../components/domain/owner-console/project-roadmap-controls.tsx',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const selector={projectId:'project-a',revision:1,planFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64)},preview={...selector,origin:'manual_import',milestoneId:'backlog-1',taskCount:1,dependencyCount:0,originalDependencyCount:0,previewFingerprint:'c'.repeat(64),enrolled:false,tasks:[{sourceId:'<script>bad</script>',taskId:'task-a',originalDependencyIds:[],dependencyIds:[],status:'draft',version:1,dependencies:[],featurePlan:{planId:'plan-1',revision:1,fingerprint:'d'.repeat(64)}}]};
 for(const locale of ['en','ru'] as const){const c=projectRoadmapCopy(locale),mod:{exports:Record<string,unknown>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>name==='react'?{...React,useActionState:()=>[{status:'preview',preview},()=>{},false]}:require(name),mod,mod.exports);
 const html=renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapControls,{selector,c,previewAction:async()=>({status:'idle'}),enrollAction:async()=>({status:'idle'})}));assert(html.includes(c.activate));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>bad'));assert(html.includes(c.policy));let depth=0;for(const tag of html.matchAll(/<\/?form\b[^>]*>/gu)){depth+=tag[0].startsWith('</')?-1:1;assert(depth>=0&&depth<=1);}assert.equal(depth,0);
 const ready=renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapTaskControls,{preview:{...preview,enrolled:true},reviewedPlan:preview.tasks[0].featurePlan,taskId:'task-a',c,action:async()=>({status:'idle'})}));assert(ready.includes(c.ready));assert(ready.includes('name="featurePlanFingerprint"'));assert(ready.includes('name="expectedVersion"'));
 const noPlan=renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapTaskControls,{preview:{...preview,enrolled:true,tasks:[{...preview.tasks[0],featurePlan:null}]},reviewedPlan:null,taskId:'task-a',c,action:async()=>({status:'idle'})}));assert(noPlan.includes(c.noPlan));assert(!noPlan.includes('name="featurePlanFingerprint"'));
 const stale=renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapTaskControls,{preview:{...preview,enrolled:true},reviewedPlan:{...preview.tasks[0].featurePlan,fingerprint:'e'.repeat(64)},taskId:'task-a',c,action:async()=>({status:'idle'})}));assert(stale.includes(c.conflict));assert(!stale.includes('name="featurePlanFingerprint"'));
 }
});

test('actual enrollment/readiness actions bind only their scoped operation and invalidate acknowledged factual mutations',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript');
 for(const [file,name,operation] of [['app/projects/[projectId]/planning/actions.ts','enrollProjectRoadmapAction','enroll'],['app/tasks/[taskId]/development/actions.ts','readyProjectRoadmapTaskAction','ready']])for(const status of ['applied','replayed','conflict','unavailable']){
 const calls:string[]=[],paths:string[]=[],code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,mod:{exports:Record<string,(p:unknown,f:FormData)=>Promise<unknown>>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>name==='next/cache'?{revalidatePath:(path:string)=>paths.push(path)}:name.includes('owner-project-roadmap.server')?{submitProjectRoadmap:async(op:string)=>{calls.push(op);return{status};}}:{},mod,mod.exports);
 assert.deepEqual(await mod.exports[name](null,new FormData()),{status});assert.deepEqual(calls,[operation]);assert.equal(paths.length,['applied','replayed'].includes(status)?3:0);
 }
});

test('actual approved planning page exposes explicit enrollment preview in both locales',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const copy=await import(new URL('../lib/i18n/project-planning-copy.ts',import.meta.url).href),roadmap=await import(new URL('../lib/i18n/project-roadmap-copy.ts',import.meta.url).href);
 const compile=(source:string,modules:Record<string,unknown>)=>{const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,mod:{exports:Record<string,unknown>}={exports:{}};new Function('require','module','exports',code)((name:string)=>{assert(Object.hasOwn(modules,name),name);return modules[name];},mod,mod.exports);return mod.exports;};
 const controls=compile(readFileSync(new URL('../components/domain/owner-console/project-roadmap-controls.tsx',import.meta.url),'utf8'),{'react/jsx-runtime':require('react/jsx-runtime'),react:{...React,useActionState:()=>[{status:'idle'},()=>{},false]}});
 const plan={schemaVersion:'pac-project-plan/v1',title:'Approved plan',tasks:[{id:'t',title:'Task',goal:'Goal',description:'Description',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['Verified'],scope:['Scope'],sourceReferences:[0]}]};
 for(const locale of ['en','ru'] as const){const shell=({children}:{children:unknown})=>React.createElement('div',null,children);
 const modules={'react/jsx-runtime':require('react/jsx-runtime'),'next/link':{__esModule:true,default:({children,href}:{children:unknown;href:string})=>React.createElement('a',{href},children)},'@/components/shell/app-shell':{AppShell:shell},'@/components/ui/page-header':{PageHeader:()=>null},'@/components/ui/section-card':{SectionCard:shell},'@/components/domain/owner-console/owner-state':{OwnerDataUnavailable:()=>null,SignInRequired:()=>null},'@/components/domain/owner-console/project-planning-forms':{PlanningSourceForm:()=>null,PlanningDecisionForm:()=>null},'@/components/domain/owner-console/project-roadmap-controls':controls,'@/lib/i18n/locale.server':{getI18n:async()=>({locale})},'@/lib/i18n/project-planning-copy':copy,'@/lib/i18n/project-roadmap-copy':roadmap,'./actions':{},'@/lib/composition/owner-project-planning.server':{loadProjectPlanning:async()=>({status:'available',binding:{project:{projectId:'project-a'},projectStatus:'active'},sources:[],plans:{latestRevision:1,history:[{revision:1,status:'approved'}],selected:{revision:1,status:'approved',origin:'manual_import',plan,planFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),source:{filename:'plan.md',version:1,sha256:'c'.repeat(64)},tasks:[{sourceId:'t',taskId:'task-a'}]}}})}};
 const file=process.env.PAC_DEV_PAGE_SOURCE??new URL('../app/projects/[projectId]/planning/page.tsx',import.meta.url);const page=compile(readFileSync(file,'utf8'),modules).default as (props:unknown)=>Promise<unknown>;
 const html=renderToStaticMarkup(await page({params:Promise.resolve({projectId:'project-a'}),searchParams:Promise.resolve({})}));assert(html.includes(roadmap.projectRoadmapCopy(locale).preview));assert(html.includes('name="sourceFingerprint"'));
 }
});

test('EN/RU reload distinguishes current, original and proposed dependency facts without inferring readiness',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs');const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{projectRoadmapCopy}=await import(new URL('../lib/i18n/project-roadmap-copy.ts',import.meta.url).href);
 const source=readFileSync(new URL('../components/domain/owner-console/project-roadmap-controls.tsx',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const base:ProjectRoadmapPreview={origin:'manual_import',projectId:'project-a',revision:1,planFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),milestoneId:'backlog-a',taskCount:1,dependencyCount:0,originalDependencyCount:1,previewFingerprint:'c'.repeat(64),enrolled:true,tasks:[{sourceId:'B',taskId:'task-b',originalDependencyIds:['historical-task-a'],dependencyIds:[],dependencies:[],status:'draft',version:2,featurePlan:null}]};
 for(const locale of ['en','ru'] as const){const c=projectRoadmapCopy(locale);let current=base;const mod:{exports:Record<string,unknown>}={exports:{}};new Function('require','module','exports',code)((name:string)=>name==='react'?{...React,useActionState:()=>[{status:'preview',preview:current},()=>{},false]}:require(name),mod,mod.exports);
 const renderPlanning=()=>renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapControls,{selector:base,c,previewAction:async()=>({status:'idle'}),enrollAction:async()=>({status:'idle'})}));
 const renderTask=()=>renderToStaticMarkup(React.createElement(mod.exports.ProjectRoadmapTaskControls,{preview:current,taskId:'task-b',reviewedPlan:null,c,action:async()=>({status:'idle'})}));
 const planning=renderPlanning(),removed=renderTask();assert(planning.includes(c.currentDependencies+': 0'));assert(planning.includes(c.originalDependencies+': 1'));assert(removed.includes(c.dependencyStatus));assert(!removed.includes('historical-task-a'));assert(removed.includes(c.noPlan));assert(!removed.includes('name="featurePlanFingerprint"'));
 current={...base,dependencyCount:1,originalDependencyCount:0,tasks:[{...base.tasks[0],originalDependencyIds:[],dependencyIds:['current-task-a'],dependencies:[{taskId:'current-task-a',status:'ready'}]}]};
 const added=renderTask();assert(added.includes('current-task-a'));assert(added.includes(c.taskReady));assert(added.includes(c.noPlan));assert(!added.includes('name="featurePlanFingerprint"'));
 current={...current,enrolled:false};assert(renderPlanning().includes(c.proposedDependencies));const proposed=renderTask();assert(proposed.includes(c.proposedDependencyStatus));assert(!proposed.includes('<p>'+c.dependencyStatus+'</p>'));assert(!proposed.includes('name="expectedVersion"'));
 }
});
