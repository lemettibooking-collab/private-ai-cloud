import { request } from "node:http";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";

// No new unauthenticated HTTP route. Probe existing local Next.js entry page, discard its body.
export function appIsAlive(port = 3000): Promise<boolean> {
  return new Promise(resolve => {
    let finished = false;
    const done = (ok: boolean) => { if (!finished) { finished = true; clearTimeout(timer); resolve(ok); } };
    const req = request({ host: "127.0.0.1", port, path: "/", method: "HEAD", timeout: 2000 }, res => {
      done(res.statusCode === 200); res.destroy();
    });
    const timer = setTimeout(() => { done(false); req.destroy(); }, 2500);
    req.on("timeout", () => { done(false); req.destroy(); });
    req.on("error", () => done(false));
    req.end();
  });
}

export async function databaseIsReady(database: WorkflowRuntimeDatabase): Promise<boolean> {
  let client: Awaited<ReturnType<WorkflowRuntimeDatabase["connect"]>> | undefined;
  let safe = false;
  try {
    client = await database.connect();
    const result = await client.query("select 1 as ready");
    safe = true;
    return result.rows.length === 1 && result.rows[0].ready === 1;
  } catch { return false; }
  finally { client?.release(!safe); }
}
