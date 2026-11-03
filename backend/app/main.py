import os
import threading
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from .dataset import Regions
from .harmonize import Params, harmonize, statistics

load_dotenv()  # reads backend/.env if present; real environment variables take precedence

app = FastAPI(title="FIREHARMONIZE API")
REGIONS = Regions.from_env()   # demo, or live NASA FIRMS per region with caching + fallback (see dataset.py)

# Comma-separated list of frontend origins allowed to call the API (e.g. your Vercel URL).
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"])

# Default harmonization parameters (prototype values, not NASA constants); overridable per request.
DEFAULT_RADIUS_KM = float(os.getenv("SPATIAL_MATCH_RADIUS_KM", "1.0"))
DEFAULT_WINDOW_MIN = float(os.getenv("TEMPORAL_MATCH_WINDOW_MINUTES", "30"))
DEFAULT_CONF = float(os.getenv("CONFIDENCE_THRESHOLD", "30"))


def source(region=None):
    try:
        return REGIONS.source(region)
    except KeyError:
        raise HTTPException(404, f"Unknown region '{region}'. See /api/regions")


def load_raw(region=None):
    return source(region).get()[0]


def meta(region=None):
    return source(region).get()[1]


def filt(df, start=None, end=None, bbox=None, sensor=None):
    try:
        if start: df = df[df.acq_datetime >= pd.Timestamp(start, tz="UTC")]
        if end: df = df[df.acq_datetime <= pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)]
        if start and end and pd.Timestamp(start) > pd.Timestamp(end):
            raise HTTPException(400, "start must be <= end")
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if bbox:
        try:
            w, s, e, n = [float(x) for x in bbox.split(",")]
        except ValueError:
            raise HTTPException(400, "bbox must be west,south,east,north")
        df = df[df.longitude.between(w, e) & df.latitude.between(s, n)]
    if sensor:
        df = df[df.sensor == sensor.upper()]
    return df


# Harmonization results are cached per dataset + parameters: one dashboard load asks for the
# same run several times (stats, statuses, events, trends), and live data can be thousands of rows.
_RUN_CACHE, _RUN_LOCK = {}, threading.Lock()


def run(radius_km, window_min, conf, start, end, bbox, region=None):
    rid = source(region).region_id
    raw = load_raw(region)
    key = (rid, id(raw), radius_km, window_min, conf, start, end, bbox)
    with _RUN_LOCK:
        if key not in _RUN_CACHE:
            d = filt(raw, start, end, bbox)
            if d.empty:
                raise HTTPException(404, "No observations in selected region/date range")
            for k in [k for k in _RUN_CACHE if k[0] == rid and k[1] != id(raw)]:   # old data for this region
                del _RUN_CACHE[k]
            if len(_RUN_CACHE) >= 32:
                _RUN_CACHE.clear()
            _RUN_CACHE[key] = harmonize(d, Params(radius_km=radius_km, window_min=window_min, conf_threshold=conf))
        return _RUN_CACHE[key]


def _js(df):
    return df.astype(object).where(df.notna(), None).to_dict("records")


def _ts(df):
    df = df.copy()
    for c in df.columns:
        if str(df[c].dtype).startswith("datetime"):
            df[c] = df[c].astype(str)
    return df


H = dict(radius_km=Query(DEFAULT_RADIUS_KM, gt=0, le=10), window_min=Query(DEFAULT_WINDOW_MIN, gt=0, le=240),
         conf=Query(DEFAULT_CONF, ge=0, le=100))


@app.get("/")
def root():
    return {"name": "FireHarmonize API", **REGIONS.peek_meta(), "docs": "/docs", "health": "/api/health",
            "dataset": "/api/dataset", "regions": "/api/regions"}


@app.get("/api/health")
def health():
    # Never contacts NASA FIRMS: Render calls this every few seconds.
    return REGIONS.peek_meta()


@app.get("/api/regions")
def regions():
    """Regions the dashboard can switch between (never contacts FIRMS)."""
    return REGIONS.listing()


@app.get("/api/dataset")
def dataset(region: str = None):
    """What data is being served for a region: live FIRMS (dates, sources, fetch time) or demo."""
    return meta(region)


@app.get("/api/fires")
def fires(start: str = None, end: str = None, bbox: str = None, sensor: str = None,
          page: int = Query(1, ge=1), size: int = Query(100, ge=1, le=1000), region: str = None):
    d = filt(load_raw(region), start, end, bbox, sensor)
    return {"total": len(d), "page": page, "label": meta(region)["label"],
            "items": _js(_ts(d.iloc[(page - 1) * size: page * size]))}


@app.get("/api/harmonization/run")
def run_h(radius_km: float = H["radius_km"], window_min: float = H["window_min"], conf: float = H["conf"],
          start: str = None, end: str = None, bbox: str = None, region: str = None):
    o, ev = run(radius_km, window_min, conf, start, end, bbox, region)
    m = meta(region)
    return {"statistics": statistics(o), "events": len(ev), "label": m["label"], "mode": m["mode"],
            "is_demo": m["mode"] != "live",
            "params": {"radius_km": radius_km, "window_min": window_min, "conf_threshold": conf,
                       "note": "Prototype parameters, not NASA constants"}}


@app.get("/api/harmonization/matches")
def matches(radius_km: float = H["radius_km"], window_min: float = H["window_min"], conf: float = H["conf"],
            start: str = None, end: str = None, bbox: str = None, limit: int = Query(50, le=500),
            region: str = None):
    o, _ = run(radius_km, window_min, conf, start, end, bbox, region)
    m = o[o.status == "MATCHED_EVENT"].sort_values("match_score", ascending=False).head(limit)
    return _js(_ts(m))


@app.get("/api/harmonization/observations")
def observation_status(radius_km: float = H["radius_km"], window_min: float = H["window_min"], conf: float = H["conf"],
                       start: str = None, end: str = None, bbox: str = None, region: str = None):
    """Per-observation harmonization status (MATCHED_EVENT, MODIS_ONLY, VIIRS_ONLY,
    LOW_CONFIDENCE, POSSIBLE_DUPLICATE) for the given parameters."""
    o, _ = run(radius_km, window_min, conf, start, end, bbox, region)
    cols = ["observation_id", "status", "event_id", "partner_id", "match_score"]
    return _js(o[cols])


@app.get("/api/fires/harmonized")
def harmonized(radius_km: float = H["radius_km"], window_min: float = H["window_min"], conf: float = H["conf"],
               start: str = None, end: str = None, bbox: str = None, region: str = None):
    _, ev = run(radius_km, window_min, conf, start, end, bbox, region)
    return _js(_ts(ev))


@app.get("/api/stats/trends")
def trends(start: str = None, end: str = None, bbox: str = None,
           radius_km: float = H["radius_km"], window_min: float = H["window_min"], region: str = None):
    d = filt(load_raw(region), start, end, bbox)
    _, ev = run(radius_km, window_min, DEFAULT_CONF, start, end, bbox, region)
    raw = d.groupby([d.acq_datetime.dt.date.astype(str), "sensor"]).size().unstack(fill_value=0)
    h = ev.groupby("date").size()
    return {"daily": [{"date": k, "modis": int(r.get("MODIS", 0)), "viirs": int(r.get("VIIRS", 0)),
                       "raw_total": int(r.sum()), "harmonized_events": int(h.get(k, 0))}
                      for k, r in raw.iterrows()]}


@app.get("/api/data-quality")
def dq(region: str = None):
    d = load_raw(region)
    return {"label": "Application-derived quality metrics (not an official NASA score)", "rows": len(d),
            "missing_confidence": int(d.confidence.isna().sum()), "missing_frp": int(d.frp.isna().sum()),
            "by_sensor": d.sensor.value_counts().to_dict()}
