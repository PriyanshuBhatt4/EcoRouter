"""Deterministic fakes and shared helpers for the offline M2 test suite."""
from __future__ import annotations

# Known-good endpoints around San Francisco. Coordinates are [lon, lat]:
# longitudes are negative, latitudes positive, so ordering is unambiguous.
GEO_DEST = {"latitude": 37.7721, "longitude": -122.4105}
ORIGIN = {"latitude": 37.77, "longitude": -122.42}

# Fixed stand-in for app.services.exposure's "as of" stamp (ISO-8601, UTC, 'Z').
AS_OF = "2026-10-22T14:03:27Z"


def make_candidate(index: int) -> dict:
    """Build a routing candidate shaped like app.services.routing output."""
    return {
        "id": f"route-{index}",
        "distance_m": 1000.0 * (index + 1),
        "duration_s": 300.0 * (index + 1),
        "coordinates": [
            [-122.42 + 0.005 * index, 37.77 + 0.001 * index],
            [-122.41 + 0.005 * index, 37.771 + 0.001 * index],
        ],
    }


def make_routes_res(count: int = 1) -> dict:
    """Build an app.services.routing.get_routes-style result with `count` candidates."""
    return {
        "candidates": [make_candidate(i) for i in range(count)],
        "provider": "valhalla_public",
        "provider_note": "Valhalla public server used (prototype only, no SLA).",
    }


def ok_estimate(value: float = 12.0) -> dict:
    """Build an app.services.exposure.estimate_pm25_route-style available result."""
    return {
        "available": True,
        "metric": "pm2_5",
        "value": value,
        "units": "ug/m3",
        "source": "open-meteo-cams",
        "samples": 2,
        "indistinguishable": False,
        "caveat": "regional model estimate (CAMS) - not street-level",
        "as_of": AS_OF,
    }


def unavailable_estimate(reason: str = "timeout") -> dict:
    """Build an app.services.exposure.estimate_pm25_route-style unavailable result."""
    return {
        "available": False,
        "reason": reason,
        "metric": "pm2_5",
        "units": "ug/m3",
        "source": "open-meteo-cams",
        "caveat": "regional model estimate (CAMS) - not street-level",
        "as_of": AS_OF,
    }


def route_body(**overrides) -> dict:
    """Build a valid POST /route request body."""
    body = {
        "latitude": ORIGIN["latitude"],
        "longitude": ORIGIN["longitude"],
        "destination": "Golden Gate Bridge",
        "mode": "walking",
        "alternatives": 3,
    }
    body.update(overrides)
    return body


def assert_error_envelope(response, status_code: int, code: str) -> None:
    """Assert the {"error": {"code", "message"}} envelope contract."""
    assert response.status_code == status_code
    body = response.json()
    assert set(body.keys()) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert body["error"]["message"]


def patch_geocode(monkeypatch, result):
    """Patch main.geocode_destination; raise `result` if it is an Exception."""
    from app import main

    calls = []

    def fake_geocode(destination):
        calls.append(destination)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(main, "geocode_destination", fake_geocode)
    return calls


def patch_routes(monkeypatch, result):
    """Patch main.get_routes; raise `result` if it is an Exception.

    Returns the list of call kwargs (one dict per invocation).
    """
    from app import main

    calls = []

    def fake_get_routes(
        start_lat, start_lon, dest_lat, dest_lon, mode="walking", alternatives=3
    ):
        calls.append(
            {
                "start": (start_lat, start_lon),
                "destination": (dest_lat, dest_lon),
                "mode": mode,
                "alternatives": alternatives,
            }
        )
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(main, "get_routes", fake_get_routes)
    return calls


def patch_estimate(monkeypatch, estimate_fn=None):
    """Patch main.estimate_pm25_route; default gives every route value 12.0.

    Returns the list of call records (one dict per candidate).
    """
    from app import main

    if estimate_fn is None:

        def estimate_fn(coords, total_distance_m=0.0, timeout=10):
            return ok_estimate(12.0)

    calls = []

    def fake_estimate(coords, total_distance_m=0.0, timeout=10):
        calls.append({"coords": list(coords), "total_distance_m": total_distance_m})
        return estimate_fn(
            list(coords), total_distance_m=total_distance_m, timeout=timeout
        )

    monkeypatch.setattr(main, "estimate_pm25_route", fake_estimate)
    return calls


def sequence_estimate(values):
    """Estimate fn returning successive per-candidate values (None = unavailable)."""
    iterator = iter(values)

    def estimate_fn(coords, total_distance_m=0.0, timeout=10):
        value = next(iterator)
        if value is None:
            return unavailable_estimate("no_values")
        return ok_estimate(value)

    return estimate_fn
