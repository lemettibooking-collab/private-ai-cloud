import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RunStatusBadge } from "@/components/domain/owner-console/run-status";
import type { OwnerConsoleProjectRun } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type ProjectRunTableProps = {
  runs: readonly OwnerConsoleProjectRun[];
  // Display names of registry projects (factual run.projectId is always shown).
  projectNames?: ReadonlyMap<string, string>;
  // The validated selected project, preserved on run links; null = All Projects.
  selectedProjectId: string | null;
  showProject: boolean;
};

// Factual runs from the project-scoped discovery — technical execution attempts, so the run id and
// timestamps read as telemetry (mono). Each row keeps its FACTUAL project id.
export function ProjectRunTable({ runs, projectNames, selectedProjectId, showProject }: ProjectRunTableProps) {
  const scoped = projectScopedHref("/runs", selectedProjectId);
  const runHref = (runId: string) => `/runs/${encodeURIComponent(runId)}${scoped.slice("/runs".length)}`;
  return (
    <div className="overflow-x-auto">
      <table className="pac-table">
        <thead>
          <tr>
            {["Run", ...(showProject ? ["Project"] : []), "Status", "Workflow", "Created", "Started", "Completed"].map((header) => (
              <th key={header} scope="col">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={`${run.projectId}/${run.runId}`}>
              <td>
                <Link className="font-mono text-[12px] text-ink hover:text-accent" href={runHref(run.runId)}>{run.runId}</Link>
                <p className="pac-id">rev {run.revision}</p>
              </td>
              {showProject && (
                <td>
                  <Link className="text-[12.5px] text-ink-2 hover:text-accent" href={projectScopedHref("/runs", run.projectId)}>
                    {projectNames?.get(run.projectId) ?? run.projectId}
                  </Link>
                  <p className="pac-id">{run.projectId}</p>
                </td>
              )}
              <td><RunStatusBadge status={run.status} /></td>
              <td className="font-mono text-[11.5px] text-ink-2">{run.workflowId}</td>
              <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">{formatTimestamp(run.createdAt)}</td>
              <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">{formatTimestamp(run.startedAt)}</td>
              <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">{formatTimestamp(run.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const activeRunStatuses = new Set(["queued", "running", "waiting_approval", "review"]);
export const blockedRunStatuses = new Set(["blocked", "failed"]);
