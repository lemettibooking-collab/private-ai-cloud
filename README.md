# Private AI Cloud

Private AI Cloud (PAC) is a **vendor-neutral AI Engineering Control Plane**. PAC owns the engineering process: FeaturePlan, admission policy, routing, quality and security gates, corrective loop, human approval, audit and cost. Managed or self-hosted executors own the internal agent execution. The product also includes the Owner-facing AI Operations Center for projects, runs, approvals and roadmap.

The canonical roadmap is [`docs/ROADMAP.md`](docs/ROADMAP.md). The documentation index is [`docs/README.md`](docs/README.md).

## Current State

- **UI:** the Owner Console (Next.js App Router, Mission Control shell). Dashboard, Projects, Runs, Run Detail and Approvals read real runtime data read-only for the authenticated Owner (AI-038.3). Other prototype pages remain on mocked data.
- **Backend foundation (server-only):**
  - PostgreSQL 16 schema and raw SQL migrations (`db/`);
  - a durable workflow runtime with tenant isolation, approvals, budgets, idempotency, audit and recovery semantics (`lib/workflows/`, `lib/db/`);
  - FeaturePlan, admission policy, development-execution and scheduler contracts (`lib/contracts/`);
  - a `ModelProvider` abstraction with an OpenAI adapter and a deterministic mock (`lib/providers/`).
- **Owner auth/session (AI-038.2, done):**
  - the Owner read boundary and identity boundary;
  - an Auth.js GitHub session adapter (`lib/auth/`), whose only HTTP route is `app/api/auth/[...nextauth]`.
- **Not complete yet:**
  - UI write actions (task creation, approve/reject), global run listing and multi-project switching;
  - runtime business APIs;
  - executor integrations (`ExecutorAdapter`, starting with AI-041.0);
  - RAG and real external integrations;
  - production deployment.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- PostgreSQL 16 (`pg`), raw SQL migrations
- Auth.js (`next-auth` v5 beta), GitHub provider, JWT sessions
- Node.js built-in test runner; opt-in live PostgreSQL suite (`npm run test:pg`)

## Local Prerequisites

- Node.js 24.13.x (`.nvmrc` pins 24.13.1).
- npm 11.8.0, as declared by the `packageManager` contract.

With `nvm`, activate the project runtime before installing dependencies:

```bash
nvm use
npm install
```

## Verification And Development

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

`npm run test:pg` runs the opt-in live PostgreSQL regression suite against a throwaway local database. Tests never call real model providers or perform real OAuth.

Open the local app at `http://localhost:3000` after `npm run dev`.
