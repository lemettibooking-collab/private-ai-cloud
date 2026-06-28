# Private AI Cloud

Private AI Cloud is a closed AI Operations Center prototype for managing internal knowledge, RAG-style chat, AI departments, workflows, approvals, reports, settings, and roadmap visibility.

## Current Status

Frontend-only MVP UI prototype.

The current baseline is aligned with Product Blueprint v0.2 and includes UI Refinement Patch 1. All data is mocked in the frontend. No backend services or real integrations are implemented yet.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Mocked data in local TypeScript modules

## Included UI Areas

- Dashboard
- Knowledge Base
- RAG Chat
- AI Departments
- Workflows
- Approvals
- Reports
- Settings
- Roadmap

## Not Implemented Yet

- Backend
- Database
- Authentication
- Real LLM/RAG execution
- Real integrations
- Docker/self-host runtime

## Database Status

The current project is still frontend-only. DB-01 only adds database scaffold documentation and environment placeholders. There is no runtime database connection yet.

Future DB work targets PostgreSQL. Docker is not required for DB-01.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

Open the local app at `http://localhost:3000` after `npm run dev`.
