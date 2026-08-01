# Sanchari-BE

Backend API for [Sanchari](../Sanchari) — generates AI travel itineraries via Groq (through a LangGraph agent), enriches them with real Google Places data (destination photos, hotels), and crawls/maintains the shared destinations catalog.

## Features

- **`POST /api/v1/ai/generate`** — generates a full itinerary (metadata, packing list, must-try dishes, suggested hotels, day-by-day plan) for a destination. Supports:
  - Multi-city trips via `legs: [{ city, days }]`, with automatic rest days (every 6 exploring days) and a travel day between cities
  - Dual-currency budget conversion (destination's local currency + the traveler's home currency, via `homeCurrency` or `homeCountry`)
  - Real hotel suggestions from Google Places (falls back to AI-estimated hotels if no real listing is found)
- **`POST /api/v1/crawl`** — manually triggers the destinations crawler (also runs automatically once on first empty-table boot, then monthly)
- **`GET /api/v1/health`** — health check

## Tech Stack

- Node.js + Express + TypeScript
- LangGraph for the itinerary generation agent, Groq (`llama-3.1-8b-instant`) as the LLM
- Supabase (Postgres) for storing destinations/trips
- Google Places API for real destination photos, hotel listings, and the crawler
- Redis (Upstash) for rate limiting

## Setup

```bash
npm install
cp .env.example .env   # fill in your own values
npm run dev
```

### Required environment variables (`.env`)

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key — [console.groq.com/keys](https://console.groq.com/keys) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, bypasses RLS) |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `REDIS_URL` | Redis connection string (e.g. a free Upstash database) — used for rate limiting |
| `FOURSQUARE_API_KEY` | Foursquare Places API key |
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform key with the Places API enabled — must **not** be restricted to "HTTP referrers" (server-side calls need "None" or an IP restriction) |
| `PEXELS_API_KEY` | Pexels API key — used only by `scripts/seedDestinationImages.mjs` |

`PORT` and `NODE_ENV` are also read from `.env` locally; most hosts (e.g. Railway) inject `PORT` automatically.

## Scripts

- `npm run dev` — run with `tsx` (no build step, TypeScript directly)
- `npm run build` — compile to `dist/`
- `npm start` — run the compiled build (`dist/index.js`) — used in production
- `npm run seed:images` — one-time script to backfill destination photos from Pexels for the static fallback destination list (`--write` to actually persist to Supabase; omit to dry-run)

## Deployment

Deployed as a standard Node service (e.g. Railway): build command `npm run build`, start command `npm start`, with the environment variables above set in the host's dashboard.
