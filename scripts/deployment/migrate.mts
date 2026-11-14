// Explicit, local operator command only. No startup hook, seed, provider or automatic retry.
import { fileURLToPath } from "node:url";
const migrations = await import(new URL("../../lib/deployment/migrations.ts", import.meta.url).href) as typeof import("../../lib/deployment/migrations");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");

async function main(): Promise<number> {
  if (process.argv.length !== 3 || process.argv[2] !== "apply") {
    process.stderr.write("Usage: node scripts/deployment/migrate.mts apply\n");
    return 1;
  }
  let database: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase> | undefined;
  try {
    // Startup options stay in the shared pg adapter; bound server statements via the URL.
    const url = new URL(postgres.workflowRuntimePostgresConnectionString(process.env.DATABASE_URL));
    url.searchParams.set("statement_timeout", "60000");
    database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: url.toString(), maxConnections: 1 });
    const result = await migrations.applyDeploymentMigrations(database, fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
    process.stdout.write(`migration_gate_ok applied=${result.applied} total=${result.total}\n`);
    return 0;
  } catch {
    process.stderr.write("migration_gate_denied\n");
    return 1;
  } finally { await database?.close().catch(() => undefined); }
}
process.exitCode = await main();
