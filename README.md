# whenTrain?

Real-time NYC subway arrival times for all stations within a 15-minute walk of your location. Live at [whentrain.lushchik.com](https://whentrain.lushchik.com).

## What it does

- Requires your location to find nearby stations — share it when prompted
- Finds every subway station within a 15-minute walk (~1,260 m)
- Shows the next northbound and southbound trains at each station
- Refreshes every 30 seconds, silently re-checking your position each time
- Installable as a PWA on iOS and Android

## Stack

| Layer | Tech |
|---|---|
| Frontend | Lit 3 web components, Vite, vite-plugin-pwa |
| Backend | Node.js + Express, TypeScript |
| Data | MTA GTFS static (stops, trips) + GTFS-RT protobuf feeds |
| Cache | Redis — raw feed bytes cached 30 s per feed endpoint |
| Infra | Docker Compose, nginx (reverse proxy + static files) |
| Deploy | Coolify on DigitalOcean, HTTPS via Let's Encrypt |

## Running locally

```bash
docker compose up --build
```

Open [http://localhost](http://localhost). The backend downloads the MTA GTFS static zip on first start (~10 s), then serves arrivals at `/api/arrivals?lat=&lng=`.

## Project layout

```
packages/
  backend/   Express API — GTFS parsing, feed fetching, Redis cache
  frontend/  Lit PWA — station cards, geolocation, auto-refresh
```

## API

```
GET /api/arrivals?lat={lat}&lng={lng}
```

Returns all stations within 15 minutes walking distance, each with northbound and southbound arrival times.

```
GET /health
```

Returns `{"ok":true}` once the GTFS data is loaded.
