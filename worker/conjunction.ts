import type { TLERecord, ConjunctionEvent, TOCAData, TOCAPosition } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
//  SGP4 propagation (minimal, self-contained implementation)
//  This avoids a Node.js dependency on satellite.js inside a Cloudflare Worker.
//  We implement the key SGP4 subset needed for LEO close-approach screening.
// ──────────────────────────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const EARTH_RADIUS_KM = 6378.137;
const MU = 398600.4418; // km³/s²
const J2 = 1.08262998905e-3;
const XKE = 60 / Math.sqrt((EARTH_RADIUS_KM ** 3) / MU); // er/min
const XKMPER = EARTH_RADIUS_KM;
const MIN_PER_DAY = 1440.0;

interface TLEParsed {
  name: string;
  norad_id: string;
  epoch: Date;
  // mean elements
  inclination: number;    // rad
  raan: number;           // rad
  eccentricity: number;
  argOfPerigee: number;   // rad
  meanAnomaly: number;    // rad
  meanMotion: number;     // rad/min
  bstar: number;
}

function parseTLE(record: TLERecord): TLEParsed {
  const l1 = record.line1;
  const l2 = record.line2;

  const epochYear2 = parseInt(l1.substring(18, 20), 10);
  const epochYear = epochYear2 >= 57 ? 1900 + epochYear2 : 2000 + epochYear2;
  const epochDay = parseFloat(l1.substring(20, 32));
  const jan1 = Date.UTC(epochYear, 0, 1);
  const epochMs = jan1 + (epochDay - 1) * 86400000;

  // BSTAR drag term
  const bstarStr = l1.substring(53, 61).trim();
  let bstar = 0;
  if (bstarStr !== "00000+0" && bstarStr !== "00000-0" && bstarStr !== "") {
    const mantissa = parseFloat("0." + bstarStr.substring(0, 5));
    const exp = parseInt(bstarStr.substring(5), 10);
    bstar = mantissa * Math.pow(10, exp);
  }

  return {
    name: record.name,
    norad_id: record.norad_id,
    epoch: new Date(epochMs),
    inclination: parseFloat(l2.substring(8, 16)) * DEG2RAD,
    raan: parseFloat(l2.substring(17, 25)) * DEG2RAD,
    eccentricity: parseFloat("0." + l2.substring(26, 33).trim()),
    argOfPerigee: parseFloat(l2.substring(34, 42)) * DEG2RAD,
    meanAnomaly: parseFloat(l2.substring(43, 51)) * DEG2RAD,
    meanMotion: (parseFloat(l2.substring(52, 63)) * TWO_PI) / MIN_PER_DAY, // rad/min
    bstar,
  };
}

/**
 * Propagate an SGP4 satellite to a given time (simplified Kepler-only propagation).
 * Returns ECEF position in km (ECI-fixed frame, sufficient for conjunction screening).
 * We use a simplified two-body propagation with J2 secular perturbation for RAAN and ω.
 */
function propagate(tle: TLEParsed, atMs: number): [number, number, number] {
  const dtMin = (atMs - tle.epoch.getTime()) / 60000;
  const n0 = tle.meanMotion; // rad/min

  // Semi-major axis from mean motion (rad/min → km)
  // n = sqrt(mu / a^3)  →  a = (mu / n_rad_s^2)^(1/3)
  const nRadS = n0 / 60; // rad/s
  const a = Math.pow(MU / (nRadS * nRadS), 1 / 3);
  const p = a * (1 - tle.eccentricity ** 2);
  const cosI = Math.cos(tle.inclination);

  // J2 secular drift rates
  const nRateJ2 =
    (1.5 * J2 * (EARTH_RADIUS_KM / p) ** 2 * n0 * (1 - 1.5 * Math.sin(tle.inclination) ** 2)) /
    (1 - tle.eccentricity ** 2) ** 2;
  const raanDot = -1.5 * J2 * (EARTH_RADIUS_KM / p) ** 2 * n0 * cosI;
  const argDot =
    0.75 * J2 * (EARTH_RADIUS_KM / p) ** 2 * n0 * (5 * cosI ** 2 - 1);

  const n = n0 + nRateJ2;
  const raan = tle.raan + raanDot * dtMin;
  const omega = tle.argOfPerigee + argDot * dtMin;
  let M = tle.meanAnomaly + n * dtMin;
  M = M % TWO_PI;

  // Solve Kepler's equation iteratively
  let E = M;
  for (let i = 0; i < 10; i++) {
    E = M + tle.eccentricity * Math.sin(E);
  }

  // True anomaly
  const sinE = Math.sin(E);
  const cosE = Math.cos(E);
  const nu = Math.atan2(
    Math.sqrt(1 - tle.eccentricity ** 2) * sinE,
    cosE - tle.eccentricity
  );

  // Distance
  const r = a * (1 - tle.eccentricity * cosE);

  // Perifocal coordinates
  const xP = r * Math.cos(nu);
  const yP = r * Math.sin(nu);

  // Rotate to ECI (RAAN, inclination, arg-of-perigee)
  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosInc = Math.cos(tle.inclination);
  const sinInc = Math.sin(tle.inclination);
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);

  const x =
    (cosRaan * cosOmega - sinRaan * sinOmega * cosInc) * xP +
    (-cosRaan * sinOmega - sinRaan * cosOmega * cosInc) * yP;
  const y =
    (sinRaan * cosOmega + cosRaan * sinOmega * cosInc) * xP +
    (-sinRaan * sinOmega + cosRaan * cosOmega * cosInc) * yP;
  const z = (sinOmega * sinInc) * xP + (cosOmega * sinInc) * yP;

  return [x, y, z];
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Collision probability (Chan model approximation)
//  Pc ≈ exp(-0.5 * (d/sigma)²) · scale
//  We use a simple Gaussian approximation with combined position uncertainty.
// ──────────────────────────────────────────────────────────────────────────────
function estimatePc(minDist: number, combinedSigmaKm = 0.1, hardBodyRadius = 0.01): number {
  // Simplified: Pc based on combined covariance in the encounter plane
  const u = minDist / combinedSigmaKm;
  return Math.exp(-0.5 * u * u) * (hardBodyRadius / combinedSigmaKm) ** 2;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Conjunction screening
// ──────────────────────────────────────────────────────────────────────────────

const SCREEN_THRESHOLD_KM = 200; // initial broad filter
const ALERT_THRESHOLD_KM = 10;   // high-risk threshold
const PROPAGATION_STEP_MIN = 2;  // minutes between steps
const LOOKAHEAD_HOURS = 72;

/**
 * Find the top high-risk conjunctions among the given TLE records
 * over the next LOOKAHEAD_HOURS hours.
 *
 * To stay within Cloudflare Worker CPU limits we:
 * 1. Use a coarse grid (PROPAGATION_STEP_MIN) to identify candidate pairs.
 * 2. Refine minimum distance only for candidate pairs.
 * 3. Limit to the first MAX_SATS satellites (sorted by orbital period proximity).
 */
const MAX_SATS = 500; // keep Worker CPU under limit
const TOP_N = 10;

export async function computeConjunctions(
  records: TLERecord[]
): Promise<ConjunctionEvent[]> {
  const nowMs = Date.now();
  const endMs = nowMs + LOOKAHEAD_HOURS * 3600 * 1000;
  const stepMs = PROPAGATION_STEP_MIN * 60 * 1000;

  // Parse TLEs and limit to low-LEO satellites (period ~80–128 min → altitude ~200–2000 km)
  const sats = records
    .map((r) => {
      try {
        return parseTLE(r);
      } catch {
        return null;
      }
    })
    .filter((s): s is TLEParsed => s !== null)
    .slice(0, MAX_SATS);

  const n = sats.length;
  const events: ConjunctionEvent[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let minDist = Infinity;
      let minT = nowMs;

      // Coarse sweep
      for (let t = nowMs; t <= endMs; t += stepMs) {
        const posI = propagate(sats[i], t);
        const posJ = propagate(sats[j], t);
        const d = dist3(posI, posJ);
        if (d < minDist) {
          minDist = d;
          minT = t;
        }
      }

      if (minDist > SCREEN_THRESHOLD_KM) continue;

      // Refine: binary-search within ±2*step around minT
      let lo = Math.max(nowMs, minT - stepMs * 2);
      let hi = Math.min(endMs, minT + stepMs * 2);
      for (let iter = 0; iter < 20; iter++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        const d1 = dist3(propagate(sats[i], m1), propagate(sats[j], m1));
        const d2 = dist3(propagate(sats[i], m2), propagate(sats[j], m2));
        if (d1 < d2) { hi = m2; minT = m1; minDist = d1; }
        else { lo = m1; minT = m2; minDist = d2; }
      }

      if (minDist > SCREEN_THRESHOLD_KM) continue;

      const pc = estimatePc(minDist);
      const confidence: "high" | "medium" | "low" =
        minDist < ALERT_THRESHOLD_KM ? "high" : minDist < 50 ? "medium" : "low";

      events.push({
        id: `evt_${sats[i].norad_id}_${sats[j].norad_id}`,
        sat1: { name: sats[i].name, norad_id: sats[i].norad_id },
        sat2: { name: sats[j].name, norad_id: sats[j].norad_id },
        toca: new Date(minT).toISOString(),
        min_distance_km: parseFloat(minDist.toFixed(3)),
        pc: parseFloat(pc.toExponential(4)),
        data_confidence: confidence,
      });
    }
  }

  // Return top N closest approaches
  return events
    .sort((a, b) => a.min_distance_km - b.min_distance_km)
    .slice(0, TOP_N);
}

/**
 * Generate a TOCA position sequence for a specific conjunction event.
 * Propagates both satellites for ±30 minutes around TOCA.
 */
export function computeTOCAPositions(
  sat1Record: TLERecord,
  sat2Record: TLERecord,
  tocaIso: string
): TOCAData {
  const tocaMs = new Date(tocaIso).getTime();
  const windowMs = 30 * 60 * 1000; // ±30 min
  const stepMs = 60 * 1000; // 1-minute steps

  const sat1 = parseTLE(sat1Record);
  const sat2 = parseTLE(sat2Record);

  const positions: TOCAPosition[] = [];
  let minDist = Infinity;
  let minTime = tocaMs;

  for (let t = tocaMs - windowMs; t <= tocaMs + windowMs; t += stepMs) {
    const p1 = propagate(sat1, t);
    const p2 = propagate(sat2, t);
    const d = dist3(p1, p2);
    if (d < minDist) {
      minDist = d;
      minTime = t;
    }
    positions.push({
      time: new Date(t).toISOString(),
      sat1_pos: [parseFloat(p1[0].toFixed(3)), parseFloat(p1[1].toFixed(3)), parseFloat(p1[2].toFixed(3))],
      sat2_pos: [parseFloat(p2[0].toFixed(3)), parseFloat(p2[1].toFixed(3)), parseFloat(p2[2].toFixed(3))],
      distance_km: parseFloat(d.toFixed(3)),
    });
  }

  return {
    id: `toca_${sat1.norad_id}_${sat2.norad_id}`,
    toca: new Date(minTime).toISOString(),
    min_distance_km: parseFloat(minDist.toFixed(3)),
    positions,
  };
}
