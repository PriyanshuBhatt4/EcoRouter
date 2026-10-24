"""POST /route success-path and PM2.5 cross-route logic tests (offline)."""

from tests.helpers import (
    GEO_DEST,
    ORIGIN,
    make_routes_res,
    patch_estimate,
    patch_geocode,
    patch_routes,
    route_body,
    sequence_estimate,
)


def _assert_candidate_shape(candidate):
    """Assert the per-candidate contract: id/distance/duration/coordinates + enrichment."""
    assert isinstance(candidate["id"], str) and candidate["id"]
    assert isinstance(candidate["distance_m"], (int, float))
    assert isinstance(candidate["duration_s"], (int, float))
    coords = candidate["coordinates"]
    assert len(coords) >= 2
    for point in coords:
        assert len(point) == 2
        lon, lat = point[0], point[1]
        assert -180 <= lon <= 180
        assert -90 <= lat <= 90
    # [lon, lat] ordering: SF longitudes are negative, latitudes positive.
    assert all(point[0] < 0 for point in coords)
    assert all(0 < point[1] < 90 for point in coords)
    # Enrichment from app.services.exposure must be attached.
    estimate = candidate["pm25_estimate"]
    assert isinstance(estimate, dict)
    assert "available" in estimate
    assert "indistinguishable_across_routes" in estimate
    assert "can_compare_cleanest" in estimate
    assert "cross_route_note" in estimate


def test_route_single_candidate_contract(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    body = response.json()

    # Top-level contract fields.
    for key in (
        "origin",
        "destination",
        "mode",
        "provider",
        "route",
        "candidates",
        "attribution",
    ):
        assert key in body, f"missing top-level field: {key}"

    assert body["origin"] == ORIGIN
    assert body["destination"] == {
        "name": "Golden Gate Bridge",
        "latitude": GEO_DEST["latitude"],
        "longitude": GEO_DEST["longitude"],
    }
    assert body["mode"] == "walking"
    assert body["provider"] == "valhalla_public"
    assert body["attribution"]["air_quality"]["source"] == (
        "Open-Meteo Air Quality API"
    )

    candidates = body["candidates"]
    assert len(candidates) == 1
    assert body["route"] == candidates[0]
    _assert_candidate_shape(candidates[0])
    assert candidates[0]["id"] == "route-0"
    assert candidates[0]["pm25_estimate"]["available"] is True
    assert candidates[0]["pm25_estimate"]["value"] == 12.0

    # The geocoder received the trimmed destination; routing got the mode.
    assert geocode_calls == ["Golden Gate Bridge"]
    assert route_calls[0]["mode"] == "walking"


def test_route_three_candidates_contract(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    body = response.json()

    candidates = body["candidates"]
    assert len(candidates) == 3
    assert [c["id"] for c in candidates] == ["route-0", "route-1", "route-2"]
    assert body["route"] == candidates[0]
    for candidate in candidates:
        _assert_candidate_shape(candidate)
        assert candidate["pm25_estimate"]["available"] is True
        assert candidate["pm25_estimate"]["value"] == 12.0


def test_pm25_all_equal_marks_indistinguishable(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))
    patch_estimate(monkeypatch, sequence_estimate([12.0, 12.0, 12.0]))

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    for candidate in response.json()["candidates"]:
        estimate = candidate["pm25_estimate"]
        assert estimate["indistinguishable_across_routes"] is True
        assert estimate["can_compare_cleanest"] is False
        # The "all equal" note.
        assert "equal regional model" in estimate["cross_route_note"]
        assert "cannot identify a cleaner route" in estimate["cross_route_note"]


def test_pm25_partially_missing_prevents_comparison(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))
    # Middle candidate has no usable estimate.
    patch_estimate(monkeypatch, sequence_estimate([12.0, None, 13.5]))

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert candidates[1]["pm25_estimate"]["available"] is False
    for candidate in candidates:
        estimate = candidate["pm25_estimate"]
        assert estimate["indistinguishable_across_routes"] is True
        assert estimate["can_compare_cleanest"] is False
        assert "cannot compare" in estimate["cross_route_note"]


def test_pm25_differing_values_enable_comparison(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))
    patch_estimate(monkeypatch, sequence_estimate([10.0, 14.0, 18.0]))

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    for candidate in response.json()["candidates"]:
        estimate = candidate["pm25_estimate"]
        assert estimate["indistinguishable_across_routes"] is False
        assert estimate["can_compare_cleanest"] is True
        assert "differ" in estimate["cross_route_note"]


def test_pm25_half_up_boundary_rounds_like_the_client(client, monkeypatch):
    # 12.25 sits exactly on the 0.05 boundary: the client shows
    # Math.round(12.25 * 10) / 10 = 12.3 (half-up), so the server's
    # all-equal comparison must round the same way - Python's round() uses
    # banker's rounding and would produce 12.2. All three candidates share
    # the boundary value, so they are indistinguishable.
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(3))
    patch_estimate(monkeypatch, sequence_estimate([12.25, 12.25, 12.25]))

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    candidates = response.json()["candidates"]
    # The displayed value still comes from exposure untouched (no re-rounding).
    assert [c["pm25_estimate"]["value"] for c in candidates] == [12.25, 12.25, 12.25]
    for candidate in candidates:
        estimate = candidate["pm25_estimate"]
        assert estimate["indistinguishable_across_routes"] is True
        assert estimate["can_compare_cleanest"] is False
        assert "equal regional model" in estimate["cross_route_note"]


def test_pm25_half_up_boundary_differs_from_bankers_rounding(client, monkeypatch):
    # Boundary pair that separates half-up from banker's rounding:
    #   half-up (client Math.round): 12.25 -> 12.3 and 12.34 -> 12.3 (equal)
    #   banker's round():            12.25 -> 12.2 and 12.34 -> 12.3 (differ)
    # The comparison must agree with the client, i.e. mark the routes
    # indistinguishable; the old round(v, 1) comparison would wrongly enable
    # cleanest-route comparison for values the user sees as identical.
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(2))
    patch_estimate(monkeypatch, sequence_estimate([12.25, 12.34]))

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert [c["pm25_estimate"]["value"] for c in candidates] == [12.25, 12.34]
    for candidate in candidates:
        estimate = candidate["pm25_estimate"]
        assert estimate["indistinguishable_across_routes"] is True
        assert estimate["can_compare_cleanest"] is False
        assert "equal regional model" in estimate["cross_route_note"]
