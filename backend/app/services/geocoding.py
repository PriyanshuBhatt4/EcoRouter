import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "EcoRouteApp/1.0 (student prototype)"


class GeocodingError(Exception):
    """Raised when a destination cannot be geocoded."""


class GeocodingTimeout(GeocodingError):
    """Raised when the geocoding upstream request times out."""


class GeocodingUpstreamError(GeocodingError):
    """Raised when the geocoding upstream service fails."""


def geocode_destination(destination: str):
    params = {
        "q": destination,
        "format": "json",
        "limit": 1,
    }

    headers = {
        "User-Agent": USER_AGENT,
    }

    try:
        response = httpx.get(
            NOMINATIM_URL,
            params=params,
            headers=headers,
            timeout=10,
        )
    except httpx.TimeoutException as exc:
        raise GeocodingTimeout("geocoding request timed out") from exc
    except httpx.HTTPError as exc:
        raise GeocodingUpstreamError(f"geocoding request failed: {exc}") from exc

    if response.status_code != 200:
        raise GeocodingUpstreamError(
            f"geocoding service returned HTTP {response.status_code}"
        )

    try:
        results = response.json()
    except ValueError as exc:
        raise GeocodingUpstreamError(
            "geocoding service returned invalid JSON"
        ) from exc

    if not results:
        return None

    # Nominatim answers with a JSON array of result objects. Anything else
    # (an error object, a bare string, ...) is an upstream failure, not a
    # client error: report it as GeocodingUpstreamError so the endpoints map
    # it to 502 instead of a parsing exception escaping as a bare 500.
    if not isinstance(results, list):
        raise GeocodingUpstreamError(
            "geocoding service returned an unexpected payload"
        )

    first = results[0]
    if not isinstance(first, dict):
        raise GeocodingUpstreamError("geocoding service returned an invalid result")

    try:
        latitude = float(first["lat"])
        longitude = float(first["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GeocodingUpstreamError(
            "geocoding service returned invalid coordinates"
        ) from exc

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise GeocodingUpstreamError(
            "geocoding service returned out-of-range coordinates"
        )

    resolved = {
        "latitude": latitude,
        "longitude": longitude,
    }

    # Additive: keep Nominatim's human-readable label when the upstream sends
    # one, so callers (e.g. GET /geocode) can surface it as a display name.
    # A response without a "display_name" still returns exactly the same dict
    # as before, so existing callers are unaffected.
    display_name = first.get("display_name") if isinstance(first, dict) else None
    if display_name:
        resolved["display_name"] = str(display_name)

    return resolved
