// Synthetic schema demonstration, NOT the real Smart Algorithms backlog and never AI output.
export function representativeProjectPlan(count=3) {
 return {schemaVersion:"pac-project-plan/v1",title:"Reviewed backlog fixture",tasks:Array.from({length:count},(_,i)=>({id:`CE-${String(i+1).padStart(3,"0")}`,title:`Backlog task ${i+1}`,goal:`Deliver and verify outcome ${i+1}`,description:"Owner-authored requirements; no execution authority.",type:"feature",priority:"P2",dependencyIds:i?[`CE-${String(i).padStart(3,"0")}`]:[],acceptanceCriteria:["Expected behavior is verified"],scope:["Review the authorized feature boundary"],sourceReferences:[0]}))};
}
export function markdownProjectPlan(plan=representativeProjectPlan()){return `# Owner roadmap\n\n\`\`\`pac-plan-v1\n${JSON.stringify(plan,null,2)}\n\`\`\`\n`;}
export function yamlProjectPlan(plan=representativeProjectPlan()){
 return `schemaVersion: pac-project-plan/v1\ntitle: ${JSON.stringify(plan.title)}\ntasks:\n`+plan.tasks.map(t=>Object.entries(t).map(([k,v],i)=>`${i?"    ":"  - "}${k}: ${JSON.stringify(v)}\n`).join("")).join("");
}
