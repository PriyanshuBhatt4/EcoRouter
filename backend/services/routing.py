import httpx

OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving"
NO_ROUTE_CODES = {"NoRoute", "NoSegment"}


class RoutingError(Exception):
    pass


class RoutingTimeout(RoutingError):
    pass


class RoutingUpstreamError(RoutingError):
    pass


def get_route(
    start_latitude: float,
    start_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
):
    url = (
        f"{OSRM_ROUTE_URL}/"
        f"{start_longitude},{start_latitude};"
        f"{destination_longitude},{destination_latitude}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
    }

    try:
        response = httpx.get(
            url,
            params=params,
            timeout=10,
        )
    except httpx.TimeoutException as exc:
        raise RoutingTimeout("routing request timed out") from exc
    except httpx.HTTPError as exc:
        raise RoutingUpstreamError(f"routing request failed: {exc}") from exc

    if response.status_code != 200:
        raise RoutingUpstreamError(
            f"routing service returned HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise RoutingUpstreamError("routing service returned invalid JSON") from exc

    code = data.get("code")

    if code in NO_ROUTE_CODES:
        return None

    if code != "Ok":
        raise RoutingUpstreamError(f"routing service returned code: {code}")

    routes = data.get("routes") or []
    if not routes:
        return None

    route = routes[0]
    coordinates = (route.get("geometry") or {}).get("coordinates") or []
    if not coordinates:
        return None

    return {
        "id": "route-0",
        "distance_m": route["distance"],
        "duration_s": route["duration"],
        "coordinates": coordinates,
    }
