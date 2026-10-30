"""PROTOTYPE harmonization engine. NOT an official NASA algorithm; all parameters configurable."""
from dataclasses import dataclass
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

R_EARTH_KM = 6371.0088


@dataclass
class Params:
    radius_km: float = 1.0
    window_min: float = 30.0
    conf_threshold: float = 30.0
    w_spatial: float = 0.5
    w_temporal: float = 0.3
    w_conf: float = 0.2
    dup_km: float = 0.2      # same-sensor duplicate distance
    dup_sec: float = 60.0    # same-sensor duplicate time gap


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH_KM * np.arcsin(np.sqrt(a))


def match_score(dist_km, dt_min, conf_a, conf_b, p: Params):
    s = max(0.0, 1 - dist_km / p.radius_km)
    t = max(0.0, 1 - dt_min / p.window_min)
    c = 0.0 if (np.isnan(conf_a) and np.isnan(conf_b)) else np.nanmean([conf_a, conf_b]) / 100
    return p.w_spatial * s + p.w_temporal * t + p.w_conf * c


def flag_duplicates(df: pd.DataFrame, p: Params) -> pd.Series:
    """Same sensor+satellite, within dup_km and dup_sec of an EARLIER record -> duplicate."""
    dup = pd.Series(False, index=df.index)
    for _, g in df.groupby(["sensor", "satellite"]):
        g = g.sort_values("acq_datetime")
        xy = np.radians(g[["latitude", "longitude"]].to_numpy())
        ts = g.acq_datetime.to_numpy()
        ind = BallTree(xy, metric="haversine").query_radius(xy, r=p.dup_km / R_EARTH_KM)
        for i, nb in enumerate(ind):
            for j in nb:
                if j < i and abs((ts[i] - ts[j]) / np.timedelta64(1, "s")) <= p.dup_sec:
                    dup[g.index[i]] = True
                    break
    return dup


def _candidates(m, v, p):
    if m.empty or v.empty:
        return []
    tree = BallTree(np.radians(v[["latitude", "longitude"]].to_numpy()), metric="haversine")
    ind, dist = tree.query_radius(np.radians(m[["latitude", "longitude"]].to_numpy()),
                                  r=p.radius_km / R_EARTH_KM, return_distance=True)
    mt, vt = m.acq_datetime.to_numpy(), v.acq_datetime.to_numpy()
    mc, vc = m.confidence.to_numpy(float), v.confidence.to_numpy(float)
    out = []
    for i, (idx, dd) in enumerate(zip(ind, dist)):
        for j, d in zip(idx, dd):
            dt = abs((mt[i] - vt[j]) / np.timedelta64(1, "m"))
            if dt <= p.window_min:
                dk = d * R_EARTH_KM
                out.append((match_score(dk, dt, mc[i], vc[j], p), i, j, dk, dt))
    return out


def harmonize(obs: pd.DataFrame, p: Params | None = None):
    """obs: normalized MODIS+VIIRS. Returns (observations with status, events). Inputs untouched."""
    p = p or Params()
    o = obs.copy().reset_index(drop=True)
    o["status"] = "UNASSIGNED"
    o["event_id"] = None
    o["partner_id"] = None
    for c in ("match_score", "match_dist_km", "match_dt_min"):
        o[c] = np.nan

    o.loc[flag_duplicates(o, p), "status"] = "POSSIBLE_DUPLICATE"
    low = (o.status == "UNASSIGNED") & (o.confidence < p.conf_threshold)
    o.loc[low, "status"] = "LOW_CONFIDENCE"      # kept in raw store, excluded from matching

    pool = o[o.status == "UNASSIGNED"]
    m, v = pool[pool.sensor == "MODIS"], pool[pool.sensor == "VIIRS"]
    used_m, used_v, n = set(), set(), 0
    for score, i, j, dk, dt in sorted(_candidates(m, v, p), key=lambda x: -x[0]):  # greedy 1-to-1
        if i in used_m or j in used_v:
            continue
        used_m.add(i); used_v.add(j)
        n += 1
        eid, a, b = f"FHE-{n:06d}", m.index[i], v.index[j]
        for x, y in ((a, b), (b, a)):
            o.loc[x, "status"] = "MATCHED_EVENT"
            o.loc[x, "event_id"] = eid
            o.loc[x, "match_score"], o.loc[x, "match_dist_km"], o.loc[x, "match_dt_min"] = score, dk, dt
            o.loc[x, "partner_id"] = o.loc[y, "observation_id"]
    for idx in o.index[o.status == "UNASSIGNED"]:
        n += 1
        o.loc[idx, "status"] = f"{o.loc[idx, 'sensor']}_ONLY"
        o.loc[idx, "event_id"] = f"FHE-{n:06d}"

    g = o[o.event_id.notna()].groupby("event_id")
    events = g.agg(
        time_start=("acq_datetime", "min"), time_end=("acq_datetime", "max"),
        centroid_latitude=("latitude", "mean"), centroid_longitude=("longitude", "mean"),
        source_count=("observation_id", "count"),
        modis_count=("sensor", lambda s: int((s == "MODIS").sum())),
        viirs_count=("sensor", lambda s: int((s == "VIIRS").sum())),
        mean_confidence=("confidence", "mean"), max_confidence=("confidence", "max"),
        frp_sum=("frp", "sum"), frp_max=("frp", "max"), match_score=("match_score", "max"),
        source_sensor_list=("sensor", lambda s: sorted(set(s))),
        classification=("status", "first"),
    ).reset_index()
    events["date"] = events.time_start.dt.date.astype(str)
    events["harmonization_method"] = "PROTOTYPE greedy one-to-one spatiotemporal match (app-derived, not NASA official)"
    events["spatial_match_radius_km"] = p.radius_km
    events["temporal_match_window_min"] = p.window_min
    return o, events


def statistics(o: pd.DataFrame) -> dict:
    nm, nv = int((o.sensor == "MODIS").sum()), int((o.sensor == "VIIRS").sum())
    c = o.status.value_counts().to_dict()
    pairs = c.get("MATCHED_EVENT", 0) // 2
    return {"modis_observations": nm, "viirs_observations": nv, "matched_pairs": pairs,
            "modis_only": c.get("MODIS_ONLY", 0), "viirs_only": c.get("VIIRS_ONLY", 0),
            "possible_duplicates": c.get("POSSIBLE_DUPLICATE", 0),
            "low_confidence": c.get("LOW_CONFIDENCE", 0),
            "match_percentage_of_modis": round(100 * pairs / nm, 1) if nm else 0.0,
            "match_percentage_of_viirs": round(100 * pairs / nv, 1) if nv else 0.0}
