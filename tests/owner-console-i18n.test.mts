/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.6 RU / EN Owner Console localization: strict locale parsing, cookie semantics, exact
// dictionary parity, exhaustive domain-label maps, the language switcher's boundaries, and that the
// locale is presentation-only (never part of URLs, Quick Create payloads or any security decision).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const locale = (await import(new URL("../lib/i18n/locale.ts", import.meta.url).href)) as typeof import("../lib/i18n/locale");
const i18n = (await import(new URL("../lib/i18n/messages.ts", import.meta.url).href)) as typeof import("../lib/i18n/messages");
const prototype = (await import(new URL("../lib/i18n/prototype-content.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-content");
const binding = (await import(new URL("../lib/composition/owner-task-create.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-task-create");
const projectTask = (await import(new URL("../lib/tasks/project-task.ts", import.meta.url).href)) as typeof import("../lib/tasks/project-task");
const domain = (await import(new URL("../lib/contracts/domain.ts", import.meta.url).href)) as typeof import("../lib/contracts/domain");
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

function leaves(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out.set(path, child);
    else for (const [k, v] of leaves(child, path)) out.set(k, v);
  }
  return out;
}
const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z]+)\}/gu)].map((match) => match[1]).sort();

const taskStatuses = ["draft", "ready", "planning", "approved", "running", "verifying", "waiting_owner", "blocked", "recovery_required", "completed", "failed", "cancelled"];
// OwnerConsoleRunStatus (lib/composition/owner-console-read.ts) — the run statuses the console renders.
const runStatuses = ["queued", "running", "waiting_approval", "review", "completed", "failed", "blocked", "cancelled"];
const approvalStatuses = ["pending", "approved", "rejected", "cancelled"];

test("A–D. strict locale parsing: only exactly 'ru' / 'en'; everything else is the default 'ru'", () => {
  assert.equal(locale.defaultLocale, "ru");
  assert.deepEqual([...locale.locales], ["ru", "en"]);
  assert.equal(locale.parseLocale(undefined), "ru");
  assert.equal(locale.parseLocale("ru"), "ru");
  assert.equal(locale.parseLocale("en"), "en");
  for (const hostile of ["RU", "EN", "en-US", "ru-RU", " en", "en ", "", "de", "fr", "null", "../en", "en;Path=/", ["en"], { en: true }, 1, null, true]) {
    assert.equal(locale.parseLocale(hostile), "ru", JSON.stringify(hostile));
  }
});

test("cookie semantics: pac_locale, Path=/, SameSite=Lax, ~1 year, Secure only on HTTPS, not HttpOnly, value only", () => {
  assert.equal(locale.localeCookieName, "pac_locale");
  assert.equal(locale.localeCookieMaxAgeSeconds, 31_536_000);
  assert.equal(locale.serializeLocaleCookie("en", false), "pac_locale=en; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(locale.serializeLocaleCookie("ru", true), "pac_locale=ru; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  assert.equal(locale.serializeLocaleCookie("en-US" as any, false), "pac_locale=ru; Path=/; Max-Age=31536000; SameSite=Lax", "hostile input never reaches the cookie");
  assert.ok(!/HttpOnly/iu.test(locale.serializeLocaleCookie("en", true)));
});

test("E. RU and EN dictionaries have the exact same keys and the same placeholders; no empty or EN-fallback RU values", () => {
  const en = leaves(i18n.messages.en);
  const ru = leaves(i18n.messages.ru);
  assert.deepEqual([...ru.keys()].sort(), [...en.keys()].sort());
  for (const [key, value] of en) {
    assert.ok(value.trim().length > 0, `en ${key} empty`);
    assert.ok(ru.get(key)!.trim().length > 0, `ru ${key} empty`);
    assert.deepEqual(placeholders(ru.get(key)!), placeholders(value), `placeholders differ at ${key}`);
  }
  // Russian copy is Russian: apart from identifiers / tokens, a RU value never equals its EN sentence.
  for (const [key, value] of en) {
    if (/\s/u.test(value) && value.length > 12) assert.notEqual(ru.get(key), value, `ru ${key} is untranslated`);
  }
  assert.equal(i18n.messages.ru.locale.ariaLabel, "Язык интерфейса: Русский");
  assert.equal(i18n.messages.en.locale.ariaLabel, "Interface language: English");
});

test("F–H. exhaustive presentation maps for every existing domain value (values themselves unchanged)", () => {
  for (const lang of ["ru", "en"] as const) {
    const t = i18n.messages[lang];
    assert.deepEqual(Object.keys(t.taskStatus).sort(), [...projectTask.projectTaskStatuses].sort(), `${lang} task statuses`);
    assert.deepEqual(Object.keys(t.taskStatus).sort(), [...taskStatuses].sort());
    assert.deepEqual(Object.keys(t.runStatus).sort(), [...runStatuses].sort(), `${lang} run statuses`);
    assert.deepEqual(Object.keys(t.approvalStatus).sort(), [...approvalStatuses].sort());
    assert.deepEqual(Object.keys(t.risk).sort(), [...domain.riskLevels].sort());
    assert.deepEqual(Object.keys(t.riskBadge).sort(), [...domain.riskLevels].sort());
    assert.deepEqual(Object.keys(t.taskType).sort(), [...projectTask.projectTaskTypes].sort());
    assert.deepEqual(Object.keys(t.projectStatus).sort(), ["active", "archived", "paused"]);
  }
  const ru = i18n.messages.ru;
  assert.deepEqual(ru.taskStatus, {
    draft: "Черновик", ready: "Готово", planning: "Планирование", approved: "Одобрено", running: "Выполняется", verifying: "Проверка",
    waiting_owner: "Ожидает владельца", blocked: "Заблокировано", recovery_required: "Требует восстановления", completed: "Завершено",
    failed: "Ошибка", cancelled: "Отменено",
  });
  assert.deepEqual(ru.risk, { low: "Низкий", medium: "Средний", high: "Высокий", critical: "Критический" });
  assert.deepEqual(ru.taskType, { feature: "Функция", fix: "Исправление", investigation: "Исследование", roadmap: "Дорожная карта" });
  assert.deepEqual([ru.nav.items["/dashboard"], ru.nav.items["/attention"], ru.nav.items["/runs"], ru.nav.items["/approvals"]], ["Главная", "Требует внимания", "Запуски", "Согласования"]);
  // Priority tokens are never translated (no P0–P4 key exists anywhere in the dictionaries).
  for (const lang of ["ru", "en"] as const) assert.ok(![...leaves(i18n.messages[lang]).keys()].some((key) => /\.P[0-4]$/u.test(key)));
});

test("I / K. the switcher knows only ru / en, writes only pac_locale and refreshes — no navigation, route, action or data access", () => {
  const switcher = code("components/shell/locale-switcher.tsx");
  assert.match(switcher, /^"use client";/u);
  assert.match(switcher, /document\.cookie = serializeLocaleCookie\(parseLocale\(locale\), window\.location\.protocol === "https:"\);/u);
  assert.match(switcher, /writeLocalePreference\(value\);\s*router\.refresh\(\);/u);
  assert.ok(!/router\.(push|replace|back|forward|prefetch)|window\.location\.(href|assign|replace)|location\.search|searchParams|<form|fetch\(|"use server"/u.test(switcher), "no URL change, navigation, form or request");
  assert.deepEqual([...switcher.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]).sort(),
    ["@/components/shell/icons", "@/lib/i18n/locale", "next/navigation", "react"]);
  assert.match(switcher, /ru: \{ flag: "🇷🇺", code: "RU", name: "Русский" \}/u);
  assert.match(switcher, /en: \{ flag: "🇬🇧", code: "EN", name: "English" \}/u);
  assert.match(switcher, /aria-hidden className="font-sans/u, "flags are decorative");
  assert.match(switcher, /event\.key === "Escape"/u);
  assert.match(switcher, /aria-label=\{ariaLabel\}/u);
  assert.match(switcher, /aria-selected=\{selected\}/u);
  // Placed in the top bar, directly before the account block.
  const topbar = code("components/shell/topbar.tsx");
  assert.ok(topbar.indexOf("<LocaleSwitcher") > topbar.indexOf("t.topbar.newTask") && topbar.indexOf("<LocaleSwitcher") < topbar.indexOf("{t.topbar.owner}"));
});

test("J / N. project context and routes are untouched: no locale routing, no locale query, project helpers unchanged", () => {
  assert.ok(!existsSync(join(root, "app/[locale]")) && !walk("app").some((path) => /\/(ru|en)\//u.test(`/${path}`)), "no /ru or /en route tree");
  for (const path of [...walk("app"), ...walk("components"), "lib/projects/project-context.ts", "lib/navigation.ts"].filter((file) => /\.(tsx?)$/u.test(file))) {
    assert.ok(!/[?&]locale=|[?&]lang=|searchParams\)?\.locale|\/\$\{locale\}\//u.test(code(path)), `${path} encodes the locale in a URL`);
  }
  assert.ok(!/i18n|locale/u.test(code("lib/projects/project-context.ts")), "project selector semantics stay locale-free");
});

test("M. Quick Create: same fields, form key, Server Action and payload — the locale is never part of the task intent", () => {
  const form = code("components/domain/owner-console/quick-create-form.tsx");
  assert.deepEqual([...new Set([...form.matchAll(/\bname="([^"]+)"/gu)].map((match) => match[1]))].sort(), ["goal", "idempotencyKey", "priority", "projectId", "riskLevel", "title", "type"]);
  assert.match(form, /<input name="idempotencyKey" type="hidden" value=\{props\.formKey\} \/>/u);
  // Option VALUES are the canonical domain tokens; only the visible text is localized.
  assert.match(form, /<option key=\{value\} value=\{value\}>\{props\.typeLabels\[value\] \?\? value\}<\/option>/u);
  assert.match(form, /<option key=\{value\} value=\{value\}>\{props\.riskLabels\[value\] \?\? value\}<\/option>/u);
  assert.deepEqual([...binding.quickCreateFormFields], ["idempotencyKey", "projectId", "title", "goal", "type", "priority", "riskLevel"]);
  const withLocale = new FormData();
  for (const [key, value] of Object.entries({ idempotencyKey: binding.newQuickCreateFormKey(), projectId: "project-a", title: "T", goal: "", type: "fix", priority: "", riskLevel: "", locale: "en" })) withLocale.append(key, value);
  assert.equal(binding.quickCreateInputFromForm(withLocale), null, "a smuggled locale field is refused like any other extra field");
  assert.match(code("app/tasks/new/page.tsx"), /action=\{quickCreateTaskAction\}/u);
  assert.ok(!/locale|i18n/u.test(code("app/tasks/new/actions.ts") + code("lib/composition/owner-task-create.ts") + code("lib/composition/owner-task-create.server.ts")));
});

test("O. <html lang> follows the resolved locale (default ru); Cyrillic subsets are requested for both families", () => {
  const layout = code("app/layout.tsx");
  assert.match(layout, /const \{ locale \} = await getI18n\(\);/u);
  assert.match(layout, /lang=\{locale\}/u);
  assert.ok(!/lang="en"|lang="ru"/u.test(layout));
  assert.equal((layout.match(/subsets: \["latin", "cyrillic"\]/gu) ?? []).length, 2);
  const server = source("lib/i18n/locale.server.ts");
  assert.match(server, /^(\/\/[^\n]*\n)*import "server-only";/u);
  assert.match(server, /parseLocale\(\(await cookies\(\)\)\.get\(localeCookieName\)\?\.value\)/u, "one canonical cookie resolver");
  const cookieReaders = [...walk("app"), ...walk("components"), ...walk("lib")].filter((path) => /\.(tsx?)$/u.test(path) && /\bcookies\(\)/u.test(code(path)));
  assert.deepEqual(cookieReaders, ["lib/i18n/locale.server.ts"], "no page parses the locale cookie itself");
});

test("security boundary: the locale never reaches auth, tenancy, registry, reads, mutations, approvals or providers", () => {
  const securityPaths = [...walk("lib/auth"), ...walk("lib/db"), ...walk("lib/tasks"), ...walk("lib/workflows"), ...walk("lib/providers"), ...walk("lib/projects"),
    ...walk("lib/contracts"), "lib/composition/owner-console-read.ts", "lib/composition/owner-console-read.server.ts", "lib/composition/owner-read-runtime.ts",
    "lib/composition/authenticated-owner-read-runtime.ts", "lib/composition/github-owner-read-runtime.ts", "lib/composition/owner-task-create.ts",
    "lib/composition/owner-task-create.server.ts", "app/tasks/new/actions.ts", "app/api/auth/[...nextauth]/route.ts"].filter((path) => /\.tsx?$/u.test(path));
  for (const path of securityPaths) assert.ok(!/pac_locale|lib\/i18n|\.\.\/i18n|getLocale|getI18n|parseLocale/u.test(code(path)), `${path} depends on the locale`);
  // The i18n layer itself imports nothing with authority.
  for (const path of walk("lib/i18n")) assert.ok(!/lib\/db|lib\/auth|owner-task|next-auth|lib\/workflows|lib\/providers/u.test(code(path)), path);
});

test("L. identifiers and stored content are not in the dictionaries; badges map labels, never rewrite values", () => {
  const all = JSON.stringify(i18n.messages);
  for (const identifier of ["project-a", "task-", "run-", "workflow-", "step-one", "pac-console", "Smart Algorithms Demo"]) assert.ok(!all.includes(identifier), identifier);
  for (const path of ["components/domain/owner-console/task-table.tsx", "components/domain/owner-console/project-run-table.tsx", "components/domain/owner-console/attention-task-list.tsx"]) {
    const text = code(path);
    assert.ok(/\{task\.taskId\}|\{run\.runId\}/u.test(text), `${path} shows the raw id`);
    assert.ok(!/t\.[a-zA-Z.]+\[(task|run)\.(taskId|runId|title|projectId)\]/u.test(text), `${path} translates an identifier or stored text`);
  }
});

test("prototype pages (Roadmap / Settings) mirror the English mock content 1:1 in Russian", () => {
  const { en, ru } = prototype.prototypeContent;
  assert.deepEqual(ru.roadmap.items.map((item) => [item.version, item.status, item.items.length]), en.roadmap.items.map((item) => [item.version, item.status, item.items.length]));
  assert.deepEqual(ru.settings.modules.map((item) => [item.href, item.status]), en.settings.modules.map((item) => [item.href, item.status]));
  assert.deepEqual(ru.assistants.profiles.map((item) => item.status), en.assistants.profiles.map((item) => item.status));
  assert.deepEqual(ru.integrations.items.map((item) => [item.id, item.status]), en.integrations.items.map((item) => [item.id, item.status]));
  assert.deepEqual(ru.roles.items.map((item) => [item.id, item.landing, item.permissions.length]), en.roles.items.map((item) => [item.id, item.landing, item.permissions.length]));
  for (const status of new Set(en.settings.modules.map((item) => item.status))) assert.ok(ru.settings.status[status], status);
  for (const status of new Set(en.integrations.items.map((item) => item.status))) assert.ok(ru.integrations.status[status], status);
  const properNames = new Set(["Smart Algorithms Demo"]);
  for (const [key, value] of leaves(en)) {
    const translated = leaves(ru).get(key);
    if (translated !== undefined && !properNames.has(value) && /\s/u.test(value) && value.length > 20 && !/^https?:|^\//u.test(value)) assert.notEqual(translated, value, `untranslated ${key}`);
  }
});

test("V-1 survives localization: only the state WORD is localized; the bounded-count decision is unchanged", async () => {
  const bounded = (await import(new URL("../components/domain/owner-console/bounded-count.ts", import.meta.url).href)) as typeof import("../components/domain/owner-console/bounded-count");
  for (const lang of ["ru", "en"] as const) {
    const states = i18n.messages[lang].instrumentState;
    assert.deepEqual({ ...bounded.withStateLabel(bounded.attentionReading(0, true), states) }, { value: "0", state: undefined, tone: "neutral" }, `${lang}: no 'clear' over a bounded view`);
    assert.deepEqual({ ...bounded.withStateLabel(bounded.attentionReading(0, false), states) }, { value: "0", state: states.clear, tone: "success" });
    assert.deepEqual({ ...bounded.withStateLabel(bounded.attentionReading(2, true), states) }, { value: "2", state: states.action, tone: "attention" });
  }
});

// ---------------------------------------------------------------------------------------------
// AI-038.6 L10N-1: route localization coverage + reachable-link closure
// ---------------------------------------------------------------------------------------------

// EVERY human-facing page and how it is localized. A new page.tsx without an entry fails the test.
//   owner     — Owner Console dictionary (lib/i18n/messages) via getI18n()
//   prototype — prototype copy / data (lib/i18n/prototype-{pages,mock,content}) via getI18n()
// There is no "Russian-native" exception (L10N-2): every human-facing page is bilingual, and
// "contains Russian" is never evidence of localization.
// There are no redirect-only or non-UI page routes; app/api/auth/[...nextauth]/route.ts is a route
// handler, not a page.
const coverage: Readonly<Record<string, "owner" | "prototype">> = {
  "/": "owner", "/dashboard": "owner", "/attention": "owner", "/projects": "owner", "/tasks": "owner", "/tasks/[taskId]": "owner",
  "/tasks/new": "owner", "/tasks/[taskId]/development": "owner", "/runs": "owner", "/runs/[runId]": "owner", "/approvals": "owner",
  "/approvals/[approvalId]": "prototype", "/roadmap": "prototype", "/settings": "prototype", "/settings/assistants": "prototype",
  "/settings/integrations": "prototype", "/settings/operator-console": "prototype", "/settings/roles": "prototype", "/settings/security": "prototype",
  "/knowledge": "prototype", "/knowledge/[documentId]": "prototype", "/chat": "prototype", "/departments": "prototype", "/reports": "prototype",
  "/workflows": "prototype", "/workflows/runs/[runId]": "prototype", "/workflows/support-reply/run": "prototype",
  "/workflows/qa-review/run": "prototype", "/workflows/telegram-content/run": "prototype",
  "/operations": "prototype", "/workflows/codex-task/run": "prototype", "/workflows/development-plan/run": "prototype",
  "/workflows/development-execution/run": "prototype",
};

const pageRoutes = () => walk("app").filter((path) => path.endsWith("/page.tsx") || path === "app/page.tsx")
  .map((path) => ({ path, route: path === "app/page.tsx" ? "/" : `/${path.slice("app/".length, -"/page.tsx".length)}` }));

// L10N-3: the ONE bounded list of Latin words allowed inside human-facing copy that is otherwise
// localized — brands / product names and acronyms. Ordinary English words (Owner, Scheduler,
// Workspace, review, snapshot, scope…) are never on it.
// AI-039.2: "ChatGPT" is the provider's product name in the official Sign in with ChatGPT wording.
const latinNames = ["Private AI Cloud", "Smart Algorithms Demo", "Smart Algorithms", "PAC", "GitHub", "Telegram", "Codex", "Markdown", "Next.js", "Git", "Google", "Scanner", "Pro", "ChatGPT"];
const latinAcronyms = new Set(["AI", "QA", "LLM", "API", "PDF", "RAG", "MVP", "FAQ", "SEO", "CRM", "CMS", "BI", "CI", "SLA", "GPU", "PR", "ID", "NUL"]);
// Words that are not translatable UI copy in component sources (EN-side detector).
const notCopy = new Set([...latinNames.flatMap((name) => name.split(/[ .]/u)), ...latinAcronyms, "S3", "npm"]);

// Latin-word fragments inside a Russian UI string. A Latin word is NEVER accepted merely because the
// string also contains Cyrillic. Accepted: the bounded names / acronyms above, {placeholders},
// repository paths, npm / git commands, version or task ids containing digits (v0.2, AI-011), and a
// value that is in its entirety one canonical token shown as data (maxConcurrentRuns, reason.code,
// start_initial_attempt). Identifiers embedded in prose are reported.
const canonicalToken = /^(?:[a-z]+(?:[A-Z][a-z0-9]*)+|[a-z0-9]+(?:_[a-z0-9]+)+|[a-z]+(?:\.[a-z]+)+)$/u;
function latinInRussian(value: string): string[] {
  if (canonicalToken.test(value.trim())) return [];
  let text = value
    .replace(/\{[A-Za-z]+\}/gu, " ")
    .replace(/(?<![\w.])\.?[\w.-]+(?:\/[\w.-]+)+\/?(?![\w/])/gu, " ")
    .replace(/\bnpm (?:run [a-z][\w:-]*|test|ci|install)\b|\bgit [a-z]+(?: --?[a-z][\w-]*)*/gu, " ");
  for (const name of latinNames) text = text.replace(new RegExp(`(?<![A-Za-z])${name.replace(".", "\\.")}(?![A-Za-z])`, "gu"), " ");
  return (text.match(/[A-Za-z][A-Za-z0-9]*/gu) ?? []).filter((word) => !latinAcronyms.has(word) && !/[0-9]/u.test(word));
}

// English-looking UI copy inside JSX text or user-visible string props of a source file.
function englishCopy(path: string): string[] {
  const text = code(path);
  const hits: string[] = [];
  const consider = (value: string) => {
    const words = value.match(/[A-Za-z][A-Za-z'-]+/gu) ?? [];
    const copyWords = words.filter((word) => !notCopy.has(word) && !/^[a-z]+[A-Z]/u.test(word) && !/[0-9_./]/u.test(word));
    if (/^\s*[a-z]+(\.[a-z]+)+\s*$/u.test(value)) return; // dotted technical identifier (reason.code)
    if (copyWords.length >= 2 || copyWords.some((word) => /^[A-Z][a-z]{3,}$/u.test(word))) hits.push(value.trim());
  };
  // JSX text nodes: a ">" that is not part of "=>" / "->", and content that is not code.
  for (const match of text.matchAll(/(?<![=\-])>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*</gu)) {
    if (!/=>|===|;|\(\s*$|^\s*\)/u.test(match[1])) consider(match[1]);
  }
  for (const match of text.matchAll(/\b(?:title|description|label|placeholder|eyebrow|actionLabel|aria-label|alt)="([^"]*[A-Za-z][^"]*)"/gu)) consider(match[1]);
  return hits;
}

// The symmetric guard (L10N-2): Russian text hard-coded in a rendered source would leak into the
// English UI. Exactly two non-UI exceptions exist, both bounded here:
//   - the language switcher's endonym ("Русский" is shown as itself in every locale);
//   - the Codex form's executor-payload defaults (`initialInput`), which flow verbatim into the
//     generated artifact and are intentionally locale-independent.
function russianCopy(path: string): string[] {
  let text = code(path);
  if (path === "components/shell/locale-switcher.tsx") text = text.replace(/name: "Русский"/u, "");
  if (path === "components/domain/codex-task-artifact-form.tsx") text = text.replace(/const initialInput: CodexTaskArtifactInput = \{[\s\S]*?\n\};\n/u, "");
  return text.split("\n").filter((line) => /[А-Яа-яЁё]/u.test(line)).map((line) => line.trim());
}

// The page plus the app components it imports (transitively, components/** only).
function renderedSources(page: string): string[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const match of code(path).matchAll(/from\s+["']@\/(components\/[^"']+)["']/gu)) {
      const candidate = `${match[1]}.tsx`;
      if (existsSync(join(root, candidate))) visit(candidate);
    }
  };
  visit(page);
  return [...seen];
}

test("L10N-1 coverage: every app page is inventoried and renders no English-only UI copy in its sources", () => {
  const pages = pageRoutes();
  assert.deepEqual(pages.map((page) => page.route).sort(), Object.keys(coverage).sort(), "inventory matches app/**/page.tsx exactly");
  for (const { path, route } of pages) {
    const text = code(path);
    const kind = coverage[route];
    if (kind === "owner") assert.match(text, /await getI18n\(\)/u, `${route} resolves the locale`);
    if (kind === "prototype") {
      assert.match(text, /await getI18n\(\)/u, `${route} resolves the locale`);
      assert.match(text, /prototype(Pages|Content|Mock)\[locale\]/u, `${route} reads localized prototype copy`);
    }
    for (const source of renderedSources(path)) {
      assert.deepEqual(englishCopy(source), [], `${route}: hard-coded English UI copy in ${source}`);
      assert.deepEqual(russianCopy(source), [], `${route}: hard-coded Russian UI copy in ${source}`);
    }
  }
});

test("L10N-2 symmetric guard: no ru-native exception, and the former Russian-native routes read every UI string from a locale dictionary", () => {
  assert.ok(!Object.values(coverage).includes("ru-native" as never), "no ru-native category");
  const former = {
    "/operations": ["app/operations/page.tsx", "components/domain/project-operations-center.tsx", "operations"],
    "/workflows/codex-task/run": ["app/workflows/codex-task/run/page.tsx", "components/domain/codex-task-artifact-form.tsx", "codexForm"],
    "/workflows/development-plan/run": ["app/workflows/development-plan/run/page.tsx", "components/domain/development-plan-simulator.tsx", "devPlan"],
    "/workflows/development-execution/run": ["app/workflows/development-execution/run/page.tsx", "components/domain/development-execution-simulator.tsx", "devExec"],
  } as const;
  for (const [route, [page, component, section]] of Object.entries(former)) {
    assert.equal(coverage[route], "prototype", route);
    assert.match(code(page), new RegExp(`prototypePages\\[locale\\]\\.${section}`, "u"), `${route} selects its ${section} copy by locale`);
    assert.ok(renderedSources(page).includes(component), `${route} renders ${component}`);
    assert.deepEqual(russianCopy(page), [], `${route}: page has no hard-coded Russian`);
    assert.deepEqual(russianCopy(component), [], `${route}: component has no hard-coded Russian`);
    assert.deepEqual(englishCopy(component), [], `${route}: component has no hard-coded English`);
  }
  // The guard is not vacuous: the original Russian-native sources would fail it.
  assert.notDeepEqual(russianCopy("components/domain/project-control-center.tsx"), [], "detector sanity: an unlocalized Russian source is reported");
});

test("L10N-2 demo text maps are exhaustive: no Russian demo string can fall back into the English UI", async () => {
  const pagesModule = (await import(new URL("../lib/i18n/prototype-pages.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-pages");
  const exec = (await import(new URL("../lib/development-execution-demo.ts", import.meta.url).href)) as typeof import("../lib/development-execution-demo");
  const plan = (await import(new URL("../lib/development-plan-demo.ts", import.meta.url).href)) as typeof import("../lib/development-plan-demo");
  const cyrillic = /[А-Яа-яЁё]/u;
  const sorted = (value: object) => Object.keys(value).sort();
  for (const lang of ["ru", "en"] as const) {
    const c = pagesModule.prototypePages[lang];
    // Execution: every scenario, every step string and the fail-closed error messages.
    assert.deepEqual(sorted(c.devExec.scenarios), exec.developmentExecutionDemoScenarios.map((s) => s.id).sort());
    assert.deepEqual(sorted(c.devExec.statuses), sorted(exec.developmentExecutionDemoStatusLabels));
    assert.deepEqual(sorted(c.devExec.nextActions), sorted(exec.developmentExecutionDemoNextActionLabels));
    assert.deepEqual(sorted(c.devExec.reasons), sorted(exec.developmentExecutionDemoReasonLabels));
    const stepText = c.devExec.stepText as Readonly<Record<string, string>>;
    const produced = new Set<string>();
    for (const scenario of exec.developmentExecutionDemoScenarios) {
      const result = exec.createDevelopmentExecutionDemoScenario(scenario.id);
      assert.equal(result.ok, true, scenario.id);
      if (!result.ok) continue;
      for (const step of result.value.steps) {
        for (const value of [step.title, step.description, step.checkedSummary, step.retryExplanation, step.nextDescription, step.failureReason]) if (value) produced.add(value);
      }
    }
    const unknown = exec.createDevelopmentExecutionDemoScenario("not-a-scenario" as never);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) produced.add(unknown.error.message);
    assert.ok(produced.size >= 60, "the enumeration reaches every step string");
    for (const value of produced) assert.ok(Object.hasOwn(stepText, value), `${lang}: untranslated execution demo string ${JSON.stringify(value)}`);
    // Build-error messages other than the unknown-scenario one are only reachable on a corrupted
    // snapshot; they are matched against the demo source so no map key is stale.
    const demoSource = source("lib/development-execution-demo.ts");
    for (const key of Object.keys(stepText)) assert.ok(produced.has(key) || demoSource.includes(`"${key}"`), `${lang}: stale stepText key ${key}`);
    // Plan: scenarios, tasks across every scenario, verdicts and reason codes.
    assert.deepEqual(sorted(c.devPlan.scenarios), plan.developmentPlanDemoScenarios.map((s) => s.id).sort());
    assert.deepEqual(sorted(c.devPlan.verdicts), sorted(plan.developmentPlanDemoVerdictLabels));
    assert.deepEqual(sorted(c.devPlan.reasons), sorted(plan.developmentPlanDemoReasonLabels));
    for (const scenario of plan.developmentPlanDemoScenarios) {
      const result = plan.evaluateDevelopmentPlanDemoScenario(scenario.id, false);
      assert.equal(result.plan.id, "development-plan-simulator", "plan title / goal are presented through planText");
      for (const task of result.plan.tasks) assert.ok(Object.hasOwn(c.devPlan.tasks, task.id), `${lang}: task ${task.id}`);
      assert.ok(Object.hasOwn(c.devPlan.planStatus, result.plan.status), `${lang}: plan status ${result.plan.status}`);
      for (const task of result.plan.tasks) assert.ok(Object.hasOwn(c.devPlan.riskLevels, task.riskLevel), `${lang}: risk ${task.riskLevel}`);
    }
    // Operations: every unavailable title and every owner-facing scheduler reason code.
    const opsSource = source("lib/project-operations-demo.ts");
    const titles = new Set([...opsSource.matchAll(/unavailable(?:Snapshot)?\(\s*[^,]+,\s*(?:[^,]+,\s*)?"([^"]+)"/gu)].map((m) => m[1]));
    assert.ok(titles.size >= 4, "every unavailable title is enumerated");
    for (const title of titles) assert.ok(Object.hasOwn(c.operations.unavailableTitles, title), `${lang}: unavailable title ${title}`);
    const messageMap = opsSource.slice(opsSource.indexOf("workspace_concurrency_exceeded:"));
    const codes = messageMap.slice(0, messageMap.indexOf("};")).match(/^\s+([a-z_]+): "/gmu)!.map((m) => m.trim().slice(0, -3));
    for (const reasonCode of codes) assert.ok(Object.hasOwn(c.operations.ownerMessages, reasonCode), `${lang}: owner message ${reasonCode}`);
    // The English side of every L10N-2 section carries no Russian (only the RU-text lookup keys do).
    if (lang === "en") {
      for (const section of ["operations", "codexForm", "devPlan", "devExec"] as const) {
        for (const [key, value] of leaves(c[section])) {
          if (key.startsWith("unavailableTitles.") || key.startsWith("stepText.")) continue;
          assert.ok(!cyrillic.test(value), `en.${section}.${key} contains Russian: ${value}`);
        }
      }
      for (const value of Object.values(stepText)) assert.ok(!cyrillic.test(value), `en stepText: ${value}`);
      for (const value of Object.values(c.operations.unavailableTitles)) assert.ok(!cyrillic.test(value), `en unavailable title: ${value}`);
    } else {
      // RU keeps the demo's own accepted wording verbatim, except where that wording mixes in Latin
      // prose (L10N-3): then the RU value differs and is natural Russian.
      const keepsOrNaturalizes = (demo: string, value: string, label: string) => {
        assert.deepEqual(latinInRussian(value), [], `${label}: Latin in RU ${JSON.stringify(value)}`);
        if (latinInRussian(demo).length === 0) assert.equal(value, demo, `${label}: accepted RU wording changed`);
      };
      const pairs = (demo: object, ruMap: object, label: string) => {
        for (const [key, demoValue] of Object.entries(demo)) keepsOrNaturalizes(demoValue as string, (ruMap as Record<string, string>)[key], `${label}.${key}`);
      };
      pairs(exec.developmentExecutionDemoStatusLabels, c.devExec.statuses, "devExec.statuses");
      pairs(exec.developmentExecutionDemoNextActionLabels, c.devExec.nextActions, "devExec.nextActions");
      pairs(exec.developmentExecutionDemoReasonLabels, c.devExec.reasons, "devExec.reasons");
      pairs(plan.developmentPlanDemoReasonLabels, c.devPlan.reasons, "devPlan.reasons");
      pairs(plan.developmentPlanDemoVerdictLabels, c.devPlan.verdicts, "devPlan.verdicts");
      for (const [key, value] of Object.entries(stepText)) keepsOrNaturalizes(key, value, "devExec.stepText");
      for (const scenario of exec.developmentExecutionDemoScenarios) {
        keepsOrNaturalizes(scenario.title, c.devExec.scenarios[scenario.id][0], `devExec.scenarios.${scenario.id}`);
        keepsOrNaturalizes(scenario.description, c.devExec.scenarios[scenario.id][1], `devExec.scenarios.${scenario.id}`);
      }
    }
  }
});

// Leaves of the RU data mirrors (prototype-mock / prototype-content) that are canonical structure,
// not copy: ids, hrefs, status / tone / risk tokens copied from the English data. Exempt only while
// identical to English; plus two explicit token leaves (priority notation, department status tokens).
const structuralKeys = new Set(["id", "href", "landing", "status", "statusTone", "riskTone", "riskLevel", "tone", "availability", "templateCode", "confidence", "role"]);
const structuralPaths = [/^table\.priorityUnset$/u, /^departments\.summary\.\d+\.0$/u];

test("L10N-3 Latin detector: bounded allowlist, mixed prose is reported", () => {
  for (const bad of ["Owner-facing обзор", "Decision вычислен", "planned dispatches отсутствуют", "Действующий maxConcurrentRuns", "Нет blocked reasons в выбранном scope.",
    "Проверки и review", "В snapshot сохранены", "Подготовка handoff", "Owner", "Scheduler недоступен", "Email", "GitHub issues", "Подтверждение Owner", "Pro-level review"]) {
    assert.notDeepEqual(latinInRussian(bad), [], `must be reported: ${bad}`);
  }
  for (const good of ["Private AI Cloud", "Запустить Codex", "GitHub", "RAG", "reason.code", "maxConcurrentRuns", "start_initial_attempt", "AI-отдел QA / код-ревью",
    "Путь .git/config запрещён политикой системы.", "Попытка {n} из 3", "Фокус MVP", "запланировано в v0.2", "планом AI‑017", "Git-команды не выполняются",
    "npm run lint; npm run build", "Smart Algorithms Demo", "GitHub / Google Диск / Яндекс / S3", "Чек-лист MVP Scanner"]) {
    assert.deepEqual(latinInRussian(good), [], `must be accepted: ${good}`);
  }
});

test("L10N-3 natural Russian: no Latin prose fragments in any RU presentation dictionary", async () => {
  const pagesModule = (await import(new URL("../lib/i18n/prototype-pages.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-pages");
  const mockModule = (await import(new URL("../lib/i18n/prototype-mock.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-mock");
  const dictionaries = {
    messages: [i18n.messages.ru, i18n.messages.en],
    "prototype-content": [prototype.prototypeContent.ru, prototype.prototypeContent.en],
    "prototype-pages": [pagesModule.prototypePages.ru, pagesModule.prototypePages.en],
    "prototype-mock": [mockModule.prototypeMock.ru, mockModule.prototypeMock.en],
  } as const;
  const found: string[] = [];
  let checked = 0;
  for (const [name, [ru, en]] of Object.entries(dictionaries)) {
    const enLeaves = leaves(en);
    for (const [path, value] of leaves(ru)) {
      const dataMirror = name === "prototype-mock" || name === "prototype-content";
      if ((dataMirror && structuralKeys.has(path.split(".").at(-1)!) && value === enLeaves.get(path)) || structuralPaths.some((pattern) => pattern.test(path))) {
        assert.equal(value, enLeaves.get(path), `${name}.${path}: a structural token must equal English`);
        continue;
      }
      checked += 1;
      const latin = latinInRussian(value);
      if (latin.length > 0) found.push(`${name}.${path}: [${latin.join(", ")}] ${JSON.stringify(value)}`);
    }
  }
  assert.ok(checked > 1500, `the scan reaches every RU leaf (${checked})`);
  assert.deepEqual(found, [], "RU UI prose must be natural Russian");
});

test("L10N-2 artifact boundary: the Codex executor payload is locale-independent", () => {
  for (const path of ["lib/codex-task-artifact.ts", "lib/codex-task-form-policy.ts"]) {
    assert.ok(!/i18n|locale/u.test(code(path)), `${path} does not depend on the UI locale`);
  }
  const form = code("components/domain/codex-task-artifact-form.tsx");
  const defaults = form.match(/const initialInput: CodexTaskArtifactInput = \{[\s\S]*?\n\};\n/u)?.[0] ?? "";
  assert.ok(defaults.length > 0 && !/\bc\./u.test(defaults), "payload defaults are literal, never taken from UI copy");
  // The artifact is built from the field values only; the copy never reaches the builder.
  assert.match(form, /buildEffectiveCodexTaskInput\(\s*input,\s*pathSelectionMode,\s*\)/u);
  assert.match(form, /createCodexTaskArtifact\(effectiveInput\)/u);
  assert.match(form, /writeText\(artifact\.prompt\)/u);
  assert.match(form, /new Blob\(\[artifact\.markdown\]/u);
});

test("L10N-1 data: Russian prototype copy and data mirror English exactly and are translated", async () => {
  const pagesModule = (await import(new URL("../lib/i18n/prototype-pages.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-pages");
  const mockModule = (await import(new URL("../lib/i18n/prototype-mock.ts", import.meta.url).href)) as typeof import("../lib/i18n/prototype-mock");
  const enPages = leaves(pagesModule.prototypePages.en);
  const ruPages = leaves(pagesModule.prototypePages.ru);
  assert.deepEqual([...ruPages.keys()].sort(), [...enPages.keys()].sort(), "prototype page copy key parity");
  for (const [key, value] of enPages) {
    assert.deepEqual(placeholders(ruPages.get(key)!), placeholders(value), key);
    if (/\s/u.test(value) && value.length > 14 && !/^[A-Z][\w-]+ \/|GitHub \/|·/u.test(value)) assert.notEqual(ruPages.get(key), value, `untranslated ${key}`);
  }
  const { en, ru } = mockModule.prototypeMock;
  // Structure, ids, hrefs, status tokens, tones and flags are identical; only text differs.
  const shape = (content: typeof en) => ({
    documents: content.documents.map((d) => [d.id, d.status, d.statusTone]),
    groups: content.workflowGroups.map((g) => [g.id, g.workflows.map((w) => [w.availability, w.href ?? null, w.approvalRequired, w.externalActionLocked])]),
    runs: content.workflowRuns.map((r) => [r.id, r.status, r.statusTone, r.templateCode]),
    approvals: content.approvals.map((a) => [a.id, a.status, a.riskLevel, a.riskTone, a.statusTone]),
    reports: content.reports.map((r) => [r.id, r.status, r.metrics.length]),
    departments: content.departments.map((d) => [d.id, d.status, d.keyWorkflows.length, d.integrationsLater.length]),
    previews: Object.entries(content.workflowPreviews).map(([key, preview]) => [key, preview.sections.map((section) => section.tone ?? null)]),
    lifecycle: content.workflowLifecycleSteps.map((step) => step.status),
  });
  assert.deepEqual(shape(ru), shape(en));
  assert.notEqual(ru.approvals[0].title, en.approvals[0].title);
  assert.notEqual(ru.workflowGroups[0].workflows[1].description, en.workflowGroups[0].workflows[1].description);
  for (const lang of ["ru", "en"] as const) {
    const labels = mockModule.prototypeMock[lang].labels;
    assert.deepEqual(Object.keys(labels.runStatus).sort(), [...domain.workflowRunStatuses].sort());
    assert.deepEqual(Object.keys(labels.approvalStatus).sort(), [...domain.approvalStatuses].sort());
  }
});

test("L10N-1 link closure: internal links from localized surfaces only reach inventoried (localized) routes", async () => {
  const mockData = (await import(new URL("../lib/mock-data.ts", import.meta.url).href)) as typeof import("../lib/mock-data");
  const roles = (await import(new URL("../lib/roles.ts", import.meta.url).href)) as typeof import("../lib/roles");
  const routes = Object.keys(coverage).map((route) => new RegExp(`^${route.replace(/\[[^\]]+\]/gu, "[^/?#]+")}$`, "u"));
  const covered = (href: string) => routes.some((pattern) => pattern.test(href.split(/[?#]/u)[0]));
  const targets = new Set<string>();
  for (const item of mockData.settingsModules) targets.add(item.href);
  for (const item of mockData.quickActions) targets.add(item.href);
  for (const item of mockData.workflowTemplates) targets.add(item.href);
  for (const group of mockData.workflowGroups) for (const workflow of group.workflows) if (workflow.href) targets.add(workflow.href);
  for (const role of roles.roles) targets.add(role.landing);
  for (const section of navigation.ownerNavigation) for (const item of section.items) if (item.available) targets.add(item.href);
  for (const path of [...walk("app"), ...walk("components")].filter((file) => /\.tsx$/u.test(file))) {
    for (const match of code(path).matchAll(/href[=:]\s*\{?\s*["'`](\/[A-Za-z0-9/_\-[\]]*)(\$\{)?/gu)) {
      if (match[1].startsWith("/api/")) continue;
      // `/tasks/${id}` → a dynamic segment of that route.
      targets.add(match[2] && match[1].endsWith("/") ? `${match[1]}x` : match[1]);
    }
  }
  assert.ok(targets.has("/knowledge"), "Settings → /knowledge is part of the closure");
  assert.ok(covered("/knowledge"));
  assert.deepEqual([...targets].filter((href) => !covered(href)).sort(), [], "every internal link target is a localized route");
});
