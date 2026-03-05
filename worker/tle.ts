import type { TLERecord } from "./types.js";

// Primary: active LEO satellites TLE text feed from CelesTrak
const ACTIVE_SAT_TLE_URL =
  "https://celestrak.org/pub/TLE/active.txt";

/**
 * Fetch the latest TLE data for active LEO satellites from CelesTrak.
 * Returns an array of TLERecord objects.
 */
export async function fetchTLEData(): Promise<TLERecord[]> {
  const res = await fetch(ACTIVE_SAT_TLE_URL, {
    headers: { "User-Agent": "CubeSat-Collision-Alert/1.0" },
  });
  if (!res.ok) {
    throw new Error(`CelesTrak fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseTLE3Line(text);
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
