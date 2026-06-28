import type { StatusTone } from "./app";

export type DocumentStatus = "indexed" | "indexing" | "failed" | "uploaded";

export type KnowledgeDocument = {
  id: string;
  title: string;
  collection: string;
  status: DocumentStatus;
  statusTone: StatusTone;
  uploadedBy: string;
  updatedAt: string;
  size: string;
  sourcePreview: string;
  indexingNote: string;
};

export type SourceCitation = {
  id: string;
  title: string;
  collection: string;
  excerpt: string;
  confidence: string;
};
