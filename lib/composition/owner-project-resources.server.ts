import "server-only";
import { randomBytes } from "node:crypto";
import { connection } from "next/server";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createProjectOwnerAccess } from "../projects/project-owner-access";
import { createRepositoryBinding } from "../projects/repository-binding";
import { createProjectKnowledge } from "../projects/project-knowledge";
import { repositoryBindingForm, knowledgeUploadForm } from "../projects/project-resource-forms";

async function withResources<T>(work: (repository: ReturnType<typeof createRepositoryBinding>, knowledge: ReturnType<typeof createProjectKnowledge>) => Promise<T>) {
  const session = await auth();
  const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
  try {
    const access = createProjectOwnerAccess({ database, domainWorkspaceId: process.env.APP_DEMO_WORKSPACE_SLUG ?? "", session });
    return await work(createRepositoryBinding(access), createProjectKnowledge(access));
  } finally { await database.close().catch(() => undefined); }
}
export function projectResourceRequestKey() { return `pr-${randomBytes(16).toString("hex")}`; }
export async function loadProjectRepository(projectId: unknown) {
  await connection();
  try { return await withResources(repository => repository.read(projectId)); }
  catch { return { status: "unavailable" as const }; }
}
export async function loadProjectKnowledge(projectId: unknown, filename: unknown, version: unknown) {
  await connection();
  try {
    return await withResources(async (repository, knowledge) => {
      const binding = await repository.read(projectId); if (binding.status !== "ok") return { status: binding.status };
      const documents = await knowledge.list(projectId); if (documents.status !== "ok") return { status: documents.status };
      if (filename === undefined && version === undefined) return { status: "available" as const, binding: binding.value, documents: documents.value, selected: null };
      const selected = await knowledge.read(projectId, filename, typeof version === "string" && /^[1-9][0-9]?$/u.test(version) ? Number(version) : version);
      if (selected.status !== "ok") return { status: selected.status };
      return { status: "available" as const, binding: binding.value, documents: documents.value, selected: selected.value };
    });
  } catch { return { status: "unavailable" as const }; }
}
export async function submitRepositoryBinding(form: FormData) {
  try { const input = repositoryBindingForm(form); return input ? await withResources(repository => repository.bind(input)) : { status: "invalid_input" as const }; }
  catch { return { status: "unavailable" as const }; }
}
export async function submitKnowledgeUpload(form: FormData) {
  try { const input = await knowledgeUploadForm(form); return input ? await withResources((_repository, knowledge) => knowledge.upload(input)) : { status: "invalid_input" as const }; }
  catch { return { status: "unavailable" as const }; }
}
