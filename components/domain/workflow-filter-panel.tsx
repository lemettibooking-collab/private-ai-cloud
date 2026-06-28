"use client";

import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/types/app";
import type { WorkflowAvailability, WorkflowGroup } from "@/types/workflow";

type WorkflowFilter =
  | "All"
  | "MVP active"
  | "v0.2 planned"
  | "future"
  | "locked";

type WorkflowFilterPanelProps = {
  groups: WorkflowGroup[];
};

const filters: WorkflowFilter[] = [
  "All",
  "MVP active",
  "v0.2 planned",
  "future",
  "locked",
];

const availabilityTone: Record<WorkflowAvailability, StatusTone> = {
  active: "success",
  planned: "warning",
  locked: "locked",
  future: "neutral",
};

const availabilityLabel: Record<WorkflowAvailability, WorkflowFilter> = {
  active: "MVP active",
  planned: "v0.2 planned",
  locked: "locked",
  future: "future",
};

export function WorkflowFilterPanel({ groups }: WorkflowFilterPanelProps) {
  const [activeFilter, setActiveFilter] = useState<WorkflowFilter>("All");

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          workflows: group.workflows.filter((workflow) => {
            if (activeFilter === "All") {
              return true;
            }

            if (activeFilter === "locked") {
              return (
                workflow.externalActionLocked || workflow.availability === "locked"
              );
            }

            return availabilityLabel[workflow.availability] === activeFilter;
          }),
        }))
        .filter((group) => group.workflows.length > 0),
    [activeFilter, groups],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              activeFilter === filter
                ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100"
                : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500"
            }`}
            key={filter}
            onClick={() => setActiveFilter(filter)}
            type="button"
          >
            {filter}
          </button>
        ))}
      </div>

      {visibleGroups.map((group) => (
        <SectionCard
          description={group.description}
          key={group.id}
          title={group.title}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.workflows.map((workflow) => (
              <article
                className="flex h-full flex-col rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={`${group.id}-${workflow.title}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-500">
                      {workflow.department}
                    </p>
                    <h3 className="mt-2 text-base font-semibold text-slate-50">
                      {workflow.title}
                    </h3>
                  </div>
                  <StatusBadge tone={availabilityTone[workflow.availability]}>
                    {availabilityLabel[workflow.availability]}
                  </StatusBadge>
                </div>

                <p className="mt-3 flex-1 text-sm leading-6 text-slate-400">
                  {workflow.description}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusBadge
                    tone={workflow.approvalRequired ? "warning" : "success"}
                  >
                    {workflow.approvalRequired
                      ? "approval required"
                      : "review optional"}
                  </StatusBadge>
                  {workflow.externalActionLocked && (
                    <StatusBadge tone="locked">locked</StatusBadge>
                  )}
                </div>

                <div className="mt-5">
                  {workflow.availability === "active" && workflow.href ? (
                    <ActionButton href={workflow.href}>Run workflow</ActionButton>
                  ) : (
                    <ActionButton disabled variant="secondary">
                      {availabilityLabel[workflow.availability]}
                    </ActionButton>
                  )}
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
