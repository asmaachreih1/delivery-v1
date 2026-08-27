# Delivery Tracking System — V1

TSPTW brute force router with live traffic, time windows, alerts, and mobile-first driver web app.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Algorithm | Custom brute force TSPTW |
| Maps / Traffic | OpenRouteService (free) |
| Driver GPS | Browser `navigator.geolocation` |
| Map rendering | Leaflet.js + OpenStreetMap |
| Deployment | Vercel |

---

## Local development setup

### 1. Get a free OpenRouteService API key

Go to https://openrouteservice.org/dev/#/signup and create a free account.  
Copy your API key from the dashboard.

### 2. Set up backend environment

```bash
cd backend
cp .env.example .env
# Open .env and paste your ORS_API_KEY
```

### 3. Install dependencies

```bash
# From project root
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 4. Run locally

```bash
# From project root — starts both backend (port 3001) and frontend (port 5173)
npm run dev
```

Open http://localhost:5173 on your phone or browser.

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "V1 initial build"
git remote add origin https://github.com/YOUR_USERNAME/delivery-v1.git
git push -u origin main
```

### 2. Import to Vercel

- Go to https://vercel.com/new
- Import your GitHub repository
- Vercel auto-detects the config from `vercel.json`

### 3. Add environment variables in Vercel

In your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `ORS_API_KEY` | Your OpenRouteService key |
| `FRONTEND_URL` | Your Vercel deployment URL (e.g. `https://delivery-v1.vercel.app`) |

### 4. Redeploy

Vercel rebuilds automatically. Your app is live.

---

## How the algorithm works

1. Driver enters restaurant address, departure time, and up to 8 delivery stops — each with a time window (earliest/latest delivery time)
2. Backend geocodes all addresses via ORS, then fetches a real-time traffic-aware travel time matrix (minutes between every pair of points)
3. Brute force TSPTW solver generates all permutations of stop order, simulates each route against the time windows, and picks the one with the lowest total trip time
4. If no valid route exists → RED alert with infeasibility diagnosis. If route has long waits → YELLOW warning. Otherwise GREEN, proceed.
5. Driver follows the ordered stop list on the map. One tap opens Google Maps navigation to the next stop. One tap marks it delivered.
6. Driver's live position comes from the phone's browser GPS (navigator.geolocation), updating every 5 seconds.

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/run/start` | Submit stops + time windows, runs algorithm, returns optimised route |
| GET | `/api/run/:id` | Get current run state |
| PATCH | `/api/run/:id/stop/:n/deliver` | Mark a stop as delivered |
| POST | `/api/location` | Receive driver GPS coordinates |
| GET | `/api/location` | Get latest driver position |
| GET | `/api/location/autocomplete?q=` | Address autocomplete suggestions |
| GET | `/api/health` | Health check |

---

## V2 roadmap

- Replace browser GPS with Teltonika FMC920 IoT device (4G LTE, <3m accuracy)
- Dynamic re-routing: re-run algorithm at each stop with fresh traffic data
- Upgrade to Google Maps Distance Matrix API for higher accuracy
- Dispatcher dashboard (desktop view)
- Multi-driver support (VRP)
