// AI-038.5 Mission Control visual refinement: structural guards only (no pixel / class assertions).
// The refinement must not change navigation, add client components or write paths, scatter status
// colors, or invent telemetry. AI-038.7 adds the decorative ambient shader background; its renderer
// lifecycle is exercised behaviorally in tests/ambient-renderer.test.mts.
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
// AI-038.7: the only files allowed to draw on a canvas — the decorative ambient background.
const ambientComponent = "components/shell/ambient-shader-background.tsx";
const ambientRenderer = "components/shell/ambient-renderer.ts";
const ambientFiles = [ambientComponent, ambientRenderer];

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
  // AI-038.7 adds exactly one more: the decorative ambient shader background (its renderer module is
  // plain TypeScript, not a client entry).
  assert.deepEqual(clientFiles, ["components/domain/owner-console/quick-create-form.tsx", ambientComponent, "components/shell/locale-switcher.tsx", "components/shell/project-switcher.tsx", "components/shell/sidebar.tsx"]);
  assert.ok(!/^\s*["']use client["']/mu.test(source(ambientRenderer)), "the renderer is a plain module");
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
    // The ambient background is the one decorative canvas; its no-data guarantees are tested below.
    if (!ambientFiles.includes(path)) assert.ok(!/<canvas|<video|recharts|chart\.js|d3-|WebGL/iu.test(text), `${path} renders a chart / canvas`);
    else assert.ok(!/<video|recharts|chart\.js|d3-/iu.test(text), `${path} renders a chart`);
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

test("J / D. AI-038.5 CSS ambient fallback is preserved: compositor-only motion, frozen under reduced motion", () => {
  const css = source("app/globals.css");
  const shell = source("components/shell/app-shell.tsx");
  const component = code(ambientComponent);
  assert.ok(!/^\s*["']use client["']/mu.test(shell), "the shell stays a Server Component");
  assert.match(component, /<div aria-hidden className="pac-ambient" ref=\{rootRef\}>/u, "decorative layer is hidden from assistive technology");
  // The four masses are still server-rendered inside the fallback mesh, before the canvas.
  assert.match(component, /<div className="pac-ambient-mesh">\s*<span className="pac-ambient-field pac-ambient-field-a" \/>\s*<span className="pac-ambient-field pac-ambient-field-b" \/>\s*<span className="pac-ambient-field pac-ambient-field-c" \/>\s*<span className="pac-ambient-field pac-ambient-field-d" \/>\s*<\/div>\s*<canvas className="pac-ambient-canvas" ref=\{canvasRef\} \/>/u);
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
  // The haze stays above both the fallback and the canvas (::after paints after the children) and
  // under the UI (the content column is a later z-[1] sibling); the layer never takes input.
  assert.match(css, /\.pac-ambient \{[^}]*position: fixed;[^}]*z-index: 0;[^}]*pointer-events: none;/u);
  assert.match(css, /\.pac-ambient::after \{[^}]*position: absolute;[^}]*inset: 0;/u);
});

test("D / 6. shader mode: the canvas is hidden until the renderer runs; then one moving layer only", () => {
  const css = source("app/globals.css");
  const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]]/gu, "\\$&")} \\{([^}]*)\\}`, "u"))?.[1] ?? "";
  assert.match(rule(".pac-ambient-canvas"), /opacity: 0;/u, "no canvas before the renderer has started (SSR, failure, reduced motion)");
  assert.match(rule('.pac-ambient[data-renderer="shader"] .pac-ambient-canvas'), /opacity: 1;/u);
  assert.match(rule('.pac-ambient[data-renderer="shader"] .pac-ambient-mesh'), /opacity: 0;[\s\S]*visibility: hidden;/u, "the CSS mesh fades out under the shader");
  assert.match(rule('.pac-ambient[data-renderer="shader"] .pac-ambient-field'), /animation-play-state: paused;/u, "no double animation: CSS loops pause");
  // Only the renderer sets the attribute, directly on the DOM (never React state) and only on success;
  // every exit path removes it.
  const component = code(ambientComponent);
  assert.deepEqual(component.match(/root\.dataset\.renderer = "[a-z]+"/gu), ['root.dataset.renderer = "shader"']);
  assert.match(component, /if \(!result\.ok\) return;\s*renderer = result\.renderer;\s*root\.dataset\.renderer = "shader";/u);
  assert.match(component, /const stop = \(\) => \{[\s\S]*?delete root\.dataset\.renderer;/u);
  assert.ok(!/data-renderer=/u.test(component), "the server-rendered markup is always the fallback");
  assert.ok(!/useState|useReducer|setState/u.test(component), "no React state in the background");
});

test("A / B / C / K. the ambient background is one prop-less client island with no data, no library", () => {
  const component = code(ambientComponent);
  const renderer = code(ambientRenderer);
  const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/gu)].map((match) => match[1]).sort();
  assert.deepEqual(imports(component), ["@/components/shell/ambient-renderer", "react"]);
  assert.deepEqual(imports(renderer), [], "the renderer imports nothing");
  for (const text of [component, renderer]) {
    assert.ok(!/lib\/(db|auth|tasks|workflows|providers|projects|composition|i18n|contracts)|owner-console|fetch\(|cookies|searchParams|localStorage/u.test(text), "no data, auth, locale or browser-state access");
    assert.ok(!/three|@react-three|\bogl\b|shadergradient|regl|pixi|twgl|gl-matrix|framer-motion|gsap/iu.test(text), "no WebGL / animation library");
  }
  const packageJson = JSON.parse(source("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  assert.deepEqual(deps.filter((name) => /three|ogl|shadergradient|regl|pixi|twgl|gl-matrix|framer-motion|gsap|^motion$/iu.test(name)), []);
  // No props in, nothing operational out: the shell renders it bare and the shader only knows size + time.
  assert.match(component, /export function AmbientShaderBackground\(\) \{/u);
  assert.match(code("components/shell/app-shell.tsx"), /<AmbientShaderBackground \/>/u);
  const uniforms = [...renderer.matchAll(/uniform\s+(?:vec2|float|vec3|vec4|int|sampler2D)\s+(\w+);/gu)].map((match) => match[1]).sort();
  assert.deepEqual(uniforms, ["uIntensity", "uResolution", "uTime"]);
  assert.deepEqual([...new Set([...renderer.matchAll(/getUniformLocation\(program, "(\w+)"\)/gu)].map((match) => match[1]))].sort(), ["uIntensity", "uResolution", "uTime"]);
});

test("F / G / H / I / J / L / M. lifecycle wiring: reduced motion, visibility, ~30 FPS, DPR 1, no pointer, context loss, cleanup", async () => {
  const component = code(ambientComponent);
  const renderer = code(ambientRenderer);
  const constants = (await import(new URL("../components/shell/ambient-renderer.ts", import.meta.url).href)) as typeof import("../components/shell/ambient-renderer");
  // F. reduced motion: never started while reduced, stopped when the preference turns on.
  assert.match(component, /const REDUCED_MOTION = "\(prefers-reduced-motion: reduce\)";/u);
  assert.match(component, /if \(renderer \|\| contextLost \|\| motion\.matches\) return;/u);
  assert.match(component, /const onMotionPreference = \(\) => \(motion\.matches \? stop\(\) : start\(\)\);/u);
  // G. visibility comes from the real document.
  assert.match(component, /isHidden: \(\) => document\.hidden/u);
  assert.match(component, /document\.addEventListener\("visibilitychange", listener\)/u);
  // H. requestAnimationFrame is the only scheduler; ~30 FPS cap.
  assert.equal(constants.AMBIENT_TARGET_FPS, 30);
  assert.equal(constants.AMBIENT_FRAME_INTERVAL_MS, 1000 / 30);
  assert.match(component, /window\.requestAnimationFrame\(callback\)/u);
  for (const text of [component, renderer]) assert.ok(!/setInterval|setTimeout|Math\.random|performance\.now|Date\.now/u.test(text), "no timers, randomness or wall clock");
  // I. DPR 1: the drawing buffer follows CSS pixels; devicePixelRatio is never read.
  assert.equal(constants.AMBIENT_MAX_DPR, 1);
  for (const text of [component, renderer]) assert.ok(!/devicePixelRatio/u.test(text));
  assert.match(component, /listener\(canvas\.clientWidth, canvas\.clientHeight\)/u);
  assert.match(component, /new ResizeObserver\(report\)/u);
  // J. no pointer / mouse / touch tracking anywhere in the background (event names, handler props, coordinates).
  for (const text of [component, renderer]) {
    assert.ok(!/["'](?:pointer|mouse|touch)[a-z]*["']|\bon(?:Pointer|Mouse|Touch)[A-Z]\w*|\b(?:client|page|screen|offset|movement)[XY]\b|uPointer|uMouse/u.test(text), "no pointer tracking");
  }
  // L. context loss: stays on the CSS fallback until reload.
  assert.match(component, /onContextLost: \(\) => \{\s*contextLost = true;\s*stop\(\);/u);
  assert.match(renderer, /addEventListener\("webglcontextlost", onContextLost\)/u);
  // M. cleanup: layout-effect teardown removes the media listener and disposes the renderer.
  assert.match(component, /return \(\) => \{\s*motion\.removeEventListener\("change", onMotionPreference\);\s*stop\(\);\s*\};/u);
  assert.match(component, /return \(\) => observer\.disconnect\(\);/u);
  assert.match(component, /return \(\) => document\.removeEventListener\("visibilitychange", listener\);/u);
});

test("8. shader palette: PAC teal / ocean / steel navy / cyan only — no operational status colors", () => {
  const renderer = code(ambientRenderer);
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  const colors = Object.fromEntries([...renderer.matchAll(/const vec3 (\w+) = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);/gu)].map((match) => [match[1], hex(Number(match[2]), Number(match[3]), Number(match[4]))]));
  assert.deepEqual(colors, { OCEAN: "#0B3150", STEEL: "#123B63", TEAL: "#0E7490", CYAN: "#38BDF8" });
  assert.ok(!/34d399|fbbf24|f87171|--pac-(ok|warn|bad)/iu.test(renderer), "green / amber / red stay reserved for statuses");
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
