import type { KVEnv } from "./types.js";
import { fetchTLEData } from "./tle.js";
import { computeConjunctions } from "./conjunction.js";

/**
 * Cron handler: fetch fresh TLE data, compute high-risk conjunctions,
 * and write results to Cloudflare KV.
 */
export async function handleCron(env: KVEnv): Promise<void> {
  const startTs = Date.now();
  console.log("[cron] Starting TLE fetch and conjunction computation…");

  // 1. Fetch TLE data from CelesTrak
  const records = await fetchTLEData();
  console.log(`[cron] Fetched ${records.length} TLE records in ${Date.now() - startTs}ms`);

  // 2. Persist TLE data to KV (paginated to avoid single-value size limits)
  const tleBatch = JSON.stringify({
    updated_at: new Date().toISOString(),
    count: records.length,
    data: records,
  });
  await env.TLE_KV.put("tle:latest", tleBatch);

  // 3. Compute high-risk conjunctions
  const conjunctions = await computeConjunctions(records);
  console.log(
    `[cron] Found ${conjunctions.length} conjunction events in ${Date.now() - startTs}ms`
  );

  // 4. Persist conjunction list to KV
  await env.TLE_KV.put(
    "conjunctions:latest",
    JSON.stringify({
      updated_at: new Date().toISOString(),
      conjunctions,
    })
  );

  // 5. Update global last-updated timestamp
  await env.TLE_KV.put("meta:last_updated", new Date().toISOString());

  console.log(`[cron] Done in ${Date.now() - startTs}ms`);
}
