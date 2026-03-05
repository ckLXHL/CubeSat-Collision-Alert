import type { KVEnv, TLERecord } from "./types.js";
import { handleCron } from "./cron.js";
import { computeTOCAPositions } from "./conjunction.js";

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

async function handleGetTLE(env: KVEnv, url: URL): Promise<Response> {
  const raw = await env.TLE_KV.get("tle:latest");
  if (!raw) {
    return corsResponse({
      updated_at: new Date().toISOString(),
      total: 0,
      page: 1,
      limit: 100,
      data: [],
    });
  }

  const parsed = JSON.parse(raw) as {
    updated_at: string;
    count: number;
    data: TLERecord[];
  };

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)));
  const offset = (page - 1) * limit;
  const slice = parsed.data.slice(offset, offset + limit);

  return corsResponse({
    updated_at: parsed.updated_at,
    total: parsed.count,
    page,
    limit,
    data: slice,
  });
}

async function handleGetTLEById(env: KVEnv, id: string): Promise<Response> {
  const raw = await env.TLE_KV.get("tle:latest");
  if (!raw) return notFound("No TLE data available");

  const parsed = JSON.parse(raw) as { updated_at: string; count: number; data: TLERecord[] };
  const record = parsed.data.find(
    (r) => r.norad_id === id || r.name.toLowerCase() === id.toLowerCase()
  );
  if (!record) return notFound(`Satellite '${id}' not found`);
  return corsResponse(record);
}

async function handleGetTOCA(env: KVEnv, conjunctionId: string): Promise<Response> {
  // Conjunction IDs are formatted as evt_{noradId1}_{noradId2}
  const match = conjunctionId.match(/^evt_(\d+)_(\d+)$/);
  if (!match) return notFound("Invalid conjunction ID");

  const [, id1, id2] = match;

  const raw = await env.TLE_KV.get("tle:latest");
  if (!raw) return serverError("TLE data not available");

  const parsed = JSON.parse(raw) as { data: TLERecord[] };
  const sat1 = parsed.data.find((r) => r.norad_id === id1);
  const sat2 = parsed.data.find((r) => r.norad_id === id2);

  if (!sat1 || !sat2) {
    return notFound(`One or both satellites not found (${id1}, ${id2})`);
  }

  // Get TOCA time from the conjunction list
  const conjRaw = await env.TLE_KV.get("conjunctions:latest");
  let tocaIso = new Date().toISOString();
  if (conjRaw) {
    const conjData = JSON.parse(conjRaw) as { conjunctions: { id: string; toca: string }[] };
    const evt = conjData.conjunctions.find((e) => e.id === conjunctionId);
    if (evt) tocaIso = evt.toca;
  }

  const tocaData = computeTOCAPositions(sat1, sat2, tocaIso);
  return corsResponse(tocaData);
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

    // Route: GET /api/tle
    if (path === "/api/tle" && request.method === "GET") {
      return handleGetTLE(env, url);
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
