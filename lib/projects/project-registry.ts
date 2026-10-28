// AI-038.3.1 Project Registry contract (pure; no I/O).
//
// Model:  Workspace (tenant / security boundary) → Project (product/system inside it) → Runs.
// A Project is identified by its stable key inside ONE workspace. It is NOT a filesystem folder,
// Git checkout, VPS directory, executor session, environment or branch:
//
//   Git repository (canonical code)      → recorded here only as a non-secret HTTPS locator
//   PAC (control plane)                  → owns this registry
//   Managed executor / VPS / Local Runner → execution environments (AI-041 / AI-042), NOT stored here
//   Local Mac folders, VPS checkouts     → temporary working copies, NOT project identity
//
// The same Project ID therefore stays valid wherever execution happens. Executor, environment,
// deployment and secrets-profile bindings are deferred until their typed M4 contracts exist.

export const projectStatuses = Object.freeze(["active", "paused", "archived"] as const);
export type ProjectStatus = (typeof projectStatuses)[number];

// listProjects returns these; archived projects are excluded from discovery and from run listing.
export const discoverableProjectStatuses = Object.freeze(["active", "paused"] as const);

export const projectRegistryLimits = Object.freeze({
  defaultLimit: 25,
  maxLimit: 100,
  maxProjectKeyLength: 64,
  maxDisplayNameLength: 120,
  maxRepositoryUrlLength: 300,
  maxDefaultBranchLength: 200,
});

// Same rule as workflow_runs.project_id and the runtime's stable ids.
export const projectKeyPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

// Mirrors the 0009 CHECK constraints exactly (defense in depth on read).
const repositoryUrlPattern =
  /^https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){1,8}$/u;
const credentialMarker = /(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-)/u;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const branchForbidden = /(\.\.|\/\/|\/$|\.$|\.lock$|\/\.)/u;
const controlCharacters = /[\u0000-\u001f\u007f]/u;

export type PublicProjectRepository = Readonly<{ url: string; defaultBranch: string | null }>;

export type PublicProjectSummary = Readonly<{
  projectId: string;
  displayName: string;
  status: ProjectStatus;
  repository: PublicProjectRepository | null;
}>;

export function isProjectKey(input: unknown): input is string {
  return typeof input === "string" && input.length <= projectRegistryLimits.maxProjectKeyLength && projectKeyPattern.test(input);
}

export function isProjectStatus(input: unknown): input is ProjectStatus {
  return typeof input === "string" && (projectStatuses as readonly string[]).includes(input);
}

export function isCanonicalRepositoryUrl(input: unknown): input is string {
  return typeof input === "string"
    && input.length <= projectRegistryLimits.maxRepositoryUrlLength
    && repositoryUrlPattern.test(input)
    && !credentialMarker.test(input);
}

export function isDefaultBranch(input: unknown): input is string {
  return typeof input === "string"
    && input.length >= 1 && input.length <= projectRegistryLimits.maxDefaultBranchLength
    && branchPattern.test(input) && !branchForbidden.test(input);
}

export function isDisplayName(input: unknown): input is string {
  return typeof input === "string"
    && input.length >= 1 && input.length <= projectRegistryLimits.maxDisplayNameLength
    && input === input.trim() && !controlCharacters.test(input);
}

// A database row → public summary, or null when ANY field is malformed (the caller fails closed).
export function projectSummaryFromRow(row: Readonly<Record<string, unknown>>): PublicProjectSummary | null {
  const repositoryUrl = row.repository_url;
  const defaultBranch = row.default_branch;
  if (!isProjectKey(row.project_key) || !isDisplayName(row.display_name) || !isProjectStatus(row.status)) return null;
  if (repositoryUrl !== null && !isCanonicalRepositoryUrl(repositoryUrl)) return null;
  if (defaultBranch !== null && !isDefaultBranch(defaultBranch)) return null;
  if (repositoryUrl === null && defaultBranch !== null) return null;
  return Object.freeze({
    projectId: row.project_key,
    displayName: row.display_name,
    status: row.status,
    repository: repositoryUrl === null
      ? null
      : Object.freeze({ url: repositoryUrl as string, defaultBranch: (defaultBranch as string | null) ?? null }),
  });
}

export function boundedProjectLimit(input: unknown): number | null {
  const value = input === undefined ? projectRegistryLimits.defaultLimit : input;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= projectRegistryLimits.maxLimit
    ? value
    : null;
}
