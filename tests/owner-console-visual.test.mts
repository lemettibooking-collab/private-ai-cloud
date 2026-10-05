// AI-038.5 Mission Control visual refinement: structural guards only (no pixel / class assertions).
// The refinement must not change navigation, add client components or write paths, scatter status
// colors, or invent telemetry.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const navigation = (await import(new URL("../lib/navigation.ts", import.meta.url).href)) as typeof import("../lib/navigation");

const root = fileURLToPath(new URL("..", import.meta.url));
function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path)];
  });
}
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'])\/\/[^\n]*/gu, "$1");

const ownerPages = ["app/dashboard/page.tsx", "app/attention/page.tsx", "app/projects/page.tsx", "app/tasks/page.tsx", "app/tasks/[taskId]/page.tsx",
  "app/tasks/new/page.tsx", "app/runs/page.tsx", "app/runs/[runId]/page.tsx", "app/approvals/page.tsx"];
const consoleUi = [...ownerPages, ...walk("components/domain/owner-console"), ...walk("components/shell"),
  "components/ui/instrument.tsx", "components/ui/tone.ts", "components/ui/status-badge.tsx", "components/ui/section-card.tsx"];

test("primary Owner navigation is unchanged (labels, order, availability, project scope)", () => {
  assert.deepEqual(navigation.ownerNavigation.map((section) => [section.id, section.items.map((item) => [item.label, item.href, item.available, Boolean(item.projectScoped)])]), [
    ["overview", [["Dashboard", "/dashboard", true, true], ["My Attention", "/attention", true, true]]],
    ["work", [["Projects", "/projects", true, false], ["Tasks", "/tasks", true, true], ["Runs", "/runs", true, true], ["Roadmap", "/roadmap", true, false], ["Approvals", "/approvals", true, true]]],
    ["platform", [["Usage", "/usage", false, false], ["Security", "/security", false, false], ["Settings", "/settings", true, false]]],
  ]);
});

test("no new client components or write paths in the Owner Console", () => {
  const clientFiles = [...walk("components/shell"), ...walk("components/domain/owner-console"), ...walk("components/ui"), ...ownerPages]
    .filter((path) => /^\s*["']use client["']/mu.test(source(path))).sort();
  // AI-038.6 adds exactly one small client component: the interface-language selector.
  assert.deepEqual(clientFiles, ["components/domain/owner-console/quick-create-form.tsx", "components/shell/locale-switcher.tsx", "components/shell/project-switcher.tsx", "components/shell/sidebar.tsx"]);
  const serverActions = [...walk("app"), ...walk("components"), ...walk("lib")].filter((path) => /\.(tsx?|mts)$/u.test(path) && /["']use server["']/u.test(code(path)));
  assert.deepEqual(serverActions, ["app/tasks/new/actions.ts"]);
  for (const path of consoleUi) {
    assert.ok(!/\bfetch\(|lib\/db\/|lib\/tasks\/owner-task-mutations|lib\/providers|lib\/workflows/u.test(code(path)), `${path} reaches data or write layers`);
  }
});

test("one semantic status system: badges read tones from status-tone.ts, not ad-hoc color choices", () => {
  const tones = code("components/domain/owner-console/status-tone.ts");
  for (const map of ["taskTone", "runTone", "projectTone", "approvalTone", "riskTone"]) assert.match(tones, new RegExp(`export const ${map}: Record<`, "u"));
  for (const path of consoleUi.filter((file) => file !== "components/domain/owner-console/status-tone.ts")) {
    assert.ok(!/<StatusBadge tone=\{[^}]*\?\s*"(success|warning|danger|info)"/u.test(code(path)), `${path} picks a status tone inline`);
    assert.ok(!/(?:Tone|tone)\s*[:=]\s*\{\s*(queued|draft|pending|low|active):/u.test(code(path)), `${path} defines its own status map`);
  }
});

test("no fabricated telemetry: no charts, canvas, health scores, uptime, latency, CPU or agent counts", () => {
  for (const path of consoleUi) {
    const text = code(path);
    assert.ok(!/<canvas|<video|recharts|chart\.js|d3-|WebGL/iu.test(text), `${path} renders a chart / canvas`);
    assert.ok(!/\buptime\b|\blatency\b|\bcpu\b|health score|security score|agents online|confidence/iu.test(text), `${path} shows invented telemetry`);
    assert.ok(!/Math\.random|setInterval|animate-pulse|animate-ping/u.test(text), `${path} animates or randomizes data`);
  }
});

test("Quick Create keeps its exact fields, hidden form key and Server Action", () => {
  const form = code("components/domain/owner-console/quick-create-form.tsx");
  assert.deepEqual([...new Set([...form.matchAll(/\bname="([^"]+)"/gu)].map((match) => match[1]))].sort(), ["goal", "idempotencyKey", "priority", "projectId", "riskLevel", "title", "type"]);
  assert.match(form, /<input name="idempotencyKey" type="hidden" value=\{props\.formKey\} \/>/u);
  assert.ok(!/<select[^>]*\bdisabled=/u.test(form), "a disabled select would drop its value from the submitted form");
  assert.match(code("app/tasks/new/page.tsx"), /action=\{quickCreateTaskAction\}/u);
});

test("ambient background is decorative CSS only: compositor-only motion, frozen under reduced motion", () => {
  const css = source("app/globals.css");
  const shell = source("components/shell/app-shell.tsx");
  assert.match(shell, /<div aria-hidden className="pac-ambient">/u, "decorative layer is hidden from assistive technology");
  assert.ok(!/^\s*["']use client["']/mu.test(shell), "the shell stays a Server Component");
  const keyframes = [...css.matchAll(/@keyframes pac-mass-[a-z]+ \{([\s\S]*?)\n\}/gu)].map((match) => match[1]);
  assert.equal(keyframes.length, 4);
  for (const body of keyframes) {
    const properties = [...body.matchAll(/([a-z-]+):/gu)].map((match) => match[1]);
    assert.deepEqual([...new Set(properties)].sort(), ["opacity", "transform"], "only transform / opacity animate");
  }
  const durations = [...css.matchAll(/\.pac-ambient-field-[a-z] \{[^}]*animation-duration: (\d+)s;/gu)].map((match) => Number(match[1]));
  assert.equal(durations.length, 4);
  for (const duration of durations) assert.ok(duration >= 24 && duration <= 40, "slow 24–40 s cycles only");
  assert.match(css, /\.pac-ambient-field \{[^}]*animation-direction: alternate;/u, "smooth back-and-forth loops, no jumps");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.pac-ambient-field \{\s*animation: none !important;/u);
  assert.ok(!/\.pac-ambient[^{]*\{[^}]*filter:/u.test(css), "no per-frame filter on the ambient layer");
});

test("V-1: a bounded parent list never turns a category subset into '+' or a factual 'clear'", async () => {
  const bounded = (await import(new URL("../components/domain/owner-console/bounded-count.ts", import.meta.url).href)) as typeof import("../components/domain/owner-console/bounded-count");
  // Totals of the truncated list itself may carry "+"; category counts never do.
  assert.equal(bounded.totalReading(50, true), "50+");
  assert.equal(bounded.totalReading(7, false), "7");
  assert.equal(bounded.observedCount(3), "3");
  // Zero observed inside a truncated view is unknown, not clear: no success tone, no state.
  assert.deepEqual({ ...bounded.attentionReading(0, true) }, { value: "0", tone: "neutral" });
  assert.deepEqual({ ...bounded.attentionReading(0, false) }, { value: "0", state: "clear", tone: "success" });
  assert.deepEqual({ ...bounded.attentionReading(4, true) }, { value: "4", state: "action", tone: "attention" });
  // Pages: no parent-truncation suffix on category counts, no unconditional "clear" for attention.
  const dashboard = code("app/dashboard/page.tsx");
  assert.ok(!/needsOwner\}\$\{plus\(/u.test(dashboard), "dashboard needs-attention count must not inherit '+'");
  assert.ok(!/needsOwner > 0 \? "action" : "clear"/u.test(dashboard), "dashboard must not claim 'clear' over a bounded view");
  assert.equal((dashboard.match(/attentionReading\(needsOwner, view\.tasks\.current\.truncated\)/gu) ?? []).length, 2);
  const tasks = code("app/tasks/page.tsx");
  assert.ok(!/const mark = /u.test(tasks) && !/\.length\}\$\{mark\}/u.test(tasks), "tasks summary categories must not share the list '+'");
  const attention = code("app/attention/page.tsx");
  assert.ok(!/group\.tasks\.length\}\$\{/u.test(attention), "attention groups must show observed counts only");
});
