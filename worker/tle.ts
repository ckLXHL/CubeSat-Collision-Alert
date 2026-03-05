import type { TLERecord } from "./types.js";

// CelesTrak GP data endpoint — supports targeted NORAD ID query
const CELESTRAK_GP_URL = "https://celestrak.org/SOCRATES/satcat.php";

// Bulk active-satellite TLE feed (used as a fallback for individual lookups)
const CELESTRAK_ACTIVE_TLE_URL = "https://celestrak.org/pub/TLE/active.txt";

/**
 * Fetch TLE records for a specific set of NORAD catalog IDs.
 * Uses CelesTrak's GP data API with individual catalog-number queries,
 * falling back to a bulk parse of the active-satellite feed if needed.
 *
 * Returns only TLERecord objects for the requested IDs.
 */
export async function fetchTLEsByNoradIds(noradIds: string[]): Promise<TLERecord[]> {
  if (noradIds.length === 0) return [];

  // CelesTrak supports a comma-separated CATNR query for up to ~200 objects
  const catnr = noradIds.slice(0, 200).join(",");
  const url =
    `https://celestrak.org/SOCRATES/satcat.php?CATNR=${encodeURIComponent(catnr)}&FORMAT=tle`;

  let res = await fetch(url, {
    headers: { "User-Agent": "CubeSat-Collision-Alert/1.0" },
  });

  // Fall back to the GP-data endpoint if the SOCRATES satcat rejects the request
  if (!res.ok) {
    const gpUrl =
      `https://celestrak.org/GP/GP.php?CATNR=${encodeURIComponent(catnr)}&FORMAT=tle`;
    res = await fetch(gpUrl, {
      headers: { "User-Agent": "CubeSat-Collision-Alert/1.0" },
    });
  }

  if (!res.ok) {
    throw new Error(`CelesTrak TLE fetch failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const all = parseTLE3Line(text);

  // Return only records whose NORAD ID was requested (deduplicate)
  const requested = new Set(noradIds);
  return all.filter((r) => requested.has(r.norad_id));
}

/**
 * Parse a 3-line TLE text block into TLERecord objects.
 * Format:
 *   NAME LINE
 *   1 XXXXX...
 *   2 XXXXX...
 */
export function parseTLE3Line(text: string): TLERecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const records: TLERecord[] = [];
  let i = 0;

  while (i < lines.length - 2) {
    const nameLine = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (line1.startsWith("1 ") && line2.startsWith("2 ")) {
      const noradId = line1.substring(2, 7).trim();
      const epoch = parseTLEEpoch(line1);
      records.push({
        name: nameLine.trim(),
        norad_id: noradId,
        line1,
        line2,
        epoch: epoch.toISOString(),
      });
      i += 3;
    } else {
      i += 1;
    }
  }

  return records;
}

/**
 * Parse TLE epoch from line 1 (columns 19–32, 0-indexed 18–31).
 * Format: YYDDD.DDDDDDDD — 2-digit year + day-of-year with fractional day.
 */
export function parseTLEEpoch(line1: string): Date {
  const epochStr = line1.substring(18, 32).trim();
  const year2 = parseInt(epochStr.substring(0, 2), 10);
  const year = year2 >= 57 ? 1900 + year2 : 2000 + year2;
  const dayOfYear = parseFloat(epochStr.substring(2));

  const jan1 = new Date(Date.UTC(year, 0, 1));
  const ms = (dayOfYear - 1) * 24 * 60 * 60 * 1000;
  return new Date(jan1.getTime() + ms);
}

/**
 * Check TLE data freshness: returns true if the given epoch is stale
 * (more than maxAgeHours old).
 */
export function isTLEStale(epochIso: string, maxAgeHours = 24): boolean {
  const epoch = new Date(epochIso).getTime();
  const ageMs = Date.now() - epoch;
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

