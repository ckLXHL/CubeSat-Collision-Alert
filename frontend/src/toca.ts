import { twoline2satrec, propagate, eciToEcf, gstime } from "satellite.js";
import { fetchTOCA, ConjunctionEvent, TLERecord } from "./api.js";

// ──────────────────────────────────────────────────────────────────────────────
//  Minimal CesiumJS global type declarations (loaded from CDN)
// ──────────────────────────────────────────────────────────────────────────────
declare const Cesium: {
  Ion: { defaultAccessToken: string };
  Viewer: new (container: string | Element, options?: Record<string, unknown>) => CesiumViewer;
  JulianDate: {
    fromIso8601(iso: string): CesiumJulianDate;
  };
  Cartesian3: {
    new (x?: number, y?: number, z?: number): CesiumCartesian3;
    midpoint(a: CesiumCartesian3, b: CesiumCartesian3, result: CesiumCartesian3): CesiumCartesian3;
    multiplyByScalar(v: CesiumCartesian3, s: number, result: CesiumCartesian3): CesiumCartesian3;
    normalize(v: CesiumCartesian3, result: CesiumCartesian3): CesiumCartesian3;
    magnitude(v: CesiumCartesian3): number;
  };
  Cartesian2: new (x: number, y: number) => unknown;
  Color: {
    CYAN: unknown;
    ORANGE: unknown;
  };
  ClockRange: { LOOP_STOP: unknown };
  ReferenceFrame: { FIXED: unknown };
  SampledPositionProperty: new (referenceFrame?: unknown) => CesiumSampledPositionProperty;
  PolylineGlowMaterialProperty: new (options: Record<string, unknown>) => unknown;
  DistanceDisplayCondition: new (near: number, far: number) => unknown;
  TileMapServiceImageryProvider: new (options: Record<string, unknown>) => unknown;
  buildModuleUrl(resource: string): string;
};

interface CesiumCartesian3 { x: number; y: number; z: number }
interface CesiumJulianDate { clone(): CesiumJulianDate }
interface CesiumSampledPositionProperty {
  addSample(time: CesiumJulianDate, position: CesiumCartesian3): void;
}
interface CesiumTimeline { zoomTo(start: CesiumJulianDate, stop: CesiumJulianDate): void }
interface CesiumClock {
  startTime: CesiumJulianDate;
  stopTime: CesiumJulianDate;
  currentTime: CesiumJulianDate;
  clockRange: unknown;
  multiplier: number;
}
interface CesiumCamera { flyTo(options: Record<string, unknown>): void }
interface CesiumEntityCollection {
  add(entity: Record<string, unknown>): unknown;
  removeAll(): void;
}
interface CesiumViewer {
  clock: CesiumClock;
  timeline: CesiumTimeline;
  camera: CesiumCamera;
  entities: CesiumEntityCollection;
}

let viewer: CesiumViewer | null = null;

function formatDate(iso: string): string {
  return new Date(iso).toUTCString().replace("GMT", "UTC");
}

// ──────────────────────────────────────────────────────────────────────────────
//  SGP4 propagation using satellite.js
//  Generates a ±30-minute position sequence around the TOCA time.
// ──────────────────────────────────────────────────────────────────────────────

interface PropagatedPoint {
  time: Date;
  /** ECEF position in km */
  x: number;
  y: number;
  z: number;
}

function propagateSatellite(tle: TLERecord, tocaMs: number): PropagatedPoint[] {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  const windowMs = 30 * 60 * 1000; // ±30 minutes
  const stepMs = 60 * 1000;        // 1-minute steps
  const points: PropagatedPoint[] = [];

  for (let t = tocaMs - windowMs; t <= tocaMs + windowMs; t += stepMs) {
    const date = new Date(t);
    const result = propagate(satrec, date);
    const pos = result.position;
    if (!pos || typeof pos !== "object") continue;

    // Convert ECI → ECEF
    const gmst = gstime(date);
    const ecef = eciToEcf(pos as { x: number; y: number; z: number }, gmst);
    points.push({ time: date, x: ecef.x, y: ecef.y, z: ecef.z });
  }
  return points;
}

function buildSampledProperty(points: PropagatedPoint[]): CesiumSampledPositionProperty {
  const prop = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.FIXED);
  for (const p of points) {
    const jd = Cesium.JulianDate.fromIso8601(p.time.toISOString());
    // satellite.js returns km; CesiumJS needs metres
    prop.addSample(jd, new Cesium.Cartesian3(p.x * 1000, p.y * 1000, p.z * 1000));
  }
  return prop;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function loadTOCAView(evt: ConjunctionEvent): Promise<void> {
  // Update info bar
  (document.getElementById("toca-event-id") as HTMLElement).textContent = evt.id;
  (document.getElementById("toca-sat1") as HTMLElement).textContent =
    `${evt.sat1.name} (${evt.sat1.norad_id})`;
  (document.getElementById("toca-sat2") as HTMLElement).textContent =
    `${evt.sat2.name} (${evt.sat2.norad_id})`;
  (document.getElementById("toca-time") as HTMLElement).textContent = formatDate(evt.toca);
  (document.getElementById("toca-dist") as HTMLElement).textContent =
    `${evt.min_distance_km.toFixed(2)} km`;
  (document.getElementById("toca-pc") as HTMLElement).textContent =
    evt.pc.toExponential(2);

  const placeholder = document.getElementById("toca-placeholder") as HTMLElement;
  const container = document.getElementById("cesium-container") as HTMLElement;

  placeholder.style.display = "none";
  container.style.display = "block";

  try {
    // Fetch TLE data from the Worker (no position computation server-side)
    const tocaData = await fetchTOCA(evt.id);
    const tocaMs = new Date(tocaData.toca).getTime();

    // Propagate positions client-side using satellite.js SGP4
    const sat1Points = propagateSatellite(tocaData.sat1_tle, tocaMs);
    const sat2Points = propagateSatellite(tocaData.sat2_tle, tocaMs);

    if (sat1Points.length === 0 || sat2Points.length === 0) {
      container.innerHTML = `<div class="error-msg" style="margin:20px;">SGP4 propagation returned no positions — TLE may be invalid.</div>`;
      return;
    }

    // Initialise or reuse CesiumJS viewer
    if (!viewer) {
      const token = (import.meta as unknown as { env?: Record<string, string> })
        .env?.VITE_CESIUM_TOKEN;
      if (token) Cesium.Ion.defaultAccessToken = token;

      viewer = new Cesium.Viewer("cesium-container", {
        imageryProvider: token
          ? undefined
          : new Cesium.TileMapServiceImageryProvider({
              url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
            }),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: true,
        timeline: true,
        fullscreenButton: false,
      });
    } else {
      viewer.entities.removeAll();
    }

    const startIso = sat1Points[0].time.toISOString();
    const stopIso = sat1Points[sat1Points.length - 1].time.toISOString();
    const start = Cesium.JulianDate.fromIso8601(startIso);
    const stop = Cesium.JulianDate.fromIso8601(stopIso);
    const tocaJD = Cesium.JulianDate.fromIso8601(tocaData.toca);

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = tocaJD.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 30;
    viewer.timeline.zoomTo(start, stop);

    const sat1Prop = buildSampledProperty(sat1Points);
    const sat2Prop = buildSampledProperty(sat2Points);

    viewer.entities.add({
      name: evt.sat1.name,
      position: sat1Prop,
      point: { pixelSize: 10, color: Cesium.Color.CYAN },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.CYAN }),
        width: 2,
        leadTime: 0,
        trailTime: 600,
      },
      label: {
        text: evt.sat1.name,
        font: "12px sans-serif",
        fillColor: Cesium.Color.CYAN,
        pixelOffset: new Cesium.Cartesian2(12, 0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
      },
    });

    viewer.entities.add({
      name: evt.sat2.name,
      position: sat2Prop,
      point: { pixelSize: 10, color: Cesium.Color.ORANGE },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.ORANGE }),
        width: 2,
        leadTime: 0,
        trailTime: 600,
      },
      label: {
        text: evt.sat2.name,
        font: "12px sans-serif",
        fillColor: Cesium.Color.ORANGE,
        pixelOffset: new Cesium.Cartesian2(12, 0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
      },
    });

    // Fly camera to the TOCA position (midpoint between the two satellites at TOCA)
    const tocaIdx = Math.floor(sat1Points.length / 2);
    const p1 = sat1Points[tocaIdx];
    const p2 = sat2Points[tocaIdx];
    const midCart = Cesium.Cartesian3.midpoint(
      new Cesium.Cartesian3(p1.x * 1000, p1.y * 1000, p1.z * 1000),
      new Cesium.Cartesian3(p2.x * 1000, p2.y * 1000, p2.z * 1000),
      new Cesium.Cartesian3()
    );
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.multiplyByScalar(
        Cesium.Cartesian3.normalize(midCart, new Cesium.Cartesian3()),
        Cesium.Cartesian3.magnitude(midCart) + 2_000_000,
        new Cesium.Cartesian3()
      ),
      duration: 2,
    });
  } catch (err) {
    container.innerHTML = `<div class="error-msg" style="margin:20px;">Failed to load TOCA data: ${(err as Error).message}</div>`;
  }
}

