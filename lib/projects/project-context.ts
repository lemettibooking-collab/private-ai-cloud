// AI-038.3.2 Owner project context (pure; no I/O, no authority).
//
// The browser may send `?project=<id>`. It is an UNTRUSTED resource selector: it can only narrow the
// Owner's view to a project that the authenticated registry read (`listProjects` inside the trusted
// workspace) actually returns. It never chooses the workspace, actor, role or user.
//
// "All Projects" is the ABSENCE of a selector. It is a UI/query scope, not a registry row, not a
// project key and not a special id.
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isProjectKey } from "./project-registry.ts";

export type ProjectSelector =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "candidate"; projectId: string }>
  | Readonly<{ kind: "invalid" }>;

const ALL = Object.freeze({ kind: "all" as const });
const INVALID = Object.freeze({ kind: "invalid" as const });

// Raw `searchParams.project` → selector. Absent means All Projects. Anything present but not exactly
// one structurally valid id (empty, malformed, array/duplicate, non-string) is INVALID and must never
// fall back to All Projects, which would silently broaden the scope.
export function parseProjectSelector(raw: unknown): ProjectSelector {
  if (raw === undefined) return ALL;
  if (typeof raw !== "string" || !isProjectKey(raw)) return INVALID;
  return Object.freeze({ kind: "candidate" as const, projectId: raw });
}

// The Owner pages that understand a project scope.
export const projectScopedPaths = Object.freeze(["/dashboard", "/tasks", "/runs", "/attention", "/approvals"] as const);
export type ProjectScopedPath = (typeof projectScopedPaths)[number];

// The only way the console builds a project-context link. `projectId` must come from a validated
// selection or from registry results; anything else yields the unscoped (All Projects) link, so an
// unvalidated value is never interpolated.
export function projectScopedHref(path: ProjectScopedPath, projectId: string | null): string {
  if (!(projectScopedPaths as readonly string[]).includes(path)) return "/dashboard";
  return projectId !== null && isProjectKey(projectId) ? `${path}?project=${encodeURIComponent(projectId)}` : path;
}

// Where a project switch should land from the current page: stay on the same major Owner page.
export function switchTargetPath(pathname: string): ProjectScopedPath {
  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) return "/tasks";
  if (pathname === "/attention" || pathname.startsWith("/attention/")) return "/attention";
  if (pathname === "/runs" || pathname.startsWith("/runs/")) return "/runs";
  if (pathname === "/approvals" || pathname.startsWith("/approvals/")) return "/approvals";
  return "/dashboard";
}

// AI-038.4b: the Quick Create form, optionally for one project (same validation as projectScopedHref;
// the target page re-validates the selector against the authenticated registry).
export function quickCreateHref(projectId: string | null): string {
  return projectId !== null && isProjectKey(projectId) ? `/tasks/new?project=${encodeURIComponent(projectId)}` : "/tasks/new";
}
