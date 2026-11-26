// AI-038.5 restrained inline icon set (16px grid, 1.5 stroke, currentColor). Functional only.

type IconProps = { className?: string };

function Icon({ className = "h-4 w-4", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
      {children}
    </svg>
  );
}

export const DashboardIcon = (props: IconProps) => (
  <Icon {...props}><rect height="5" rx="1" width="5" x="2" y="2" /><rect height="5" rx="1" width="5" x="9" y="2" /><rect height="5" rx="1" width="5" x="2" y="9" /><rect height="5" rx="1" width="5" x="9" y="9" /></Icon>
);
export const AttentionIcon = (props: IconProps) => (
  <Icon {...props}><path d="M8 2.2 14 13H2z" /><path d="M8 6.5v3M8 11.4v.1" /></Icon>
);
export const ProjectsIcon = (props: IconProps) => (
  <Icon {...props}><path d="M2 4.5h4.5l1.2 1.5H14v6.5H2z" /></Icon>
);
export const TasksIcon = (props: IconProps) => (
  <Icon {...props}><rect height="11" rx="1.5" width="11" x="2.5" y="2.5" /><path d="m5.3 8 1.8 1.8 3.6-3.6" /></Icon>
);
export const RunsIcon = (props: IconProps) => (
  <Icon {...props}><path d="M2 8h3l1.5-3.5 3 7L11 8h3" /></Icon>
);
export const RoadmapIcon = (props: IconProps) => (
  <Icon {...props}><path d="M3 13V3M3 3.5h8l-1.5 2.5L11 8.5H3" /></Icon>
);
export const ApprovalsIcon = (props: IconProps) => (
  <Icon {...props}><path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="m5.8 8 1.5 1.5 3-3" /></Icon>
);
export const UsageIcon = (props: IconProps) => (
  <Icon {...props}><path d="M3 13V9M8 13V3M13 13V6" /></Icon>
);
export const SecurityIcon = (props: IconProps) => (
  <Icon {...props}><rect height="6" rx="1" width="9" x="3.5" y="7" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></Icon>
);
export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" /></Icon>
);
export const BellIcon = (props: IconProps) => (
  <Icon {...props}><path d="M4 6.5a4 4 0 0 1 8 0v3l1.2 2H2.8L4 9.5z" /><path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" /></Icon>
);
export const GlobeIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" /></Icon>
);
export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}><path d="M8 3.5v9M3.5 8h9" /></Icon>
);
export const LockIcon = SecurityIcon;

export const navIcons: Readonly<Record<string, (props: IconProps) => React.ReactElement>> = {
  "/dashboard": DashboardIcon,
  "/attention": AttentionIcon,
  "/projects": ProjectsIcon,
  "/tasks": TasksIcon,
  "/runs": RunsIcon,
  "/roadmap": RoadmapIcon,
  "/approvals": ApprovalsIcon,
  "/usage": UsageIcon,
  "/security": SecurityIcon,
  "/settings": SettingsIcon,
};
