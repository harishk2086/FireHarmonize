# FIREHARMONIZE — NASA MODIS + VIIRS Active Fire Intelligence (Phase 1 backend)

Prototype harmonization of MODIS and VIIRS hotspots. **Not an official NASA methodology.**
All match parameters (radius, window, weights, confidence threshold) are configurable prototype values, not NASA constants.

## Run
    cd backend && pip install -r requirements.txt
    DATA_MODE=demo uvicorn app.main:app --reload     # docs at /docs
    python -m pytest -q

## Demo mode
`DATA_MODE=demo` uses a SYNTHETIC dataset (app/demo.py) pushed through the same normalize -> harmonize pipeline.
Labelled: "DEMO DATA — connect NASA FIRMS/Earthdata to enable live/historical data."

## Live mode
Set `FIRMS_MAP_KEY` (server-side only) and use `app/firms.py::fetch` (NASA FIRMS area API; MODIS_NRT, VIIRS_SNPP_NRT; use *_SP sources for archive).

## Method (app-derived)
1. Normalize: UTC timestamps, WGS84 range check, FIRMS fields -> common schema. VIIRS l/n/h -> 25/60/90 (app mapping).
2. Same-sensor duplicates (<=0.2 km, <=60 s) -> POSSIBLE_DUPLICATE. Confidence < threshold -> LOW_CONFIDENCE (kept, not matched).
3. Candidate MODIS-VIIRS pairs within radius and time window (BallTree haversine).
4. score = 0.5*spatial + 0.3*temporal + 0.2*confidence (weights configurable); greedy one-to-one assignment by score.
5. Events: matched pairs + MODIS_ONLY + VIIRS_ONLY. Raw observations are never altered.

## API
/api/health, /api/fires, /api/fires/harmonized, /api/harmonization/run|matches, /api/stats/trends, /api/data-quality
Filters: start, end, bbox=west,south,east,north, sensor.

## Limitations
Greedy matching (not globally optimal); matched events have no FRP reconciliation across sensors; overpass times differ by sensor so
radius/window drive match rate; VIIRS confidence mapping is an assumption.
