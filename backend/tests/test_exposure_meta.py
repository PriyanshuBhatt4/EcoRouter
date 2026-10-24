"""Contract tests for the additive `as_of` stamp on exposure payloads.

Every shape returned by app.services.exposure.estimate_pm25_route - success and
every failure reason - must carry an `as_of` timestamp the client can render
("as of 2026-10-22T14:03:27Z"). Offline: httpx is monkeypatched, no network.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.services.exposure import estimate_pm25_route
from tests.helpers import (
    GEO_DEST,
    make_routes_res,
    patch_estimate,
    patch_geocode,
    patch_routes,
    route_body,
)

_ROUTE = [[0.0, 0.0], [0.0, 0.01]]  # ~1.1 km apart -> 2 sample points

# Second precision, trailing 'Z', UTC.
_AS_OF_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

_SUCCESS_KEYS = {
    "available",
    "metric",
    "value",
    "units",
    "source",
    "samples",
    "value_variance",
    "indistinguishable",
    "caveat",
    "as_of",
}


class FakeResponse:
    """Minimal stand-in for an httpx.Response (mirrors tests/test_services.py)."""

    def __init__(self, status_code=200, payload=None, invalid_json=False):
        self.status_code = status_code
        self._payload = payload
        self._invalid_json = invalid_json

    def json(self):
        if self._invalid_json:
            raise ValueError("invalid JSON")
        return self._payload


def _assert_valid_as_of(payload):
    """Assert the payload carries a parseable UTC 'as of' stamp; return it."""
    assert "as_of" in payload, "payload is missing the as_of stamp"
    as_of = payload["as_of"]
    assert isinstance(as_of, str), f"as_of must be a string, got {type(as_of)}"
    assert _AS_OF_RE.match(as_of), f"as_of is not second-precision ISO-8601 UTC: {as_of}"
    parsed = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None, "as_of must be timezone-aware"
    assert parsed.utcoffset() == timedelta(0), "as_of must be UTC"
    return parsed


def _patch_failure(monkeypatch, kind):
    """Make httpx.get fail in the way that produces the given failure reason."""
    if kind == "timeout":

        def fake_get(url, params=None, timeout=None):
            raise httpx.TimeoutException("slow")

    elif kind == "upstream_error":

        def fake_get(url, params=None, timeout=None):
            raise httpx.ConnectError("connection refused")

    elif kind == "http_503":
        fake_get = lambda url, params=None, timeout=None: FakeResponse(503)  # noqa: E731
    elif kind == "invalid_json":
        fake_get = lambda url, params=None, timeout=None: FakeResponse(  # noqa: E731
            200, None, invalid_json=True
        )
    elif kind == "no_values":
        fake_get = lambda url, params=None, timeout=None: FakeResponse(  # noqa: E731
            200, {"current": {}}
        )
    else:  # pragma: no cover - guards the parametrization below
        raise AssertionError(f"unknown failure kind: {kind}")

    monkeypatch.setattr(httpx, "get", fake_get)


# --------------------------------------------------------------------------
# Service level: every payload shape carries `as_of`
# --------------------------------------------------------------------------


def test_success_payload_includes_as_of(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200, {"current": {"pm2_5": 12.7}}
        ),
    )

    result = estimate_pm25_route(_ROUTE, total_distance_m=1100.0)

    assert result["available"] is True
    _assert_valid_as_of(result)
    # The pre-existing fields are unchanged by the additive stamp.
    assert set(result.keys()) == _SUCCESS_KEYS
    assert result["value"] == 12.7
    assert result["metric"] == "pm2_5"
    assert result["units"] == "ug/m3"
    assert result["source"] == "open-meteo-cams"
    assert result["samples"] == 2
    assert result["value_variance"] == [12.7]
    assert result["indistinguishable"] is False


def test_success_list_response_includes_as_of(monkeypatch):
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

    result = estimate_pm25_route(_ROUTE, total_distance_m=1100.0)

    assert result["available"] is True
    _assert_valid_as_of(result)
    assert result["value"] == 15.0
    assert result["value_variance"] == [10.0, 20.0]


@pytest.mark.parametrize(
    "kind,reason",
    [
        ("timeout", "timeout"),
        ("upstream_error", "upstream_error"),
        ("http_503", "http_503"),
        ("invalid_json", "invalid_json"),
        ("no_values", "no_values"),
    ],
)
def test_failure_payloads_include_as_of(monkeypatch, kind, reason):
    _patch_failure(monkeypatch, kind)

    result = estimate_pm25_route(_ROUTE, total_distance_m=1100.0)

    assert result["available"] is False
    assert result["reason"] == reason
    _assert_valid_as_of(result)
    # The failure shape keeps its pre-existing fields too.
    assert result["metric"] == "pm2_5"
    assert result["units"] == "ug/m3"
    assert result["source"] == "open-meteo-cams"


def test_no_sample_points_payload_includes_as_of(monkeypatch):
    def fake_get(url, params=None, timeout=None):
        raise AssertionError("httpx.get must not be called for empty coords")

    monkeypatch.setattr(httpx, "get", fake_get)

    result = estimate_pm25_route([], total_distance_m=0.0)

    assert result["available"] is False
    assert result["reason"] == "no_sample_points"
    _assert_valid_as_of(result)


def test_as_of_tracks_current_utc_time(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, timeout=None: FakeResponse(
            200, {"current": {"pm2_5": 5.0}}
        ),
    )

    before = datetime.now(timezone.utc).replace(microsecond=0)
    result = estimate_pm25_route(_ROUTE, total_distance_m=1100.0)
    after = datetime.now(timezone.utc).replace(microsecond=0)

    parsed = _assert_valid_as_of(result)
    assert before <= parsed <= after


# --------------------------------------------------------------------------
# API level: the stamp survives the /route pass-through
# --------------------------------------------------------------------------


def test_route_response_preserves_as_of(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(2))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    body = response.json()
    for candidate in body["candidates"]:
        estimate = candidate["pm25_estimate"]
        _assert_valid_as_of(estimate)
        assert estimate["available"] is True
        assert estimate["source"] == "open-meteo-cams"
        assert estimate["units"] == "ug/m3"
    # The primary route mirrors the first candidate, stamp included.
    assert body["route"]["pm25_estimate"]["as_of"] == (
        body["candidates"][0]["pm25_estimate"]["as_of"]
    )


def test_route_exception_fallback_includes_as_of(client, monkeypatch):
    def boom(coords, total_distance_m=0.0, timeout=10):
        raise RuntimeError("exposure service blew up")

    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch, boom)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    estimate = response.json()["candidates"][0]["pm25_estimate"]
    assert estimate["available"] is False
    assert estimate["reason"] == "exception"
    _assert_valid_as_of(estimate)


def test_route_exception_fallback_logs_the_swallowed_failure(client, monkeypatch, caplog):
    # The defensive fallback keeps the client-safe payload, but the swallowed
    # exception must still reach the server log - otherwise a broken exposure
    # service is completely invisible in production.
    def boom(coords, total_distance_m=0.0, timeout=10):
        raise RuntimeError("exposure service blew up")

    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch, boom)

    with caplog.at_level(logging.ERROR, logger="ecorouter"):
        response = client.post("/route", json=route_body())

    assert response.status_code == 200
    estimate = response.json()["candidates"][0]["pm25_estimate"]
    assert estimate["available"] is False
    assert estimate["reason"] == "exception"

    exposure_logs = [
        record
        for record in caplog.records
        if record.name == "ecorouter"
        and "exposure" in record.getMessage().lower()
    ]
    assert exposure_logs, "the swallowed exposure failure was not logged"
    # The traceback belongs in the log, never in the response body.
    assert "exposure service blew up" not in response.text
