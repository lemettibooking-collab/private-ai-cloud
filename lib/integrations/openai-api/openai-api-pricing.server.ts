// Node-only trusted nonsecret pricing source. Never import into a browser component.
import { constants, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "../../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOpenAIApiPrice } from "./openai-api-policy.ts";
/** Operator verifies standard uncached USD rates and dated model against official pricing,
 * then installs this 0600 file atomically. No browser field, key, model output or network fetch.
 * Empty/missing/stale catalog denies; there is intentionally no guessed default model/price. */
export async function readOpenAIApiPricing(model: string, now: number, path = join(homedir(), ".config/private-ai-cloud/openai-api-pricing.json")) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await file.stat();
    if (!s.isFile() || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 || s.size > 16384) return null;
    const b = Buffer.alloc(16385), r = await file.read(b,0,b.length,0);
    if (r.bytesRead !== s.size) return null;
    const c = exactOwnData(JSON.parse(b.subarray(0,r.bytesRead).toString("utf8")),["version","prices"]);
    if (!c || c.version !== 1 || !Array.isArray(c.prices) || !c.prices.length || c.prices.length > 20) return null;
    const entries = c.prices.map(p => normalizeOpenAIApiPrice(p,now));
    if (entries.some(p => !p) || new Set(entries.map(p=>p!.model)).size !== entries.length) return null;
    return entries.find(p=>p!.model===model) ?? null;
  } catch { return null; } finally { await file?.close(); }
}
