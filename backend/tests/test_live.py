"""Live NASA FIRMS mode: parsing, caching, fallbacks and API wiring (FIRMS itself is mocked)."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import firms, main
from app.dataset import DataSource
from app.normalize import normalize

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
30.71234,75.85012,321.4,1.0,1.0,2026-11-02,512,Terra,MODIS,74,6.1NRT,295.2,18.4,D
30.70110,75.86220,318.9,1.0,1.0,2026-11-02,845,Aqua,MODIS,55,6.1NRT,294.0,12.1,D
29.95000,76.40000,330.0,1.1,1.0,2026-11-03,52,Aqua,MODIS,20,6.1NRT,290.0,9.0,N
"""
VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
30.71300,75.85100,335.2,0.4,0.4,2026-11-02,520,N,VIIRS,n,2.0NRT,296.1,7.9,D
31.20000,74.90000,340.1,0.4,0.4,2026-11-02,830,N,VIIRS,h,2.0NRT,297.0,10.5,D
"""
EMPTY_CSV = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"


class FakeResponse:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


def frames():
    return {"MODIS": normalize(pd.read_csv(pd.io.common.StringIO(MODIS_CSV)), "MODIS", "MODIS_NRT"),
            "VIIRS": normalize(pd.read_csv(pd.io.common.StringIO(VIIRS_CSV)), "VIIRS", "VIIRS_SNPP_NRT")}


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


# ---------------------------------------------------------------- firms.fetch
def test_fetch_builds_most_recent_url_and_parses(monkeypatch):
    seen = {}
    monkeypatch.setenv("FIRMS_MAP_KEY", "SECRETKEY123")
    monkeypatch.delenv("FIRMS_API_BASE", raising=False)

    def fake_get(url, timeout):
        seen["url"] = url
        return FakeResponse(VIIRS_CSV)
    monkeypatch.setattr(firms.requests, "get", fake_get)
    df = firms.fetch("VIIRS", (73.5, 28.5, 77.5, 32.5), 3)
    assert seen["url"] == ("https://firms.modaps.eosdis.nasa.gov/api/area/csv/SECRETKEY123/"
                           "VIIRS_SNPP_NRT/73.5,28.5,77.5,32.5/3")
    assert len(df) == 2 and set(df.sensor) == {"VIIRS"}
    assert list(df.confidence) == [60, 90]                     # n -> 60, h -> 90


def test_fetch_pads_short_acq_time(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "K")
    monkeypatch.setattr(firms.requests, "get", lambda url, timeout: FakeResponse(MODIS_CSV))
    df = firms.fetch("MODIS", (73.5, 28.5, 77.5, 32.5), 3)
    assert str(df.acq_datetime.iloc[2]) == "2026-11-03 00:52:00+00:00"   # "52" means 00:52 UTC


def test_fetch_errors_never_leak_the_key(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "SECRETKEY123")
    monkeypatch.setattr(firms.requests, "get", lambda url, timeout: FakeResponse("Invalid MAP_KEY.", 400))
    with pytest.raises(firms.FirmsError) as ex:
        firms.fetch("MODIS", (73.5, 28.5, 77.5, 32.5), 3)
    assert "SECRETKEY123" not in str(ex.value) and "Invalid MAP_KEY" in str(ex.value)

    def boom(url, timeout):
        raise firms.requests.ConnectionError(f"failed {url}")
    monkeypatch.setattr(firms.requests, "get", boom)
    with pytest.raises(firms.FirmsError) as ex:
        firms.fetch("MODIS", (73.5, 28.5, 77.5, 32.5), 3)
    assert "SECRETKEY123" not in str(ex.value)


def test_fetch_requires_key(monkeypatch):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    with pytest.raises(firms.FirmsError, match="not set"):
        firms.fetch("MODIS", (73.5, 28.5, 77.5, 32.5), 3)


def test_fetch_empty_result_is_empty_frame(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "K")
    monkeypatch.setattr(firms.requests, "get", lambda url, timeout: FakeResponse(EMPTY_CSV))
    assert firms.fetch("VIIRS", (73.5, 28.5, 77.5, 32.5), 3).empty


# ---------------------------------------------------------------- DataSource
def test_live_data_cached_then_refreshed():
    calls, clock, f = [], Clock(), frames()
    src = DataSource(mode="live", fetch=lambda s, b, d: calls.append(s) or f[s], clock=clock, cache_minutes=60)
    df, m = src.get()
    assert m["mode"] == "live" and m["region"] == "Punjab & Haryana" and m["counts"] == {"MODIS": 3, "VIIRS": 2}
    assert m["sources"] == ["MODIS_NRT", "VIIRS_SNPP_NRT"] and m["first_date"] == "2026-11-02"
    assert not df.is_demo.any()
    clock.t += 30 * 60
    src.get()
    assert calls == ["MODIS", "VIIRS"]                          # still cached
    clock.t += 31 * 60
    src.get()
    assert calls == ["MODIS", "VIIRS", "MODIS", "VIIRS"]        # refreshed after 60 min


def test_falls_back_to_labelled_demo_when_firms_never_worked():
    def down(s, b, d):
        raise firms.FirmsError("FIRMS unreachable (ConnectionError)")
    df, m = DataSource(mode="live", fetch=down, clock=Clock()).get()
    assert m["mode"] == "demo-fallback" and "UNAVAILABLE" in m["label"] and "unreachable" in m["reason"]
    assert df.is_demo.all() and len(df) == 186


def test_serves_stale_copy_when_refresh_fails_and_backs_off():
    calls, clock, f, state = [], Clock(), frames(), {"up": True}

    def fetch(s, b, d):
        calls.append(s)
        if not state["up"]:
            raise firms.FirmsError("FIRMS error 503: busy")
        return f[s]
    src = DataSource(mode="live", fetch=fetch, clock=clock, cache_minutes=60, retry_minutes=5)
    src.get()
    state["up"] = False
    clock.t += 61 * 60
    df, m = src.get()
    assert m["mode"] == "live" and m["stale"] and "cached copy" in m["label"] and len(df) == 5
    n = len(calls)
    clock.t += 60
    src.get()
    assert len(calls) == n                                      # no retry within 5 minutes
    state["up"] = True
    clock.t += 5 * 60
    df, m = src.get()
    assert not m["stale"]


def test_no_detections_falls_back_to_demo():
    empty = frames()["VIIRS"].iloc[0:0]
    df, m = DataSource(mode="live", fetch=lambda s, b, d: empty, clock=Clock()).get()
    assert m["mode"] == "demo-fallback" and "no detections" in m["reason"]


def test_peek_meta_never_fetches():
    calls = []
    src = DataSource(mode="live", fetch=lambda s, b, d: calls.append(s), clock=Clock())
    assert src.peek_meta()["mode"] == "live" and calls == []


# ---------------------------------------------------------------- API in live mode
def test_api_serves_live_data(monkeypatch):
    f = frames()
    monkeypatch.setattr(main, "SOURCE", DataSource(mode="live", fetch=lambda s, b, d: f[s], clock=Clock()))
    main._RUN_CACHE.clear()
    c = TestClient(main.app)
    ds = c.get("/api/dataset").json()
    assert ds["mode"] == "live" and ds["counts"] == {"MODIS": 3, "VIIRS": 2}
    run = c.get("/api/harmonization/run").json()
    assert run["mode"] == "live" and run["is_demo"] is False
    assert run["statistics"]["modis_observations"] == 3 and run["statistics"]["matched_pairs"] == 1
    assert c.get("/api/fires").json()["total"] == 5
    assert c.get("/api/health").json()["mode"] == "live"
    main._RUN_CACHE.clear()
