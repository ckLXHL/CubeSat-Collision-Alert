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

export interface TOCAPosition {
  time: string;
  sat1_pos: [number, number, number];
  sat2_pos: [number, number, number];
  distance_km: number;
}

export interface TOCAData {
  id: string;
  toca: string;
  min_distance_km: number;
  positions: TOCAPosition[];
}

export interface KVEnv {
  TLE_KV: KVNamespace;
}
