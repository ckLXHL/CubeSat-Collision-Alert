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

export interface TLERecord {
  name: string;
  norad_id: string;
  line1: string;
  line2: string;
  epoch: string;
}

/**
 * Response for /api/conjunction/:id/toca
 * Returns the TLE data for both satellites so the frontend can run
 * SGP4 propagation (via satellite.js) client-side.
 */
export interface TOCAResponse {
  id: string;
  toca: string;
  min_distance_km: number;
  sat1_tle: TLERecord;
  sat2_tle: TLERecord;
}

export interface KVEnv {
  TLE_KV: KVNamespace;
}

