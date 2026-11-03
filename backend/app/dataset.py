"""Chooses which observations the API serves: live NASA FIRMS data or the synthetic demo.

Live mode (DATA_MODE=live) fetches MODIS + VIIRS near-real-time detections for one
region from the FIRMS area API, caches them, and falls back safely:
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


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _date_range(df: pd.DataFrame):
    if df.empty:
        return None, None
    return (df.acq_datetime.min().strftime("%Y-%m-%d"), df.acq_datetime.max().strftime("%Y-%m-%d"))


class DataSource:
    def __init__(self, mode="demo", bbox=(73.5, 28.5, 77.5, 32.5), region="Punjab & Haryana", days=3,
                 cache_minutes=60.0, retry_minutes=5.0, fetch=None, clock=time.time):
        self.mode = mode
        self.bbox = tuple(bbox)
        self.region = region
        self.days = max(1, min(10, int(days)))      # FIRMS area API accepts 1..10
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

    @classmethod
    def from_env(cls):
        return cls(
            mode=os.getenv("DATA_MODE", "demo").strip().lower(),
            bbox=[float(x) for x in os.getenv("LIVE_BBOX", "73.5,28.5,77.5,32.5").split(",")],
            region=os.getenv("LIVE_REGION_NAME", "Punjab & Haryana"),
            days=int(os.getenv("LIVE_DAYS", "3")),
            cache_minutes=float(os.getenv("LIVE_CACHE_MINUTES", "60")),
            retry_minutes=float(os.getenv("LIVE_RETRY_MINUTES", "5")),
        )

    # ------------------------------------------------------------------ demo
    def _demo_data(self, mode="demo", reason=None):
        if self._demo is None:
            self._demo = make_demo()
        df = self._demo
        first, last = _date_range(df)
        label = DEMO_LABEL if mode == "demo" else (
            "LIVE NASA FIRMS DATA UNAVAILABLE - showing synthetic demo data (South India).")
        meta = {"mode": mode, "label": label, "region": DEMO_REGION, "bbox": DEMO_BBOX,
                "sources": ["synthetic demo"], "days": None, "first_date": first, "last_date": last,
                "fetched_at": None, "stale": False, "reason": reason,
                "counts": df.sensor.value_counts().to_dict()}
        return df, meta

    # ------------------------------------------------------------------ live
    def _fetch_live(self):
        m = self.fetch("MODIS", self.bbox, self.days)
        v = self.fetch("VIIRS", self.bbox, self.days)
        df = pd.concat([m, v], ignore_index=True)
        if df.empty:
            raise firms.FirmsError(f"FIRMS returned no detections for {self.region} in the last {self.days} day(s)")
        df["is_demo"] = False
        now = self.clock()
        first, last = _date_range(df)
        meta = {"mode": "live", "region": self.region, "bbox": list(self.bbox),
                "sources": [firms.source_for("MODIS"), firms.source_for("VIIRS")], "days": self.days,
                "first_date": first, "last_date": last, "fetched_at": _iso(now), "stale": False,
                "reason": None, "counts": df.sensor.value_counts().to_dict()}
        meta["label"] = (f"LIVE NASA FIRMS data - {self.region}, last {self.days} day(s) "
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
