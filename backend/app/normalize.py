"""Normalization: FIRMS-style raw rows -> common schema. Raw data is never modified (copy)."""
import pandas as pd

# APPLICATION-DERIVED mapping of VIIRS categorical confidence to 0-100. Not an official NASA scale.
VIIRS_CONF = {"l": 25, "low": 25, "n": 60, "nominal": 60, "h": 90, "high": 90}
COLS = ["observation_id", "sensor", "satellite", "latitude", "longitude", "acq_datetime",
        "confidence", "frp", "brightness", "product", "version"]


def normalize(raw: pd.DataFrame, sensor: str, product: str = "FIRMS") -> pd.DataFrame:
    sensor = sensor.upper()
    d = raw.copy()
    d.columns = [c.lower() for c in d.columns]
    d["latitude"] = pd.to_numeric(d.get("latitude"), errors="coerce")
    d["longitude"] = pd.to_numeric(d.get("longitude"), errors="coerce")
    d = d[d.latitude.between(-90, 90) & d.longitude.between(-180, 180)]  # WGS84 range check
    t = d["acq_time"].astype(str).str.zfill(4)
    d["acq_datetime"] = pd.to_datetime(d["acq_date"].astype(str) + " " + t.str[:2] + ":" + t.str[2:],
                                       utc=True, errors="coerce")
    d = d.dropna(subset=["latitude", "longitude", "acq_datetime"])
    c = d.get("confidence")
    if c is None:
        d["confidence"] = float("nan")
    elif sensor == "VIIRS":
        d["confidence"] = c.astype(str).str.lower().map(VIIRS_CONF)
    else:
        d["confidence"] = pd.to_numeric(c, errors="coerce")
    d["frp"] = pd.to_numeric(d.get("frp"), errors="coerce")
    bcol = "brightness" if sensor == "MODIS" else "bright_ti4"
    d["brightness"] = pd.to_numeric(d.get(bcol), errors="coerce")
    d["sensor"] = sensor
    d["satellite"] = d.get("satellite", "unknown")
    d["product"] = product
    d["version"] = d.get("version", "")
    d = d.reset_index(drop=True)
    d["observation_id"] = [f"{sensor[:3]}-{i:07d}" for i in range(len(d))]
    return d[COLS]
