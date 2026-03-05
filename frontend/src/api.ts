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

export interface TLEResponse {
  updated_at: string;
  total: number;
  page: number;
  limit: number;
  data: TLERecord[];
}

export interface TOCAPosition {
  time: string;
  sat1_pos: [number, number, number];
  sat2_pos: [number, number, number];
  distance_km: number;
}

export interface TOCAResponse {
  id: string;
  toca: string;
  min_distance_km: number;
  positions: TOCAPosition[];
}

export async function fetchConjunctions(): Promise<ConjunctionsResponse> {
  const res = await fetch(`${API_BASE}/conjunctions`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchTLE(page = 1, limit = 100): Promise<TLEResponse> {
  const res = await fetch(`${API_BASE}/tle?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchTLEById(id: string): Promise<TLERecord> {
  const res = await fetch(`${API_BASE}/tle/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchTOCA(conjunctionId: string): Promise<TOCAResponse> {
  const res = await fetch(`${API_BASE}/conjunction/${encodeURIComponent(conjunctionId)}/toca`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}
