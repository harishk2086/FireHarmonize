# 🔥 FIREHARMONIZE
### MODIS + VIIRS Cross-Sensor Active Fire Harmonization & Intelligence Platform

**NASA Space Apps Challenge 2026**

FireHarmonize is a prototype platform designed to harmonize active-fire observations from NASA's MODIS and VIIRS satellite instruments. It combines observations using configurable spatial and temporal matching criteria to identify potential cross-sensor matches, distinguish unmatched observations, and provide a unified view of fire activity.

The platform aims to improve the interpretation of satellite-based fire observations through interactive visualization, harmonization analysis, historical trends, and data-quality assessment.

> **Important:** FireHarmonize uses an application-developed prototype methodology. It is not an official NASA product or NASA-endorsed harmonization algorithm. Demo mode uses synthetic data, not actual NASA satellite observations.

---

## 🌐 Live Demo

| | Link |
|---|---|
| **Dashboard** | **https://fire-harmonize.vercel.app** |
| API (FastAPI) | https://fireharmonize.onrender.com |
| Interactive API docs | https://fireharmonize.onrender.com/docs |
| API health check | https://fireharmonize.onrender.com/api/health |

- **Data:** the live demo runs in **demo mode** with a clearly labelled **synthetic** dataset (186 observations over South India, 10–14°N, 77–80.5°E, Feb–Apr 2025). It is not real NASA satellite data.
- **First load may take up to a minute.** The backend is hosted on Render's free plan, which sleeps after 15 minutes without visitors. The dashboard shows a *"Waking up the backend server…"* banner and fills in automatically once the server is ready.
- **Hosting:** frontend on Vercel, backend on Render, basemaps from the Esri ArcGIS Location Platform (API key restricted to the dashboard's address).

---

## 🚀 Key Features

- **Cross-Sensor Harmonization:** Identify potential MODIS–VIIRS observation matches using spatial and temporal proximity.
- **Interactive Fire Map:** Visualize MODIS observations, VIIRS observations, and harmonized events on an interactive map.
- **Observation Inspector:** Examine individual fire observations, including coordinates, acquisition time, confidence, and other available metadata.
- **Configurable Matching:** Adjust spatial radius, temporal window, and confidence threshold.
- **Historical Fire Trends:** Explore fire-observation patterns over time.
- **Data Quality Assessment:** Examine record counts and missing-value indicators.
- **REST API:** Access fire observations, harmonized events, statistics, and data-quality information through FastAPI.

---

## 🛰️ Satellite Data Sources

FireHarmonize is designed around two major satellite observation systems:

| Instrument | Satellite platforms | Purpose |
|---|---|---|
| MODIS | Terra and Aqua | Active-fire and thermal-anomaly observations |
| VIIRS | Suomi-NPP, NOAA-20 and NOAA-21 | Active-fire and thermal-anomaly observations |

**Current data status:** Demo mode uses a synthetic dataset generated in memory by `backend/app/demo.py` (186 observations: 90 MODIS, 96 VIIRS). A NASA FIRMS connector exists in `backend/app/firms.py`, but live mode is not wired up yet — setting `DATA_MODE=live` currently returns HTTP 501.

---

## 🧠 Harmonization Methodology

FireHarmonize implements an application-derived prototype matching pipeline.

### 1. Data Normalization
- Convert acquisition timestamps to UTC.
- Validate latitude and longitude against WGS84 coordinate ranges.
- Convert incoming FIRMS fields into a common observation schema.
- Map VIIRS confidence categories: Low, Nominal, and High to 25, 60, and 90 respectively.

### 2. Duplicate and Confidence Handling
- Identify potential same-sensor duplicates within 0.2 km and 60 seconds.
- Mark observations below the configured confidence threshold as `LOW_CONFIDENCE`.
- Retain low-confidence observations rather than discarding them.

### 3. Cross-Sensor Candidate Matching
- Generate MODIS–VIIRS candidate pairs.
- Apply configurable spatial and temporal constraints.
- Use the BallTree haversine approach to identify spatially close observations.

### 4. Match Score Calculation

The prototype calculates a weighted match score:

**Match Score =**

`0.5 × Spatial Score + 0.3 × Temporal Score + 0.2 × Confidence Score`

The weights are configurable application parameters, not official NASA constants.

### 5. Event Classification

The resulting harmonized dataset contains:

- `MATCHED_EVENT` — MODIS and VIIRS observations paired by the prototype algorithm.
- `MODIS_ONLY` — MODIS observations without an accepted VIIRS match.
- `VIIRS_ONLY` — VIIRS observations without an accepted MODIS match.
- `POSSIBLE_DUPLICATE` — same-sensor records flagged as likely duplicates (excluded from matching).
- `LOW_CONFIDENCE` — records below the confidence threshold (kept, but excluded from matching).

The original satellite observations are preserved and are not modified by the harmonization process.

---

## 🏗️ System Architecture

### Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Mapping | Leaflet, React-Leaflet |
| Data Visualization | Recharts |
| Backend | Python, FastAPI |
| Data Storage | In-memory pandas DataFrames (no database) |
| Data Processing | Pandas, NumPy |
| Spatial Matching | scikit-learn BallTree, Haversine distance |
| Satellite Data Integration | NASA FIRMS API (live integration path) |

### Processing Workflow

```text
       MODIS Observations
               |
               |
       VIIRS Observations
               |
               v
       Data Normalization
               |
               v
     Duplicate Identification
               |
               v
      Confidence Assessment
               |
               v
    Spatial-Temporal Matching
               |
               v
       Match Score Calculation
               |
               v
      Harmonized Fire Events
               |
               v
       FastAPI Backend
               |
               v
       React Dashboard
               |
      +--------+---------+
      |        |         |
   Fire Map  Trends   Data Quality
      |
 Observation Inspector
```

---

## ⚙️ Installation and Setup

### Prerequisites

- Python 3.10 or later
- Node.js and npm
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/harishk2086/FireHarmonize.git
cd FireHarmonize
```

### 2. Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate it on Windows:

```cmd
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the environment variables using the example configuration (still inside `backend/`):

```cmd
copy .env.example .env
```

The backend loads `backend/.env` automatically on startup. The defaults run in demo mode, so this step is optional for local development.

Run the backend in demo mode:

```bash
python -m uvicorn app.main:app --reload
```

Backend API:

`http://localhost:8000`

Interactive API documentation:

`http://localhost:8000/docs`

### 3. Frontend Setup

Open another terminal and navigate to the frontend:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

> On Windows PowerShell, if `npm` is blocked by the execution policy, use `npm.cmd run dev` instead.

In development, the Vite dev server forwards `/api` requests to `http://localhost:8000`, so no frontend configuration is needed. To build for production:

```bash
npm run build
```

Frontend dashboard:

`http://localhost:5173`

### 4. Run Backend Tests

From the backend directory:

```bash
python -m pytest -q
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Backend health and operating mode |
| GET | `/api/fires` | Retrieve fire observations |
| GET | `/api/fires/harmonized` | Retrieve harmonized events |
| GET | `/api/harmonization/run` | Execute prototype harmonization |
| GET | `/api/harmonization/matches` | Retrieve matching results |
| GET | `/api/stats/trends` | Retrieve historical trend statistics |
| GET | `/api/data-quality` | Retrieve data-quality metrics |

Supported fire-data filters include:

- `start` — Start date
- `end` — End date
- `bbox` — Geographic bounding box (`west,south,east,north`)
- `sensor` — Sensor selection

Refer to the FastAPI Swagger documentation for supported parameters and response schemas.

---

## 🧪 Demo Mode and Live Data

### Demo Mode

The default demo configuration uses synthetic fire observations generated in:

`backend/app/demo.py`

These observations pass through the same normalization and harmonization pipeline used by the application.

The dashboard labels this dataset:

**DEMO DATA — connect NASA FIRMS/Earthdata to enable live/historical data.**

### Live Data Integration

The backend includes a NASA FIRMS integration path in:

`backend/app/firms.py`

The intended configuration uses:

- `FIRMS_MAP_KEY` — Server-side NASA FIRMS API key.
- MODIS NRT observations.
- VIIRS SNPP NRT observations.
- Historical SP sources where supported.

**Status:** the connector (`fetch()`) is implemented, but the API does not call it yet. A loader that fetches and caches FIRMS data for live mode still needs to be written.

**Security:** Never expose the FIRMS API key in frontend code or commit actual API credentials to GitHub.

---

## 🔧 Configuration Reference

**Backend** (`backend/.env`, see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATA_MODE` | `demo` | `demo` or `live` (live not implemented yet) |
| `FIRMS_MAP_KEY` | — | NASA FIRMS MAP_KEY, server-side only |
| `SPATIAL_MATCH_RADIUS_KM` | `1.0` | Default spatial matching radius |
| `TEMPORAL_MATCH_WINDOW_MINUTES` | `30` | Default temporal matching window |
| `CONFIDENCE_THRESHOLD` | `30` | Default minimum confidence for matching |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated frontend origins allowed to call the API |

**Frontend** (`frontend/.env`, see `frontend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | empty | Backend base URL in production (e.g. your Render URL). Leave empty locally. |
| `VITE_ARCGIS_API_KEY` | empty | ArcGIS Location Platform API key for licensed Esri basemaps (public key, *Static basemap tiles* privilege, referrer-restricted). Without it the map falls back to public Esri tiles for development. |

When deploying, set `VITE_API_URL` on the frontend host to the backend URL, and add the frontend URL to `CORS_ORIGINS` on the backend.

---

## ⚠️ Limitations

FireHarmonize is an experimental prototype. Its current limitations include:

1. **Greedy Matching:** The one-to-one matching approach is not guaranteed to produce a globally optimal assignment.
2. **Confidence Mapping:** The VIIRS confidence mapping of 25, 60, and 90 is an application assumption.
3. **Match Parameters:** Spatial radius, temporal window, confidence threshold, and scoring weights are configurable prototype values.
4. **FRP Reconciliation:** Matched events do not currently perform cross-sensor FRP reconciliation.
5. **Satellite Overpass Differences:** Different acquisition times and observation characteristics can affect the matching rate.
6. **Demo Dataset:** Synthetic observations are used in demo mode and must not be interpreted as actual satellite detections.
7. **NASA Methodology:** The matching score and harmonization procedure are application-developed and are not official NASA methodology.

---

## 🌍 Potential Applications

- Wildfire monitoring and situational awareness.
- Cross-sensor satellite observation analysis.
- Historical fire activity assessment.
- Identification of potentially corresponding fire observations.
- Research and exploration of satellite-based fire datasets.

---

## 🔮 Future Enhancements

- Verified live and historical NASA FIRMS data integration.
- Improved global matching algorithms.
- Advanced fire-event clustering and tracking.
- Cross-sensor Fire Radiative Power (FRP) analysis.
- Expanded historical and regional fire analytics.
- Improved data validation and uncertainty assessment.

---

## 👨‍💻 Project Information

**Project:** FireHarmonize  
**Author:** Harish K, B.E. Electronics and Communication Engineering  
**Event:** NASA Space Apps Challenge 2026  
**Challenge:** Harmonization of MODIS and VIIRS Hot Spots  
**Repository:** https://github.com/harishk2086/FireHarmonize

---

## 📜 Disclaimer

FireHarmonize is an independent prototype developed for the NASA Space Apps Challenge 2026.

NASA, MODIS, VIIRS, and NASA FIRMS are referenced in the context of the satellite instruments and data services. This project is not affiliated with, sponsored by, or endorsed by NASA.

All demonstration results are synthetic unless explicitly identified and verified as originating from NASA data services.

**Built to explore a unified view of satellite-based fire observations.** 🔥
