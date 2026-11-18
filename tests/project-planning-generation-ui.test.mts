import assert from 'node:assert/strict';
import test from 'node:test';
const transport=await import(new URL('../lib/planning/project-planning-form.ts',import.meta.url).href);
const seam=await import(new URL('../lib/composition/owner-project-planning-generation-action.ts',import.meta.url).href);
const source={filename:'a.md',version:1,sha256:'a'.repeat(64)};
const form=(values:Record<string,string>)=>{const f=new FormData();for(const[k,v]of Object.entries(values))f.set(k,v);return f;};
const selected={projectId:'project-a',sources:JSON.stringify([source])};
test('bounded exact generation transport rejects duplicates, authority, bodies and malformed selectors',()=>{
 assert(transport.projectGenerationForm(form(selected),'prepare'));
 for(const extra of ([{workspaceId:'x'},{provider:'mock'},{body:'secret'},{sources:'x'.repeat(2049)},{projectId:'../escape'},{sources:'[{"filename":"a.md","filename":"b.md"}]'}] as Record<string,string>[]))assert.equal(transport.projectGenerationForm(form({...selected,...extra}),'prepare'),null);
 const f=form(selected);f.append('projectId','project-a');assert.equal(transport.projectGenerationForm(f,'prepare'),null);
 assert.equal(transport.projectGenerationForm(form({...selected,operationKey:'pp-'+'a'.repeat(32),offerFingerprint:'b'.repeat(64),consent:'false'}),'generate'),null);
 assert.equal(transport.projectGenerationForm(form({projectId:'project-a',operationKey:'bad'}),'read'),null);
});
test('production-unbound transport authorizes, never calls generation; hostile input does not resolve authority',async()=>{
 let calls=0;const action=seam.createProjectGenerationActions({authorize:async()=>{calls++;return 'ok';},read:async()=>({status:'recovery_required'})});
 assert.equal((await action('prepare',form(selected))).status,'production_binding_unavailable');assert.equal(calls,1);
 assert.equal((await action('generate',form({...selected,operationKey:'pp-'+'a'.repeat(32),offerFingerprint:'b'.repeat(64),consent:'true'}))).status,'production_binding_unavailable');
 assert.equal((await action('read',form({projectId:'project-a',operationKey:'pp-'+'a'.repeat(32)}))).status,'recovery_required');
 assert.equal((await action('prepare',form({...selected,workspaceId:'forged'}))).status,'invalid_input');assert.equal(calls,3);
 const denied=seam.createProjectGenerationActions({authorize:async()=> 'unauthenticated',read:async()=>{throw Error('must not read');}});
 assert.equal((await denied('read',form({projectId:'project-a',operationKey:'pp-'+'a'.repeat(32)}))).status,'unauthenticated');
});

// Render the actual client module with the existing TypeScript/React dependencies.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const copy=await import(new URL('../lib/i18n/project-planning-copy.ts',import.meta.url).href);
function clientModule(hooks:unknown=React){
 const js=ts.transpileModule(readFileSync(new URL('../components/domain/owner-console/project-planning-forms.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{} as Record<string,(props:unknown)=>unknown>};new Function('require','module','exports',js)((name:string)=>name==='react'?hooks:require(name),m,m.exports);return m.exports;
}
test('all generation states localized; actual proposal renders escaped fields and exact references in EN/RU',()=>{
 const client=clientModule();
 const plan={schemaVersion:'pac-project-plan/v1',title:'<script>title</script>',tasks:[{id:'id',title:'<img src=x>',goal:'<script>goal</script>',description:'<b>description</b>',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['<iframe>'],scope:['<svg>'],sourceReferences:[0]}]};
 for(const locale of ['en','ru'] as const){
  const g=copy.projectGenerationCopy(locale),c=copy.projectPlanningCopy(locale);
  assert.deepEqual(Object.keys(g),Object.keys(copy.projectGenerationCopy('en')));
  for(const status of ['awaiting_authorization','submission_pending','proposal_available','invalid_output','budget_denied','provider_unavailable','authorization_denied','conflict','recovery_required','production_binding_unavailable']){
   const html=renderToStaticMarkup(client.GenerationResult({state:{status,proposal:plan,sources:[source]},c,g}));
   assert(html.includes('role="status"'));if(status==='proposal_available'){assert(html.includes('&lt;script&gt;title'));assert(html.includes(source.sha256));assert(html.includes('&lt;iframe&gt;'));assert(!/<script|<img|<iframe|<svg/u.test(html));}else assert(!html.includes('title&lt;'));
  }
 }
});
test('actual consent starts unchecked and disabled; selection remount and read forms never invoke a model on render',()=>{
 let states:unknown[]=[],cursor=0,calls=0;const actions=async()=>{calls++;return{status:'idle'};};
 const hooks={useState:(initial:unknown)=>{const i=cursor++;states[i]??=initial;return[states[i],(v:unknown)=>{states[i]=v;}];},useActionState:(_action:unknown,initial:unknown)=>[initial,()=>{},false]};
 const client=clientModule(hooks),c=copy.projectPlanningCopy('en'),g=copy.projectGenerationCopy('en');
 const props={projectId:'project-a',sources:[source],c,g,prepareAction:actions,generateAction:actions,readAction:actions};
 const tree=client.ProjectPlanningGenerationForm(props) as {props:{children:unknown[]}};
 assert(tree);assert.equal(calls,0);
 // SSR executes all nested form components; no automatic action dispatch.
 states=[];cursor=0;const html=renderToStaticMarkup(client.ProjectPlanningGenerationForm(props));assert(html.includes(g.read));assert.equal(calls,0);
});
test('actual authorization checkbox gates submission; fixed operation key survives pending and recovery',()=>{
 const c=copy.projectPlanningCopy('en'),g=copy.projectGenerationCopy('en');
 const policy={version:1,purpose:'project_document_planning',destination:'deterministic:local',identity:{providerId:'mock',providerKind:'mock',deploymentId:'mock-deployment',providerModelId:'mock-model',providerRequestModelId:'mock-model-v1',providerModelVersion:'mock-model-v1'},maxInputTokens:100,maxOutputTokens:100,maxCostUsdMicros:10,dailyTokenBudget:200,monthlyCostBudgetUsdCents:10,inputCostUsdMicrosPerMillionTokens:1,outputCostUsdMicrosPerMillionTokens:1,pricesVerifiedOn:'2020-01-01'};
 let cursor=0;const states:unknown[]=[];
 const hooks={useState:(initial:unknown)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(v:unknown)=>{states[i]=v;}];},useActionState:()=>[{status:'recovery_required'},()=>{},false]};
 const client=clientModule(hooks),key='pp-'+'a'.repeat(32);
 const props={projectId:'project-a',offer:{sources:[source],policy,preparationFingerprint:'b'.repeat(64),offerFingerprint:'c'.repeat(64)},operationKey:key,c,g,generateAction:async()=>({status:'idle'}),readAction:async()=>({status:'idle'})};
 type Element={type:unknown;props:Record<string,unknown>};
 const elements=(node:unknown):Element[]=>{if(Array.isArray(node))return node.flatMap(elements);if(!node||typeof node!=='object'||!('props' in node))return[];const n=node as Element;return[n,...elements(n.props.children)];};
 const render=()=>{cursor=0;return elements(client.GenerationAuthorizationForm(props));};
 let tree=render();let checkbox=tree.find(n=>n.props.name==='consent')!;assert.equal(checkbox.props.checked,false);assert.equal(tree.find(n=>n.type==='button')!.props.disabled,true);
 (checkbox.props.onChange as (e:unknown)=>void)({target:{checked:true}});tree=render();assert.equal(tree.find(n=>n.type==='button')!.props.disabled,false);
 assert.equal(tree.find(n=>n.props.name==='operationKey')!.props.value,key);
 assert(tree.some(n=>n.type==='a'&&String(n.props.href).includes(key)));
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');let replaced='';Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{href:'http://localhost/projects/project-a/planning'},history:{replaceState:(_a:unknown,_b:unknown,url:URL)=>{replaced=url.toString();}}}});
 try{(tree.find(n=>n.type==='form')!.props.onSubmit as ()=>void)();}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
 assert(replaced.includes(key));tree=render();assert.equal(tree.find(n=>n.type==='button')!.props.disabled,true);assert.equal(tree.find(n=>n.props.name==='operationKey')!.props.value,key);
 // Remount for a different offer starts with unchecked consent.
 states.length=0;tree=render();checkbox=tree.find(n=>n.props.name==='consent')!;assert.equal(checkbox.props.checked,false);
});
test('server seam never exposes raw/internal fields, preserves key and distinguishes bounded failures',async()=>{
 const key='pp-'+'a'.repeat(32);const input=form({...selected,operationKey:key,offerFingerprint:'b'.repeat(64),consent:'true'});
 for(const status of ['budget_denied','provider_unavailable','authorization_denied','conflict','invalid_output','recovery_required']){
  const action=seam.createProjectGenerationActions({authorize:async()=> 'ok',read:async()=>({status}),backend:{prepare:async()=>({status}),generate:async()=>({status,rawOutput:'secret',id:'private-uuid',sql:'secret'})}});
  assert.deepEqual(await action('generate',input),{status,operationKey:key,runtimeDispatchAllowed:false});
 }
 const throwing=seam.createProjectGenerationActions({authorize:async()=> 'ok',read:async()=>{throw Error('private SQL');}});
 assert.equal((await throwing('read',form({projectId:'project-a',operationKey:key}))).status,'recovery_required');
});
test('framework metadata is bounded and never becomes application authority',()=>{
 const f=form(selected);f.set('$ACTION_ID_test','');assert(transport.projectGenerationForm(f,'prepare'));
 f.set('$ACTION_ID_test','x'.repeat(16385));assert.equal(transport.projectGenerationForm(f,'prepare'),null);
 const blob=form(selected);blob.set('sources',new Blob(['private']),'data.json');assert.equal(transport.projectGenerationForm(blob,'prepare'),null);
});
test('actual Server Actions delegate explicit operations only and never revalidate generation into manual approval',async()=>{
 const js=ts.transpileModule(readFileSync(new URL('../app/projects/[projectId]/planning/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const calls:string[]=[],invalidations:string[]=[];const m={exports:{} as Record<string,(p:unknown,f:FormData)=>Promise<unknown>>};
 new Function('require','module','exports',js)((name:string)=>name==='next/cache'?{revalidatePath:(p:string)=>invalidations.push(p)}:{submitProjectGeneration:async(op:string)=>{calls.push(op);return{status:'production_binding_unavailable'};}},m,m.exports);
 assert.equal(calls.length,0);
 for(const name of ['prepareProjectGenerationAction','generateProjectProposalAction','readProjectProposalAction'])await m.exports[name](null,form(selected));
 assert.deepEqual(calls,['prepare','generate','read']);assert.deepEqual(invalidations,[]);
});
test('source selection changes remount the reviewed offer and consent',()=>{
 const values:unknown[]=[];let index=0;
 const hooks={useState:(initial:unknown)=>{const i=index++;if(!(i in values))values[i]=initial;return[values[i],(v:unknown)=>{values[i]=v;}];},useActionState:(_a:unknown,s:unknown)=>[s,()=>{},false]};
 const client=clientModule(hooks),action=async()=>({status:'idle'}),props={projectId:'project-a',sources:[source,{...source,filename:'b.md'}],c:copy.projectPlanningCopy('en'),g:copy.projectGenerationCopy('en'),prepareAction:action,generateAction:action,readAction:action};
 type Child={type?:{name?:string};key?:string;props:Record<string,unknown>};
 const render=()=>{index=0;return (client.ProjectPlanningGenerationForm(props) as {props:{children:Child[]}}).props.children;};
 let children=render();const initial=children.find(n=>n?.type?.name==='Prepare')!.key;
 (children.find(n=>n?.type?.name==='PlanningMultiSourceSelect')!.props.onChange as (v:string[])=>void)([`${source.filename}|1|${source.sha256}`]);
 children=render();assert.notEqual(children.find(n=>n?.type?.name==='Prepare')!.key,initial);
});
test('actual production composition resolves server identity/workspace and remains unbound',async()=>{
 const js=ts.transpileModule(readFileSync(new URL('../lib/composition/owner-project-planning.server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 let auths=0,closes=0,reads=0;const trustedSession={pacIdentity:{provider:'github',providerSubject:'original'}};
 const modules:Record<string,unknown>={
  'server-only':{},'next/server':{connection:async()=>{}},'../auth/next-auth.server':{auth:async()=>{auths++;return trustedSession;}},
  '../db/postgres':{createWorkflowRuntimePostgresDatabase:()=>({close:async()=>{closes++;}})},
  '../projects/project-owner-access':{snapshotProjectSession:(s:unknown)=>s,createProjectOwnerAccess:(config:{session:unknown})=>{assert.strictEqual(config.session,trustedSession);return{run:async(_projectId:string,_write:boolean,work:()=>Promise<unknown>)=>({status:'ok',value:await work()})};}},
  '../projects/repository-binding':{},'../planning/project-planning':{},'../planning/project-planning-form':transport,
  './owner-project-planning-generation-action':seam,
  '../planning/project-planning-generation':{createProjectGenerationRequests:(config:{policy:()=>unknown})=>{assert.equal(config.policy(),null);return{read:async()=>{reads++;return{status:'ok',value:{status:'recovery_required'}};}};}},
  '../planning/project-planning-contract':{planDigest:()=> 'a'.repeat(64)},
 };
 const m={exports:{} as {submitProjectGeneration:(op:string,f:FormData)=>Promise<{status:string}>}};new Function('require','module','exports',js)((name:string)=>{assert(Object.hasOwn(modules,name),name);return modules[name];},m,m.exports);
 assert.equal((await m.exports.submitProjectGeneration('prepare',form(selected))).status,'production_binding_unavailable');
 assert.equal((await m.exports.submitProjectGeneration('read',form({projectId:'project-a',operationKey:'pp-'+'a'.repeat(32)}))).status,'recovery_required');
 assert.equal(auths,2);assert.equal(closes,2);assert.equal(reads,1);
});

test('C1 rejected shapes and excessive field counts stop before entries traversal or authority',async()=>{
 const excessive=form({...selected,operationKey:'pp-'+'a'.repeat(32),offerFingerprint:'b'.repeat(64),consent:'true'});
 for(let i=0;i<100;i++)excessive.append('$ACTION_ID_'+i,'');
 const descriptor=Object.getOwnPropertyDescriptor(FormData.prototype,'entries')!;
 let traversals=0,authority=0,generations=0;
 Object.defineProperty(FormData.prototype,'entries',{...descriptor,value:function(this:FormData){traversals++;return Reflect.apply(descriptor.value,this,[]);}});
 const action=seam.createProjectGenerationActions({authorize:async()=>{authority++;return 'ok';},read:async()=>({status:'recovery_required'}),backend:{prepare:async()=>{generations++;return{};},generate:async()=>{generations++;return{};}}});
 try{
  for(const rejected of [excessive,null,{},new Proxy(new FormData(),{}),Object.create(FormData.prototype)]){
   assert.equal(transport.projectGenerationForm(rejected,'generate'),null);
   assert.equal((await action('generate',rejected)).status,'invalid_input');
  }
  assert.equal(traversals,0,'bounded field helper rejection must return before entries traversal');
  assert.equal(authority,0);assert.equal(generations,0);
 }finally{Object.defineProperty(FormData.prototype,'entries',descriptor);}
});

test('C2 keyed project transition discards nested offer/consent/submission/result and retains original project read link',()=>{
 const c=copy.projectPlanningCopy('en'),g=copy.projectGenerationCopy('en'),action=async()=>({status:'idle'}),key='pp-'+'a'.repeat(32);
 const hooks={useState:(initial:unknown)=>[initial,()=>{}],useActionState:(_a:unknown,s:unknown)=>[s,()=>{},false]};
 const client=clientModule(hooks);
 type Element={type:unknown;key:string|null;props:Record<string,unknown>};
 const base={sources:[source],c,previewAction:action,saveAction:action,aiAction:action};
 const project=(projectId:string)=>({projectId,sources:[source],c,g,prepareAction:action,generateAction:action,readAction:action});
 const a=client.PlanningSourceForm({...base,projectId:'project-a',generation:project('project-a')}) as Element;
 const b=client.PlanningSourceForm({...base,projectId:'project-b',generation:project('project-b')}) as Element;
 // A keyed component replacement discards all state in the previous subtree, including pending results.
 assert.notEqual(a.key,b.key,'generation subtree must remount even with identical source selectors');
 const children=(node:unknown):Element[]=>{if(Array.isArray(node))return node.flatMap(children);if(!node||typeof node!=='object'||!('props'in node))return[];const n=node as Element;return[n,...children(n.props.children)];};
 const clean=renderToStaticMarkup(client.ProjectPlanningGenerationForm(project('project-b')));
 assert(!clean.includes('checked=""'));assert(!clean.includes(g.proposal_available));assert(!clean.includes(key));
 const policy={identity:{providerId:'mock',providerKind:'mock',deploymentId:'mock-deployment',providerModelId:'mock-model',providerRequestModelId:'mock-model-v1',providerModelVersion:'mock-model-v1'}};
 const old=children(client.GenerationAuthorizationForm({...project('project-a'),offer:{sources:[source],policy},operationKey:key}));
 assert(old.some(n=>n.type==='a'&&n.props.href===`/projects/project-a/planning?operationKey=${key}`));
 assert.equal(old.find(n=>n.props.name==='projectId')!.props.value,'project-a');
 const newer=children(client.ProjectPlanningGenerationForm({...project('project-b'),operationKey:key}));
 const read=newer.find(n=>(n.type as {name?:string})?.name==='ExistingOperation')!;
 assert.equal(read.props.projectId,'project-b');assert.equal(read.props.initialKey,key);
 // The same identifier in another project's read form never carries old proposal state or authority.
 assert(read.key?.includes('project-b'));
});
test('C2 exact source revisions invalidate the reviewed subtree even when selection state is retained',()=>{
 const values:unknown[]=[];let index=0;
 const hooks={useState:(initial:unknown)=>{const i=index++;if(!(i in values))values[i]=initial;return[values[i],(v:unknown)=>{values[i]=v;}];},useActionState:(_a:unknown,s:unknown)=>[s,()=>{},false]};
 const client=clientModule(hooks),action=async()=>({status:'idle'}),base={projectId:'project-a',sources:[source],c:copy.projectPlanningCopy('en'),g:copy.projectGenerationCopy('en'),prepareAction:action,generateAction:action,readAction:action};
 type Child={type?:{name?:string};key?:string;props:Record<string,unknown>};
 const render=(props=base)=>{index=0;return(client.ProjectPlanningGenerationForm(props) as {props:{children:Child[]}}).props.children;};
 let tree=render();(tree.find(n=>n?.type?.name==='PlanningMultiSourceSelect')!.props.onChange as(v:string[])=>void)([`${source.filename}|1|${source.sha256}`]);
 tree=render();const before=tree.find(n=>n?.type?.name==='Prepare')!.key;
 tree=render({...base,sources:[{...source,version:2,sha256:'b'.repeat(64)}]});assert.notEqual(tree.find(n=>n?.type?.name==='Prepare')!.key,before);
});
