import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "EcoRouteApp/1.0 (student prototype)"


class GeocodingError(Exception):
    pass


class GeocodingTimeout(GeocodingError):
    pass


class GeocodingUpstreamError(GeocodingError):
    pass


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

    return {
        "latitude": float(results[0]["lat"]),
        "longitude": float(results[0]["lon"]),
    }
