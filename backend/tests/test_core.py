import pandas as pd
from fastapi.testclient import TestClient
from app.normalize import normalize
from app.harmonize import Params, harmonize, haversine_km, match_score, statistics
from app.main import app


def raw(lat, lon, t, conf, sat="Terra"):
    return pd.DataFrame([dict(latitude=lat, longitude=lon, acq_date="2025-03-01", acq_time=t,
                              confidence=conf, frp=5, brightness=330, bright_ti4=330, satellite=sat)])


def mk(m, v):
    return pd.concat([normalize(m, "MODIS"), normalize(v, "VIIRS")], ignore_index=True)


def test_haversine():
    assert abs(haversine_km(0, 0, 0, 1) - 111.19) < 0.1


def test_timestamp_utc_and_coord_filter():
    d = normalize(pd.concat([raw(10, 80, "0530", 80), raw(95, 80, "0530", 80)]), "MODIS")
    assert len(d) == 1 and str(d.acq_datetime[0]) == "2025-03-01 05:30:00+00:00"


def test_viirs_conf_mapping():
    assert normalize(raw(10, 80, "0100", "h"), "VIIRS").confidence[0] == 90


def test_match_and_scores():
    o, ev = harmonize(mk(raw(10, 80, "0500", 80), raw(10.003, 80, "0510", "h")))
    assert statistics(o)["matched_pairs"] == 1 and len(ev) == 1
    assert 0 < o.match_score.max() <= 1


def test_outside_radius_and_window():
    o, _ = harmonize(mk(raw(10, 80, "0500", 80), raw(10.05, 80, "0510", "h")))
    assert set(o.status) == {"MODIS_ONLY", "VIIRS_ONLY"}
    o, _ = harmonize(mk(raw(10, 80, "0500", 80), raw(10.001, 80, "0700", "h")))
    assert set(o.status) == {"MODIS_ONLY", "VIIRS_ONLY"}


def test_duplicate_and_low_conf():
    d = pd.concat([raw(10, 80, "0500", 80), raw(10, 80, "0500", 80), raw(11, 81, "0500", 5)])
    o, _ = harmonize(normalize(d, "MODIS"))
    assert sorted(o.status) == ["LOW_CONFIDENCE", "MODIS_ONLY", "POSSIBLE_DUPLICATE"]


def test_score_weights_configurable():
    assert match_score(0, 29, 50, 50, Params(w_spatial=1, w_temporal=0, w_conf=0)) == 1.0


def test_api_filtering():
    c = TestClient(app)
    assert c.get("/api/fires?sensor=VIIRS&size=5").json()["items"][0]["sensor"] == "VIIRS"
    assert c.get("/api/fires?bbox=bad").status_code == 400
    assert c.get("/api/harmonization/run?bbox=0,0,1,1").status_code == 404
    r = c.get("/api/harmonization/run?radius_km=2&window_min=60").json()
    assert r["statistics"]["matched_pairs"] > 0
    assert len(c.get("/api/stats/trends").json()["daily"]) > 0


def test_root_points_to_docs():
    r = TestClient(app).get("/")
    assert r.status_code == 200 and r.json()["docs"] == "/docs"
