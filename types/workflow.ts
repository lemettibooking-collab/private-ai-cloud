import type { StatusTone } from "./app";
import type { SourceCitation } from "./knowledge";
import type { WorkflowRunStatus } from "@/lib/contracts/domain";

export type { WorkflowRunStatus } from "@/lib/contracts/domain";

export type WorkflowStatus = WorkflowRunStatus;

export type WorkflowTemplate = {
  code: string;
  title: string;
  department: string;
  description: string;
  approvalRequired: boolean;
  href: string;
  accent: string;
};

export type WorkflowAvailability = "active" | "planned" | "locked" | "future";

export type WorkflowCatalogItem = {
  title: string;
  department: string;
  description: string;
  availability: WorkflowAvailability;
  approvalRequired: boolean;
  externalActionLocked: boolean;
  href?: string;
};

export type WorkflowGroup = {
  id: string;
  title: string;
  description: string;
  workflows: WorkflowCatalogItem[];
};

export type WorkflowLifecycleStep = {
  label: string;
  status: "input" | "retrieving" | "generating" | "risk" | "approval" | "export";
};

export type WorkflowRun = {
  id: string;
  templateCode: string;
  title: string;
  status: WorkflowStatus;
  statusTone: StatusTone;
  requestedBy: string;
  updatedAt: string;
  duration: string;
  outputPreview: string;
};

export type WorkflowPreview = {
  title: string;
  sections: Array<{
    title: string;
    content: string;
    tone?: StatusTone;
  }>;
  sources?: SourceCitation[];
};
