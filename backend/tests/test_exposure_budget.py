"""Tests for the /route exposure-section time budget (offline, fake clock).

The handler in app.main bounds all PM2.5 estimate calls with a monotonic
deadline (EXPO_SECTION_BUDGET_S) and a per-candidate cap
(EXPO_PER_CANDIDATE_CAP_S). estimate_pm25_route is monkeypatched so these
tests never touch the network; time.monotonic is replaced with a deterministic
clock so the budget math is exact.
"""

from types import SimpleNamespace

from tests.helpers import (
    GEO_DEST,
    make_routes_res,
    ok_estimate,
    patch_estimate,
    patch_geocode,
    patch_routes,
    route_body,
)

TOTAL_BUDGET_S = 4.0
PER_CANDIDATE_CAP_S = 2.0


class FakeClock:
    """Deterministic stand-in for time.monotonic.

    `step` advances the clock on every read (mirrors real elapsed time while
    the handler runs); tests can also advance it explicitly to simulate a slow
    exposure call.
    """

    def __init__(self, start=0.0, step=0.0):
        self.now = start
        self.step = step

    def monotonic(self):
        value = self.now
        self.now += self.step
        return value

    def advance(self, seconds):
        self.now += seconds


def _patch_clock(monkeypatch, clock):
    from app import main

    # Replace only main's reference to the time module so the fake clock does
    # not leak into httpx/pytest internals.
    monkeypatch.setattr(main, "time", SimpleNamespace(monotonic=clock.monotonic))


def _assert_expired_shape(estimate):
    assert estimate["available"] is False
    assert estimate["reason"] == "exposure budget expired"
    assert estimate["metric"] == "pm2_5"
    assert estimate["units"] == "ug/m3"
    assert estimate["source"] == "open-meteo-cams"
    assert isinstance(estimate["caveat"], str) and estimate["caveat"]
    assert isinstance(estimate["as_of"], str) and estimate["as_of"]
    # Cross-route annotations are still merged in after enrichment.
    assert estimate["indistinguishable_across_routes"] is True
    assert estimate["can_compare_cleanest"] is False


def _assert_candidate_geometry(candidate):
    assert isinstance(candidate["distance_m"], (int, float))
    assert isinstance(candidate["duration_s"], (int, float))
    coords = candidate["coordinates"]
    assert len(coords) >= 2
    for point in coords:
        assert len(point) == 2


def test_first_candidate_uses_per_candidate_cap_and_later_calls_respect_remaining(
    client, monkeypatch
):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))

    clock = FakeClock(start=0.0)
    _patch_clock(monkeypatch, clock)

    timeouts = []

    def slow_estimate(coords, total_distance_m=0.0, timeout=10):
        timeouts.append(timeout)
        # Simulate each call consuming exactly the budget it was granted.
        clock.advance(timeout)
        return ok_estimate(12.0)

    patch_estimate(monkeypatch, slow_estimate)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    assert timeouts, "estimate_pm25_route should have been called"
    # First candidate gets exactly the per-candidate cap.
    assert timeouts[0] == PER_CANDIDATE_CAP_S
    # Every later timeout never exceeds what was left on the section deadline.
    elapsed = 0.0
    for timeout in timeouts:
        remaining = TOTAL_BUDGET_S - elapsed
        assert 0 < timeout <= min(PER_CANDIDATE_CAP_S, remaining)
        elapsed += timeout
    assert elapsed <= TOTAL_BUDGET_S

    candidates = response.json()["candidates"]
    assert candidates[0]["pm25_estimate"]["available"] is True
    # The third candidate has no budget left once two 2.0s calls are spent.
    assert len(timeouts) == 2
    _assert_expired_shape(candidates[2]["pm25_estimate"])


def test_exhausted_budget_skips_estimate_and_returns_unavailable_shape(
    client, monkeypatch
):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))

    # The deadline is established at t=0, then every subsequent read jumps
    # past it, so the first candidate already sees remaining <= floor.
    clock = FakeClock(start=0.0, step=5.0)
    _patch_clock(monkeypatch, clock)

    def must_not_run(coords, total_distance_m=0.0, timeout=10):
        raise AssertionError("estimate_pm25_route called with no remaining budget")

    patch_estimate(monkeypatch, must_not_run)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    body = response.json()
    candidates = body["candidates"]
    assert len(candidates) == 3
    for candidate in candidates:
        _assert_candidate_geometry(candidate)
        _assert_expired_shape(candidate["pm25_estimate"])
    # Primary route is still the first candidate, with all geometry intact.
    assert body["route"] == candidates[0]
    assert body["route"]["id"] == "route-0"


def test_partial_budget_keeps_first_estimate_and_expires_the_rest(
    client, monkeypatch
):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))

    clock = FakeClock(start=0.0)
    _patch_clock(monkeypatch, clock)

    timeouts = []

    def consuming_estimate(coords, total_distance_m=0.0, timeout=10):
        timeouts.append(timeout)
        # The first call burns the entire section budget.
        clock.advance(TOTAL_BUDGET_S)
        return ok_estimate(11.5)

    patch_estimate(monkeypatch, consuming_estimate)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    assert timeouts == [PER_CANDIDATE_CAP_S]

    candidates = response.json()["candidates"]
    first = candidates[0]["pm25_estimate"]
    assert first["available"] is True
    assert first["value"] == 11.5
    for candidate in candidates[1:]:
        _assert_expired_shape(candidate["pm25_estimate"])
        assert "value" not in candidate["pm25_estimate"]
    # All three route geometries survive the partial enrichment.
    for candidate in candidates:
        _assert_candidate_geometry(candidate)


def test_fast_path_calls_estimate_for_every_candidate_within_budget(
    client, monkeypatch
):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))

    # Small time step per clock read, but far from exhausting the budget.
    clock = FakeClock(start=0.0, step=0.5)
    _patch_clock(monkeypatch, clock)

    calls = []

    def immediate_estimate(coords, total_distance_m=0.0, timeout=10):
        calls.append(
            {
                "coords": list(coords),
                "total_distance_m": total_distance_m,
                "timeout": timeout,
            }
        )
        return ok_estimate(12.0)

    patch_estimate(monkeypatch, immediate_estimate)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    assert len(calls) == 3
    assert [call["total_distance_m"] for call in calls] == [
        1000.0,
        2000.0,
        3000.0,
    ]
    for call in calls:
        assert 0 < call["timeout"] <= PER_CANDIDATE_CAP_S

    candidates = response.json()["candidates"]
    assert [c["pm25_estimate"]["available"] for c in candidates] == [True] * 3
    assert [c["pm25_estimate"]["value"] for c in candidates] == [12.0] * 3
    # No budget-expired branch leaks into the fast path.
    assert all(
        c["pm25_estimate"].get("reason") != "exposure budget expired"
        for c in candidates
    )
