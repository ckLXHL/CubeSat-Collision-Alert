# CubeSat Collision Alert 🛰️

A lightweight, serverless near-real-time collision monitoring platform for LEO satellites.

## Architecture

```
[CelesTrak]
     ↓  Cron Trigger (every 6 h)
[Cloudflare Workers]  →  TLE fetch, conjunction computation, KV write
     ↓
[Cloudflare KV]  →  TLE data · high-risk list · timestamps
     ↓  REST API
[Cloudflare Pages]  →  Static frontend (Vite + TypeScript + CesiumJS CDN)
```

## Features

| Module | Description |
|--------|-------------|
| **Risk Dashboard** | Live-scrolling list of the top 10 highest-risk satellite pairs in the next 72 hours, with collision probability gauges and configurable alert threshold (< 10 km). |
| **TOCA View** | 3-D CesiumJS visualization of the Time of Closest Approach for any selected conjunction event. |
| **CDM Translator** | Client-side parser for CDM (KVN or XML) files — converts covariance matrices into progress-bar Pc meters and 3-D confidence ellipsoids. No data leaves the browser. |
| **TLE Freshness** | Stale-data banner when TLE epoch is > 24 hours old. |

## Directory Structure

```
/
├── frontend/               # Vite + TypeScript static frontend
│   ├── index.html          # Entry page (CesiumJS loaded from CDN)
│   ├── src/
│   │   ├── main.ts         # App entry point & tab wiring
│   │   ├── dashboard.ts    # Risk dashboard module
│   │   ├── toca.ts         # TOCA 3-D view (CesiumJS)
│   │   ├── cdm-parser.ts   # CDM translator (client-side)
│   │   └── api.ts          # Worker API client
│   ├── vite.config.ts
│   └── package.json
├── worker/                 # Cloudflare Workers backend
│   ├── index.ts            # API router + scheduled handler
│   ├── cron.ts             # Cron job: fetch TLE + compute conjunctions
│   ├── conjunction.ts      # SGP4 propagation + conjunction screening
│   ├── tle.ts              # TLE fetch & parse utilities
│   └── types.ts            # Shared TypeScript interfaces
├── wrangler.toml           # Cloudflare Worker + KV + Cron config
└── package.json
```

## Quick Start

### Prerequisites

- Node.js ≥ 18
- A [Cloudflare account](https://dash.cloudflare.com) with Workers and KV enabled
- `wrangler` CLI: `npm install -g wrangler`

### 1 — Create KV namespace

```bash
wrangler kv:namespace create TLE_KV
```

Copy the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TLE_KV"
id = "<paste-id-here>"
```

### 2 — Local development

```bash
# Frontend (http://localhost:5173)
cd frontend && npm install && npm run dev

# Worker (http://localhost:8787)
npm install && wrangler dev
```

The Vite dev server proxies `/api/*` to the local Worker automatically.

### 3 — Deploy

```bash
# Deploy Worker
wrangler deploy

# Frontend is deployed automatically by Cloudflare Pages on push to main.
# Build command : cd frontend && npm run build
# Output dir    : frontend/dist
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/conjunctions` | Precomputed high-risk conjunction list (next 72 h) |
| `GET` | `/api/tle?page=1&limit=100` | Paginated TLE data |
| `GET` | `/api/tle/:id` | Single satellite TLE (by NORAD ID or name) |
| `GET` | `/api/conjunction/:id/toca` | TOCA position sequence for a conjunction |
| `GET` | `/api/health` | Health check |

Example response from `/api/conjunctions`:

```json
{
  "updated_at": "2026-03-05T12:00:00Z",
  "conjunctions": [
    {
      "id": "evt_22675_24946",
      "sat1": { "name": "COSMOS 2251", "norad_id": "22675" },
      "sat2": { "name": "IRIDIUM 33",  "norad_id": "24946" },
      "toca": "2026-03-06T08:23:11Z",
      "min_distance_km": 4.2,
      "pc": 1.5e-4,
      "data_confidence": "high"
    }
  ]
}
```

## Cloudflare Pages Setup

| Setting | Value |
|---------|-------|
| Build command | `cd frontend && npm run build` |
| Output directory | `frontend/dist` |
| Environment variable (optional) | `VITE_CESIUM_TOKEN` — Cesium Ion access token for full imagery |

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `VITE_API_BASE` | Frontend build | Override API base URL (default: `/api`) |
| `VITE_CESIUM_TOKEN` | Frontend build | Cesium Ion token for satellite imagery |

## Feedback & Support

- 💬 [GitHub Discussions](https://github.com/ckLXHL/CubeSat-Collision-Alert/discussions)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com)
