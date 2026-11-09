import { createHash } from "node:crypto";
import { isUint8Array, isProxy } from "node:util/types";
import type { createProjectOwnerAccess } from "./project-owner-access";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { Conflict, exactOwnData, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { fingerprint, requestKeyPattern } from "./repository-binding.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { isProjectKey } from "./project-registry.ts";

export const knowledgeLimits = Object.freeze({ maxBytes: 262144, maxDocuments: 100, maxVersions: 50, maxProjectBytes: 16777216 });
export function isDocumentFilename(input: unknown): input is string {
  return typeof input === "string" && input.length >= 4 && input.length <= 128 && input === input.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._-]*\.(md|yaml|yml)$/u.test(input) && !input.includes("..");
}
export function documentSnapshot(raw: unknown): Readonly<{ bytes: Uint8Array; text: string; sha256: string }> | null {
  if (isProxy(raw) || !isUint8Array(raw)) return null;
  const getLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
  const length = Reflect.apply(getLength, raw, []) as number;
  if (length < 1 || length > knowledgeLimits.maxBytes) return null;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = raw[i];
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text) || !Buffer.from(text, "utf8").equals(Buffer.from(bytes))) return null;
    return Object.freeze({ bytes, text, sha256: createHash("sha256").update(bytes).digest("hex") });
  } catch { return null; }
}

export type KnowledgeDocumentSummary = Readonly<{ filename: string; version: number; sha256: string; uploadedAt: string; verificationStatus: "uploaded_unverified" }>;
function summary(row: Record<string, unknown>, filename: string): KnowledgeDocumentSummary {
  const version = Number(row.version);
  const date = row.created_at instanceof Date ? row.created_at : typeof row.created_at === "string" ? new Date(row.created_at) : null;
  if (!isDocumentFilename(filename) || !Number.isSafeInteger(version) || version < 1 || version > 50
    || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(row.sha256) || !date || !Number.isFinite(date.getTime())) throw new Unavailable();
  return Object.freeze({ filename, version, sha256: row.sha256, uploadedAt: date.toISOString(), verificationStatus: "uploaded_unverified" });
}

export function createProjectKnowledge(access: ReturnType<typeof createProjectOwnerAccess>) {
  return Object.freeze({
    list(projectId: unknown) {
      return access.run(projectId, false, async (client, context) => {
        const rows = await client.query(`/* project-knowledge:list */
          select d.filename,v.version,v.sha256,v.created_at from knowledge_documents d
          left join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id and v.id=d.current_version_id
          where d.workspace_id=$1 and d.project_key=$2 and d.status='active' order by d.filename limit 101`, [context.workspaceId, projectId]);
        if (rows.rowCount > 100) throw new Unavailable();
        return Object.freeze(rows.rows.map(row => summary(row, row.filename as string)));
      });
    },
    read(projectId: unknown, filename: unknown, version: unknown) {
      if (!isDocumentFilename(filename) || (version !== undefined && (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 50))) return Promise.resolve(Object.freeze({ status: "invalid_input" as const }));
      return access.run(projectId, false, async (client, context) => {
        const history = await client.query(`/* project-knowledge:history */
          select v.id::text,v.version,v.sha256,v.created_at,d.current_version_id::text from knowledge_documents d
          join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id
          where d.workspace_id=$1 and d.project_key=$2 and d.filename=$3 and d.status='active' order by v.version desc limit 51`, [context.workspaceId, projectId, filename]);
        if (history.rowCount < 1 || history.rowCount > 50 || history.rows[0].id !== history.rows[0].current_version_id) throw new Unavailable();
        const versions = history.rows.map(row => summary(row, filename));
        if (versions.some((v, i) => v.version !== versions.length - i)) throw new Unavailable();
        const selected = history.rows.find(row => Number(row.version) === (version ?? versions[0].version));
        if (!selected) throw new Unavailable();
        const content = await client.query(`/* project-knowledge:content */
          select v.content from knowledge_document_versions v join knowledge_documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
          where v.workspace_id=$1 and d.project_key=$2 and d.filename=$3 and d.status='active' and v.id=$4::uuid`, [context.workspaceId, projectId, filename, selected.id]);
        const snapshot = content.rowCount === 1 ? documentSnapshot(content.rows[0].content) : null;
        if (!snapshot || snapshot.sha256 !== selected.sha256) throw new Unavailable();
        return Object.freeze({ document: summary(selected, filename), versions: Object.freeze(versions), content: snapshot.text });
      });
    },
    async upload(raw: unknown) {
      const input = exactOwnData(raw, ["projectId", "filename", "bytes", "expectedVersion", "requestId"]);
      const snapshot = input ? documentSnapshot(input.bytes) : null;
      if (!input || !isProjectKey(input.projectId) || !snapshot || !isDocumentFilename(input.filename) || typeof input.requestId !== "string" || input.requestId.length > 96 || input.requestId !== input.requestId.trim() || !requestKeyPattern.test(input.requestId)
        || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0 || (input.expectedVersion as number) >= 50) return Object.freeze({ status: "invalid_input" as const });
      const intent = { projectId: input.projectId, filename: input.filename, expectedVersion: input.expectedVersion as number, requestId: input.requestId };
      const digest = fingerprint([intent.projectId, intent.filename, intent.expectedVersion, snapshot.sha256]);
      return access.run(input.projectId, true, async (client, context) => {
        const prior = await client.query(`/* project-knowledge:replay */
          select v.id::text,v.version,v.sha256,v.created_at,v.intent_fingerprint,v.created_by::text,d.project_key,d.filename from knowledge_document_versions v
          join knowledge_documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
          where v.workspace_id=$1 and v.upload_request_key=$2 limit 2`, [context.workspaceId, intent.requestId]);
        if (prior.rowCount) {
          const row = prior.rows[0];
          if (prior.rowCount !== 1 || Number(row.version) !== intent.expectedVersion + 1 || row.sha256 !== snapshot.sha256 || row.intent_fingerprint !== digest || row.created_by !== context.userId || row.project_key !== intent.projectId || row.filename !== intent.filename) throw new Conflict();
          const audit = await client.query(`/* project-knowledge:replay-audit */
            select actor_user_id::text,metadata from audit_events where workspace_id=$1 and event_type='knowledge.document_uploaded'
            and entity_type='knowledge_document_version' and entity_id=$2::uuid limit 2 for share`, [context.workspaceId, row.id]);
          const metadata = exactOwnData(audit.rows[0]?.metadata, ["projectId", "version", "sha256"]);
          if (audit.rowCount !== 1 || audit.rows[0].actor_user_id !== context.userId || metadata?.projectId !== intent.projectId
            || metadata.version !== Number(row.version) || metadata.sha256 !== snapshot.sha256) throw new Conflict();
          return Object.freeze({ outcome: "replayed" as const, document: summary(row, intent.filename) });
        }
        const quota = await client.query(`/* project-knowledge:quota */
          select (select count(*)::int from knowledge_documents where workspace_id=$1 and project_key=$2) as documents,
                 coalesce(sum(octet_length(v.content)),0)::text as bytes
          from knowledge_document_versions v join knowledge_documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
          where d.workspace_id=$1 and d.project_key=$2`, [context.workspaceId, intent.projectId]);
        const document = await client.query(`/* project-knowledge:document */
          select id::text,current_version_id::text from knowledge_documents where workspace_id=$1 and project_key=$2 and filename=$3 and status='active' for update`, [context.workspaceId, intent.projectId, intent.filename]);
        if (quota.rowCount !== 1 || Number(quota.rows[0].bytes) + snapshot.bytes.length > knowledgeLimits.maxProjectBytes
          || (!document.rowCount && Number(quota.rows[0].documents) >= 100)) throw new Conflict();
        let id: unknown = document.rows[0]?.id;
        const latest = id ? await client.query(`/* project-knowledge:latest */
          select id::text,version from knowledge_document_versions where workspace_id=$1 and document_id=$2 order by version desc limit 1`, [context.workspaceId, id]) : null;
        const current = latest?.rows[0];
        if ((Number(current?.version ?? 0) !== intent.expectedVersion) || (document.rowCount && document.rows[0].current_version_id !== (current?.id ?? null))) throw new Conflict();
        if (!id) {
          const created = await client.query(`/* project-knowledge:create-document */
            insert into knowledge_documents(workspace_id,project_key,filename,title,source_type,mime_type,status,indexing_status,uploaded_by)
            values($1,$2,$3,$3,'manual_upload',$4,'active','uploaded',$5) returning id::text`,
          [context.workspaceId, intent.projectId, intent.filename, intent.filename.endsWith(".md") ? "text/markdown" : "text/yaml", context.userId]);
          if (created.rowCount !== 1) throw new Unavailable(); id = created.rows[0].id;
        }
        const stored = await client.query(`/* project-knowledge:version */
          insert into knowledge_document_versions(workspace_id,document_id,version,content,sha256,upload_request_key,intent_fingerprint,created_by)
          values($1,$2,$3,$4,$5,$6,$7,$8) on conflict (workspace_id,upload_request_key) do nothing
          returning id::text,version,sha256,created_at`, [context.workspaceId, id, intent.expectedVersion + 1, Buffer.from(snapshot.bytes), snapshot.sha256, intent.requestId, digest, context.userId]);
        if (stored.rowCount !== 1) throw new Conflict();
        const row = stored.rows[0];
        const updated = await client.query(`/* project-knowledge:advance */
          update knowledge_documents set current_version_id=$3::uuid where workspace_id=$1 and id=$2::uuid returning id`, [context.workspaceId, id, row.id]);
        if (updated.rowCount !== 1) throw new Unavailable();
        const audit = await client.query(`/* project-knowledge:audit */
          insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)
          values($1,$2,'knowledge.document_uploaded','knowledge_document_version',$3::uuid,$4::jsonb) returning id`,
        [context.workspaceId, context.userId, row.id, JSON.stringify({ projectId: intent.projectId, version: row.version, sha256: snapshot.sha256 })]);
        if (audit.rowCount !== 1) throw new Unavailable();
        return Object.freeze({ outcome: "saved" as const, document: summary(row, intent.filename) });
      });
    },
  });
}
