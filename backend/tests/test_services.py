"""Unit tests for app.services.* with httpx monkeypatched - no network, no DB."""

import json

import httpx
import pytest

from app.services.exposure import _sample_points, estimate_pm25_route
from app.services.geocoding import (
    GeocodingTimeout,
    GeocodingUpstreamError,
    geocode_destination,
)
from app.services.routing import (
    RoutingTimeout,
    RoutingUpstreamError,
    _decode_polyline6,
    get_routes,
)

# Precomputed polyline6 samples (precision 6), round-trip verified against
# app.services.routing._decode_polyline6. Points encoded as (lat, lon), decoded
# output is [lon, lat].
POLYLINE6_MAIN = "_ph`gA~p|nhFo}@_pRo}@_pR"
POLYLINE6_MAIN_DECODED = [
    [-122.42, 37.77],
    [-122.41, 37.771],
    [-122.4, 37.772],
]
POLYLINE6_ALT = "o}v_gAnzyohF_yFowH"
POLYLINE6_ALT_DECODED = [
    [-122.435, 37.761],
    [-122.43, 37.765],
]


class FakeResponse:
    """Minimal stand-in for an httpx.Response."""

    def __init__(self, status_code=200, payload=None, invalid_json=False):
        self.status_code = status_code
        self._payload = payload
        self._invalid_json = invalid_json

    def json(self):
        if self._invalid_json:
            raise ValueError("invalid JSON")
        return self._payload


# --------------------------------------------------------------------------
# app.services.routing._decode_polyline6
# --------------------------------------------------------------------------


def test_decode_polyline6_known_sample():
    assert _decode_polyline6(POLYLINE6_MAIN) == POLYLINE6_MAIN_DECODED


def test_decode_polyline6_second_sample():
    assert _decode_polyline6(POLYLINE6_ALT) == POLYLINE6_ALT_DECODED


def test_decode_polyline6_empty_string():
    assert _decode_polyline6("") == []


def test_decode_polyline6_non_string_returns_empty():
    # A malformed upstream "shape" (number/list/null) must not raise from
    # len()/ord(); it simply yields no coordinates.
    assert _decode_polyline6(None) == []
    assert _decode_polyline6(123) == []


# --------------------------------------------------------------------------
# app.services.routing.get_routes
# --------------------------------------------------------------------------


def _valhalla_payload(include_alternates=True):
    alternates = []
    if include_alternates:
        alternates = [
            {
                "trip": {
                    "summary": {"length": 2.5, "time": 1500.0},
                    "legs": [{"shape": POLYLINE6_ALT}],
                }
            },
            {
                "trip": {
                    "summary": {"length": 3.5, "time": 2100.0},
                    "legs": [{"shape": POLYLINE6_MAIN}],
                }
            },
        ]
    return {
        "trip": {
            "summary": {"length": 1.5, "time": 900.0},
            "legs": [{"shape": POLYLINE6_MAIN}],
        },
        "alternates": alternates,
    }


def test_get_routes_full_payload_builds_candidates(monkeypatch):
    posted = {}

    def fake_post(url, json=None, timeout=None):
        posted["url"] = url
        posted["json"] = json
        posted["timeout"] = timeout
        return FakeResponse(200, _valhalla_payload())

    monkeypatch.setattr(httpx, "post", fake_post)

    result = get_routes(37.77, -122.42, 37.7721, -122.4105, mode="walking")

    assert result["provider"] == "valhalla_public"
    candidates = result["candidates"]
    assert len(candidates) == 3
    assert [c["id"] for c in candidates] == ["route-0", "route-1", "route-2"]

    primary = candidates[0]
    assert primary["distance_m"] == 1500.0  # summary.length (km) -> metres
    assert primary["duration_s"] == 900.0
    assert primary["coordinates"] == POLYLINE6_MAIN_DECODED
    assert candidates[1]["coordinates"] == POLYLINE6_ALT_DECODED
    assert candidates[1]["distance_m"] == 2500.0

    # Coordinates decoded to [lon, lat] and within valid ranges.
    for candidate in candidates:
        for lon, lat in candidate["coordinates"]:
            assert -180 <= lon <= 180
            assert -90 <= lat <= 90

    # Outgoing request shape.
    assert posted["json"]["costing"] == "pedestrian"
    assert posted["json"]["alternates"] == 3
    assert posted["json"]["locations"] == [
        {"lat": 37.77, "lon": -122.42},
        {"lat": 37.7721, "lon": -122.4105},
    ]


@pytest.mark.parametrize(
    "mode,costing",
    [("walking", "pedestrian"), ("driving", "auto"), ("cycling", "bicycle")],
)
def test_get_routes_mode_mapping(monkeypatch, mode, costing):
    posted = {}

    def fake_post(url, json=None, timeout=None):
        posted["json"] = json
        return FakeResponse(200, _valhalla_payload(include_alternates=False))

    monkeypatch.setattr(httpx, "post", fake_post)

    result = get_routes(37.77, -122.42, 37.7721, -122.4105, mode=mode)

    assert posted["json"]["costing"] == costing
    assert result["candidates"][0]["id"] == "route-0"


@pytest.mark.parametrize("alternatives,expected_count", [(1, 2), (2, 3)])
def test_get_routes_honors_alternates(monkeypatch, alternatives, expected_count):
    def fake_post(url, json=None, timeout=None):
        assert json["alternates"] == alternatives
        return FakeResponse(200, _valhalla_payload())

    monkeypatch.setattr(httpx, "post", fake_post)

    result = get_routes(
        37.77, -122.42, 37.7721, -122.4105, mode="walking", alternatives=alternatives
    )

    assert len(result["candidates"]) == expected_count


def test_get_routes_zero_alternates_ignores_upstream_alternates(monkeypatch):
    # alternates=0 means "primary route only". The requested count is a hard
    # cap, so even if the upstream answers with alternates anyway the service
    # must not hand back more candidates than asked for.
    def fake_post(url, json=None, timeout=None):
        assert json["alternates"] == 0
        return FakeResponse(200, _valhalla_payload())

    monkeypatch.setattr(httpx, "post", fake_post)

    result = get_routes(
        37.77, -122.42, 37.7721, -122.4105, mode="walking", alternatives=0
    )

    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["id"] == "route-0"


def test_get_routes_timeout_raises_routing_timeout(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        raise httpx.TimeoutException("slow")

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RoutingTimeout):
        get_routes(37.77, -122.42, 37.7721, -122.4105)


def test_get_routes_non_200_raises_routing_upstream_error(monkeypatch):
    monkeypatch.setattr(
        httpx, "post", lambda url, json=None, timeout=None: FakeResponse(503)
    )

    with pytest.raises(RoutingUpstreamError):
        get_routes(37.77, -122.42, 37.7721, -122.4105)


def test_get_routes_non_object_payload_raises_routing_upstream_error(monkeypatch):
    # HTTP 200 with valid JSON that is not an object must be an upstream error
    # (502 envelope), not an AttributeError escaping as a bare 500.
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, json=None, timeout=None: FakeResponse(200, ["not", "an", "object"]),
    )

    with pytest.raises(RoutingUpstreamError):
        get_routes(37.77, -122.42, 37.7721, -122.4105)


def test_get_routes_malformed_trip_yields_no_candidates(monkeypatch):
    # A trip whose legs carry a non-string shape is skipped as unusable
    # instead of crashing inside the polyline decoder.
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, json=None, timeout=None: FakeResponse(
            200, {"trip": {"summary": {"length": 1.0}, "legs": [{"shape": 123}]}}
        ),
    )

    assert get_routes(37.77, -122.42, 37.7721, -122.4105) is None


def test_get_routes_non_list_alternates_are_ignored(monkeypatch):
    # A malformed "alternates" field must not make iteration raise; the valid
    # primary trip is still returned.
    payload = _valhalla_payload(include_alternates=False)
    payload["alternates"] = 5  # truthy but not iterable
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, json=None, timeout=None: FakeResponse(200, payload),
    )

    result = get_routes(37.77, -122.42, 37.7721, -122.4105)

    assert [c["id"] for c in result["candidates"]] == ["route-0"]


# --------------------------------------------------------------------------
# app.services.exposure._sample_points
# --------------------------------------------------------------------------


def test_sample_points_empty():
    assert _sample_points([]) == []


def test_sample_points_single_coord():
    assert _sample_points([[12.34, 56.78]]) == [[12.34, 56.78]]


def test_sample_points_respects_min_spacing():
    # ~111 m between consecutive points: only every 3rd point reaches the
    # 250 m spacing threshold.
    coords = [[0.0, 0.001 * i] for i in range(7)]

    points = _sample_points(coords)

    assert points == [[0.0, 0.0], [0.0, 0.003], [0.0, 0.006]]


def test_sample_points_caps_at_max_samples():
    # ~111 km hops: every consecutive pair clears the spacing threshold, but
    # the result must be capped at the default max of 12 samples.
    coords = [[float(i), 0.0] for i in range(20)]

    points = _sample_points(coords)

    assert len(points) == 12
    assert points[0] == [0.0, 0.0]
    assert points[11] == [11.0, 0.0]


# --------------------------------------------------------------------------
# app.services.exposure.estimate_pm25_route
# --------------------------------------------------------------------------

_SAMPLE_ROUTE = [[0.0, 0.0], [0.0, 0.01]]  # ~1.1 km apart -> 2 samples


def test_estimate_pm25_success_dict_response(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200, {"current": {"pm2_5": 12.7}}
        ),
    )

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is True
    assert result["value"] == 12.7
    assert result["metric"] == "pm2_5"
    assert result["units"] == "ug/m3"
    assert result["source"] == "open-meteo-cams"


def test_estimate_pm25_success_list_response_averages(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200,
            [
                {"current": {"pm2_5": 10.0}},
                {"current": {"pm2_5": 20.0}},
            ],
        ),
    )

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is True
    assert result["value"] == 15.0
    assert result["value_variance"] == [10.0, 20.0]


def test_estimate_pm25_single_coordinate_route(monkeypatch):
    # A route with one coordinate produces one sample; Open-Meteo answers a
    # single point with an object (not a list), which the parser must handle.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200, {"current": {"pm2_5": 9.4}}
        ),
    )

    result = estimate_pm25_route([[0.0, 0.0]], total_distance_m=0.0)

    assert result["available"] is True
    assert result["samples"] == 1
    assert result["value"] == 9.4


def test_estimate_pm25_timeout(monkeypatch):
    def fake_get(url, params=None, timeout=None):
        raise httpx.TimeoutException("slow")

    monkeypatch.setattr(httpx, "get", fake_get)

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is False
    assert result["reason"] == "timeout"


def test_estimate_pm25_http_error(monkeypatch):
    def fake_get(url, params=None, timeout=None):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "get", fake_get)

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is False
    assert result["reason"] == "upstream_error"


def test_estimate_pm25_non_200(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda url, params=None, timeout=None: FakeResponse(503)
    )

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is False
    assert result["reason"] == "http_503"


def test_estimate_pm25_empty_values(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(200, {"current": {}}),
    )

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result["available"] is False
    assert result["reason"] == "no_values"


def test_estimate_pm25_empty_coords_skips_http(monkeypatch):
    def fake_get(url, params=None, timeout=None):
        raise AssertionError("httpx.get must not be called for empty coords")

    monkeypatch.setattr(httpx, "get", fake_get)

    result = estimate_pm25_route([], total_distance_m=0.0)

    assert result["available"] is False
    assert result["reason"] == "no_sample_points"


# The exact payload this service returned *before* the dead-code cleanup
# (dead `pass` class bodies, the identical if/else branches and the unused
# `hourly` request parameter were removed). Frozen as a regression guard: the
# cleanup must not change a single byte of the estimate the client receives.
_EXPECTED_EXPOSURE_PAYLOAD = {
    "available": True,
    "metric": "pm2_5",
    "value": 12.7,
    "units": "ug/m3",
    "source": "open-meteo-cams",
    "samples": 2,
    "value_variance": [12.7],
    "indistinguishable": False,
    "caveat": (
        "regional model estimate (CAMS) - not street-level; coarse resolution "
        "may make values indistinguishable between nearby routes"
    ),
    "as_of": "2026-10-22T14:03:27Z",
}


def test_estimate_pm25_payload_is_byte_identical_to_pre_cleanup(monkeypatch):
    from app.services import exposure

    # Freeze the "as of" stamp so the payload is byte-comparable.
    monkeypatch.setattr(exposure, "_as_of", lambda: "2026-10-22T14:03:27Z")
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200, {"current": {"pm2_5": 12.7}}
        ),
    )

    result = estimate_pm25_route(_SAMPLE_ROUTE, total_distance_m=1100.0)

    assert result == _EXPECTED_EXPOSURE_PAYLOAD
    # Byte-identity of the serialized payload (canonical key order).
    assert json.dumps(result, sort_keys=True, separators=(",", ":")) == json.dumps(
        _EXPECTED_EXPOSURE_PAYLOAD, sort_keys=True, separators=(",", ":")
    )


# --------------------------------------------------------------------------
# app.services.geocoding.geocode_destination
# --------------------------------------------------------------------------


def test_geocode_destination_success(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: FakeResponse(
            200, [{"lat": "37.7749", "lon": "-122.4194"}]
        ),
    )

    result = geocode_destination("San Francisco")

    assert result == {"latitude": 37.7749, "longitude": -122.4194}


def test_geocode_destination_empty_results(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: FakeResponse(200, []),
    )

    assert geocode_destination("Nowhereville") is None


def test_geocode_destination_timeout(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        raise httpx.TimeoutException("slow")

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(GeocodingTimeout):
        geocode_destination("San Francisco")


def test_geocode_destination_non_200(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: FakeResponse(502),
    )

    with pytest.raises(GeocodingUpstreamError):
        geocode_destination("San Francisco")


def test_geocode_destination_http_error(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(GeocodingUpstreamError):
        geocode_destination("San Francisco")


@pytest.mark.parametrize(
    "payload",
    [
        {"error": "unexpected object"},  # not a result list
        ["not-a-result-object"],  # list item is not a mapping
        [{"display_name": "missing lat/lon"}],  # required keys absent
        [{"lat": "not-a-number", "lon": "1.0"}],  # unparseable coordinate
        [{"lat": "91.0", "lon": "0.0"}],  # out-of-range latitude
    ],
)
def test_geocode_destination_malformed_payload_raises_upstream_error(
    monkeypatch, payload
):
    # A 200 response with an unexpected body is an upstream failure (502),
    # never an uncaught KeyError/TypeError/ValueError escaping as a 500.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: FakeResponse(200, payload),
    )

    with pytest.raises(GeocodingUpstreamError):
        geocode_destination("San Francisco")
