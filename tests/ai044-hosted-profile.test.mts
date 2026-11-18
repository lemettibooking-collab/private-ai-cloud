import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const api = await import(new URL("../lib/executors/ai044-hosted-profile.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-hosted-profile");
const shared = await import(new URL("../lib/executors/ai044-proof-binding.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-proof-binding");
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function header(path: string, content: Buffer, kind = "0", mode = 0o644) {
  const h = Buffer.alloc(512); h.write(path, 0, 100); h.write(`${mode.toString(8).padStart(7, "0")}\0`, 100);
  h.write("0000000\0", 108); h.write("0000000\0", 116); h.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136); h.fill(32, 148, 156); h.write(kind, 156); h.write("ustar\0", 257); h.write("00", 263);
  const sum = h.reduce((a, b) => a + b, 0); h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([h, content, Buffer.alloc((512 - content.length % 512) % 512)]);
}
function paxLine(value: string) { let length = Buffer.byteLength(value) + 3; while (String(length).length + Buffer.byteLength(value) + 2 !== length) length = String(length).length + Buffer.byteLength(value) + 2; return `${length} ${value}\n`; }
function archive(entries: [string, string | Buffer, string?, number?][] = [["src/server/terminal/account/analytics.ts", "export const value = 1;\n"]], baseline: string = shared.ai044Baseline) {
  return Buffer.concat([header("pax_global_header", Buffer.from(paxLine(`comment=${baseline}`)), "g"),
    ...entries.map(([path, content, kind, mode]) => header(path, Buffer.isBuffer(content) ? content : Buffer.from(content), kind, mode)), Buffer.alloc(1024)]);
}
function binding(bytes: Buffer) {
  return { schemaVersion: 1, workspaceId: "workspace-a", projectId: "smart-algorithms", projectTaskId: "portfolio-analytics", planId: "plan-a", planRevision: 1,
    planFingerprint: "a".repeat(64), developmentTaskId: "task-a", developmentRunId: "run-a", invocationId: "invocation-a", attemptNumber: 1,
    executorIdentity: { id: "openai-agents", version: "v1" }, provider: { id: "openai", accountId: "account-a", modelId: "approved-model", credentialSourceId: "source-a" },
    repository: { id: shared.ai044Repository, baseline: shared.ai044Baseline }, archiveSha256: hash(bytes), allowedPaths: ["src/server/terminal/account"],
    acceptanceCriteria: ["Analytics GET performs zero writes"], verificationCommands: [...shared.ai044RequiredVerification], modelSpendLimitCents: 1, maximumExposureUsdMicros: 10000 };
}
function frozen(value: unknown) { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
function prepared() { const bytes = archive(), b = binding(bytes); const r = api.prepareAI044HostedProfile(b, bytes, "file-approved"); assert.equal(r.verdict, "allow"); assert.ok(r.value); return { b, bytes, profile: r.value }; }

test("AI044 exact git archive-compatible PAX baseline/hash manifest is canonical, detached and frozen", () => {
  const bytes = archive([["z.txt", "z"], ["a.txt", "a"], ["public/pixel.png", Buffer.from([137, 80, 78, 71, 0, 0])]]), b = binding(bytes), before = Buffer.from(bytes), old = structuredClone(b);
  const a = api.validateAI044RepositoryArchive(b, bytes), c = api.validateAI044RepositoryArchive(b, bytes);
  assert.equal(a.verdict, "allow"); assert.ok(a.value); assert.deepEqual(a, c); assert.notEqual(a.value, c.value); frozen(a);
  assert.deepEqual(a.value.files.map(v => v.path), ["a.txt", "public/pixel.png", "z.txt"]); assert.equal(a.value.files[0].sha256, hash("a"));
  assert.deepEqual(bytes, before); assert.deepEqual(b, old);
});
for (const [label, alter] of [
  ["wrong baseline", (b: ReturnType<typeof binding>) => { b.repository.baseline = "b".repeat(40); }],
  ["wrong repository", (b: ReturnType<typeof binding>) => { b.repository.id = "foreign/repository"; }],
  ["changed archive SHA", (b: ReturnType<typeof binding>) => { b.archiveSha256 = "b".repeat(64); }],
] as const) test(`AI044 archive denies ${label} without partial output`, () => { const bytes = archive(), b = binding(bytes); alter(b); const r = api.validateAI044RepositoryArchive(b, bytes); assert.equal(r.verdict, "deny"); assert.equal(r.value, null); });
for (const path of ["../outside", "/absolute", "a/../outside", "a//b", ".env", "src/.env.production", ".git/config", "node_modules/pkg/a", ".npmrc", "credentials.json", "id_rsa", "cert.pem", "a\\b"]) test(`AI044 archive rejects unsafe path ${path}`, () => {
  const bytes = archive([[path, "text"]]); const r = api.validateAI044RepositoryArchive(binding(bytes), bytes); assert.equal(r.verdict, "deny"); assert.equal(r.value, null);
});
for (const kind of ["1", "2", "3", "4", "6", "7", "L", "K"]) test(`AI044 archive rejects nonregular TAR item ${kind}`, () => {
  const bytes = archive([["source.ts", "text", kind]]); assert.equal(api.validateAI044RepositoryArchive(binding(bytes), bytes).verdict, "deny");
});
test("AI044 archive validates header checksum, termination and duplicate paths", () => {
  const bytes = archive(); bytes[512 + 40] ^= 1; assert.equal(api.validateAI044RepositoryArchive(binding(bytes), bytes).verdict, "deny");
  const duplicate = archive([["a.txt", "one"], ["a.txt", "two"]]); assert.equal(api.validateAI044RepositoryArchive(binding(duplicate), duplicate).verdict, "deny");
  const unterminated = archive().subarray(0, -1024); assert.equal(api.validateAI044RepositoryArchive(binding(unterminated), unterminated).verdict, "deny");
});
test("AI044 archive rejects wrong or absent global baseline provenance marker", () => {
  const wrong = archive(undefined, "b".repeat(40)), absent = Buffer.concat([header("source.ts", Buffer.from("text")), Buffer.alloc(1024)]);
  for (const bytes of [wrong, absent]) assert.equal(api.validateAI044RepositoryArchive(binding(bytes), bytes).verdict, "deny");
});
test("AI044 archive supports safe per-file PAX long path and executable files", () => {
  const path = `src/${"a".repeat(120)}/file.ts`, bytes = Buffer.concat([header("pax_global_header", Buffer.from(paxLine(`comment=${shared.ai044Baseline}`)), "g"),
    header("pax_file", Buffer.from(paxLine(`path=${path}`)), "x"), header("placeholder", Buffer.from("hello"), "0", 0o755), Buffer.alloc(1024)]);
  const r = api.validateAI044RepositoryArchive(binding(bytes), bytes); assert.equal(r.verdict, "allow"); assert.ok(r.value); assert.equal(r.value.files[0].path, path); assert.equal(r.value.files[0].executable, true);
});
test("AI044 archive rejects secret bytes without exposing raw secret", () => {
  const secret = "sk-" + "a".repeat(24), bytes = archive([["source.txt", secret]]), r = api.validateAI044RepositoryArchive(binding(bytes), bytes);
  assert.equal(r.verdict, "deny"); assert.equal(r.value, null); assert.ok(!JSON.stringify(r).includes(secret));
});
test("AI044 archive imposes total bytes, individual bytes, entry count and path bounds", () => {
  const oversized = Buffer.alloc(api.ai044ArchiveLimits.bytes + 512); assert.equal(api.validateAI044RepositoryArchive(binding(oversized), oversized).verdict, "deny");
  const large = archive([["large.bin", Buffer.alloc(api.ai044ArchiveLimits.fileBytes + 1)]]); assert.equal(api.validateAI044RepositoryArchive(binding(large), large).verdict, "deny");
  const many = archive(Array.from({ length: api.ai044ArchiveLimits.entries }, (_, i) => [`f${i}.txt`, ""])); assert.equal(api.validateAI044RepositoryArchive(binding(many), many).verdict, "deny");
});
test("AI044 hostile archive/binding proxies and getters execute no caller code", () => {
  let count = 0; const bytes = archive(), hostile = new Proxy(bytes, { get() { count++; throw Error("hostile"); } });
  assert.equal(api.validateAI044RepositoryArchive(binding(bytes), hostile).verdict, "deny");
  const b = binding(bytes); Object.defineProperty(b, "archiveSha256", { get() { count++; throw Error("hostile"); }, enumerable: true });
  assert.equal(api.validateAI044RepositoryArchive(b, bytes).verdict, "deny"); assert.equal(count, 0);
});
test("AI044 intrinsic byte snapshot never invokes typed-array byteLength/valueOf/iterator getters", () => {
  const bytes = archive(), b = binding(bytes); let calls = 0;
  for (const key of ["byteLength", "valueOf", Symbol.iterator]) Object.defineProperty(bytes, key, { get() { calls++; throw Error("hostile byte property"); } });
  assert.equal(api.validateAI044RepositoryArchive(b, bytes).verdict, "allow"); assert.equal(calls, 0);
});
test("AI044 archive rejects file-as-parent conflicts", () => {
  const bytes = archive([["src", "one"], ["src/file.ts", "two"]]); assert.equal(api.validateAI044RepositoryArchive(binding(bytes), bytes).verdict, "deny");
  const directoryConflict = archive([["src", "one"], ["src/child/", "", "5", 0o755]]);
  assert.equal(api.validateAI044RepositoryArchive(binding(directoryConflict), directoryConflict).verdict, "deny");
});
test("RED AI044 archive denies nonadjacent file-as-parent across lexical interpositions", () => {
  for (const children of [[["a", "one"], ["a-", "two"], ["a/b", "three"]], [["a", "one"], ["a-", "two"], ["a/b/", "", "5", 0o755]]] as [string, string, string?, number?][][]) {
    const bytes = archive(children); const r = api.validateAI044RepositoryArchive(binding(bytes), bytes); assert.equal(r.verdict, "deny"); assert.equal(r.value, null);
  }
});
test("AI044 trusted setup checksum line is a real newline and verifies/catches corruption offline", () => {
  const { profile, bytes, b } = prepared(), environment = JSON.parse(profile.body).environment;
  const directory = mkdtempSync(join(tmpdir(), "ai044-checksum-proof-")), path = join(directory, "repository.tar");
  try {
    writeFileSync(path, bytes);
    const command = environment.setup_commands[0].command.replace("/workspace/repository.tar", path);
    const prefix = command.split(" | ")[0], line = spawnSync("/bin/sh", ["-c", prefix], { encoding: "utf8", env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" } });
    assert.equal(line.status, 0); assert.equal(line.stdout, `${b.archiveSha256}  ${path}\n`);
    // macOS uses shasum; Linux's hosted command is sha256sum. Both consume the same strict checksum-line format.
    const check = command.replace("sha256sum", "shasum -a 256");
    assert.equal(spawnSync("/bin/sh", ["-c", check], { encoding: "utf8", env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" } }).status, 0);
    const corrupted = Buffer.from(bytes); corrupted[100] ^= 1; writeFileSync(path, corrupted);
    assert.notEqual(spawnSync("/bin/sh", ["-c", check], { encoding: "utf8", env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" } }).status, 0);
  } finally { rmSync(directory, { recursive: true }); }
});
test("AI044 malformed/oversized PAX records and hidden metadata are fail-closed", () => {
  for (const payload of ["9999 comment=bad\n", paxLine(`comment=${shared.ai044Baseline}`) + paxLine(`comment=${shared.ai044Baseline}`), paxLine("linkpath=/outside"), paxLine("path=../../outside")]) {
    const bytes = Buffer.concat([header("pax_global_header", Buffer.from(payload), "g"), header("source.ts", Buffer.from("hello")), Buffer.alloc(1024)]);
    const r = api.validateAI044RepositoryArchive(binding(bytes), bytes); assert.equal(r.verdict, "deny"); assert.equal(r.value, null);
  }
});
test("AI044 hosted profile fixes medium inline environment, exact restricted network, empty sandbox secrets and no authority", () => {
  const { profile } = prepared(), r = JSON.parse(profile.body);
  assert.equal(profile.profileVersion, shared.ai044ProfileVersion); assert.equal(r.environment.type, "openai_hosted"); assert.equal(r.environment.container_size, "medium");
  assert.deepEqual(r.environment.desktop, { enabled: false });
  assert.deepEqual(r.environment.network, { access: "restricted", allowed_domains: ["registry.npmjs.org"] }); assert.deepEqual(r.environment.env, {});
  assert.deepEqual(r.environment.packages, { npm: [], python: [], system: [] }); assert.deepEqual(r.environment.skills, []); assert.deepEqual(r.environment.plugins, []);
  assert.deepEqual(r.agent.tools, []); assert.equal(r.agent.multi_agent.enabled, false); assert.deepEqual(r.spend_control, { limit: 1 });
  assert.equal(profile.dispatchAuthorized, false); assert.equal(profile.runtimeDispatchAllowed, false); assert.equal("livePermit" in profile, false); frozen(profile);
  assert.match(r.environment.setup_commands[0].command, /sha256sum --check --strict/u); assert.match(r.environment.setup_commands[1].command, /--no-same-owner --no-same-permissions/u);
});
test("AI044 hosted golden is deterministic and every profile identity/configuration binding changes fingerprints", () => {
  const { b, bytes, profile } = prepared(), before = structuredClone(b), bytesBefore = Buffer.from(bytes);
  const repeat = api.prepareAI044HostedProfile(b, bytes, "file-approved"); assert.deepEqual(repeat.value, profile); assert.notEqual(repeat.value, profile);
  for (const change of [(v: typeof b) => { v.provider.accountId = "account-b"; }, (v: typeof b) => { v.provider.modelId = "other-model"; },
    (v: typeof b) => { v.provider.credentialSourceId = "source-b"; }, (v: typeof b) => { v.planRevision = 2; },
    (v: typeof b) => { v.modelSpendLimitCents = 2; v.maximumExposureUsdMicros = 20000; }, (v: typeof b) => { v.attemptNumber = 2; }]) {
    const changed = structuredClone(b); change(changed); const r = api.prepareAI044HostedProfile(changed, bytes, "file-approved");
    assert.equal(r.verdict, "allow"); assert.ok(r.value); assert.notEqual(r.value.profileFingerprint, profile.profileFingerprint); assert.notEqual(r.value.requestFingerprint, profile.requestFingerprint);
  }
  assert.deepEqual(b, before); assert.deepEqual(bytes, bytesBefore);
});
test("AI044 hosted request has its own literal golden domain, distinct from accepted environment:none bytes", () => {
  const { profile } = prepared(); assert.equal(profile.requestFingerprint, "4d9dffdbdd76b6c9485797b3596493ad3602d02a43bfd2c3d43097b6005fc56e");
  assert.equal(hash(profile.body), profile.requestFingerprint);
});
for (const network of [{ access: "enabled", allowed_domains: [] }, { access: "disabled", allowed_domains: [] }, { access: "restricted", allowed_domains: ["*.npmjs.org"] },
  { access: "restricted", allowed_domains: ["registry.npmjs.org", "api.binance.com"] }, { access: "restricted", allowed_domains: ["github.com"] },
  { access: "restricted", allowed_domains: ["https://registry.npmjs.org"] }, { access: "restricted", allowed_domains: ["registry.npmjs.org:443"] },
  { access: "restricted", allowed_domains: ["registry.npmjs.org"], env: { OPENAI_API_KEY: "fake" } }]) test(`AI044 hosted network rejects broadened/unknown shape ${JSON.stringify(network)}`, () => {
  const bytes = archive(), r = api.prepareAI044HostedProfile(binding(bytes), bytes, "file-approved", network); assert.equal(r.verdict, "deny"); assert.equal(r.value, null);
});
test("AI044 hosted cannot omit/unlimit spend or accept credential material in the binding/file reference", () => {
  const bytes = archive(); for (const amount of [0, -1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER]) { const b = binding(bytes); b.modelSpendLimitCents = amount; assert.equal(api.prepareAI044HostedProfile(b, bytes, "file-approved").verdict, "deny"); }
  const secret = "sk-" + "a".repeat(24), b = binding(bytes); b.provider.credentialSourceId = secret;
  for (const r of [api.prepareAI044HostedProfile(b, bytes, "file-approved"), api.prepareAI044HostedProfile(binding(bytes), bytes, secret)]) {
    assert.equal(r.verdict, "deny"); assert.equal(r.value, null); assert.ok(!JSON.stringify(r).includes(secret));
  }
});
