"""GET /geocode success and error-envelope tests (offline, deterministic).

The endpoint reuses app.services.geocoding.geocode_destination verbatim, so every
test monkeypatches it - no network, no DB, no auth, no API keys.
"""

import httpx

from app.services.geocoding import GeocodingTimeout, GeocodingUpstreamError

from tests.helpers import assert_error_envelope, patch_geocode


class _FakeResponse:
    """Minimal stand-in for an httpx.Response (used for the service test)."""

    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


# --------------------------------------------------------------------------
# Success path
# --------------------------------------------------------------------------


def test_geocode_success_returns_coordinates_and_display_name(client, monkeypatch):
    geocode_calls = patch_geocode(
        monkeypatch,
        {
            "latitude": 37.7721,
            "longitude": -122.4105,
            "display_name": "Golden Gate Bridge, San Francisco",
        },
    )

    response = client.get("/geocode", params={"q": "Golden Gate Bridge"})

    assert response.status_code == 200
    body = response.json()
    # Same flat success shape as the other success responses (no error key).
    assert set(body.keys()) == {"latitude", "longitude", "displayName"}
    assert body["latitude"] == 37.7721
    assert body["longitude"] == -122.4105
    assert body["displayName"] == "Golden Gate Bridge, San Francisco"
    # The trimmed query is what reached the geocoder.
    assert geocode_calls == ["Golden Gate Bridge"]


def test_geocode_success_falls_back_to_query_text_without_display_name(
    client, monkeypatch
):
    # app.services.geocoding only adds "display_name" when Nominatim sends one,
    # so the endpoint must fall back to the queried text.
    patch_geocode(monkeypatch, {"latitude": 28.6139, "longitude": 77.2090})

    response = client.get("/geocode", params={"q": "India Gate"})

    assert response.status_code == 200
    body = response.json()
    assert body["latitude"] == 28.6139
    assert body["longitude"] == 77.2090
    assert body["displayName"] == "India Gate"


def test_geocode_success_trims_query_before_geocoding(client, monkeypatch):
    geocode_calls = patch_geocode(
        monkeypatch, {"latitude": 48.8584, "longitude": 2.2945}
    )

    response = client.get("/geocode", params={"q": "  Eiffel Tower  "})

    assert response.status_code == 200
    assert geocode_calls == ["Eiffel Tower"]
    assert response.json()["displayName"] == "Eiffel Tower"


def test_geocode_success_has_no_error_envelope(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 1.0, "longitude": 2.0})

    response = client.get("/geocode", params={"q": "somewhere"})

    assert response.status_code == 200
    assert "error" not in response.json()


# --------------------------------------------------------------------------
# Request validation
# --------------------------------------------------------------------------


def test_geocode_blank_q_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 1.0, "longitude": 2.0})

    response = client.get("/geocode", params={"q": ""})

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "q must not be blank" in response.json()["error"]["message"]


def test_geocode_whitespace_only_q_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 1.0, "longitude": 2.0})

    response = client.get("/geocode", params={"q": "   "})

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "q must not be blank" in response.json()["error"]["message"]


def test_geocode_missing_q_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, {"latitude": 1.0, "longitude": 2.0})

    response = client.get("/geocode")

    assert_error_envelope(response, 422, "INVALID_REQUEST")


def test_geocode_query_over_max_length_rejected(client, monkeypatch):
    # Query(max_length=200): 201 characters are rejected before the handler.
    patch_geocode(monkeypatch, {"latitude": 1.0, "longitude": 2.0})

    response = client.get("/geocode", params={"q": "x" * 201})

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "q" in response.json()["error"]["message"]


# --------------------------------------------------------------------------
# Upstream failures - same codes/statuses as POST /route
# --------------------------------------------------------------------------


def test_geocode_no_result_yields_404(client, monkeypatch):
    patch_geocode(monkeypatch, None)

    response = client.get("/geocode", params={"q": "Nowhereville"})

    assert_error_envelope(response, 404, "NO_GEOCODING_RESULT")
    assert "Nowhereville" in response.json()["error"]["message"]


def test_geocode_timeout_yields_504(client, monkeypatch):
    patch_geocode(monkeypatch, GeocodingTimeout("timed out"))

    response = client.get("/geocode", params={"q": "Golden Gate Bridge"})

    assert_error_envelope(response, 504, "UPSTREAM_TIMEOUT")
    assert "geocoding" in response.json()["error"]["message"]


def test_geocode_upstream_error_yields_502(client, monkeypatch):
    patch_geocode(monkeypatch, GeocodingUpstreamError("boom"))

    response = client.get("/geocode", params={"q": "Golden Gate Bridge"})

    assert_error_envelope(response, 502, "UPSTREAM_ERROR")
    assert "geocoding" in response.json()["error"]["message"]


def test_geocode_malformed_upstream_body_yields_502(client, monkeypatch):
    # Exercise the real service: a 200 body that is not a Nominatim result list
    # must surface as the same 502 envelope as any other geocoding upstream
    # failure, not as a 500 INTERNAL_ERROR from a parsing exception.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: _FakeResponse(
            200, {"unexpected": "payload"}
        ),
    )

    response = client.get("/geocode", params={"q": "Golden Gate Bridge"})

    assert_error_envelope(response, 502, "UPSTREAM_ERROR")
    assert "geocoding" in response.json()["error"]["message"]


# --------------------------------------------------------------------------
# app.services.geocoding display_name preservation (additive behaviour)
# --------------------------------------------------------------------------


def test_geocode_service_preserves_display_name_when_present(monkeypatch):
    from app.services.geocoding import geocode_destination

    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: _FakeResponse(
            200,
            [
                {
                    "lat": "37.7749",
                    "lon": "-122.4194",
                    "display_name": "San Francisco, California, United States",
                }
            ],
        ),
    )

    result = geocode_destination("San Francisco")

    assert result["latitude"] == 37.7749
    assert result["longitude"] == -122.4194
    assert result["display_name"] == "San Francisco, California, United States"


def test_geocode_service_without_display_name_keeps_exact_dict(monkeypatch):
    # Backward compatibility: a payload without "display_name" must still
    # return exactly {"latitude", "longitude"} - nothing added, nothing removed.
    from app.services.geocoding import geocode_destination

    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, params=None, headers=None, timeout=None: _FakeResponse(
            200, [{"lat": "37.7749", "lon": "-122.4194"}]
        ),
    )

    result = geocode_destination("San Francisco")

    assert result == {"latitude": 37.7749, "longitude": -122.4194}
