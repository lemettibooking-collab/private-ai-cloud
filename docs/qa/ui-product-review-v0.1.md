# Private AI Cloud UI Product Review v0.1

Date: 2026-06-28

Scope: product QA / UX review of the current frontend-only prototype against Product Blueprint v0.2, `private-ai-cloud-ui-blueprint.md`, `workflow-engine-blueprint.md`, and `twenty-reference-analysis.md`.

No code or UI changes were made for this review.

## Executive Summary

The prototype now communicates the core product direction: Private AI Cloud is an AI Operations Center for Smart Algorithms, not a CRM. The strongest areas are the approval-first posture, all 10 AI Departments, the department-grouped workflow catalog, and the Owner-oriented dashboard.

Main gaps are product framing and prioritization, not raw coverage. Several required concepts exist only as settings cards or mock labels, so they are technically visible but not yet clear enough as product surfaces. The biggest UX risk is that `/workflows` and `/departments` expose many future capabilities at once, which may blur MVP scope for a first-time viewer.

Overall status: mostly covered, with important P1 clarity work recommended before demo polish.

## 1. Blueprint Coverage

| Blueprint area | Where represented | Status | What to improve |
|---|---|---:|---|
| Core Platform | `/settings`, sidebar shell, topbar, `settingsModules` | covered | Add a compact "Core Platform map" that explains workspace, roles, knowledge, approvals, audit, and integrations as one system. |
| AI Departments | `/departments`, `/settings/assistants`, `/workflows` | covered | Add department filters or tabs; current full grid is complete but dense. |
| Infrastructure Layer | `/settings`, `/settings/operator-console`, `/dashboard` System Health | partially covered | Infrastructure is visible as mock status, but not yet a coherent layer. Add app/worker/indexer/storage/integration status rows. |
| Managed Service | `/settings` Managed Service Settings card | partially covered | Present only as a planned card. Needs managed-service boundaries: support, backups, operator access, SLA later. |
| Company Workspace | Topbar, sidebar, `/settings` Company Workspace | covered | Strong enough; keep Smart Algorithms Demo as first-viewport signal on dashboard/settings. |
| Knowledge Base | `/knowledge`, `/dashboard`, `/chat` citations | covered | Good coverage; add clearer document lifecycle: uploaded -> parsed -> indexed -> failed/ready. |
| RAG Chat | `/chat`, sidebar label `RAG Chat` | covered | Strong core cues; improve answer/source layout hierarchy and add visible input composer placeholder. |
| Document Intelligence | `/knowledge` document versions, source management; Legal department future | partially covered | The term itself is not visible. Add a Document Intelligence card tying summary/risk/version compare to future Legal/Document workflows. |
| Workflow Engine | `/workflows`, run routes, recent runs on `/dashboard` | covered | Add a small "run lifecycle" strip: draft, generated, waiting approval, approved, executed/manual. |
| AI Assistants | `/departments`, `/settings/assistants`, `/chat` selector | covered | Chat selector currently shows first six assistants only; make it clear this is a selected shortlist. |
| Integrations Hub | `/settings/integrations`, `/settings`, approvals locked external actions | covered | Good enough for prototype; keep external action locks visually consistent. |
| Security, Audit & Compliance | `/settings/security`, `/approvals`, audit timeline on dashboard | covered | Add audit event examples beyond support reply: publish, local checks, Codex launch. |
| Operator Console | `/settings/operator-console`, System Health | partially covered | Good placeholder, but not linked strongly from dashboard risks/queues. |

## 2. AI Departments Coverage

| Department | Where shown | Workflows linked | Status | Clarity | Improve |
|---|---|---|---:|---|---|
| AI Support Department | `/departments`, `/workflows`, `/chat`, `/approvals` | Knowledge Base Answer, Support Reply | MVP active | clear | Add support-specific knowledge gaps and escalation examples. |
| AI Marketing & Growth Department | `/departments`, `/workflows`, `/reports`, `/approvals` | Telegram Content, Marketing Hook / Pain Mining, Content Plan, Growth Report | MVP active | clear | Separate active Telegram Content from planned marketing/growth analytics. |
| AI Community Engagement Department | `/departments`, `/workflows` | Discussion Monitoring, Official Comment Draft, Reputation Monitoring | v0.2 planned | mostly clear | Mark as public-channel future lane to avoid MVP confusion. |
| AI Sales Department | `/departments`, `/workflows`, `/approvals`, `/reports` | Lead Intake, Lead Qualification, Follow-up Draft, Commercial Proposal Draft | v0.2 planned | clear but CRM-adjacent | Keep sales framed as approval-gated AI operations, not CRM records. |
| AI Customer Success / Upsell Department | `/departments`, `/workflows` | User Activity Analysis, Churn Risk Detection, Pro Potential Detection, Upsell Message Draft, Onboarding Recommendation | v0.2 planned | clear | Explain required future data source, since usage analytics are not present. |
| AI Product Department | `/departments`, `/workflows`, `/dashboard`, `/reports` | Product / Codex Task, Feature Request Analysis, Roadmap Grouping, User Story Draft, Release Checklist | MVP active | clear | Add visible roadmap v0.1/v0.2/v0.3/v1.0/v2.0 summary. |
| AI Development / Codex Orchestration Department | `/departments`, `/workflows`, `/approvals`, `/settings/assistants` | Codex Task Prompt, Handoff Summary, Result Collection | MVP active | clear | Add stronger distinction between creating a Codex task and launching Codex. |
| AI QA / Code Review Department | `/departments`, `/workflows`, `/approvals`, `/reports` | QA Review Report, Diff Risk Analysis, Manual QA Checklist, Browser Smoke Checklist | MVP active | clear | Add manual QA/browser smoke examples to dashboard or reports. |
| AI Executive Analytics Department | `/departments`, `/workflows`, `/dashboard`, `/reports` | Weekly Owner Report, Daily Report later, Decision Points Summary | MVP active | clear | Owner Report should have a more executive summary layout, not only report cards. |
| AI Legal / Document Department | `/departments`, `/workflows` | Document Summary, Risk Extraction, Version Compare, Lawyer Questions Draft | future | clear | Tie it to Document Intelligence on `/knowledge` and mark future strongly. |

All 10 departments are represented. Status distinction is visible, but the department page would benefit from filters for MVP active / v0.2 planned / future.

## 3. MVP Smart Algorithms Coverage

| MVP module | Status | Evidence | Notes |
|---|---:|---|---|
| Knowledge Base | covered | `/knowledge`, `/dashboard` indexing health | Good source-first posture. |
| RAG Chat | covered | `/chat` answer/source/no-data/actions | Needs a clearer chat input affordance. |
| Support Assistant | covered | `/departments`, `/chat`, Support Reply workflow | Strong. |
| Telegram / Content Assistant | covered | `/departments`, `/workflows`, approvals | Strong. |
| Marketing Hook / Pain Mining Assistant | partially covered | Marketing workflow group | Workflow exists as planned, but assistant is folded into Content Assistant. |
| Sales / Lead Assistant | partially covered | Sales department, Lead follow-up approval, Leads Summary | Present as planned; not part of MVP active. |
| Product Assistant | covered | Product department, Product / Codex Task | Strong. |
| Codex Task Assistant | covered | Codex Orchestrator, Codex Task workflow, Codex launch approval | Strong but terminology varies. |
| QA / Code Review Assistant | covered | QA department and QA Review workflow | Strong. |
| Admin Approval Queue | covered | `/approvals`, dashboard Pending Approvals | Strong. |

First workflows: Knowledge Base, Support Reply, Telegram Content, Product / Codex Task, and QA / Review Report are all present and active in `/workflows`.

## 4. Dashboard Review

Status: covered.

Present: Ask Knowledge Base, Create Support Reply, Create Telegram Post, Create Codex Task, Review Code / Diff, Pending Approvals, Weekly Owner Report, Activity Summary, Risk / Attention Items.

What works well:

- The dashboard reads as an Owner decision center rather than a neutral stats page.
- Quick actions align with the MVP workflow set.
- System Health and Owner attention center make the approval-first policy visible.
- Smart Algorithms Demo is visible in the page title and shell.

What is unclear:

- Pending approval count says 9, but the Weekly Owner Report metric still says 5 pending approvals in mock data.
- Owner attention items are static and not visually linked to the relevant approval/workflow/document rows.
- "Weekly Owner Report preview" is useful, but it is visually secondary; in an Owner dashboard it could be a stronger decision artifact.

What is overloaded:

- Quick actions, stats, owner attention, approvals, activity, system health, runs, outputs, risks, and report preview all appear on one page. It is comprehensive but dense.

What to strengthen:

- Add a top "Today for Owner" strip: approve, investigate, decide.
- Link risk items to a source: approval id, document id, run id.
- Promote Weekly Owner Report into a decision summary with blockers and recommended actions.

## 5. Knowledge Base Review

Status: mostly covered.

Visible:

- Upload files: covered as disabled prototype upload.
- Collections: covered.
- Tags: covered.
- Document versions: partially covered as planned card.
- Search: partially covered as visual placeholder.
- Indexing: covered through statuses and Indexing Queue.
- Source management: covered as card.
- Collection permissions: covered.
- Knowledge base update: covered as card.
- RAG readiness: covered.

Missing / partial:

- Search is not interactive, which is acceptable for prototype but should be visually labeled as mock search.
- Document versions do not show an example version list.
- Document Intelligence is implied but not explicitly named.
- Source preview/detail is mostly in document cards and drawer placeholder, not a clear document detail view.

## 6. RAG Chat Review

Status: covered.

Visible:

- Answers with sources: covered.
- Source cards: covered.
- No-data state: covered.
- Selected collections: covered.
- Chat history: covered.
- Save useful answer: covered.
- Quality rating: covered.
- Export answer: covered.
- Send to workflow: covered.

UX notes:

- The page communicates RAG Chat well.
- The assistant selector only shows six profiles while the platform has ten departments; that may be okay, but the UI should say "available in chat" or "shortlist".
- There is no visible message input composer; for a chat surface, this makes the prototype feel more like a review page than a usable chat.

## 7. Workflows Review

Status: covered.

Visible:

- MVP workflows: covered.
- Planned/future workflows: covered.
- Grouping by departments: covered.
- Approval requirement: covered.
- Locked external actions: covered.
- Active/planned/future distinction: covered.

Overload risk:

- This is the densest page in the prototype. It exposes all v0.2/future lanes immediately, which proves coverage but can make MVP scope feel less focused.
- Planned and future items use the same disabled button text, "Planned / locked", even when the workflow is future rather than locked.

Recommended UX:

- Add tabs or segmented filters: MVP active, v0.2 planned, future.
- Collapse non-MVP groups by default or put them below a roadmap section.
- Use button labels that match state: "Planned", "Future", "Locked".

## 8. Approvals Review

Status: covered.

Approval rules visible:

- Telegram post publication: covered.
- Support reply beyond FAQ: covered.
- Lead follow-up: covered.
- Codex task creation: covered.
- Codex launch: covered.
- Local checks run: covered.
- External integration action: covered.
- Code acceptance: covered.
- Merge manual outside system: covered.

Locked-by-default clarity:

- Strong. The policy card, risk badges, disabled action buttons, and preview copy all reinforce that external actions are locked.

UX notes:

- The approval detail placeholder is useful but generic. It should show one concrete selected approval with original/edited/final payload examples.
- The queue cards are complete but repetitive; a table/list mode may scan better once there are 9 examples.

## 9. Reports Review

Status: covered.

Reports visible:

- Weekly Owner Report: covered.
- Daily Report planned: covered.
- Support Summary: covered.
- Leads Summary: covered.
- Marketing Summary: covered.
- Product Summary: covered.
- Development Summary: covered.
- QA / Code Review Summary: covered.
- Blockers: covered.
- Recommendations: covered.
- Owner Decision Points: covered.
- System Usage Summary: covered.

UX notes:

- Coverage is complete.
- Executive Analytics framing is present, but the page still reads as a report catalog. A highlighted "latest Weekly Owner Report" with blockers/recommendations/decision points would make it more owner-grade.
- Roadmap v0.1/v0.2/v0.3/v1.0/v2.0 is not visible here or elsewhere.

## 10. Settings Review

Status: mostly covered.

Visible:

- Company Workspace: covered.
- Users: covered as settings module.
- Roles & Permissions: covered and linked to `/settings/roles`.
- Knowledge Collections Access: covered as planned module and `/knowledge` permissions.
- AI Assistants: covered via `/settings/assistants`.
- Integrations Hub: covered and linked to `/settings/integrations`.
- Security, Audit & Compliance: covered via `/settings/security`.
- Operator Console: covered via `/settings/operator-console`.
- Usage Limits: partially covered as planned card.
- Infrastructure Status: partially covered as settings card plus dashboard health.
- Managed Service Settings: partially covered as planned card.

Subpage notes:

- `/settings/assistants`: good registry, but lacks model/tool/permission columns.
- `/settings/security`: good policy cards, but no audit log examples or approval policy matrix.
- `/settings/operator-console`: good placeholder, but no queue counts or system status indicators.

## 11. UX / Product Risks

| Risk | Assessment | Severity |
|---|---|---:|
| Looks like a CRM clone | Low. The UI is centered on AI operations, knowledge, workflows, approvals, and reports. Sales is present but planned, not dominant. | low |
| AI Operations Center positioning | Clear. Sidebar, dashboard, departments, approvals, and workflow language support the positioning. | low |
| Interface overload | Medium. Coverage is comprehensive, but workflow and department pages can feel like a product inventory. | medium |
| Too many future/planned entities | Medium. Future/planned coverage is useful, but MVP active needs stronger visual priority. | medium |
| MVP scope clarity | Medium. Dashboard and workflows show MVP actions, but planned/future items compete for attention. | medium |
| Approval-first clarity | Strong. This is one of the best-covered principles. | low |
| Smart Algorithms as first demo workspace | Clear in shell and dashboard, but should also appear in `/knowledge` and `/reports` context. | low |
| Roadmap coverage | Missing. Blueprint asks v0.1/v0.2/v0.3/v1.0/v2.0 roadmap; current UI does not show this explicitly. | high |
| Document Intelligence clarity | Partial. Legal/Document and knowledge versioning exist, but the product term and capability cluster are not explicit. | medium |

## Recommended UI Patch 1

### P0

- Add a visible Roadmap section with v0.1, v0.2, v0.3, v1.0, and v2.0 milestones. Best locations: `/reports` as "Roadmap & Owner Planning" or `/settings` as "Product Roadmap".
- Fix mock count consistency: dashboard Pending approvals shows 9, while Weekly Owner Report metrics still say 5 pending approvals.
- Add explicit "Document Intelligence" coverage to `/knowledge`: summary, risk extraction, version compare, lawyer questions draft, and future Legal/Document link.

### P1

- Add MVP/planned/future filters to `/workflows` and `/departments`.
- Promote MVP active workflows above planned/future items more aggressively; collapse non-MVP groups by default or place them under roadmap.
- Add a concrete selected approval detail example on `/approvals` with original payload, edited payload, final payload, comments, and audit trail.
- Add a chat input composer placeholder to `/chat` so the page feels like an actual RAG chat surface.
- Strengthen `/reports` with a featured Weekly Owner Report layout: blockers, recommendations, owner decisions, usage summary.
- Add run lifecycle strip to `/workflows`: draft, generated, waiting approval, approved, manual execution.

### P2

- Add queue counts and retry examples to `/settings/operator-console`.
- Add model/tool/permission columns to `/settings/assistants`.
- Add status-specific disabled button labels: Planned, Future, Locked.
- Add route-level breadcrumbs or active workspace context to subpages.
- Add a compact "Core Platform map" to `/settings`.
- Add more varied audit examples beyond support reply.

## Verification Notes

This review was based on static inspection of current app routes, components, and mock data. Required verification commands should be run after this document is created:

```bash
npm run lint
npm run build
```

## Patch 1 Implementation Notes

Date: 2026-06-28

### P0 Fixed

- Added a dedicated `/roadmap` route and sidebar item with v0.1, v0.2, v0.3, v1.0, and v2.0 cards. The page clearly marks v0.1 as the current Smart Algorithms Internal Demo scope.
- Fixed pending approval count consistency by deriving `pendingApprovalsCount` from approval items where `status === "pending"`. Dashboard stats, report metrics, approval context, and Weekly Owner Report summary now use the same source.
- Added explicit Document Intelligence coverage on `/knowledge` with document summary, key terms extraction, risk detection, version comparison, checklist review, deadline/amount/obligation extraction, document card generation, questions draft, and document-to-task capabilities. Added Document Intelligence to Core Platform settings.

### P1 Partially Fixed

- Added MVP/planned/future/locked filters to `/departments` and `/workflows`.
- Strengthened Weekly Owner Report on `/dashboard` and `/reports` with Pending decisions, High-risk approvals, Indexing issues, Codex tasks waiting, and QA reports ready.
- Added concrete approval detail content on `/approvals/[approvalId]`, including original AI output, edited/final output, source documents, risk notes, allowed approvers, disabled approval buttons, and a no-external-action note.
- Added chat input placeholder and quick mocked actions on `/chat`.
- Added workflow lifecycle strip on `/workflows`, workflow run form pages, and workflow run detail pages.

### Remaining P1 / P2

- Add richer operator queue counts and retry states to `/settings/operator-console`.
- Add model/tool/permission columns to `/settings/assistants`.
- Add more varied audit examples for publish, local checks, and Codex launch.
- Consider collapsing non-MVP workflow groups by default if the catalog still feels dense.
- Add route-level breadcrumbs or stronger workspace context to deeper subpages.

### Routes Changed

- `/dashboard`
- `/knowledge`
- `/chat`
- `/departments`
- `/workflows`
- `/workflows/support-reply/run`
- `/workflows/telegram-content/run`
- `/workflows/codex-task/run`
- `/workflows/qa-review/run`
- `/workflows/runs/[runId]`
- `/approvals`
- `/approvals/[approvalId]`
- `/reports`
- `/settings`
- `/roadmap`

### Verification Results

- `npm run lint`: passed.
- `npm run build`: passed.
- Dev server route checks returned `200 OK` for `/dashboard`, `/knowledge`, `/chat`, `/departments`, `/workflows`, `/approvals`, `/reports`, `/settings`, and `/roadmap`.
