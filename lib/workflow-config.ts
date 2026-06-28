import type { WorkflowPreview } from "@/types/workflow";

export const workflowPreviews: Record<string, WorkflowPreview> = {
  "support-reply": {
    title: "Support Reply preview",
    sections: [
      {
        title: "Classification",
        content:
          "Question classified as Scanner onboarding / checklist mismatch. Priority: medium.",
        tone: "info",
      },
      {
        title: "Generated answer",
        content:
          "The Scanner MVP checklist expects local validation first, then indexing status review, then an owner approval before publishing a customer-facing answer.",
        tone: "success",
      },
      {
        title: "Safety note",
        content:
          "External send is disabled in the MVP prototype. This reply must be copied manually after approval.",
        tone: "warning",
      },
    ],
    sources: [
      {
        id: "src-support-faq",
        title: "Support FAQ",
        collection: "Support",
        excerpt:
          "Customer-facing replies must reference indexed support knowledge and avoid unverified operational claims.",
        confidence: "High",
      },
    ],
  },
  "telegram-content": {
    title: "Telegram Content preview",
    sections: [
      {
        title: "Generated post draft",
        content:
          "Private AI Cloud turns internal documents into controlled AI operations: ask, generate, approve, and only then act.",
        tone: "success",
      },
      {
        title: "Risk check",
        content:
          "Medium risk: public channel. Requires owner approval and manual publish in MVP.",
        tone: "warning",
      },
    ],
  },
  "codex-task": {
    title: "Product / Codex Task preview",
    sections: [
      {
        title: "Codex prompt",
        content:
          "Create a static Next.js prototype page for approval details using mocked approval data and no backend integrations.",
        tone: "info",
      },
      {
        title: "Markdown task",
        content:
          "Implement UI only. Include status badges, before/after preview, comments placeholder, and disabled approve/reject actions.",
        tone: "success",
      },
      {
        title: "Acceptance criteria",
        content:
          "Page renders with mock data, follows shell layout, passes lint and build.",
        tone: "neutral",
      },
      {
        title: "Verify commands",
        content: "npm run lint; npm run build",
        tone: "neutral",
      },
    ],
  },
  "qa-review": {
    title: "QA / Review Report preview",
    sections: [
      {
        title: "Changed files",
        content:
          "app/approvals/page.tsx, components/domain/approval-card.tsx, lib/mock-data.ts",
        tone: "info",
      },
      {
        title: "Risks",
        content:
          "Mock-only implementation is safe. Verify disabled buttons are clearly non-executing.",
        tone: "warning",
      },
      {
        title: "Failed checks",
        content: "No failed checks in the provided mock log.",
        tone: "success",
      },
      {
        title: "Recommendation",
        content: "Approve for prototype branch after lint/build pass.",
        tone: "success",
      },
    ],
  },
};
