import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const navigation = require("next/navigation");
const { documents } = await import(new URL("../lib/mock-data.ts", import.meta.url).href);

function loadPage(locale: "en" | "ru" = "en") {
  const source = readFileSync(new URL("../app/knowledge/[documentId]/page.tsx", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports: string[] = [];
  let localeReads = 0;
  // Retain the old presentation dependencies so RED reaches the actual fallback,
  // rather than failing to import the vulnerable page. No real shell/DB is loaded.
  const modules: Record<string, unknown> = {
    "next/navigation": navigation,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/domain/audit-timeline": { AuditTimeline: () => null },
    "@/components/shell/app-shell": { AppShell: () => null },
    "@/components/ui/page-header": { PageHeader: () => null },
    "@/components/ui/section-card": { SectionCard: () => null },
    "@/components/ui/status-badge": { StatusBadge: () => null },
    "@/lib/i18n/locale.server": { getI18n: async () => { localeReads++; return { locale }; } },
    "@/lib/i18n/prototype-mock": { prototypeMock: {
      [locale]: { documents, auditEvents: [], labels: { documentStatus: {} } },
    } },
    "@/lib/i18n/prototype-pages": { prototypePages: { [locale]: { document: {} } } },
  };
  const compiled: { exports: { default?: (props?: unknown) => unknown } } = { exports: {} };
  new Function("require", "module", "exports", javascript)((name: string) => {
    imports.push(name);
    assert(Object.hasOwn(modules, name), `Unexpected route dependency: ${name}`);
    return modules[name];
  }, compiled, compiled.exports);
  assert.equal(typeof compiled.exports.default, "function");
  return { page: compiled.exports.default!, imports, localeReads: () => localeReads };
}

async function rejectsAsNotFound(page: (props?: unknown) => unknown, props?: unknown) {
  await assert.rejects(Promise.resolve().then(() => page(props)), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal("digest" in error ? error.digest : undefined, "NEXT_HTTP_ERROR_FALLBACK;404");
    return true;
  });
}

test("legacy known document IDs terminate with the real Next notFound signal in both locales", async () => {
  assert(documents.length > 0);
  for (const locale of ["en", "ru"] as const) {
    const { page } = loadPage(locale);
    for (const document of documents) await rejectsAsNotFound(page, { params: Promise.resolve({ documentId: document.id }) });
  }
});

test("unknown and project-like document IDs never select fallback or real content", async () => {
  const { page } = loadPage();
  for (const documentId of ["unknown-document", "robotbank", "00000000-0000-4000-8000-000000000001", "../private.md"]) {
    await rejectsAsNotFound(page, { params: Promise.resolve({ documentId }) });
  }
});

test("anonymous invocation cannot render legacy content", async () => {
  const { page } = loadPage();
  await rejectsAsNotFound(page, { params: Promise.resolve({ documentId: documents[0].id }), session: null });
});

test("retired route does not inspect untrusted selectors or a supplied identity", async () => {
  const { page } = loadPage();
  let reads = 0;
  const props = Object.defineProperties({}, {
    params: { get() { reads++; throw Error("must not read private params"); } },
    session: { get() { reads++; throw Error("must not read private identity"); } },
  });
  await rejectsAsNotFound(page, props);
  assert.equal(reads, 0);
});

test("retired route loads only Next navigation, without shell, auth, storage or egress capabilities", async () => {
  const route = loadPage();
  await rejectsAsNotFound(route.page);
  assert.deepEqual(route.imports, ["next/navigation"]);
  assert.equal(route.localeReads(), 0);
});
