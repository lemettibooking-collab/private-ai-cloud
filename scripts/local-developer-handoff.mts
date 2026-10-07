import { parseArgs } from "node:util";
import { open, constants } from "node:fs/promises";

const handoff = await import(new URL("../lib/local-handoff/local-developer-handoff.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-developer-handoff");
const policy = await import(new URL("../lib/local-handoff/local-handoff-policy.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-handoff-policy");

// Exactly two stages. Labels never resolve executables; no executor is invoked.
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    repo: { type: "string" }, spec: { type: "string" }, manifest: { type: "string" }, report: { type: "string" }, out: { type: "string" },
  } });
  if (positionals.length !== 1) policy.block("invalid_cli_arguments");
  let result;
  if (positionals[0] === "prepare" && values.spec && !values.manifest && !values.report) {
    const file = await open(values.spec, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let spec: unknown;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > policy.localHandoffLimits.maxSpecBytes) policy.block("input_limit_exceeded");
      const buffer = Buffer.alloc(policy.localHandoffLimits.maxSpecBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > policy.localHandoffLimits.maxSpecBytes) policy.block("input_limit_exceeded");
      spec = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    } finally { await file.close(); }
    result = await handoff.prepareLocalHandoff({ repository: values.repo ?? process.cwd(), spec, out: values.out });
  } else if (positionals[0] === "review" && values.manifest && values.report && !values.spec) {
    result = await handoff.reviewLocalHandoff({ repository: values.repo ?? process.cwd(), manifest: values.manifest, report: values.report, out: values.out });
  } else policy.block("invalid_cli_arguments");
  if (!result) throw new policy.HandoffBlocked("invalid_cli_arguments");
  console.log(JSON.stringify({ status: result.status, reasons: result.reasons }));
  process.exitCode = result.status === "blocked" ? 2 : 0;
} catch (error) {
  console.log(JSON.stringify({ status: "blocked", reasons: [error instanceof policy.HandoffBlocked ? error.code : "local_input_unavailable"] }));
  process.exitCode = 2;
}
