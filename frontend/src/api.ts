// API base URL — override via VITE_API_BASE env var for production
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env
  ?.VITE_API_BASE ?? "/api";

export interface SatelliteRef {
  name: string;
  norad_id: string;
}

export interface ConjunctionEvent {
  id: string;
  sat1: SatelliteRef;
  sat2: SatelliteRef;
  toca: string;
  min_distance_km: number;
  pc: number;
  data_confidence: "high" | "medium" | "low";
}

export interface ConjunctionsResponse {
  updated_at: string;
  conjunctions: ConjunctionEvent[];
}

export interface TLERecord {
  name: string;
  norad_id: string;
  line1: string;
  line2: string;
  epoch: string;
}

export interface HighRiskTLEResponse {
  updated_at: string;
  count: number;
  data: TLERecord[];
}

/**
 * TOCA response — the Worker returns TLE data for both satellites so the
 * frontend can run SGP4 propagation client-side using satellite.js.
 */
export interface TOCAResponse {
  id: string;
  toca: string;
  min_distance_km: number;
  sat1_tle: TLERecord;
  sat2_tle: TLERecord;
}

export async function fetchConjunctions(): Promise<ConjunctionsResponse> {
  const res = await fetch(`${API_BASE}/conjunctions`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

/** Fetch TLEs for all satellites currently in the high-risk conjunction list. */
export async function fetchHighRiskTLE(): Promise<HighRiskTLEResponse> {
  const res = await fetch(`${API_BASE}/tle/high-risk`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

/** Fetch TLE for a single satellite by NORAD ID or name. */
export async function fetchTLEById(id: string): Promise<TLERecord> {
  const res = await fetch(`${API_BASE}/tle/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch TOCA metadata for a conjunction.
 * The response contains TLE records for both satellites; SGP4 propagation
 * is performed client-side via satellite.js.
 */
export async function fetchTOCA(conjunctionId: string): Promise<TOCAResponse> {
  const res = await fetch(`${API_BASE}/conjunction/${encodeURIComponent(conjunctionId)}/toca`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

