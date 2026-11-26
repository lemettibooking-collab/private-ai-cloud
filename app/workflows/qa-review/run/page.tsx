import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { WorkflowRunForm } from "@/components/domain/workflow-run-form";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

// Which fields are multi-line (presentation shape; the copy is localized).
const textareaFields = [true, true];

export default async function QaReviewRunPage() {
  const { locale } = await getI18n();
  const pages = prototypePages[locale].runPages;
  const c = pages.qa;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={pages.eyebrow}
        title={c.title}
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <WorkflowRunForm
          description={c.formDescription}
          fields={c.fields.map(([label, placeholder], index) => ({ label, placeholder, textarea: textareaFields[index] }))}
          preview={prototypeMock[locale].workflowPreviews["qa-review"]}
          title={c.formTitle}
        />
      </div>
    </AppShell>
  );
}
