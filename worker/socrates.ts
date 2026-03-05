import type { ConjunctionEvent } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
//  CelesTrak SOCRATES — Satellite Orbital Conjunction Reports Assessing
//  Threatening Encounters in Space
//
//  SOCRATES provides pre-computed conjunction predictions for the next 7 days.
//  We fetch only the next 72-hour window and filter for high-risk events.
// ──────────────────────────────────────────────────────────────────────────────

const SOCRATES_URL =
  "https://celestrak.org/SOCRATES/query.php" +
  "?CODE=ALL&FORMAT=csv&SORT=MIN_RNG&SORTORDER=0" +
  "&ALT=LEO&DAYSAHEAD=3&MAXRNG=200&RESULTSIZE=20";

const ALERT_THRESHOLD_KM = 10;
const TOP_N = 10;

/**
 * Parsed record from one CSV row.
 */
interface SOCRATESRow {
  name1: string;
  norad1: string;
  name2: string;
  norad2: string;
  /** ISO-8601 string */
  tca: string;
  /** km */
  minRange: number;
  /** km/s */
  relSpeed: number;
  maxProb: number;
}

/**
 * Parse a SOCRATES CSV response into structured rows.
 *
 * SOCRATES CSV header (as of 2026):
 * Satellite Name 1,Satellite Number 1,Satellite Name 2,Satellite Number 2,
 * Days Until TCA,TCA (days from epoch),TCA,TCA Range (km),
 * TCA Relative Speed (km/s),Max Probability,Dilution Threshold,Min Range (km),Next TCA
 *
 * Column indices (0-based):
 *  0  Satellite Name 1
 *  1  Satellite Number 1
 *  2  Satellite Name 2
 *  3  Satellite Number 2
 *  4  Days Until TCA
 *  5  TCA (days from epoch)  — skip
 *  6  TCA  (e.g. "2026-03-06 08:23:11 UTC")
 *  7  TCA Range (km)
 *  8  TCA Relative Speed (km/s)
 *  9  Max Probability
 * 10  Dilution Threshold      — skip
 * 11  Min Range (km)
 * 12  Next TCA                — skip
 */
export function parseSOCRATESCSV(csv: string): SOCRATESRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Skip header row
  const rows: SOCRATESRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]);
    if (cols.length < 12) continue;

    const name1 = cols[0].trim();
    const norad1 = cols[1].trim();
    const name2 = cols[2].trim();
    const norad2 = cols[3].trim();
    const tcaRaw = cols[6].trim(); // e.g. "2026-03-06 08:23:11 UTC"
    const rangeKm = parseFloat(cols[7]);
    const relSpeed = parseFloat(cols[8]);
    const maxProb = parseFloat(cols[9]);
    const minRange = parseFloat(cols[11]);

    if (!name1 || !norad1 || !name2 || !norad2) continue;
    if (isNaN(rangeKm) || isNaN(minRange)) continue;

    // Parse TCA string → ISO-8601
    const tca = parseTCAString(tcaRaw);
    if (!tca) continue;

    rows.push({ name1, norad1, name2, norad2, tca, minRange, relSpeed, maxProb });
  }
  return rows;
}

/**
 * Handle quoted and unquoted CSV columns.
 */
function splitCSVRow(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

/**
 * Convert SOCRATES TCA string to ISO-8601.
 * Input formats:
 *   "2026-03-06 08:23:11 UTC"
 *   "2026-03-06T08:23:11.000"
 */
function parseTCAString(raw: string): string | null {
  if (!raw) return null;
  // Replace space-separated UTC format
  const normalised = raw.replace(" UTC", "Z").replace(/ /g, "T");
  const d = new Date(normalised);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Convert SOCRATES rows to ConjunctionEvent objects, filtering to high-risk events
 * (min_range < threshold or max_probability > threshold) and returning top N.
 */
export function toConjunctionEvents(rows: SOCRATESRow[]): ConjunctionEvent[] {
  return rows
    .filter((r) => r.minRange < 200) // already filtered by SOCRATES URL, belt-and-suspenders
    .slice(0, TOP_N)
    .map((r) => {
      const id = `evt_${r.norad1}_${r.norad2}`;
      const confidence: "high" | "medium" | "low" =
        r.minRange < ALERT_THRESHOLD_KM ? "high" : r.minRange < 50 ? "medium" : "low";
      return {
        id,
        sat1: { name: r.name1, norad_id: r.norad1 },
        sat2: { name: r.name2, norad_id: r.norad2 },
        toca: r.tca,
        min_distance_km: parseFloat(r.minRange.toFixed(3)),
        pc: isNaN(r.maxProb) ? 0 : parseFloat(r.maxProb.toExponential(4)),
        data_confidence: confidence,
      };
    });
}

/**
 * Fetch and parse SOCRATES conjunction predictions.
 * Returns a list of ConjunctionEvent objects sorted by distance (closest first).
 */
export async function fetchSOCRATES(): Promise<ConjunctionEvent[]> {
  const res = await fetch(SOCRATES_URL, {
    headers: { "User-Agent": "CubeSat-Collision-Alert/1.0" },
  });
  if (!res.ok) {
    throw new Error(`SOCRATES fetch failed: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  const rows = parseSOCRATESCSV(csv);
  return toConjunctionEvents(rows);
}
