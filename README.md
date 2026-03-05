# CubeSat Collision Alert 🛰️

A lightweight, serverless LEO satellite collision monitoring platform.

> **Data cadence:** Conjunction predictions and TLEs are fetched from CelesTrak SOCRATES every **6 hours** via a scheduled Cron Trigger. The 3-D orbit visualization and risk dashboard always animate in **real time** using the latest cached data. Telegram alert pushes are also sent every **6 hours** when new high-risk events are detected.

## Architecture

```
[CelesTrak SOCRATES]
     ↓  Cron Trigger (every 6 h)
[Cloudflare Workers]  →  Fetch SOCRATES CSV, parse/filter high-risk conjunctions,
                          fetch TLEs only for involved satellites, KV write
     ↓
[Cloudflare KV]  →  high-risk conjunction list · high-risk-only TLE set · timestamps
     ↓  REST API
[Cloudflare Pages]  →  Static frontend (Vite + TypeScript + CesiumJS CDN + satellite.js)
```

## Features

| Module | Cadence | Description |
|--------|---------|-------------|
| **Risk Dashboard** | reflects 6-h data | Live-scrolling list of the top 10 highest-risk satellite pairs in the next 72 hours, with collision probability gauges and configurable alert threshold (< 10 km). |
| **TOCA View** | real-time animation | 3-D CesiumJS visualization of the Time of Closest Approach for any selected conjunction event. Orbit positions are computed client-side via satellite.js SGP4, so the animation runs in real time. |
| **CDM Translator** | on upload | Client-side parser for CDM (KVN or XML) files — converts covariance matrices into progress-bar Pc meters and 3-D confidence ellipsoids. No data leaves the browser. |
| **TLE Freshness** | on load | Stale-data banner when TLE epoch is > 24 hours old. |
| **Telegram Alerts** | every 6 h | Push notification to a configured Telegram channel whenever a new high-risk conjunction event (< 10 km) appears after a SOCRATES refresh. |

## Directory Structure

```
/
├── frontend/               # Vite + TypeScript static frontend
│   ├── index.html          # Entry page (CesiumJS loaded from CDN)
│   ├── src/
│   │   ├── main.ts         # App entry point & tab wiring
│   │   ├── dashboard.ts    # Risk dashboard module
│   │   ├── toca.ts         # TOCA 3-D view (CesiumJS + satellite.js SGP4)
│   │   ├── cdm-parser.ts   # CDM translator (client-side)
│   │   └── api.ts          # Worker API client
│   ├── vite.config.ts
│   └── package.json
├── worker/                 # Cloudflare Workers backend (lightweight data pipeline)
│   ├── index.ts            # API router + scheduled handler
│   ├── cron.ts             # Cron job: fetch SOCRATES + targeted TLE + KV write
│   ├── socrates.ts         # SOCRATES CSV fetch, parse & filter
│   ├── tle.ts              # Targeted TLE fetch by NORAD ID list
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
| `GET` | `/api/conjunctions` | High-risk conjunction list parsed from SOCRATES (next 72 h) |
| `GET` | `/api/tle/high-risk` | TLEs for all satellites currently in the high-risk list |
| `GET` | `/api/tle/:id` | Single satellite TLE (by NORAD ID or name) |
| `GET` | `/api/conjunction/:id/toca` | TOCA time + TLE data for client-side SGP4 propagation |
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
| `TELEGRAM_BOT_TOKEN` | Worker secret | Telegram bot token for alert push notifications |
| `TELEGRAM_CHAT_ID` | Worker secret | Telegram chat/channel ID to receive alerts |

## Data Freshness & Update Cadence

| What | How often | Notes |
|------|-----------|-------|
| SOCRATES conjunction predictions | Every 6 h | Fetched by the Cron Trigger; stored in `conjunctions:latest` KV key |
| High-risk TLE set | Every 6 h | Only TLEs for satellites in the high-risk list; stored in `tle:high_risk` KV key |
| Telegram alert push | Every 6 h | Sent after each successful SOCRATES refresh if new high-risk events exist |
| CesiumJS orbit animation | Real time | Positions are propagated client-side (satellite.js SGP4) from the cached TLE data |
| TLE staleness warning | On page load | Dashboard shows a warning banner when the TLE epoch is > 24 h old |

## Feedback & Support

- 💬 [GitHub Discussions](https://github.com/ckLXHL/CubeSat-Collision-Alert/discussions)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com)
