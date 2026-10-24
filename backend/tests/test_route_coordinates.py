"""POST /route with caller-supplied destination coordinates (offline).

Covers the saved-places capability: when the caller sends exact destination
coordinates the request skips geocoding entirely and routes to that point.
Every test monkeypatches the geocoder, the router and the exposure service -
no network, no DB, no auth, no API keys.
"""

from tests.helpers import (
    GEO_DEST,
    assert_error_envelope,
    make_routes_res,
    patch_estimate,
    patch_geocode,
    patch_routes,
    route_body,
)

DEST_LAT = 28.6
DEST_LNG = 77.2
COORDS_ERROR_MESSAGE = (
    "destinationLatitude and destinationLongitude must be provided together "
    "with valid range"
)


def _coords_body(**overrides):
    """A POST /route body with exact destination coordinates and no text."""
    body = route_body(
        destination="",
        destinationLatitude=DEST_LAT,
        destinationLongitude=DEST_LNG,
    )
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Coordinates replace geocoding
# --------------------------------------------------------------------------


def test_coordinates_only_request_skips_geocoding(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=_coords_body())

    assert response.status_code == 200
    body = response.json()
    # The geocoder must not have been called at all.
    assert geocode_calls == []
    # Routing received the exact coordinates that were supplied.
    assert route_calls[0]["destination"] == (DEST_LAT, DEST_LNG)
    assert route_calls[0]["start"] == (37.77, -122.42)
    assert body["destination"]["latitude"] == DEST_LAT
    assert body["destination"]["longitude"] == DEST_LNG


def test_coordinates_without_destination_text_succeeds(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    body = route_body()
    body.pop("destination")
    body["destinationLatitude"] = DEST_LAT
    body["destinationLongitude"] = DEST_LNG

    response = client.post("/route", json=body)

    assert response.status_code == 200
    assert geocode_calls == []
    assert route_calls[0]["destination"] == (DEST_LAT, DEST_LNG)


def test_blank_destination_with_valid_coordinates_succeeds(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=_coords_body(destination="   "))

    assert response.status_code == 200
    assert geocode_calls == []
    assert route_calls[0]["destination"] == (DEST_LAT, DEST_LNG)


def test_destination_text_with_coordinates_uses_coordinates(client, monkeypatch):
    # Text + coordinates: the text is only a label, the coordinates win and
    # the geocoder is never called.
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destination="  Home  ")
    )

    assert response.status_code == 200
    assert geocode_calls == []
    assert route_calls[0]["destination"] == (DEST_LAT, DEST_LNG)
    assert response.json()["destination"]["name"] == "Home"


# --------------------------------------------------------------------------
# Coordinate validation
# --------------------------------------------------------------------------


def test_latitude_only_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    body = route_body()
    body.pop("destination")
    body["destinationLatitude"] = DEST_LAT

    response = client.post("/route", json=body)

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert COORDS_ERROR_MESSAGE in response.json()["error"]["message"]


def test_longitude_only_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    body = route_body()
    body.pop("destination")
    body["destinationLongitude"] = DEST_LNG

    response = client.post("/route", json=body)

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert COORDS_ERROR_MESSAGE in response.json()["error"]["message"]


def test_out_of_range_destination_latitude_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destinationLatitude=91.0)
    )

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert COORDS_ERROR_MESSAGE in response.json()["error"]["message"]


def test_out_of_range_destination_longitude_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destinationLongitude=-181.0)
    )

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert COORDS_ERROR_MESSAGE in response.json()["error"]["message"]


def test_non_numeric_destination_latitude_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destinationLatitude="not-a-number")
    )

    assert_error_envelope(response, 422, "INVALID_REQUEST")


# --------------------------------------------------------------------------
# Destination name in the response envelope
# --------------------------------------------------------------------------


def test_destination_name_used_in_envelope(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destinationName="Saved home")
    )

    assert response.status_code == 200
    body = response.json()
    assert body["destination"]["name"] == "Saved home"
    assert body["destination"]["latitude"] == DEST_LAT
    assert body["destination"]["longitude"] == DEST_LNG


def test_destination_name_over_max_length_rejected(client, monkeypatch):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destinationName="x" * 201)
    )

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "destinationName" in response.json()["error"]["message"]


def test_blank_destination_name_falls_back_to_destination_text(
    client, monkeypatch
):
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post(
        "/route", json=_coords_body(destination="Park", destinationName="   ")
    )

    assert response.status_code == 200
    assert response.json()["destination"]["name"] == "Park"


def test_fallback_name_formats_coordinates(client, monkeypatch):
    # No name and no text: a deterministic "lat, lng" label is used.
    patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=_coords_body())

    assert response.status_code == 200
    assert response.json()["destination"]["name"] == "28.6000, 77.2000"


# --------------------------------------------------------------------------
# Backward compatibility (no coordinates supplied)
# --------------------------------------------------------------------------


def test_text_only_request_still_geocodes(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    route_calls = patch_routes(monkeypatch, make_routes_res(1))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body())

    assert response.status_code == 200
    body = response.json()
    assert geocode_calls == ["Golden Gate Bridge"]
    assert route_calls[0]["destination"] == (
        GEO_DEST["latitude"],
        GEO_DEST["longitude"],
    )
    assert body["destination"] == {
        "name": "Golden Gate Bridge",
        "latitude": GEO_DEST["latitude"],
        "longitude": GEO_DEST["longitude"],
    }


def test_blank_destination_without_coordinates_still_rejected(client, monkeypatch):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_estimate(monkeypatch)

    response = client.post("/route", json=route_body(destination="   "))

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "destination" in response.json()["error"]["message"]
    assert geocode_calls == []


def test_missing_destination_without_coordinates_still_rejected(
    client, monkeypatch
):
    geocode_calls = patch_geocode(monkeypatch, dict(GEO_DEST))
    patch_estimate(monkeypatch)

    body = route_body()
    body.pop("destination")

    response = client.post("/route", json=body)

    assert_error_envelope(response, 422, "INVALID_REQUEST")
    assert "destination" in response.json()["error"]["message"]
    assert geocode_calls == []
