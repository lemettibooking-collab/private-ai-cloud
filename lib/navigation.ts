// AI-038.3 Owner Console navigation: Projects-first, Owner-attention-first, task/run-centric.
// `available: false` items are shown only as clearly marked future concepts; they are not links.
// Prototype pages (Knowledge, Chat, Departments, Workflows, Reports, Operations) stay reachable by
// URL but no longer define the primary navigation.

export type OwnerNavItem = Readonly<{
  label: string;
  href: string;
  available: boolean;
  // Shows the real pending-approval count next to this item.
  attentionCount?: boolean;
}>;

export type OwnerNavSection = Readonly<{ id: string; items: readonly OwnerNavItem[] }>;

export const ownerNavigation: readonly OwnerNavSection[] = [
  {
    id: "overview",
    items: [
      { label: "Dashboard", href: "/dashboard", available: true },
      { label: "My Attention", href: "/attention", available: false },
    ],
  },
  {
    id: "work",
    items: [
      { label: "Projects", href: "/projects", available: true },
      { label: "Tasks", href: "/tasks", available: false },
      { label: "Runs", href: "/runs", available: true },
      { label: "Roadmap", href: "/roadmap", available: true },
      { label: "Approvals", href: "/approvals", available: true, attentionCount: true },
    ],
  },
  {
    id: "platform",
    items: [
      { label: "Usage", href: "/usage", available: false },
      { label: "Security", href: "/security", available: false },
      { label: "Settings", href: "/settings", available: true },
    ],
  },
];
