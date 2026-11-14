import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const compose = JSON.parse(read("compose.production.json"));
const dockerfile = read("Dockerfile");

test("AI-045: app uses locked Node/npm, npm ci, multi-stage production Next runtime and non-root UID", () => {
  assert.match(dockerfile, /FROM node:24\.22\.2-bookworm-slim AS base/u);
  assert.match(dockerfile, /node --version \| grep -Fx 'v24\.22\.2'/u);
  assert.match(dockerfile, /npm@11\.8\.0/u); assert.match(dockerfile, /npm ci --no-audit/u);
  assert.match(dockerfile, /npm ci --omit=dev/u); assert.match(dockerfile, /FROM base AS runtime/u);
  assert.match(dockerfile, /USER node/u); assert.equal(compose.services.app.user, "1000:1000");
  assert.match(dockerfile, /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start"/u);
  assert.ok(!/COPY\s+\.\s/u.test(dockerfile), "build context is explicitly allowlisted");
});
test("AI-045: strict secret exclusions and no secret/build-argument ingestion", () => {
  const ignore = read(".dockerignore").split("\n");
  for (const name of [".git", ".github", ".aws", ".ssh", ".config", "**/.env", "**/.env.*", "**/.npmrc", "**/*credential*", "node_modules", ".next", "**/*.patch", "**/*.log", "tmp", "deploy"]) assert.ok(ignore.includes(name), name);
  assert.ok(ignore.includes("!lib/**/*credential*.ts"), "protected credential-store source is retained, never host credentials");
  assert.ok(!/^(?:ARG|ENV)\s+.*(?:SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL)/mu.test(dockerfile));
  for (const p of ["Dockerfile", "compose.production.json", "deploy/runtime.env.example"]) assert.ok(!/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|BEGIN .*PRIVATE KEY|postgres:postgres)/u.test(read(p)), p);
  const env = read("deploy/runtime.env.example").split("\n").filter(s => s && !s.startsWith("#"));
  assert.ok(env.length >= 6 && env.every(s => /^[A-Z_]+=$/u.test(s)));
});
test("AI-045: only app loopback port is published; PostgreSQL is internal with durable data", () => {
  assert.deepEqual(Object.keys(compose.services).sort(), ["app", "postgres"]);
  assert.deepEqual(compose.services.app.ports, ["127.0.0.1:3000:3000"]);
  assert.equal(compose.services.postgres.ports, undefined);
  assert.deepEqual(compose.services.postgres.networks, ["application"]);
  assert.equal(compose.networks.application.internal, true);
  assert.equal(compose.services.postgres.image, "postgres:16.15-bookworm");
  assert.deepEqual(compose.services.postgres.volumes, ["postgres_data:/var/lib/postgresql/data"]);
  assert.ok(Object.hasOwn(compose.volumes, "postgres_data"));
  assert.match(compose.services.postgres.environment.POSTGRES_PASSWORD, /^\$\{POSTGRES_PASSWORD:\?/u);
});
test("AI-045: bounded checks, privilege reduction, rotation and VPS resource limits", () => {
  for (const s of Object.values(compose.services) as Record<string, unknown>[]) {
    assert.equal(s.privileged, undefined); assert.equal(s.network_mode, undefined);
    assert.ok(!JSON.stringify(s).includes("docker.sock"));
    assert.deepEqual(s.security_opt, ["no-new-privileges:true"]);
    assert.equal(s.restart, "unless-stopped"); assert.ok(s.mem_limit && s.cpus && s.pids_limit);
    assert.ok((s.healthcheck as Record<string, unknown>).timeout);
    assert.equal((s.logging as { options: Record<string, string> }).options["max-file"], "3");
  }
  assert.deepEqual(compose.services.app.cap_drop, ["ALL"]);
  assert.equal(compose.services.app.read_only, true);
  assert.deepEqual(compose.services.app.healthcheck.test.slice(-1), ["ready"]);
  assert.match(dockerfile, /HEALTHCHECK/u);
});
test("AI-045: no automatic migrations/seed, provider keys, repository mounts or AI-052 workers", () => {
  const app = compose.services.app;
  assert.equal(app.command, undefined); assert.equal(app.entrypoint, undefined);
  assert.ok(!Object.keys(app.environment).some(k => /OPENAI|LLM|PLANNER|EXECUTOR|BYPASS/u.test(k)));
  assert.deepEqual(app.volumes, ["pac_config:/home/node/.config/private-ai-cloud", "next_cache:/app/.next/cache"]);
  assert.ok(!dockerfile.includes("COPY db/seeds"));
  for (const pattern of [/ENTRYPOINT.*(?:migrat|seed)/iu, /(?:codex|claude-code|podman|bullmq|redis|docker\.sock)/iu]) assert.ok(!pattern.test(dockerfile + JSON.stringify(compose)));
  assert.match(read("lib/executors/executor-router.ts"), /runtimeDispatchAllowed:\s*false/u);
});
test("AI-045: historical migrations 0001–0023 remain exact baseline bytes", () => {
  // SHA-256 captured at e7546bea before edits. PAC-PLAN-01-02 appends 0024; all historical 23 hashes remain pinned.
  const hashes = [
    "507e66aa93e6af2e7797f6a0658ed606927e9bb3cf45247a1c38f248d5f8bb47", "c1f956637cc6abee2def461b20526c3e3fb89b199e878ea9b0a9f26c4c52145e",
    "59180e0fb0b647798352b8849e4205354888865fb63992110b83e16b5f88e9e6", "49121d113233a1b66c8c66d903bd9d95158be71615979a83ece8342256dde082",
    "25670a50386a45b08dfc2d7a2f7cdf4715f77b762380524c67c678aab94974e7", "20a2cf330a2b3d9fd0f15afe568cdfcae1f060a0f7260353cdc4dc46d98d0990",
    "0dc0bd1b1f38f6e4bc143cf1b91f9c5ecd3498d283d1a89333604a2a7912fe7f", "ebcf44d141f712bcb36d346ac97fc1b638a2a522304b9711f47c9d12420e4e3c",
    "3669b97095398dc963d0cc498aa3dd2c6b6ce9f73238fe3a636c72785742d530", "72a83675303f89840d3eda48cdfdd444ebf128555198f45070177fa62a740443",
    "0a5ba1dff7ccf75830261bdfb17682de8acd9f983a12396cfc5065c0aeb0ef7e", "1c1827d505909f4e75043f4179d0a298c06503cb816d77a8b8f82b38ddc5ce24",
    "f86eeea849aaa2b738d418bcd78ceac869c628a94db758b13668bf06fb79edf4", "f4e82dccf69e2b60797d6f7bfc0af4986ac89a70c2ead30ec401c58592a666f2",
    "46cfbafe63264ef2871037b7a01e06a647120132c78cb7ec78a74b8952885348", "b41672ef2f3c75cbb377645da352db687b250d3883e3df53fe8263931ef3e7a2",
    "80047c5a58965567a3c93eb6415df48fb249701f4701f997c31bda40a0cfa1c9", "5eb8b8cfcf83ec240ea8a4e5cc1a13e90fb69730cbcc622d3133591f9407f37a",
    "037bde00f15001da93b140faf6d5652f13d0a609d08d6473b2ddfbe2fffed2f7", "2b8731c2e76288ee9566c58bbcb3c9c9cfefe62d152628a2750070927ee44790",
    "f78043b70d10481734787c12f04f577479c0b275a50cfb246ef2b9f2100f7d13", "c72ec5e17fadd24882d3d621def785280d06ec6391b362259c46c2f231f64b58",
    "275ef92213b6d7206cb4682421182216769ca2107fad1703584690e1de459fb6"
  ];
  const files = readdirSync(new URL("db/migrations/", root)).filter(f => f.endsWith(".sql")).sort();
  assert.equal(files.length, 24);
  assert.equal(files[22], "0023_project_repository_knowledge_versions.sql");
  assert.equal(files[23], "0024_project_planning_drafts.sql");
  assert.deepEqual(files.slice(0, 23).map(f => createHash("sha256").update(read(`db/migrations/${f}`)).digest("hex")), hashes);
});
