import { fetchTOCA, ConjunctionEvent, TOCAPosition } from "./api.js";

// CesiumJS is loaded globally from CDN — declare the global type
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
    fromCssColorString(s: string): unknown;
  };
  ClockRange: { LOOP_STOP: unknown };
  ReferenceFrame: { FIXED: unknown };
  SampledPositionProperty: new (referenceFrame?: unknown) => CesiumSampledPositionProperty;
  PolylineGlowMaterialProperty: new (options: Record<string, unknown>) => unknown;
  DistanceDisplayCondition: new (near: number, far: number) => unknown;
  TileMapServiceImageryProvider: new (options: Record<string, unknown>) => unknown;
  buildModuleUrl(resource: string): string;
};

interface CesiumCartesian3 {
  x: number;
  y: number;
  z: number;
}
interface CesiumJulianDate {
  clone(): CesiumJulianDate;
}
interface CesiumSampledPositionProperty {
  addSample(time: CesiumJulianDate, position: CesiumCartesian3): void;
}
interface CesiumTimeline {
  zoomTo(start: CesiumJulianDate, stop: CesiumJulianDate): void;
}
interface CesiumClock {
  startTime: CesiumJulianDate;
  stopTime: CesiumJulianDate;
  currentTime: CesiumJulianDate;
  clockRange: unknown;
  multiplier: number;
}
interface CesiumCamera {
  flyTo(options: Record<string, unknown>): void;
}
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

function cartesianFromECIKm(
  pos: [number, number, number],
  _time: Date
): CesiumCartesian3 {
  // positions from the API are in ECEF km; convert to metres
  return new Cesium.Cartesian3(pos[0] * 1000, pos[1] * 1000, pos[2] * 1000);
}

function buildSampledProperty(
  positions: TOCAPosition[],
  satKey: "sat1_pos" | "sat2_pos"
): CesiumSampledPositionProperty {
  const prop = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.FIXED);
  for (const p of positions) {
    const t = Cesium.JulianDate.fromIso8601(p.time);
    const cart = cartesianFromECIKm(p[satKey], new Date(p.time));
    prop.addSample(t, cart);
  }
  return prop;
}

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
    const tocaData = await fetchTOCA(evt.id);

    if (!viewer) {
      // Use a token if VITE_CESIUM_TOKEN is set, otherwise use offline imagery
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

    if (tocaData.positions.length === 0) return;

    const start = Cesium.JulianDate.fromIso8601(tocaData.positions[0].time);
    const stop = Cesium.JulianDate.fromIso8601(
      tocaData.positions[tocaData.positions.length - 1].time
    );
    const tocaJD = Cesium.JulianDate.fromIso8601(tocaData.toca);

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = tocaJD.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 30;
    viewer.timeline.zoomTo(start, stop);

    const sat1Prop = buildSampledProperty(tocaData.positions, "sat1_pos");
    const sat2Prop = buildSampledProperty(tocaData.positions, "sat2_pos");

    viewer.entities.add({
      name: evt.sat1.name,
      position: sat1Prop,
      point: { pixelSize: 10, color: Cesium.Color.CYAN },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.CYAN,
        }),
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
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.ORANGE,
        }),
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

    // Fly to TOCA position (midpoint of the two satellites at TOCA)
    const tocaPos = tocaData.positions.find((p) => p.time === tocaData.toca)
      ?? tocaData.positions[Math.floor(tocaData.positions.length / 2)];
    const mid = Cesium.Cartesian3.midpoint(
      cartesianFromECIKm(tocaPos.sat1_pos, new Date(tocaPos.time)),
      cartesianFromECIKm(tocaPos.sat2_pos, new Date(tocaPos.time)),
      new Cesium.Cartesian3()
    );
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.multiplyByScalar(
        Cesium.Cartesian3.normalize(mid, new Cesium.Cartesian3()),
        Cesium.Cartesian3.magnitude(mid) + 2_000_000,
        new Cesium.Cartesian3()
      ),
      duration: 2,
    });
  } catch (err) {
    container.innerHTML = `<div class="error-msg" style="margin:20px;">Failed to load TOCA data: ${(err as Error).message}</div>`;
  }
}
