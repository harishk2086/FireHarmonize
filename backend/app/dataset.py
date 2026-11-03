"""Chooses which observations the API serves: live NASA FIRMS data or the synthetic demo.

Live mode (DATA_MODE=live) fetches MODIS + VIIRS near-real-time detections for each
region (South India, Punjab & Haryana) from the FIRMS area API, caches them, and
falls back safely:
  1. fresh live data (refetched every LIVE_CACHE_MINUTES),
  2. the last good live copy if a refresh fails (marked stale),
  3. the synthetic demo dataset, clearly labelled, if no live data was ever fetched.
Health checks never trigger a FIRMS request (peek_meta()).
"""
import os
import threading
import time
from datetime import datetime, timezone

import pandas as pd

from . import firms
from .demo import DEMO_LABEL, make_demo

DEMO_REGION = "South India (synthetic)"
DEMO_BBOX = [77.0, 10.0, 80.5, 14.0]

# Live regions: id -> (display name, west,south,east,north). The first one is the default.
# Override with LIVE_REGIONS="id|Name|w,s,e,n;id2|Name 2|w,s,e,n".
DEFAULT_REGIONS = {
    "punjab-haryana": ("Punjab & Haryana", (73.5, 28.5, 77.5, 32.5)),
    "south-india": ("South India", (74.0, 8.0, 84.8, 20.0)),
}
MAX_DAYS = 10   # FIRMS area API accepts 1..10


def parse_regions(spec):
    """'id|Name|w,s,e,n;...' -> {id: (name, bbox)}; empty -> DEFAULT_REGIONS."""
    if not spec or not spec.strip():
        return dict(DEFAULT_REGIONS)
    out = {}
    for part in spec.split(";"):
        if part.strip():
            rid, name, bbox = [x.strip() for x in part.split("|")]
            w, s, e, n = [float(x) for x in bbox.split(",")]
            out[rid] = (name, (w, s, e, n))
    return out


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


SATELLITE_NAMES = {"A": "Aqua", "T": "Terra", "N": "Suomi-NPP", "N20": "NOAA-20", "N21": "NOAA-21",
                   "1": "NOAA-20", "2": "NOAA-21"}


def overpasses(df: pd.DataFrame):
    """Typical daytime overpass time (UTC) per satellite, from the detections themselves.

    Daytime = 06:00-18:00 local solar time (UTC + longitude/15 h). Explains matching results:
    MODIS Aqua's orbit has drifted, so it now passes hours after VIIRS.
    """
    if df.empty:
        return []
    t = df.acq_datetime
    solar_h = (t.dt.hour + t.dt.minute / 60 + df.longitude / 15) % 24
    day = df[(solar_h >= 6) & (solar_h <= 18)]
    out = []
    for (sensor, sat), g in day.groupby(["sensor", "satellite"]):
        mins = g.acq_datetime.dt.hour * 60 + g.acq_datetime.dt.minute
        med = int(round(mins.median()))
        out.append({"sensor": sensor, "satellite": SATELLITE_NAMES.get(str(sat), str(sat)),
                    "utc": f"{med // 60:02d}:{med % 60:02d}", "minutes_utc": med, "count": int(len(g))})
    return sorted(out, key=lambda x: (x["sensor"], -x["count"]))


def _date_range(df: pd.DataFrame):
    if df.empty:
        return None, None
    return (df.acq_datetime.min().strftime("%Y-%m-%d"), df.acq_datetime.max().strftime("%Y-%m-%d"))


class DataSource:
    def __init__(self, mode="demo", bbox=(73.5, 28.5, 77.5, 32.5), region="Punjab & Haryana", days=3,
                 cache_minutes=60.0, retry_minutes=5.0, fetch=None, clock=time.time, region_id="punjab-haryana"):
        self.mode = mode
        self.region_id = region_id
        self.bbox = tuple(bbox)
        self.region = region
        self.days = max(1, min(MAX_DAYS, int(days)))
        self.cache_s = cache_minutes * 60
        self.retry_s = retry_minutes * 60
        self.fetch = fetch or firms.fetch
        self.clock = clock
        self._lock = threading.Lock()
        self._demo = None
        self._live = None          # (df, meta)
        self._live_t = None
        self._fail_t = None
        self._fail_reason = None

    # ------------------------------------------------------------------ demo
    def _demo_data(self, mode="demo", reason=None):
        if self._demo is None:
            self._demo = make_demo()
        df = self._demo
        first, last = _date_range(df)
        label = DEMO_LABEL if mode == "demo" else (
            "LIVE NASA FIRMS DATA UNAVAILABLE - showing synthetic demo data (South India).")
        meta = {"mode": mode, "label": label, "region_id": self.region_id, "region": DEMO_REGION, "bbox": DEMO_BBOX,
                "sources": ["synthetic demo"], "days": None, "first_date": first, "last_date": last,
                "fetched_at": None, "stale": False, "reason": reason,
                "counts": df.sensor.value_counts().to_dict(), "overpasses": overpasses(df)}
        return df, meta

    # ------------------------------------------------------------------ live
    def _fetch_days(self, days):
        m = self.fetch("MODIS", self.bbox, days)
        v = self.fetch("VIIRS", self.bbox, days)
        return pd.concat([m, v], ignore_index=True)

    def _fetch_live(self):
        days = self.days
        df = self._fetch_days(days)
        if df.empty and days < MAX_DAYS:     # quiet region (e.g. monsoon): look further back
            days = MAX_DAYS
            df = self._fetch_days(days)
        if df.empty:
            raise firms.FirmsError(f"FIRMS returned no detections for {self.region} in the last {days} day(s)")
        df["is_demo"] = False
        now = self.clock()
        first, last = _date_range(df)
        meta = {"mode": "live", "region_id": self.region_id, "region": self.region, "bbox": list(self.bbox),
                "sources": [firms.source_for("MODIS"), firms.source_for("VIIRS")], "days": days,
                "first_date": first, "last_date": last, "fetched_at": _iso(now), "stale": False,
                "reason": None, "counts": df.sensor.value_counts().to_dict(), "overpasses": overpasses(df)}
        meta["label"] = (f"LIVE NASA FIRMS data - {self.region}, last {days} day(s) "
                         f"({', '.join(meta['sources'])}), fetched {meta['fetched_at']}")
        return df, meta

    def get(self):
        """Return (observations, meta), refreshing live data when due."""
        if self.mode != "live":
            return self._demo_data()
        with self._lock:
            now = self.clock()
            if self._live is not None and now - self._live_t < self.cache_s:
                return self._live
            recently_failed = self._fail_t is not None and now - self._fail_t < self.retry_s
            if not recently_failed:
                try:
                    self._live = self._fetch_live()
                    self._live_t = now
                    self._fail_t = self._fail_reason = None
                    return self._live
                except firms.FirmsError as ex:
                    self._fail_t, self._fail_reason = now, str(ex)
            if self._live is not None:                     # serve the last good copy
                df, meta = self._live
                meta = dict(meta, stale=True, reason=self._fail_reason,
                            label=meta["label"] + f" - refresh failed, showing cached copy")
                return df, meta
            return self._demo_data(mode="demo-fallback", reason=self._fail_reason)

    def peek_meta(self):
        """Meta for health checks: never contacts FIRMS."""
        if self.mode != "live":
            return {"mode": "demo", "label": DEMO_LABEL}
        if self._live is not None:
            return {"mode": "live", "label": self._live[1]["label"]}
        return {"mode": "live", "label": "Live NASA FIRMS mode - data loads on first request"}


class Regions:
    """One DataSource per live region (each with its own cache), or a single demo source."""

    def __init__(self, mode="demo", regions=None, **kw):
        self.mode = mode
        regions = regions or dict(DEFAULT_REGIONS)
        if mode != "live":
            regions = {"demo": (DEMO_REGION, tuple(DEMO_BBOX))}
        self.sources = {rid: DataSource(mode=mode, bbox=bbox, region=name, region_id=rid, **kw)
                        for rid, (name, bbox) in regions.items()}
        self.default = next(iter(self.sources))

    @classmethod
    def from_env(cls):
        return cls(
            mode=os.getenv("DATA_MODE", "demo").strip().lower(),
            regions=parse_regions(os.getenv("LIVE_REGIONS", "")),
            days=int(os.getenv("LIVE_DAYS", "3")),
            cache_minutes=float(os.getenv("LIVE_CACHE_MINUTES", "60")),
            retry_minutes=float(os.getenv("LIVE_RETRY_MINUTES", "5")),
        )

    def source(self, region_id=None):
        """DataSource for a region id (None -> default). Unknown ids raise KeyError."""
        return self.sources[region_id or self.default]

    def listing(self):
        return {"mode": "live" if self.mode == "live" else "demo", "default": self.default,
                "regions": [{"id": rid, "name": s.region, "bbox": list(s.bbox)} for rid, s in self.sources.items()]}

    def peek_meta(self):
        return self.source().peek_meta()
