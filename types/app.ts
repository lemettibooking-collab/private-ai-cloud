export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "locked";

export type NavItem = {
  label: string;
  href: string;
  description: string;
};

export type Stat = {
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
};

export type Report = {
  id: string;
  title: string;
  summary: string;
  owner: string;
  status: string;
  updatedAt: string;
  metrics: string[];
};

export type OwnerReportMetric = {
  label: string;
  value: string;
  tone: StatusTone;
};

export type OwnerReportSection = {
  title: string;
  items: string[];
};

export type OwnerReportSummary = {
  title: string;
  subtitle: string;
  metrics: OwnerReportMetric[];
  sections: OwnerReportSection[];
};

export type Integration = {
  id: string;
  name: string;
  description: string;
  status: "not connected" | "planned" | "locked" | "manual only";
  owner: string;
};

export type DepartmentStatus = "MVP active" | "v0.2 planned" | "future";

export type Department = {
  id: string;
  title: string;
  description: string;
  status: DepartmentStatus;
  primaryAssistant: string;
  keyWorkflows: string[];
  approvalRequirement: string;
  integrationsLater: string[];
};

export type AssistantProfile = {
  name: string;
  department: string;
  purpose: string;
  status: DepartmentStatus;
};

export type KnowledgeOpsBlock = {
  title: string;
  detail: string;
  tone: StatusTone;
};

export type DocumentIntelligenceCapability = {
  title: string;
  description: string;
  status: "planned / partial" | "future";
};

export type QuickAction = {
  title: string;
  description: string;
  href: string;
  tone: StatusTone;
};

export type SettingsModule = {
  title: string;
  description: string;
  status:
    | "MVP active"
    | "v0.2 planned"
    | "future"
    | "locked"
    | "manual only"
    | "planned / partial";
  href: string;
};

export type RoadmapItem = {
  version: string;
  title: string;
  status: "current" | "next" | "future";
  description: string;
  items: string[];
};

export type Role = {
  id: string;
  name: string;
  landing: string;
  summary: string;
  permissions: string[];
};
