# AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Private AI Cloud Rules For Codex

- Work only inside `private-ai-cloud`.
- Do not modify the sibling `twenty` repository.
- Do not copy Twenty code, styles, components, schemas, assets, or product text.
- Use Twenty only as an architectural/reference project.
- Do not add backend code without a separate explicit task.
- Do not add Docker, auth, database, RAG, real LLM execution, or real integrations without a separate explicit task.
- Keep the project a frontend-only prototype with mocked data until the roadmap explicitly moves to backend work.
- Preserve Product Blueprint alignment across Dashboard, Knowledge Base, RAG Chat, AI Departments, Workflows, Approvals, Reports, Settings, and Roadmap.
- External actions must remain locked by default.
- The approval-first principle is mandatory for publish, send, run, integration, code acceptance, and merge-related flows.
- After changes, run `npm run lint` and `npm run build`.
- Do not push changes unless the user explicitly asks.
