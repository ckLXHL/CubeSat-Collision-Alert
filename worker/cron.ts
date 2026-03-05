import type { KVEnv } from "./types.js";
import { fetchSOCRATES } from "./socrates.js";
import { fetchTLEsByNoradIds } from "./tle.js";

/**
 * Cron handler: fetch SOCRATES conjunction predictions, pull TLEs only for
 * the involved satellites, and write results to Cloudflare KV.
 *
 * This keeps Worker CPU usage minimal — no orbital propagation performed here.
 */
export async function handleCron(env: KVEnv): Promise<void> {
  const startTs = Date.now();
  console.log("[cron] Starting SOCRATES fetch…");

  // 1. Fetch pre-computed conjunction predictions from SOCRATES
  const conjunctions = await fetchSOCRATES();
  console.log(`[cron] Got ${conjunctions.length} conjunction events in ${Date.now() - startTs}ms`);

  // 2. Collect the unique NORAD IDs of all involved satellites
  const noradIds = Array.from(
    new Set(conjunctions.flatMap((c) => [c.sat1.norad_id, c.sat2.norad_id]))
  );
  console.log(`[cron] Fetching TLEs for ${noradIds.length} satellites…`);

  // 3. Fetch TLEs only for those satellites (targeted pull → small KV payload)
  const tleRecords = await fetchTLEsByNoradIds(noradIds);
  console.log(`[cron] Fetched ${tleRecords.length} TLE records in ${Date.now() - startTs}ms`);

  const now = new Date().toISOString();

  // 4. Persist high-risk-only TLE set
  await env.TLE_KV.put(
    "tle:high_risk",
    JSON.stringify({
      updated_at: now,
      count: tleRecords.length,
      data: tleRecords,
    })
  );

  // 5. Persist conjunction list
  await env.TLE_KV.put(
    "conjunctions:latest",
    JSON.stringify({ updated_at: now, conjunctions })
  );

  // 6. Update global last-updated timestamp
  await env.TLE_KV.put("meta:last_updated", now);

  console.log(`[cron] Done in ${Date.now() - startTs}ms`);
}

