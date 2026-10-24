"""POST /route error-envelope tests (offline, deterministic)."""

from app.services.geocoding import GeocodingTimeout, GeocodingUpstreamError
from app.services.routing import RoutingTimeout, RoutingUpstreamError

from tests.helpers import (
    assert_error_envelope,
    make_routes_res,
    patch_estimate,
    patch_geocode,
    patch_routes,
    route_body,
)


def test_blank_destination_rejected(client, monkeypatch):
    # Success-shaped estimate so no code path can silently fall through to the
    # real app.services.exposure (whose httpx.get would trip the no-network guard).
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(destination="   "))
    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "destination" in response.json()["error"]["message"]


def test_latitude_out_of_range_rejected(client, monkeypatch):
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(latitude=91.0))
    assert_error_envelope(response, 422, "INVALID_REQUEST")


def test_longitude_out_of_range_rejected(client, monkeypatch):
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(longitude=-181.0))
    assert_error_envelope(response, 422, "INVALID_REQUEST")


def test_alternatives_above_max_rejected(client, monkeypatch):
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(alternatives=4))
    assert_error_envelope(response, 422, "INVALID_REQUEST")


def test_destination_over_max_length_rejected(client, monkeypatch):
    # Field(min_length=1, max_length=200): 201 characters must be rejected at
    # validation time with the error envelope (review fix #9).
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(destination="x" * 201))

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "destination" in response.json()["error"]["message"]


def test_alternatives_zero_returns_primary_only(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 37.7721, "longitude": -122.4105})
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(alternatives=0))

    assert response.status_code == 200
    body = response.json()
    assert len(body["candidates"]) == 1
    assert body["route"] == body["candidates"][0]
    # The requested alternative count was forwarded to routing.
    assert route_calls[0]["alternatives"] == 0


def test_geocode_none_yields_404(client, monkeypatch):
    patch_geocode(monkeypatch, None)
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(destination="Nowhereville"))

    assert_error_envelope(response, 404, "NO_GEOCODING_RESULT")
    assert "Nowhereville" in response.json()["error"]["message"]


def test_geocode_timeout_yields_504(client, monkeypatch):
    patch_geocode(monkeypatch, GeocodingTimeout("timed out"))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 504, "UPSTREAM_TIMEOUT")
    assert "geocoding" in response.json()["error"]["message"]


def test_geocode_upstream_error_yields_502(client, monkeypatch):
    patch_geocode(monkeypatch, GeocodingUpstreamError("boom"))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 502, "UPSTREAM_ERROR")
    assert "geocoding" in response.json()["error"]["message"]


def test_routes_none_yields_404(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 37.7721, "longitude": -122.4105})
    patch_routes(monkeypatch, None)
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 404, "NO_ROUTE_FOUND")


def test_routes_empty_candidates_yields_404(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 37.7721, "longitude": -122.4105})
    patch_routes(monkeypatch, {"candidates": []})
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 404, "NO_ROUTE_FOUND")


def test_routing_timeout_yields_504(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 37.7721, "longitude": -122.4105})
    patch_routes(monkeypatch, RoutingTimeout("timed out"))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 504, "UPSTREAM_TIMEOUT")
    assert "routing" in response.json()["error"]["message"]


def test_routing_upstream_error_yields_502(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 37.7721, "longitude": -122.4105})
    patch_routes(monkeypatch, RoutingUpstreamError("boom"))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert_error_envelope(response, 502, "UPSTREAM_ERROR")
    assert "routing" in response.json()["error"]["message"]
