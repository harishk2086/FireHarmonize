"""NASA FIRMS area-API connector (live mode). Key read from env; never sent to the browser."""
import io, os
import pandas as pd, requests
from .normalize import normalize

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCES = {"MODIS": "MODIS_NRT", "VIIRS": "VIIRS_SNPP_NRT"}   # use *_SP sources for archived data


class FirmsError(RuntimeError):
    pass


def fetch(sensor, bbox, start_date, days=1, timeout=30):
    key = os.getenv("FIRMS_MAP_KEY")
    if not key:
        raise FirmsError("FIRMS_MAP_KEY not set")
    w, s, e, n = bbox
    url = f"{BASE}/{key}/{SOURCES[sensor]}/{w},{s},{e},{n}/{days}/{start_date}"
    try:
        r = requests.get(url, timeout=timeout)
    except requests.RequestException as ex:
        raise FirmsError(f"FIRMS unreachable: {type(ex).__name__}")
    if r.status_code != 200 or r.text.lstrip().lower().startswith("invalid"):
        raise FirmsError(f"FIRMS error {r.status_code}")
    return normalize(pd.read_csv(io.StringIO(r.text)), sensor, SOURCES[sensor])
