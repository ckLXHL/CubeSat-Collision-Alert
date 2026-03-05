import type { KVEnv, TLERecord, TOCAResponse } from "./types.js";
import { handleCron } from "./cron.js";

// ──────────────────────────────────────────────────────────────────────────────
//  CORS headers
// ──────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...CORS_HEADERS,
    },
  });
}

function notFound(message = "Not found"): Response {
  return corsResponse({ error: message }, 404);
}

function serverError(message: string): Response {
  return corsResponse({ error: message }, 500);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Route handlers
// ──────────────────────────────────────────────────────────────────────────────

async function handleGetConjunctions(env: KVEnv): Promise<Response> {
  const raw = await env.TLE_KV.get("conjunctions:latest");
  if (!raw) {
    return corsResponse({
      updated_at: new Date().toISOString(),
      conjunctions: [],
    });
  }
  return new Response(raw, {
    status: 200,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...CORS_HEADERS,
    },
  });
}

/** GET /api/tle/high-risk — all TLEs for satellites in the current high-risk list */
async function handleGetHighRiskTLE(env: KVEnv): Promise<Response> {
  const raw = await env.TLE_KV.get("tle:high_risk");
  if (!raw) {
    return corsResponse({ updated_at: new Date().toISOString(), count: 0, data: [] });
  }
  return new Response(raw, {
    status: 200,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...CORS_HEADERS,
    },
  });
}

/** GET /api/tle/:id — single TLE by NORAD ID or satellite name */
async function handleGetTLEById(env: KVEnv, id: string): Promise<Response> {
  const raw = await env.TLE_KV.get("tle:high_risk");
  if (!raw) return notFound("No TLE data available");

  const parsed = JSON.parse(raw) as { data: TLERecord[] };
  const record = parsed.data.find(
    (r) => r.norad_id === id || r.name.toLowerCase() === id.toLowerCase()
  );
  if (!record) return notFound(`Satellite '${id}' not found`);
  return corsResponse(record);
}

/**
 * GET /api/conjunction/:id/toca
 *
 * Returns the TOCA time and the TLE records for both satellites so the
 * frontend can run SGP4 propagation client-side using satellite.js.
 * No position computation is performed in the Worker.
 */
async function handleGetTOCA(env: KVEnv, conjunctionId: string): Promise<Response> {
  // Conjunction IDs are formatted as evt_{noradId1}_{noradId2}
  const match = conjunctionId.match(/^evt_(\d+)_(\d+)$/);
  if (!match) return notFound("Invalid conjunction ID");

  const [, id1, id2] = match;

  // Look up TLEs from the high-risk cache
  const tleRaw = await env.TLE_KV.get("tle:high_risk");
  if (!tleRaw) return serverError("TLE data not available -- cron may not have run yet");

  const tleParsed = JSON.parse(tleRaw) as { data: TLERecord[] };
  const sat1 = tleParsed.data.find((r) => r.norad_id === id1);
  const sat2 = tleParsed.data.find((r) => r.norad_id === id2);

  if (!sat1 || !sat2) {
    return notFound(`TLE not found for one or both satellites (${id1}, ${id2})`);
  }

  // Look up TOCA time from the conjunction list
  const conjRaw = await env.TLE_KV.get("conjunctions:latest");
  let tocaIso = new Date().toISOString();
  let minDistKm = 0;
  if (conjRaw) {
    const conjData = JSON.parse(conjRaw) as {
      conjunctions: { id: string; toca: string; min_distance_km: number }[];
    };
    const evt = conjData.conjunctions.find((e) => e.id === conjunctionId);
    if (evt) {
      tocaIso = evt.toca;
      minDistKm = evt.min_distance_km;
    }
  }

  const response: TOCAResponse = {
    id: conjunctionId,
    toca: tocaIso,
    min_distance_km: minDistKm,
    sat1_tle: sat1,
    sat2_tle: sat2,
  };
  return corsResponse(response);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Main export — Cloudflare Workers entry point
// ──────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: KVEnv): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Route: GET /api/conjunctions
    if (path === "/api/conjunctions" && request.method === "GET") {
      return handleGetConjunctions(env);
    }

    // Route: GET /api/tle/high-risk  (must be checked before /api/tle/:id)
    if (path === "/api/tle/high-risk" && request.method === "GET") {
      return handleGetHighRiskTLE(env);
    }

    // Route: GET /api/tle/:id
    const tleByIdMatch = path.match(/^\/api\/tle\/(.+)$/);
    if (tleByIdMatch && request.method === "GET") {
      return handleGetTLEById(env, decodeURIComponent(tleByIdMatch[1]));
    }

    // Route: GET /api/conjunction/:id/toca
    const tocaMatch = path.match(/^\/api\/conjunction\/(.+)\/toca$/);
    if (tocaMatch && request.method === "GET") {
      return handleGetTOCA(env, decodeURIComponent(tocaMatch[1]));
    }

    // Health check
    if (path === "/api/health" || path === "/") {
      return corsResponse({
        status: "ok",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      });
    }

    return notFound();
  },

  async scheduled(_event: ScheduledEvent, env: KVEnv): Promise<void> {
    await handleCron(env);
  },
};

