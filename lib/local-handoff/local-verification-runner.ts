import { spawn } from "node:child_process";
import type { VerificationRecord } from "./local-handoff-policy";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { parseVerificationCommand, redactEvidence, localHandoffLimits, freezeDeep, notRun } from "./local-handoff-policy.ts";

// AI-040a options are trusted composition/test dependencies, NEVER parsed from a handoff spec.
export type VerificationOptions = Readonly<{
  timeoutMs?: number; maxLogBytes?: number; now?: () => number; spawnProcess?: typeof spawn;
}>;
export function localChildEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  for (const name of Object.keys(env)) if (/^GIT_(?!OPTIONAL_LOCKS$|CONFIG_NOSYSTEM$|CONFIG_GLOBAL$|TERMINAL_PROMPT$)/u.test(name)) delete (env as NodeJS.ProcessEnv)[name];
  delete (env as NodeJS.ProcessEnv).NODE_OPTIONS;
  // A child verifier must be an independent Node test runner, not its parent's IPC test worker.
  delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT;
  return env;
}

export async function runLocalVerification(repository: string, input: string, options: VerificationOptions = {}): Promise<VerificationRecord> {
  const command = parseVerificationCommand(input);
  const environment = localChildEnvironment();
  if (!command) return freezeDeep({ ...notRun(redactEvidence(input.slice(0, 1024), environment)), status: "unsupported" as const });
  const timeoutMs = options.timeoutMs ?? localHandoffLimits.timeoutMs;
  const maxBytes = options.maxLogBytes ?? localHandoffLimits.maxLogBytes;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > localHandoffLimits.maxLogBytes) {
    return freezeDeep({ ...notRun(command.display), status: "failed" as const });
  }
  const now = options.now ?? Date.now, started = now();
  return await new Promise(resolve => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), stdoutTruncated = false, stderrTruncated = false;
    let timedOut = false, failed = false, settled = false;
    let child: ReturnType<typeof spawn>;
    let timer: ReturnType<typeof setTimeout> | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      if (child?.pid && process.platform !== "win32" && (timedOut || stdoutTruncated || stderrTruncated)) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* No surviving verifier group. */ }
      }
      const durationMs = Math.max(0, Math.round(now() - started));
      const evidence = (data: Buffer, truncated: boolean) => {
        if (truncated) return "[truncated evidence withheld]".slice(0, maxBytes);
        let value = data.toString("utf8");
        // Native Node timing is incidental; durationMs above is the explicit clock-bearing fact.
        if (command.executable === "node") value = value.replace(/(?:duration_ms: |# duration_ms |ℹ duration_ms )[0-9.]+/gu, "duration_ms: [clock]").replace(/\([0-9.]+ms\)/gu, "([clock]ms)");
        const redacted = redactEvidence(value, environment);
        // Redaction can expand very short environment values; never truncate a sensitive prefix.
        return Buffer.byteLength(redacted) > maxBytes ? "[bounded evidence withheld]".slice(0, maxBytes) : redacted;
      };
      resolve(freezeDeep({ command: command.display, status: timedOut ? "timed_out" : failed || stdoutTruncated || stderrTruncated || exitCode !== 0 ? "failed" : "passed",
        exitCode, durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        stdout: evidence(stdout, stdoutTruncated), stderr: evidence(stderr, stderrTruncated), stdoutTruncated, stderrTruncated }));
    };
    const kill = (signal: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited; never expose OS error. */ }
    };
    const stop = () => { kill("SIGTERM"); killTimer ??= setTimeout(() => kill("SIGKILL"), 100); };
    try {
      const args = command.executable === "git" ? ["--no-optional-locks", "-c", "core.fsmonitor=false", ...command.args] : [...command.args];
      child = (options.spawnProcess ?? spawn)(command.executable, args, {
        cwd: repository, env: environment, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      });
      const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const current = stream === "stdout" ? stdout : stderr;
        const remaining = maxBytes - current.length;
        const next = Buffer.concat([current, chunk.subarray(0, Math.max(0, remaining))]);
        if (stream === "stdout") stdout = next; else stderr = next;
        if (chunk.length > remaining) {
          if (stream === "stdout") stdoutTruncated = true; else stderrTruncated = true;
          failed = true; stop();
        }
      };
      child.stdout?.on("data", chunk => capture("stdout", Buffer.from(chunk)));
      child.stderr?.on("data", chunk => capture("stderr", Buffer.from(chunk)));
      child.once("error", () => { failed = true; finish(null); });
      child.once("close", code => finish(code));
      timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    } catch { failed = true; finish(null); }
  });
}
