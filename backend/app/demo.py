"""SYNTHETIC demo generator in FIRMS CSV format. DEMO DATA — NOT NASA observations."""
import numpy as np
import pandas as pd
from .normalize import normalize

DEMO_LABEL = "DEMO DATA — connect NASA FIRMS/Earthdata to enable live/historical data."


def make_demo(seed=7, n_fires=120, bbox=(77.0, 10.0, 80.5, 14.0)):
    rng = np.random.default_rng(seed)
    w, s, e, n = bbox
    m_rows, v_rows = [], []
    for _ in range(n_fires):
        lat, lon = rng.uniform(s, n), rng.uniform(w, e)
        day = pd.Timestamp("2025-02-01") + pd.Timedelta(days=int(rng.integers(0, 60)))
        t0 = day + pd.Timedelta(minutes=int(rng.integers(0, 1440)))
        frp = float(rng.gamma(2, 8))

        def row(jit_km, sat, conf, br):
            t = t0 + pd.Timedelta(minutes=float(rng.uniform(-20, 20)))
            return dict(latitude=lat + rng.normal(0, jit_km / 111), longitude=lon + rng.normal(0, jit_km / 111),
                        acq_date=t.date().isoformat(), acq_time=t.strftime("%H%M"), satellite=sat,
                        confidence=conf, frp=frp * rng.uniform(.7, 1.3), brightness=br, bright_ti4=br, version="DEMO")
        if rng.random() < .75:
            m_rows.append(row(.5, "Terra", int(rng.integers(20, 100)), rng.uniform(310, 380)))
        if rng.random() < .85:
            v_rows.append(row(.2, "N", rng.choice(["l", "n", "h"], p=[.15, .5, .35]), rng.uniform(320, 360)))
    d = pd.concat([normalize(pd.DataFrame(m_rows), "MODIS", "DEMO"),
                   normalize(pd.DataFrame(v_rows), "VIIRS", "DEMO")], ignore_index=True)
    d["is_demo"] = True
    return d
