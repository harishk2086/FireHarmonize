"""NASA FIRMS area-API connector (live mode). Key read from env; never sent to the browser.

Request format (https://firms.modaps.eosdis.nasa.gov/api/area/):
  /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]          (most recent days)
  /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]   (from DATE)
DAY_RANGE is 1..10.
"""
import io
import os

import pandas as pd
import requests

from .normalize import normalize

DEFAULT_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
DEFAULT_SOURCES = {"MODIS": "MODIS_NRT", "VIIRS": "VIIRS_SNPP_NRT"}   # *_SP sources hold archived data


class FirmsError(RuntimeError):
    pass


def source_for(sensor: str) -> str:
    return os.getenv(f"LIVE_{sensor}_SOURCE", DEFAULT_SOURCES[sensor])


def fetch(sensor, bbox, days=1, date=None, timeout=30):
    key = os.getenv("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise FirmsError("FIRMS_MAP_KEY not set")
    base = os.getenv("FIRMS_API_BASE", DEFAULT_BASE).rstrip("/")
    source = source_for(sensor)
    w, s, e, n = bbox
    url = f"{base}/{key}/{source}/{w},{s},{e},{n}/{int(days)}" + (f"/{date}" if date else "")
    try:
        r = requests.get(url, timeout=timeout)
    except requests.RequestException as ex:             # never include the URL: it contains the key
        raise FirmsError(f"FIRMS unreachable ({type(ex).__name__})")
    text = r.text.strip()
    if r.status_code != 200 or text.lower().startswith("invalid"):
        raise FirmsError(f"FIRMS error {r.status_code}: {text[:80]}")
    if not text:
        raw = pd.DataFrame(columns=["latitude", "longitude", "acq_date", "acq_time"])
    else:
        try:
            raw = pd.read_csv(io.StringIO(text))
        except Exception as ex:
            raise FirmsError(f"FIRMS returned unreadable data ({type(ex).__name__})")
        if not {"latitude", "longitude", "acq_date", "acq_time"} <= {c.lower() for c in raw.columns}:
            raise FirmsError(f"FIRMS returned an unexpected response: {text[:80]}")
    return normalize(raw, sensor, source)
