import "server-only";
import { constants, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { auth } from "../auth/next-auth.server";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority";
import { normalizeOwnerAI044ProofPolicy } from "./owner-ai044-proof";
import { createOwnerOpenAIApiProof,ownerOpenAIApiProofInput } from "./owner-openai-api-proof";
import { createOpenAIApiCredentialStore,defaultOpenAIApiDirectory } from "../integrations/openai-api/openai-api-credential-store";
import { readOpenAIApiPricing } from "../integrations/openai-api/openai-api-pricing.server";
import { createAI044SubscriptionGitObjectReader } from "../executors/ai044-subscription-git-context";
import type { OwnerOpenAIApiProofView } from "../../types/openai-api-proof";

/** SAME exact FeaturePlan policy as the subscription runner, not browser data or a generic enable flag. */
async function policy() {
  const h=await open(join(homedir(),".config/private-ai-cloud/ai044-production-proof.json"),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const s=await h.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||s.size>32768||s.nlink!==1)throw Error("proof_unavailable");
    const b=Buffer.alloc(32769),r=await h.read(b,0,b.length,0);if(r.bytesRead!==s.size)throw Error("proof_unavailable");
    return normalizeOwnerAI044ProofPolicy(JSON.parse(b.subarray(0,r.bytesRead).toString("utf8")));
  }finally{await h.close();}
}
async function withProof(work:(p:ReturnType<typeof createOwnerOpenAIApiProof>)=>Promise<OwnerOpenAIApiProofView>):Promise<OwnerOpenAIApiProofView> {
  let db:ReturnType<typeof createWorkflowRuntimePostgresDatabase>|null=null;
  try {
    const workspace=process.env.APP_DEMO_WORKSPACE_SLUG;if(!workspace)return {status:"unavailable"};
    db=createWorkflowRuntimePostgresDatabase({connectionString:process.env.DATABASE_URL,maxConnections:2});
    const identitySource=createGitHubSessionIdentitySource({database:db,sessionResolver:{resolve:()=>auth()}});
    if((await resolveSessionOwner(db,workspace,identitySource)).status!=="owner")return {status:"unavailable"};
    const p=await policy();
    return await work(createOwnerOpenAIApiProof({database:db,domainWorkspaceId:workspace,identitySource,policy:p,
      credentials:createOpenAIApiCredentialStore(defaultOpenAIApiDirectory()),pricing:readOpenAIApiPricing,clock:Date.now,transport:globalThis.fetch,
      contextSource:createAI044SubscriptionGitObjectReader({repositoryRoot:p.repositoryRoot,repositoryId:p.repository.id})}));
  }catch{return {status:"unavailable"};}finally{await db?.close().catch(()=>undefined);}
}
export const loadOwnerOpenAIApiProof=()=>withProof(p=>p.load());
export async function submitOwnerOpenAIApiProof(form:FormData) {
  const input=ownerOpenAIApiProofInput(form);return input?withProof(p=>p.act(input)):{status:"unavailable"} as const;
}
