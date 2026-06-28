# Private AI Cloud DB Scaffold

## Current status

- DB-02 adds `0001_initial_p0_schema.sql`.
- No real DB connection.
- The migration is not automatically executed.
- No backend routes yet.
- No auth yet.
- RLS is not enabled yet.

## Target database

- PostgreSQL.
- Local development via Homebrew PostgreSQL.
- Docker is not required for the current machine.

## Why not SQLite

The MVP product needs Postgres-compatible tenant isolation, future RLS, JSONB, audit model, and workflow/approval model support. SQLite would be fast for a prototype, but it would move the product away from the target production foundation too early.

## Migration approach

- Raw SQL migrations.
- Future migration files go into `db/migrations`.
- Seed files go into `db/seeds`.
- P0 schema source is `docs/architecture/database-schema-v0.1.md`.
- `db/migrations/0001_initial_p0_schema.sql` targets PostgreSQL and defines the initial P0 schema.

## Future DB patches

- DB-03 seed demo workspace.
- DB-04 DB client/query layer.
- DB-05 read-only API routes.
- DB-06 first UI rewire.
- DB-07 audit/event foundation.

## Local PostgreSQL notes

Draft commands for a local Homebrew PostgreSQL setup:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb private_ai_cloud_dev
```

Exact commands may vary depending on local Homebrew/Postgres setup. Docker is not required.
