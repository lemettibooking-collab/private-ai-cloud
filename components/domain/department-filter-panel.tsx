"use client";

import { useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Department, DepartmentStatus, StatusTone } from "@/types/app";

type DepartmentFilter = "All" | DepartmentStatus | "locked";

type DepartmentFilterPanelProps = {
  departments: Department[];
};

const filters: DepartmentFilter[] = [
  "All",
  "MVP active",
  "v0.2 planned",
  "future",
  "locked",
];

const statusTone: Record<DepartmentStatus, StatusTone> = {
  "MVP active": "success",
  "v0.2 planned": "warning",
  future: "locked",
};

export function DepartmentFilterPanel({
  departments,
}: DepartmentFilterPanelProps) {
  const [activeFilter, setActiveFilter] = useState<DepartmentFilter>("All");

  const visibleDepartments = useMemo(
    () =>
      departments.filter((department) => {
        if (activeFilter === "All") {
          return true;
        }

        if (activeFilter === "locked") {
          return department.status === "future";
        }

        return department.status === activeFilter;
      }),
    [activeFilter, departments],
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

      <div className="grid gap-4 xl:grid-cols-2">
        {visibleDepartments.map((department) => (
          <SectionCard key={department.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">
                  {department.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {department.description}
                </p>
              </div>
              <StatusBadge tone={statusTone[department.status]}>
                {department.status}
              </StatusBadge>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs font-medium uppercase text-slate-500">
                  Primary assistant
                </p>
                <p className="mt-2 text-sm text-slate-100">
                  {department.primaryAssistant}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs font-medium uppercase text-slate-500">
                  Approval requirement
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {department.approvalRequirement}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium uppercase text-slate-500">
                Key workflows
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {department.keyWorkflows.map((workflow) => (
                  <StatusBadge key={workflow} tone="info">
                    {workflow}
                  </StatusBadge>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium uppercase text-slate-500">
                Integrations later
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {department.integrationsLater.map((integration) => (
                  <StatusBadge key={integration} tone="neutral">
                    {integration}
                  </StatusBadge>
                ))}
              </div>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
