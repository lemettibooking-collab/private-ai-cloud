import type { Role } from "@/types/app";

export const roles: Role[] = [
  {
    id: "owner",
    name: "Owner",
    landing: "/dashboard",
    summary: "Full operational control and high-risk approvals.",
    permissions: [
      "Approve critical actions",
      "Review owner reports",
      "Manage workspace security",
      "View all audit events",
    ],
  },
  {
    id: "admin",
    name: "Admin",
    landing: "/settings",
    summary: "Workspace administration and integration setup.",
    permissions: [
      "Manage users",
      "Manage roles",
      "Configure integrations",
      "View audit logs",
    ],
  },
  {
    id: "support",
    name: "Support Operator",
    landing: "/workflows",
    summary: "Runs support workflows and drafts replies.",
    permissions: [
      "Run Support Reply",
      "Use support knowledge",
      "Submit approvals",
    ],
  },
  {
    id: "marketing",
    name: "Marketing Operator",
    landing: "/workflows",
    summary: "Drafts content and sends it to approval.",
    permissions: [
      "Run Telegram Content",
      "View content collections",
      "Submit publish approvals",
    ],
  },
  {
    id: "product",
    name: "Product Manager",
    landing: "/reports",
    summary: "Creates Codex tasks and reviews feedback summaries.",
    permissions: [
      "Run Codex Task",
      "View product reports",
      "Approve product drafts",
    ],
  },
  {
    id: "reviewer",
    name: "Developer / Reviewer",
    landing: "/approvals",
    summary: "Reviews QA reports and local-check requests.",
    permissions: [
      "Run QA Review",
      "Review technical approvals",
      "Request local checks",
    ],
  },
  {
    id: "viewer",
    name: "Viewer",
    landing: "/reports",
    summary: "Read-only visibility into approved outputs.",
    permissions: ["View reports", "View approved outputs", "View dashboard"],
  },
  {
    id: "demo-viewer",
    name: "Demo Viewer",
    landing: "/dashboard",
    summary: "Curated mock data with no sensitive controls.",
    permissions: ["View demo dashboard", "View mock reports"],
  },
];
