# AI-045.0 — VPS container foundation

Implementation candidate, infrastructure hosting only. Owner decision (2026-11-07):
bring the narrow AI-045 VPS foundation forward before the AI-044 real feature proof.
AI-044 remains IN PROGRESS. AI-045 becomes IN PROGRESS only after acceptance of this
infrastructure slice. AI-052 remains PLANNED / BLOCKED after AI-051.
`runtimeDispatchAllowed=false`; generic production/live executor dispatch is BLOCKED.
This runbook describes future operator actions; implementation does not execute them
on the VPS. Independent review, controlled integration and an exact VPS pull precede
the first live smoke. Hosting PAC does not authorize provider calls or coding workers.

## Topology and limits

Target supplied by the Owner: Aéza Frankfurt, Ubuntu 26.04.1 LTS, 2 vCPU, 4 GB RAM,
4 GB swap, ~60 GB NVMe, Docker 29.9.3 / Compose 5.7.0. SSH-key login `pacadmin`,
root/password SSH disabled, UFW default-deny with only 22 allowed. These are supplied
facts, not a remotely verified configuration. Do not change UFW or open 80/443/3000/5432.

`Mac → SSH tunnel → VPS 127.0.0.1:3000 → PAC app → internal PostgreSQL 16`.
Compose publishes **only** `127.0.0.1:3000:3000`. PostgreSQL has no published port and
joins only the internal `application` network. App also joins a separate bridge for
existing outbound Auth.js functionality. This is not application egress/DNS enforcement
or an AI-052 Network Contract. No real network integration is exercised by this task.
Compose is stored in JSON (valid Compose input) so structural security tests need no
new YAML dependency. Always pass `-f compose.production.json`.

App: Node 24.22.2 / npm 11.8.0, `npm ci` from the locked dependency graph, separate build/prod
dependencies, existing `next start` runtime, UID/GID 1000, read-only image, writable
Next cache volume and bounded /tmp. The locked TypeScript compiler is retained because
the existing next.config.ts is loaded by next start. No configuration rewrite or
standalone-mode behavior change. Builds need package-registry access and the existing
next/font/google Geist/Geist Mono fetch. Runtime secrets must never be build args/env.
Base image tags are exact versions but tags are not immutable digests; record/pin the
resolved image digests during future operational acceptance. No claim of bit-identical
rebuilds across mutable registry images. No Docker verification is implied by source tests.

AI-045.0a pins `node:24.22.2-bookworm-slim` and asserts exactly `v24.22.2` in the image
build. Node 24.13.x predates the [2026-10-21 HIGH security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases/);
[24.22.2 LTS](https://nodejs.org/en/blog/release/v24.22.2/) was released on 2026-10-28.
The project engine is 24.22.x; .nvmrc and image pin 24.22.2. npm stays 11.8.x (11.8.0),
and no application dependency changes. Docker build/container smoke is a separate
Owner VPS gate after corrected static review; it is not authorized or claimed here.

App limits: 1.25 CPU / 1536 MiB / 256 PIDs. PostgreSQL: .75 CPU / 768 MiB / 128 PIDs
and 128 MiB shared memory. This leaves host headroom; it is an initial deployment
budget, not a capacity benchmark. Build one image at a time; monitor swap/disk, avoid
concurrent builds on this 4 GB host, or build a matching-platform image off-host.
No Redis, BullMQ, reverse proxy, monitoring stack or worker. JSON logs rotate 3×10 MB
per service. App drops all capabilities. Both services use no-new-privileges.
Postgres retains its official initialization entrypoint's default capabilities for
initial volume ownership and then drops to its postgres OS user; do not add cap_drop:ALL
without a disposable initialization/recreation smoke. No privileged/host-network mode,
socket mount, host root mount, or automatic environment allocation.

## 1. Exact source and protected runtime configuration

After integration, from the VPS checkout `/opt/private-ai-cloud/app`, manually verify
the approved commit SHA, clean index/tree and branch. Future pull command:

```sh
git switch feature/development-agent-module
git pull --ff-only origin feature/development-agent-module
git rev-parse HEAD
```

Use only an Owner-reviewed exact commit, not an unreviewed moving branch head.
No credentials in Git URLs. Do not execute these commands during implementation.

Install `deploy/runtime.env.example` outside the checkout as
`/etc/private-ai-cloud/runtime.env`, owned by the trusted operator, directory 0700,
file **0600** (`chmod 600`). Populate through a protected editor, not shell arguments
or command history. All template assignments intentionally start empty. Generate
strong unique PostgreSQL and AUTH secrets locally using a trusted secret generator;
no sample credential is supplied. Set:

- POSTGRES_PASSWORD: strong unique database password (not `postgres`).
- DATABASE_URL: same password URL-encoded, user `pac`, hostname `postgres`, port 5432,
  database `private_ai_cloud`. Do not use localhost inside the container.
- AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET: existing server-only Auth.js GitHub
  configuration. No development bypass or fake Owner session.
- APP_DEMO_WORKSPACE_SLUG: factual provisioned domain workspace slug, not a browser ID.

The `--env-file` below is for Compose substitution, not a build secret. Only an explicit
allowlist is injected into app. AUTH_URL is fixed to `http://127.0.0.1:3000` for the
tunnel, so Auth.js trusts this configured origin; no trust-any-host flag is added.
Configure the matching GitHub application callback
`http://127.0.0.1:3000/api/auth/callback/github` separately. This task does not perform
OAuth or alter Auth.js. HTTP is acceptable only for this local tunnel smoke, not public
access. TLS/domain/reverse proxy belong to AI-045.1.

Do not print `docker compose config` with real env values: it expands secrets. Use
`config --quiet` to validate runtime configuration. Compose-required values reject
empty configuration; they cannot judge the strength of a nonempty password.

Default bootstrap `pac` is the official Postgres administrative role. This foundation
does not implement a least-privilege application DB-role rollout. Before broader
production use, plan a separately reviewed runtime/migrator privilege split; keep the
host and operator access private in this slice.

## 2. Build, start database, explicit migration gate

All commands below are operator instructions, **not task authorization to deploy**.

```sh
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json config --quiet
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json build app
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json up -d --wait postgres
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json ps postgres
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json run --rm --no-deps app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/deployment/migrate.mts apply
```

No app-start migration or seed hook exists. Operator gate explicitly applies repository
SQL **0001–0022**, strict lexical/contiguous ordering, SHA-256 over original full bytes.
It records `public.pac_schema_migrations(name,checksum,applied_at)` in the same transaction
as all pending SQL. Metadata is a transactional bootstrap table, not migration 0023.
Bounded trusted-file snapshot (128 files, 4 MiB/file, 16 MiB total), symlinks/hardlinks
denied. It validates PostgreSQL 16 and standard string semantics, strips only complete
outer BEGIN/COMMIT wrappers, and denies internal transaction/session-control statements.
Function/DO bodies and quoted literals retain their SQL statement boundaries. Historical
files remain byte-identical; no application schema is otherwise changed.

One connection, one transaction, ACCESS EXCLUSIVE metadata-table lock with NOWAIT,
shared PAC transaction/session-safety helper. Competing migrators cannot apply concurrently.
A simultaneous first bootstrap can receive a catalog conflict; it fails safely.
No advisory lock, automatic lock takeover, pooled second connection or provider await.
Server-side per-statement timeout is 60 s; idle-in-transaction backstop is the existing
30 s. Applied history must be an exact prefix of the local checksum inventory. Drift,
missing history, older-image rollback or a populated database without recorded history
denies; the runner never auto-adopts an existing schema. Use a fresh deployment database.
Adoption of an already initialized database requires a separate reviewed procedure.

First failure rolls back the **entire pending batch** plus its metadata, preserving
previously committed history. Later files are not executed. Driver messages/SQL/URLs
are suppressed; output is only `migration_gate_ok applied=N total=N` or
`migration_gate_denied` with exit 1. A lost COMMIT acknowledgement is ambiguous: the
session is destroyed, operator inspects durable history before any explicit rerun.
Checksummed replay is idempotent, but there is no automatic retry/repair. Never change
an applied migration or delete metadata to force a deployment. Stop app/writers and
back up before later schema upgrades; this lock serializes migrators, not app traffic.

## 3. Data provisioning, then start PAC

No production data, workspace, Owner mapping or identity is automatically created.
An empty database migrates successfully but cannot grant an Owner session. Provision
real workspace/Owner GitHub-subject mapping through the existing separately approved
operator process before an authenticated smoke; do not invent identities to bypass auth.
The historical demo SQL `db/seeds/0001_seed_smart_algorithms_demo.sql` is an explicit
Owner-only optional demonstration step, never a container-start step. It is deliberately
not shipped in the runtime image. It is not a substitute for a factual GitHub identity
mapping, and must not be applied automatically or against production data.

```sh
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json up -d --no-build --wait app
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json exec -T app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/deployment/health.mts live
docker compose --env-file /etc/private-ai-cloud/runtime.env -f compose.production.json exec -T app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/deployment/health.mts ready
```

`live` probes only the existing local Next.js entry page (HEAD /, 200 required, no
redirect following or response-body output). `ready` also queries SELECT 1 via the
existing pg adapter. Total CLI deadline 8 s, HTTP bounded 2.5 s, connection 5 s, query
2 s. Outputs only `ok`/`unavailable`, exit 0/1. No new HTTP/business/auth surface.
Readiness proves HTTP and DB reachability, **not** schema freshness, Owner provisioning,
provider access, executor permission or model readiness; explicit migration gate stays
mandatory before app. PostgreSQL pg_isready checks process acceptance, app readiness
checks actual credentials/connectivity. Inspect health status with `compose ps`.

## 4. Safe inspection, recreation and backups

Use the same explicit Compose/env-file arguments for every command. Inspect status
first, bounded logs only if needed (`logs --tail 50 --since 5m app`), privately as the
operator; do not upload raw logs, expanded config or environment dumps. Existing
application logging policy is unchanged; log rotation is not a secret sanitizer.
`stop app`, `start app`, `restart app` do not run migrations or seeds. `up -d`/container
recreation retains named `postgres_data`, `pac_config` and cache volumes. Do not use
`down --volumes`, `volume prune` or project renaming as routine cleanup. PostgreSQL
initial credentials apply only when initializing an empty volume; changing env alone
does not rotate an existing DB password. Coordinate real credential rotation explicitly.

Prepare encrypted off-host backups and a tested restore before persistent use: PostgreSQL
consistent pg_dump, metadata included; protected local-config volume backed up separately
with the same secret controls. A Docker volume is persistence, not a backup. Do not
stream a DB dump or credential archive into diagnostic logs/review artifacts.

## 5. Existing credential architecture and blocked execution

`pac_config` is a private local named volume at `/home/node/.config/private-ai-cloud`,
created as UID/GID 1000 with 0700 root directory. Existing API credential files remain
0600, single-link/non-symlink, uid checked, atomically written, protected by owner-token
O_EXCL locks with no stale takeover. ChatGPT retains its own protected store and
refresh-lock semantics. No host Mac credentials are copied. No API-key env fallback
is added. Never mount the entire host home/root or Docker socket. Runtime env contains
only deployment/auth/DB config, no provider token. Do not bypass lock or uid checks.

No provider connection/configuration is performed in AI-045.0. AI-044.4 remains
Owner-controlled, explicit-selection/approval/invoke and financially fail-closed.
Missing exact Git-object repository context, fresh protected pricing, policy, approval
or credentials remains unavailable. This image does not install Git, materialize a
target repository or mount target sources; a usable real proof would need a separately
approved operational bridge. ChatGPT local/remote SIWC eligibility must be reviewed
separately before hosting/use; foundation is not commercial eligibility approval.

AI-052 exclusions: no Codex CLI worker, Claude Code worker, generic shell-execution
worker, arbitrary coding-container creation, self-hosted model, private executor or
Docker socket. `AI-045 infrastructure containers ≠ AI-052 coding sandbox`.
No public web exposure, NGINX, domain, TLS, provider calls or production deployment in
this task. Paid/hosted Phase-L remains DENY-ONLY; AI-044 is not DONE.

## 6. Future first browser smoke (not executed here)

Only after independent review + integration + VPS exact pull and deployment:

```sh
# Owner's Mac; existing SSH alias pac resolves to the key-only pacadmin connection.
ssh -N -L 3000:127.0.0.1:3000 pac
```

Open `http://127.0.0.1:3000`. Keep GitHub Owner authentication intact, verify denied
access before sign-in and factual read-only data after sign-in. Browser smoke grants
no provider/OAuth/inference authorization beyond an explicitly scoped future smoke.
Public HTTP/HTTPS stays closed; AI-045.1 handles future reverse-proxy/TLS work.
