import type { ApprovalRequest, AuditEvent } from "@/types/approval";
import type {
  AssistantProfile,
  Department,
  DocumentIntelligenceCapability,
  Integration,
  KnowledgeOpsBlock,
  OwnerReportSummary,
  QuickAction,
  Report,
  RoadmapItem,
  SettingsModule,
  Stat,
} from "@/types/app";
import type { KnowledgeDocument, SourceCitation } from "@/types/knowledge";
import type {
  WorkflowGroup,
  WorkflowRun,
  WorkflowLifecycleStep,
  WorkflowTemplate,
} from "@/types/workflow";

export const roadmapItems: RoadmapItem[] = [
  {
    version: "v0.1",
    title: "Smart Algorithms Internal Demo",
    status: "current",
    description:
      "Current prototype scope: prove the AI Operations Center around knowledge, RAG, workflows, approvals, and owner reporting.",
    items: [
      "Knowledge Base",
      "RAG Chat",
      "Support Assistant",
      "Telegram Content Assistant",
      "Product / Codex Task Assistant",
      "QA / Review Report",
      "Admin Approval Queue",
    ],
  },
  {
    version: "v0.2",
    title: "Smart Algorithms Operations MVP",
    status: "next",
    description:
      "Expand the internal operations MVP with marketing, sales, customer success, reporting, and approved channel integrations.",
    items: [
      "Marketing Hook / Pain Mining",
      "Sales / Lead Assistant",
      "Customer Success / Upsell",
      "User Activity Analysis",
      "Weekly Executive Report",
      "Telegram approval/publish integration",
      "Website lead intake",
      "Telegram bot support channel",
      "Site chat support channel",
    ],
  },
  {
    version: "v0.3",
    title: "First Client Pilot",
    status: "future",
    description:
      "Run a controlled pilot with a separate client workspace and selected AI packages.",
    items: [
      "Separate client workspace",
      "Demo Viewer",
      "Document upload",
      "RAG Chat",
      "2-3 selected AI packages",
      "Basic audit",
      "Basic security",
      "Managed deployment on rented RF infrastructure",
    ],
  },
  {
    version: "v1.0",
    title: "Productized Private AI Cloud",
    status: "future",
    description:
      "Package the platform for repeatable private deployments with commercial and operational controls.",
    items: [
      "Multi-tenant platform",
      "Packaged AI modules",
      "Tariff logic",
      "Integrations",
      "Operator console",
      "Usage analytics",
      "SLA",
      "Deployment templates",
      "Security documentation",
    ],
  },
  {
    version: "v2.0",
    title: "Own AI Infrastructure Layer",
    status: "future",
    description:
      "Move from rented/private deployment to owned AI infrastructure capacity.",
    items: [
      "Own GPU servers in colocation",
      "Centralized inference",
      "Quotas",
      "Monitoring",
      "Cost analytics",
      "Reserved capacity",
      "Dedicated client environments",
    ],
  },
];

export const documents: KnowledgeDocument[] = [
  {
    id: "roadmap",
    title: "Smart Algorithms Roadmap",
    collection: "Product",
    status: "indexed",
    statusTone: "success",
    uploadedBy: "Owner",
    updatedAt: "Today, 10:20",
    size: "184 KB",
    sourcePreview:
      "Roadmap priorities: AI operations center, approval-first workflow execution, RAG-backed support answers.",
    indexingNote: "Indexed and available for RAG answers.",
  },
  {
    id: "scanner-checklist",
    title: "Scanner MVP Checklist",
    collection: "Product",
    status: "indexed",
    statusTone: "success",
    uploadedBy: "Product Manager",
    updatedAt: "Today, 09:45",
    size: "96 KB",
    sourcePreview:
      "Checklist covers local validation, status visibility, owner review, and prototype verification commands.",
    indexingNote: "Indexed with product context tags.",
  },
  {
    id: "support-faq",
    title: "Support FAQ",
    collection: "Support",
    status: "indexed",
    statusTone: "success",
    uploadedBy: "Support Operator",
    updatedAt: "Yesterday, 17:30",
    size: "132 KB",
    sourcePreview:
      "Answers must be grounded in support collections and escalated when knowledge base context is missing.",
    indexingNote: "Indexed and used by Support Assistant.",
  },
  {
    id: "seo-strategy",
    title: "SEO Strategy",
    collection: "Content",
    status: "failed",
    statusTone: "danger",
    uploadedBy: "Marketing Operator",
    updatedAt: "Yesterday, 13:12",
    size: "77 KB",
    sourcePreview:
      "Draft content strategy for product education, Telegram explainers, and technical comparison posts.",
    indexingNote: "Failed indexing: unsupported table extraction. Retry required.",
  },
  {
    id: "codex-template",
    title: "Codex Task Template",
    collection: "Engineering",
    status: "indexing",
    statusTone: "warning",
    uploadedBy: "Developer / Reviewer",
    updatedAt: "10 min ago",
    size: "54 KB",
    sourcePreview:
      "Template includes context, goal, constraints, verification commands, and final report expectations.",
    indexingNote: "Indexing in progress. Not yet available for RAG answers.",
  },
];

export const sourceCitations: SourceCitation[] = [
  {
    id: "citation-roadmap",
    title: "Smart Algorithms Roadmap",
    collection: "Product",
    excerpt:
      "Private AI Cloud should make approvals and audit trails visible before external actions are enabled.",
    confidence: "High",
  },
  {
    id: "citation-support",
    title: "Support FAQ",
    collection: "Support",
    excerpt:
      "If knowledge base context is insufficient, assistants must say so and avoid fabricating operational details.",
    confidence: "High",
  },
];

export const quickActions: QuickAction[] = [
  {
    title: "Ask Knowledge Base",
    description: "Open RAG Chat with selected collections and source cards.",
    href: "/chat",
    tone: "info",
  },
  {
    title: "Create Support Reply",
    description: "Draft a cited support answer and send it to approval.",
    href: "/workflows/support-reply/run",
    tone: "warning",
  },
  {
    title: "Create Telegram Post",
    description: "Generate a content draft for manual publication review.",
    href: "/workflows/telegram-content/run",
    tone: "warning",
  },
  {
    title: "Create Codex Task",
    description: "Turn product intent into a Codex-ready implementation task.",
    href: "/workflows/codex-task/run",
    tone: "info",
  },
  {
    title: "Review Code / Diff",
    description: "Create QA review notes from a diff, logs, or checklist.",
    href: "/workflows/qa-review/run",
    tone: "success",
  },
  {
    title: "Pending Approvals",
    description: "Review blocked sends, publishes, local checks, and tasks.",
    href: "/approvals",
    tone: "danger",
  },
  {
    title: "Weekly Owner Report",
    description: "Inspect owner decision points and operational blockers.",
    href: "/reports",
    tone: "neutral",
  },
];

export const departments: Department[] = [
  {
    id: "support",
    title: "AI Support Department",
    description:
      "Generates source-grounded support replies and escalates questions outside the FAQ.",
    status: "MVP active",
    primaryAssistant: "Support Assistant",
    keyWorkflows: ["Knowledge Base Answer", "Support Reply"],
    approvalRequirement: "External replies require human approval.",
    integrationsLater: ["Website chat", "Email", "Helpdesk"],
  },
  {
    id: "marketing-growth",
    title: "AI Marketing & Growth Department",
    description:
      "Drafts Telegram content, mines pains, and prepares growth summaries.",
    status: "MVP active",
    primaryAssistant: "Content Assistant",
    keyWorkflows: ["Telegram Content", "Marketing Hook / Pain Mining"],
    approvalRequirement: "Publication is locked until owner approval.",
    integrationsLater: ["Telegram Bot", "Analytics", "CMS"],
  },
  {
    id: "community",
    title: "AI Community Engagement Department",
    description:
      "Monitors discussions and drafts official comments without auto-posting.",
    status: "v0.2 planned",
    primaryAssistant: "Community Assistant",
    keyWorkflows: ["Discussion Monitoring", "Official Comment Draft"],
    approvalRequirement: "All public comments require approval.",
    integrationsLater: ["Telegram groups", "Forums", "Social listening"],
  },
  {
    id: "sales",
    title: "AI Sales Department",
    description:
      "Captures leads, qualifies intent, and drafts follow-up messages.",
    status: "v0.2 planned",
    primaryAssistant: "Sales Assistant",
    keyWorkflows: ["Lead Intake", "Lead Qualification", "Follow-up Draft"],
    approvalRequirement: "Commercial outreach requires owner or sales approval.",
    integrationsLater: ["Forms", "CRM later", "Email"],
  },
  {
    id: "customer-success",
    title: "AI Customer Success / Upsell Department",
    description:
      "Analyzes activity, spots churn risk, and recommends onboarding or upsell actions.",
    status: "v0.2 planned",
    primaryAssistant: "Customer Success Assistant",
    keyWorkflows: ["Churn Risk Detection", "Upsell Message Draft"],
    approvalRequirement: "Customer-facing messages require human approval.",
    integrationsLater: ["Usage events", "Billing later", "Email"],
  },
  {
    id: "product",
    title: "AI Product Department",
    description:
      "Turns feedback into roadmap groups, user stories, release notes, and Codex tasks.",
    status: "MVP active",
    primaryAssistant: "Product Assistant",
    keyWorkflows: ["Product / Codex Task", "Feature Request Analysis"],
    approvalRequirement: "Roadmap and task handoff require product review.",
    integrationsLater: ["GitHub issues", "Docs", "Roadmap board"],
  },
  {
    id: "development",
    title: "AI Development / Codex Orchestration Department",
    description:
      "Prepares Codex prompts, handoff summaries, and result collection views.",
    status: "MVP active",
    primaryAssistant: "Codex Orchestrator",
    keyWorkflows: ["Codex Task Prompt", "Handoff Summary", "Result Collection"],
    approvalRequirement: "Codex launch and local execution stay approval-gated.",
    integrationsLater: ["Codex", "GitHub", "Local Runner"],
  },
  {
    id: "qa-review",
    title: "AI QA / Code Review Department",
    description:
      "Reviews diffs, check outputs, QA risks, and manual smoke checklists.",
    status: "MVP active",
    primaryAssistant: "QA Reviewer",
    keyWorkflows: ["QA Review Report", "Diff Risk Analysis"],
    approvalRequirement: "Code acceptance is recorded; merge remains manual.",
    integrationsLater: ["GitHub checks", "Browser smoke runner", "CI"],
  },
  {
    id: "executive",
    title: "AI Executive Analytics Department",
    description:
      "Summarizes owner attention, blockers, recommendations, and decision points.",
    status: "MVP active",
    primaryAssistant: "Owner Analyst",
    keyWorkflows: ["Weekly Owner Report", "Decision Points Summary"],
    approvalRequirement: "Owner reviews recommendations before action.",
    integrationsLater: ["Usage warehouse", "Finance later", "BI export"],
  },
  {
    id: "legal",
    title: "AI Legal / Document Department",
    description:
      "Summarizes documents, extracts risks, compares versions, and drafts lawyer questions.",
    status: "future",
    primaryAssistant: "Legal Document Assistant",
    keyWorkflows: ["Document Summary", "Risk Extraction", "Version Compare"],
    approvalRequirement: "Legal outputs are review-only and never auto-applied.",
    integrationsLater: ["Document storage", "E-sign later", "Legal review"],
  },
];

export const assistantProfiles: AssistantProfile[] = departments.map(
  (department) => ({
    name: department.primaryAssistant,
    department: department.title,
    purpose: department.description,
    status: department.status,
  }),
);

export const workflowTemplates: WorkflowTemplate[] = [
  {
    code: "support-reply",
    title: "Support Reply",
    department: "Support",
    description:
      "Generate a source-grounded support answer and prepare it for approval.",
    approvalRequired: true,
    href: "/workflows/support-reply/run",
    accent: "cyan",
  },
  {
    code: "telegram-content",
    title: "Telegram Content",
    department: "Marketing",
    description:
      "Draft a Telegram post from product context with a risk check.",
    approvalRequired: true,
    href: "/workflows/telegram-content/run",
    accent: "violet",
  },
  {
    code: "codex-task",
    title: "Product / Codex Task",
    department: "Product",
    description:
      "Convert product intent into a precise Codex-ready task prompt.",
    approvalRequired: true,
    href: "/workflows/codex-task/run",
    accent: "emerald",
  },
  {
    code: "qa-review",
    title: "QA / Review Report",
    department: "Engineering",
    description:
      "Analyze diff/log context and recommend approve, revise, or reject.",
    approvalRequired: false,
    href: "/workflows/qa-review/run",
    accent: "amber",
  },
  {
    code: "knowledge-answer",
    title: "Knowledge Base Answer",
    department: "Operations",
    description:
      "Answer strictly from selected knowledge collections with citations.",
    approvalRequired: false,
    href: "/chat",
    accent: "sky",
  },
];

export const workflowGroups: WorkflowGroup[] = [
  {
    id: "mvp",
    title: "MVP Workflows",
    description:
      "The first Smart Algorithms demo workflows that can be opened from this prototype.",
    workflows: [
      {
        title: "Knowledge Base",
        department: "Core Platform",
        description: "Answer strictly from selected indexed collections.",
        availability: "active",
        approvalRequired: false,
        externalActionLocked: false,
        href: "/chat",
      },
      {
        title: "Support Reply",
        department: "AI Support Department",
        description: "Draft a cited support answer with escalation notes.",
        availability: "active",
        approvalRequired: true,
        externalActionLocked: true,
        href: "/workflows/support-reply/run",
      },
      {
        title: "Telegram Content",
        department: "AI Marketing & Growth Department",
        description: "Draft a Telegram post from product and content context.",
        availability: "active",
        approvalRequired: true,
        externalActionLocked: true,
        href: "/workflows/telegram-content/run",
      },
      {
        title: "Product / Codex Task",
        department: "AI Product Department",
        description: "Convert a product request into a Codex task prompt.",
        availability: "active",
        approvalRequired: true,
        externalActionLocked: true,
        href: "/workflows/codex-task/run",
      },
      {
        title: "QA / Review Report",
        department: "AI QA / Code Review Department",
        description: "Summarize diff and QA signals with a review recommendation.",
        availability: "active",
        approvalRequired: false,
        externalActionLocked: false,
        href: "/workflows/qa-review/run",
      },
    ],
  },
  {
    id: "marketing-growth",
    title: "Marketing & Growth",
    description: "Content planning, pain mining, and growth reporting.",
    workflows: [
      {
        title: "Marketing Hook / Pain Mining",
        department: "AI Marketing & Growth Department",
        description: "Extract audience pain points from approved source notes.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Content Plan",
        department: "AI Marketing & Growth Department",
        description: "Create weekly content themes and draft briefs.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Growth Report",
        department: "AI Marketing & Growth Department",
        description: "Summarize traction, content performance, and next experiments.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "community",
    title: "Community Engagement",
    description: "Public discussion monitoring and reputation response drafts.",
    workflows: [
      {
        title: "Discussion Monitoring",
        department: "AI Community Engagement Department",
        description: "Track recurring topics and questions from community channels.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: true,
      },
      {
        title: "Official Comment Draft",
        department: "AI Community Engagement Department",
        description: "Draft a public answer for human review.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Reputation Monitoring",
        department: "AI Community Engagement Department",
        description: "Flag risks, misunderstandings, and urgent owner attention.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    description: "Lead capture, qualification, follow-up, and proposal drafting.",
    workflows: [
      {
        title: "Lead Intake",
        department: "AI Sales Department",
        description: "Normalize inbound lead details into a reviewable record.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: true,
      },
      {
        title: "Lead Qualification",
        department: "AI Sales Department",
        description: "Score fit, urgency, budget clues, and missing questions.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Follow-up Draft",
        department: "AI Sales Department",
        description: "Draft a response for owner or sales approval.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Commercial Proposal Draft",
        department: "AI Sales Department",
        description: "Prepare proposal text from approved pricing and scope sources.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
    ],
  },
  {
    id: "customer-success",
    title: "Customer Success / Upsell",
    description: "Usage analysis, churn signals, onboarding, and upsell drafts.",
    workflows: [
      {
        title: "User Activity Analysis",
        department: "AI Customer Success / Upsell Department",
        description: "Summarize account activity and adoption gaps.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Churn Risk Detection",
        department: "AI Customer Success / Upsell Department",
        description: "Identify low engagement and unresolved blockers.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Pro Potential Detection",
        department: "AI Customer Success / Upsell Department",
        description: "Spot accounts likely to benefit from paid capabilities.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Upsell Message Draft",
        department: "AI Customer Success / Upsell Department",
        description: "Draft a careful customer-facing upgrade message.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Onboarding Recommendation",
        department: "AI Customer Success / Upsell Department",
        description: "Recommend next setup steps from usage and knowledge context.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: true,
      },
    ],
  },
  {
    id: "product",
    title: "Product",
    description: "Feedback analysis, roadmap grouping, stories, and releases.",
    workflows: [
      {
        title: "Feature Request Analysis",
        department: "AI Product Department",
        description: "Cluster requests into pain, impact, and suggested priority.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Roadmap Grouping",
        department: "AI Product Department",
        description: "Group product signals into owner-reviewable roadmap themes.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: false,
      },
      {
        title: "User Story Draft",
        department: "AI Product Department",
        description: "Create a user story with acceptance criteria.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: false,
      },
      {
        title: "Release Checklist",
        department: "AI Product Department",
        description: "Prepare release readiness checks and communication notes.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "development",
    title: "Development / Codex",
    description: "Codex prompts, handoff context, and execution collection.",
    workflows: [
      {
        title: "Codex Task Prompt",
        department: "AI Development / Codex Orchestration Department",
        description: "Prepare constraints, context, and verification commands.",
        availability: "active",
        approvalRequired: true,
        externalActionLocked: true,
        href: "/workflows/codex-task/run",
      },
      {
        title: "Handoff Summary",
        department: "AI Development / Codex Orchestration Department",
        description: "Summarize work for the next implementation or review step.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Result Collection",
        department: "AI Development / Codex Orchestration Department",
        description: "Collect outputs, changed files, checks, and residual risks.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "qa",
    title: "QA / Code Review",
    description: "Review reports, diff risks, and manual QA checklists.",
    workflows: [
      {
        title: "QA Review Report",
        department: "AI QA / Code Review Department",
        description: "Summarize review findings and approve/revise/reject guidance.",
        availability: "active",
        approvalRequired: false,
        externalActionLocked: false,
        href: "/workflows/qa-review/run",
      },
      {
        title: "Diff Risk Analysis",
        department: "AI QA / Code Review Department",
        description: "Highlight risky files, behavior changes, and missing tests.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Manual QA Checklist",
        department: "AI QA / Code Review Department",
        description: "Generate an operator checklist for manual verification.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Browser Smoke Checklist",
        department: "AI QA / Code Review Department",
        description: "Prepare key browser routes and visual states to inspect.",
        availability: "planned",
        approvalRequired: false,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "executive",
    title: "Executive Analytics",
    description: "Owner reports, daily reports, and decision point summaries.",
    workflows: [
      {
        title: "Weekly Owner Report",
        department: "AI Executive Analytics Department",
        description: "Summarize operations, blockers, risks, and recommendations.",
        availability: "active",
        approvalRequired: false,
        externalActionLocked: false,
        href: "/reports",
      },
      {
        title: "Daily Report later",
        department: "AI Executive Analytics Department",
        description: "Daily digest for owner attention and operational deltas.",
        availability: "future",
        approvalRequired: false,
        externalActionLocked: false,
      },
      {
        title: "Decision Points Summary",
        department: "AI Executive Analytics Department",
        description: "Extract explicit owner choices from reports and approvals.",
        availability: "planned",
        approvalRequired: true,
        externalActionLocked: false,
      },
    ],
  },
  {
    id: "legal",
    title: "Legal / Document",
    description: "Document summaries, risks, version comparison, and lawyer questions.",
    workflows: [
      {
        title: "Document Summary",
        department: "AI Legal / Document Department",
        description: "Summarize contracts and long documents for review.",
        availability: "future",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Risk Extraction",
        department: "AI Legal / Document Department",
        description: "Extract obligations, exclusions, and unclear terms.",
        availability: "future",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Version Compare",
        department: "AI Legal / Document Department",
        description: "Compare two document versions and flag meaningful changes.",
        availability: "future",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Checklist Review",
        department: "AI Legal / Document Department",
        description: "Review a document against an owner-approved checklist.",
        availability: "future",
        approvalRequired: true,
        externalActionLocked: true,
      },
      {
        title: "Lawyer Questions Draft",
        department: "AI Legal / Document Department",
        description: "Draft questions for legal counsel from extracted risks.",
        availability: "future",
        approvalRequired: true,
        externalActionLocked: true,
      },
    ],
  },
];

export const workflowLifecycleSteps: WorkflowLifecycleStep[] = [
  { label: "Input", status: "input" },
  { label: "Sources", status: "retrieving" },
  { label: "AI Output", status: "generating" },
  { label: "Risk Check", status: "risk" },
  { label: "Approval", status: "approval" },
  { label: "Export / External Action", status: "export" },
];

export const workflowRuns: WorkflowRun[] = [
  {
    id: "run-1042",
    templateCode: "support-reply",
    title: "Scanner onboarding reply",
    status: "waiting_approval",
    statusTone: "warning",
    requestedBy: "Support Operator",
    updatedAt: "12 min ago",
    duration: "34s",
    outputPreview:
      "Draft reply generated from Support FAQ and Scanner MVP Checklist.",
  },
  {
    id: "run-1041",
    templateCode: "telegram-content",
    title: "Approval-first AI operations post",
    status: "generated",
    statusTone: "info",
    requestedBy: "Marketing Operator",
    updatedAt: "38 min ago",
    duration: "41s",
    outputPreview:
      "Telegram post draft ready for risk review and manual approval.",
  },
  {
    id: "run-1039",
    templateCode: "qa-review",
    title: "Approval queue prototype review",
    status: "approved",
    statusTone: "success",
    requestedBy: "Developer / Reviewer",
    updatedAt: "Yesterday",
    duration: "1m 12s",
    outputPreview:
      "QA review recommends approve after lint/build verification.",
  },
];

export const approvals: ApprovalRequest[] = [
  {
    id: "approval-501",
    title: "Telegram post publication",
    actionType: "publish Telegram post",
    riskLevel: "high",
    riskTone: "danger",
    requestedBy: "Marketing Operator",
    allowedApprovers: ["Owner", "Admin"],
    status: "pending",
    statusTone: "warning",
    preview:
      "Post explains approval-first AI operations. External publish is locked in MVP.",
    auditHint: "Generated, risk checked, approval requested.",
    originalOutput:
      "Private AI Cloud is an approval-first AI Operations Center for teams that need answers, workflows, and external actions to stay under human control. Start with internal knowledge, create a draft, review risks, then publish manually after approval.",
    editedOutput:
      "Private AI Cloud helps Smart Algorithms test approval-first AI operations: knowledge-backed answers, workflow drafts, visible risks, and manual publication after owner review.",
    finalOutput:
      "Private AI Cloud is being tested as an approval-first AI Operations Center: RAG answers, workflow drafts, risk checks, and owner-approved manual publishing.",
    sourceDocuments: [
      "Smart Algorithms Roadmap",
      "Support FAQ",
      "Scanner MVP Checklist",
    ],
    riskNotes: [
      "No investment promises.",
      "No buy-sell signal.",
      "No external Telegram publication until approval.",
    ],
    createdAt: "8 min ago",
  },
  {
    id: "approval-502",
    title: "Support reply beyond FAQ",
    actionType: "send support reply",
    riskLevel: "medium",
    riskTone: "warning",
    requestedBy: "Support Operator",
    allowedApprovers: ["Owner", "Support Lead"],
    status: "pending",
    statusTone: "warning",
    preview:
      "Reply cites Support FAQ and Scanner checklist. Manual send only.",
    auditHint: "Missing-context note added before review.",
    sourceDocuments: ["Support FAQ", "Scanner MVP Checklist"],
    riskNotes: ["Answer goes beyond FAQ and needs operator review."],
    createdAt: "19 min ago",
  },
  {
    id: "approval-503",
    title: "Codex task creation",
    actionType: "create Codex task",
    riskLevel: "medium",
    riskTone: "warning",
    requestedBy: "Product Manager",
    allowedApprovers: ["Owner", "Product Manager"],
    status: "edited",
    statusTone: "info",
    preview:
      "Task prompt edited to clarify mocked data and no backend scope.",
    auditHint: "Original and edited payloads are preserved.",
    sourceDocuments: ["Codex Task Template", "Smart Algorithms Roadmap"],
    riskNotes: ["Creates implementation work; no Codex launch happens here."],
    createdAt: "46 min ago",
  },
  {
    id: "approval-504",
    title: "Codex launch",
    actionType: "run Codex",
    riskLevel: "high",
    riskTone: "danger",
    requestedBy: "Codex Orchestrator",
    allowedApprovers: ["Owner", "Developer / Reviewer"],
    status: "pending",
    statusTone: "warning",
    preview:
      "Launch request is prepared, but execution remains manual and approval-gated.",
    auditHint: "Launch intent captured without external execution.",
    sourceDocuments: ["Codex Task Template"],
    riskNotes: ["Codex launch is high-risk and remains manual in prototype."],
    createdAt: "1 hour ago",
  },
  {
    id: "approval-505",
    title: "Local checks run",
    actionType: "run local checks",
    riskLevel: "blocked",
    riskTone: "locked",
    requestedBy: "Developer / Reviewer",
    allowedApprovers: ["Owner", "Developer / Reviewer"],
    status: "pending",
    statusTone: "locked",
    preview:
      "Local runner integration is not enabled. Request remains locked.",
    auditHint: "No command execution happens from this prototype.",
    sourceDocuments: ["Scanner MVP Checklist"],
    riskNotes: ["Local command execution is disabled."],
    createdAt: "1 hour ago",
  },
  {
    id: "approval-506",
    title: "External integration action",
    actionType: "external integration action",
    riskLevel: "blocked",
    riskTone: "locked",
    requestedBy: "Owner Analyst",
    allowedApprovers: ["Owner", "Admin"],
    status: "pending",
    statusTone: "locked",
    preview:
      "External action requires integration setup, allowlist, and approval policy.",
    auditHint: "Integration action remains blocked by default.",
    sourceDocuments: ["Smart Algorithms Roadmap"],
    riskNotes: ["Integration allowlist and secrets are not configured."],
    createdAt: "2 hours ago",
  },
  {
    id: "approval-507",
    title: "Lead follow-up",
    actionType: "send lead follow-up",
    riskLevel: "medium",
    riskTone: "warning",
    requestedBy: "Sales Assistant",
    allowedApprovers: ["Owner", "Sales Operator"],
    status: "pending",
    statusTone: "warning",
    preview:
      "Follow-up draft asks discovery questions and does not send externally.",
    auditHint: "Sales workflow is planned; this is a mocked approval example.",
    sourceDocuments: ["Smart Algorithms Roadmap"],
    riskNotes: ["Sales outreach is planned and remains manual."],
    createdAt: "2 hours ago",
  },
  {
    id: "approval-508",
    title: "Code acceptance",
    actionType: "accept code result",
    riskLevel: "high",
    riskTone: "danger",
    requestedBy: "QA Reviewer",
    allowedApprovers: ["Owner", "Developer / Reviewer"],
    status: "pending",
    statusTone: "warning",
    preview:
      "QA report recommends acceptance after lint/build and manual route checks.",
    auditHint: "Acceptance is recorded; repository merge is manual.",
    sourceDocuments: ["Scanner MVP Checklist", "Codex Task Template"],
    riskNotes: ["Acceptance record does not merge code."],
    createdAt: "3 hours ago",
  },
  {
    id: "approval-509",
    title: "Merge manual outside system",
    actionType: "manual merge outside system",
    riskLevel: "blocked",
    riskTone: "locked",
    requestedBy: "System Policy",
    allowedApprovers: ["Owner"],
    status: "pending",
    statusTone: "locked",
    preview:
      "Merge is always manual outside the system. This queue only records intent and review status.",
    auditHint: "No merge button or automatic VCS mutation is provided.",
    sourceDocuments: ["System Policy"],
    riskNotes: ["No merge button exists in the product."],
    createdAt: "Policy",
  },
];

export const pendingApprovalsCount = approvals.filter(
  (approval) => approval.status === "pending",
).length;

export const highRiskApprovalsCount = approvals.filter(
  (approval) =>
    approval.status === "pending" &&
    (approval.riskLevel === "high" || approval.riskLevel === "blocked"),
).length;

export const indexingIssuesCount = documents.filter(
  (document) => document.status === "failed",
).length;

export const codexTasksWaitingCount = approvals.filter((approval) =>
  ["create Codex task", "run Codex"].includes(approval.actionType),
).length;

export const qaReportsReadyCount = workflowRuns.filter(
  (run) => run.templateCode === "qa-review",
).length;

export const activityStats: Stat[] = [
  {
    label: "Pending approvals",
    value: String(pendingApprovalsCount),
    detail: `${highRiskApprovalsCount} high-risk or blocked`,
    tone: "warning",
  },
  {
    label: "Workflow runs",
    value: "28",
    detail: "Last 7 days",
    tone: "info",
  },
  {
    label: "Indexed documents",
    value: "4/5",
    detail: `${indexingIssuesCount} failed indexing`,
    tone: "danger",
  },
  {
    label: "Manual-only actions",
    value: "100%",
    detail: "External execution locked",
    tone: "locked",
  },
];

export const weeklyOwnerReportSummary: OwnerReportSummary = {
  title: "Weekly Owner Report - Current MVP",
  subtitle:
    "Owner-facing summary for Smart Algorithms v0.1: support, content, product, Codex, QA, and approvals.",
  metrics: [
    {
      label: "Pending decisions",
      value: String(pendingApprovalsCount),
      tone: "warning",
    },
    {
      label: "High-risk approvals",
      value: String(highRiskApprovalsCount),
      tone: "danger",
    },
    {
      label: "Indexing issues",
      value: String(indexingIssuesCount),
      tone: "danger",
    },
    {
      label: "Codex tasks waiting",
      value: String(codexTasksWaitingCount),
      tone: "warning",
    },
    {
      label: "QA reports ready",
      value: String(qaReportsReadyCount),
      tone: "success",
    },
  ],
  sections: [
    {
      title: "Support and frequent questions",
      items: [
        "New support requests focus on Scanner onboarding and local validation.",
        "Frequent questions mention source-grounded answers and missing context behavior.",
      ],
    },
    {
      title: "Bugs and feature requests",
      items: [
        "One indexing failure blocks content sources from RAG readiness.",
        "Operators asked for approval diffs, retry controls, and Codex task presets.",
      ],
    },
    {
      title: "Content, leads, and signals",
      items: [
        "Telegram drafts are ready for manual review; no posts are published automatically.",
        "Leads and Pro/waitlist signals are planned for v0.2 reporting.",
      ],
    },
    {
      title: "Product, Codex, and QA",
      items: [
        "Codex task creation and Codex launch are separate approval decisions.",
        "QA/code review status is ready for owner review before manual acceptance.",
      ],
    },
  ],
};

export const reports: Report[] = [
  {
    id: "weekly-owner",
    title: "Weekly Owner Report",
    summary:
      "Operations are healthy, but knowledge indexing has one failed document and high-risk approvals need review.",
    owner: "Owner Analyst",
    status: "Ready",
    updatedAt: "Today",
    metrics: [
      "28 workflow runs",
      `${pendingApprovalsCount} pending approvals`,
      `${indexingIssuesCount} indexing failure`,
    ],
  },
  {
    id: "daily-report",
    title: "Daily Report",
    summary:
      "Planned daily digest for approvals, workflow deltas, incidents, and owner attention.",
    owner: "Owner Analyst",
    status: "Planned",
    updatedAt: "v0.2",
    metrics: ["future schedule", "owner digest", "no backend yet"],
  },
  {
    id: "support-summary",
    title: "Support Summary",
    summary:
      "Most support drafts relate to Scanner onboarding, checklist state, and source-grounded answer expectations.",
    owner: "Support Assistant",
    status: "Draft",
    updatedAt: "Yesterday",
    metrics: ["9 drafts", "2 escalations", "0 external sends"],
  },
  {
    id: "leads-summary",
    title: "Leads Summary",
    summary:
      "Planned sales view for lead intake, qualification results, and follow-up drafts.",
    owner: "Sales Assistant",
    status: "Planned",
    updatedAt: "v0.2",
    metrics: ["lead intake planned", "0 sends", "approval required"],
  },
  {
    id: "marketing-summary",
    title: "Marketing Summary",
    summary:
      "Telegram drafts, content hooks, growth observations, and publication approvals.",
    owner: "Content Assistant",
    status: "Review",
    updatedAt: "2 days ago",
    metrics: ["4 drafts", "2 approvals", "0 published"],
  },
  {
    id: "product-summary",
    title: "Product Summary",
    summary:
      "Operators want clearer approval diffs, faster document retry, and Codex task presets.",
    owner: "Product Assistant",
    status: "Ready",
    updatedAt: "Yesterday",
    metrics: ["7 signals", "3 priorities", "2 Codex tasks"],
  },
  {
    id: "development-summary",
    title: "Development Summary",
    summary:
      "Codex task prompts, handoff notes, and result collection remain approval-gated.",
    owner: "Codex Orchestrator",
    status: "Ready",
    updatedAt: "Today",
    metrics: ["2 tasks", "1 handoff", "launch locked"],
  },
  {
    id: "qa-code-review",
    title: "QA / Code Review Summary",
    summary:
      "QA review workflow generated one approve recommendation and one revise recommendation.",
    owner: "QA Reviewer",
    status: "Ready",
    updatedAt: "2 days ago",
    metrics: ["2 reports", "1 failed check", "1 revise"],
  },
  {
    id: "blockers",
    title: "Blockers",
    summary:
      "Failed indexing, locked local runner, and pending high-risk approvals require owner attention.",
    owner: "Owner Analyst",
    status: "Ready",
    updatedAt: "Today",
    metrics: ["1 indexing failure", "2 blocked actions", "3 decisions"],
  },
  {
    id: "recommendations",
    title: "Recommendations",
    summary:
      "Prioritize indexing retry, approve or reject pending publications, and keep external actions locked.",
    owner: "Owner Analyst",
    status: "Ready",
    updatedAt: "Today",
    metrics: ["3 recommendations", "approval-first", "manual execution"],
  },
  {
    id: "owner-decision-points",
    title: "Owner Decision Points",
    summary:
      "Explicit decision queue for publishes, Codex launches, local checks, and roadmap direction.",
    owner: "Owner Analyst",
    status: "Ready",
    updatedAt: "Today",
    metrics: [
      `${pendingApprovalsCount} approvals`,
      "2 roadmap points",
      "1 policy note",
    ],
  },
  {
    id: "usage-summary",
    title: "System Usage Summary",
    summary:
      "AI chat and workflow usage is concentrated in support and product operations.",
    owner: "System",
    status: "Ready",
    updatedAt: "Today",
    metrics: [
      "42 chat messages",
      `${assistantProfiles.length} assistants`,
      "6 integration entries",
    ],
  },
];

export const knowledgeOpsBlocks: KnowledgeOpsBlock[] = [
  {
    title: "Collections",
    detail: "Product, Support, Content, Engineering, Policies, QA.",
    tone: "info",
  },
  {
    title: "Indexing Queue",
    detail: "1 document indexing, 1 failed document, retry is mocked.",
    tone: "warning",
  },
  {
    title: "Failed Documents",
    detail: "SEO Strategy failed table extraction and is excluded from RAG.",
    tone: "danger",
  },
  {
    title: "Source Permissions",
    detail: "Collection access will be role-aware in the core platform.",
    tone: "locked",
  },
  {
    title: "Versioning planned",
    detail: "Document versions and compare views are visible as planned work.",
    tone: "neutral",
  },
  {
    title: "Source Management",
    detail: "Upload, tag, archive, retry indexing, and update knowledge base.",
    tone: "success",
  },
  {
    title: "RAG readiness",
    detail: "Only indexed sources should appear in answers and citations.",
    tone: "success",
  },
  {
    title: "Integrations later",
    detail: "GitHub, Drive, Yandex Disk, and S3 connectors remain planned.",
    tone: "neutral",
  },
];

export const documentIntelligenceCapabilities: DocumentIntelligenceCapability[] = [
  {
    title: "Document summary",
    description: "Create an owner-readable summary from uploaded sources.",
    status: "planned / partial",
  },
  {
    title: "Key terms extraction",
    description: "Highlight product, policy, contract, and operational terms.",
    status: "planned / partial",
  },
  {
    title: "Risk detection",
    description: "Flag obligations, exclusions, unclear language, and missing context.",
    status: "planned / partial",
  },
  {
    title: "Version comparison",
    description: "Compare document revisions and show meaningful changes.",
    status: "future",
  },
  {
    title: "Checklist review",
    description: "Evaluate a document against a manual QA or legal checklist.",
    status: "future",
  },
  {
    title: "Deadlines / amounts / obligations",
    description: "Extract dates, money amounts, responsibilities, and owner actions.",
    status: "future",
  },
  {
    title: "Document card generation",
    description: "Turn a source into a reusable summary card for workflows.",
    status: "planned / partial",
  },
  {
    title: "Comments/questions draft",
    description: "Draft review comments and questions for a human specialist.",
    status: "future",
  },
  {
    title: "Convert document into tasks",
    description: "Create owner-reviewed tasks from a source document.",
    status: "future",
  },
];

export const integrations: Integration[] = [
  {
    id: "telegram",
    name: "Telegram Bot",
    description: "Publish approved Telegram posts after owner approval.",
    status: "locked",
    owner: "Marketing",
  },
  {
    id: "website-chat",
    name: "Website Chat",
    description: "Receive support questions and draft replies.",
    status: "planned",
    owner: "Support",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Create issues from approved product/Codex tasks.",
    status: "manual only",
    owner: "Product",
  },
  {
    id: "local-runner",
    name: "Local Runner",
    description: "Run local checks through controlled approval flow.",
    status: "locked",
    owner: "Engineering",
  },
  {
    id: "object-storage",
    name: "Object Storage",
    description: "Store documents, artifacts, and generated reports.",
    status: "planned",
    owner: "Admin",
  },
  {
    id: "llm-provider",
    name: "LLM Provider",
    description: "Configure model profiles for assistants and workflows.",
    status: "not connected",
    owner: "Admin",
  },
];

export const settingsModules: SettingsModule[] = [
  {
    title: "Company Workspace",
    description:
      "Smart Algorithms Demo workspace, environment label, locale, and operating context.",
    status: "MVP active",
    href: "/settings",
  },
  {
    title: "Users",
    description: "Mock directory, future invites, ownership, and role assignment.",
    status: "MVP active",
    href: "/settings",
  },
  {
    title: "Roles & Permissions",
    description: "Owner, Admin, operators, reviewer, viewer, and Demo Viewer.",
    status: "MVP active",
    href: "/settings/roles",
  },
  {
    title: "Knowledge Collections Access",
    description: "Collection-level visibility and RAG source permissions.",
    status: "v0.2 planned",
    href: "/knowledge",
  },
  {
    title: "Document Intelligence",
    description: "Summaries, terms, risks, comparisons, checklist review, and task extraction.",
    status: "planned / partial",
    href: "/knowledge",
  },
  {
    title: "AI Assistants",
    description: "Department assistants, model policy, tools, and safety defaults.",
    status: "MVP active",
    href: "/settings/assistants",
  },
  {
    title: "Integrations Hub",
    description: "Telegram, GitHub, local runner, storage, website chat, and LLM.",
    status: "locked",
    href: "/settings/integrations",
  },
  {
    title: "Security, Audit & Compliance",
    description: "External action locks, audit trail, secrets, and approval policy.",
    status: "locked",
    href: "/settings/security",
  },
  {
    title: "Operator Console",
    description: "Future run control surface for queues, incidents, and retries.",
    status: "v0.2 planned",
    href: "/settings/operator-console",
  },
  {
    title: "Usage Limits",
    description: "Prototype limits for runs, chat volume, source uploads, and tools.",
    status: "v0.2 planned",
    href: "/settings",
  },
  {
    title: "Infrastructure Status",
    description: "Mock app, worker, storage, integrations, indexing, and queue health.",
    status: "MVP active",
    href: "/dashboard",
  },
  {
    title: "Managed Service Settings",
    description: "Future service plan, support boundary, backups, and operator access.",
    status: "future",
    href: "/settings",
  },
];

export const chatThreads = [
  {
    id: "thread-1",
    title: "Scanner onboarding answer",
    assistant: "Support Assistant",
    updatedAt: "Now",
  },
  {
    id: "thread-2",
    title: "Telegram post angle",
    assistant: "Content Assistant",
    updatedAt: "35 min ago",
  },
  {
    id: "thread-3",
    title: "Codex prototype task",
    assistant: "Product Assistant",
    updatedAt: "Yesterday",
  },
];

export const chatMessages = [
  {
    id: "msg-1",
    role: "user",
    author: "Owner",
    body: "What should we show when the knowledge base has no relevant data?",
    timestamp: "10:18",
  },
  {
    id: "msg-2",
    role: "assistant",
    author: "Support Assistant",
    body: "Show a clear no-data state and avoid inventing details. Offer to upload a source document or send the question to a workflow for review.",
    timestamp: "10:18",
  },
];

export const auditEvents: AuditEvent[] = [
  {
    id: "audit-1",
    label: "AI output generated",
    detail: "Support Reply generated with 2 source citations.",
    timestamp: "12 min ago",
    tone: "info",
  },
  {
    id: "audit-2",
    label: "Approval requested",
    detail: "Support reply moved to waiting approval.",
    timestamp: "11 min ago",
    tone: "warning",
  },
  {
    id: "audit-3",
    label: "External action locked",
    detail: "Send support reply remains manual-only in MVP.",
    timestamp: "10 min ago",
    tone: "locked",
  },
];
