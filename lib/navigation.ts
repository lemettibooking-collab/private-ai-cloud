import type { NavItem } from "@/types/app";

export const navigationItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    description: "Owner attention center",
  },
  {
    label: "Knowledge Base",
    href: "/knowledge",
    description: "Documents and indexing",
  },
  {
    label: "RAG Chat",
    href: "/chat",
    description: "Answers with sources",
  },
  {
    label: "AI Departments",
    href: "/departments",
    description: "10 assistant teams",
  },
  {
    label: "Workflows",
    href: "/workflows",
    description: "AI operations catalog",
  },
  {
    label: "Approvals",
    href: "/approvals",
    description: "Human review queue",
  },
  {
    label: "Reports",
    href: "/reports",
    description: "Operational summaries",
  },
  {
    label: "Roadmap",
    href: "/roadmap",
    description: "v0.1 to v2.0 plan",
  },
  {
    label: "Settings",
    href: "/settings",
    description: "Workspace controls",
  },
];
