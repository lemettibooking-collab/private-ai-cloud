// Fixed local probes; no environment, SQL, provider or error detail in health output.
const health = await import(new URL("../../lib/deployment/health.ts", import.meta.url).href) as typeof import("../../lib/deployment/health");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");

async function main(): Promise<boolean> {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "live" && mode !== "ready")) return false;
  if (!await health.appIsAlive()) return false;
  if (mode === "live") return true;
  let database: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase> | undefined;
  try {
    const url = new URL(postgres.workflowRuntimePostgresConnectionString(process.env.DATABASE_URL));
    url.searchParams.set("statement_timeout", "2000");
    database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: url.toString(), maxConnections: 1 });
    return await health.databaseIsReady(database);
  } catch { return false; }
  finally { await database?.close().catch(() => undefined); }
}
// Also bounds connection+HTTP+query teardown, not just statement execution.
const deadline = setTimeout(() => { process.stdout.write("unavailable\n"); process.exit(1); }, 8000);
const ok = await main().catch(() => false);
clearTimeout(deadline);
process.stdout.write(ok ? "ok\n" : "unavailable\n");
process.exitCode = ok ? 0 : 1;
