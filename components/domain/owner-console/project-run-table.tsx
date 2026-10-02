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

// Factual runs from the project-scoped discovery. Each row keeps its FACTUAL project id.
export function ProjectRunTable({ runs, projectNames, selectedProjectId, showProject }: ProjectRunTableProps) {
  const scoped = projectScopedHref("/runs", selectedProjectId);
  const runHref = (runId: string) => `/runs/${encodeURIComponent(runId)}${scoped.slice("/runs".length)}`;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {[...(showProject ? ["Project"] : []), "Run", "Status", "Workflow", "Created", "Started", "Completed"].map((header) => (
              <th className="pac-label px-3 py-2 font-medium" key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((run) => (
            <tr className="hover:bg-panel-2" key={`${run.projectId}/${run.runId}`}>
              {showProject && (
                <td className="px-3 py-2">
                  <Link className="text-[13px] text-ink hover:text-accent" href={projectScopedHref("/runs", run.projectId)}>
                    {projectNames?.get(run.projectId) ?? run.projectId}
                  </Link>
                  <p className="font-mono text-[10.5px] text-ink-3">{run.projectId}</p>
                </td>
              )}
              <td className="px-3 py-2">
                <Link className="font-mono text-xs text-accent hover:underline" href={runHref(run.runId)}>{run.runId}</Link>
                <p className="font-mono text-[10.5px] text-ink-3">rev {run.revision}</p>
              </td>
              <td className="px-3 py-2"><RunStatusBadge status={run.status} /></td>
              <td className="px-3 py-2 font-mono text-xs text-ink-2">{run.workflowId}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{formatTimestamp(run.createdAt)}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{formatTimestamp(run.startedAt)}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{formatTimestamp(run.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const activeRunStatuses = new Set(["queued", "running", "waiting_approval", "review"]);
export const blockedRunStatuses = new Set(["blocked", "failed"]);
