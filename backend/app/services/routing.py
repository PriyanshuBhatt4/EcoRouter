import math

import httpx

# Valhalla public server - prototype only, NO SLA
VALHALLA_ROUTE_URL = "https://valhalla1.openstreetmap.de/route"

# Modes/costing supported against public server
VERIFIED_COSTING = {
    "walking": "pedestrian",
    "driving": "auto",
    "cycling": "bicycle",
}


class RoutingError(Exception):
    """Raised when a route cannot be produced."""


class RoutingTimeout(RoutingError):
    """Raised when the routing upstream request times out."""


class RoutingUpstreamError(RoutingError):
    """Raised when the routing upstream service fails."""


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _decode_polyline6(encoded: str):
    """Decode Valhalla polyline6 (encoded polyline with precision 6) to list of [lon, lat]."""
    if not isinstance(encoded, str) or not encoded:
        return []
    coords = []
    index = 0
    lat = 0
    lon = 0
    length = len(encoded)
    while index < length:
        # decode latitude
        result = 0
        shift = 0
        while True:
            if index >= length:
                break
            byte = ord(encoded[index]) - 63
            index += 1
            result |= ((byte & 0x1F) << shift)
            shift += 5
            if byte < 0x20:
                break
        if result & 1:
            dlat = ~(result >> 1)
        else:
            dlat = result >> 1
        lat += dlat

        # decode longitude
        result = 0
        shift = 0
        while True:
            if index >= length:
                break
            byte = ord(encoded[index]) - 63
            index += 1
            result |= ((byte & 0x1F) << shift)
            shift += 5
            if byte < 0x20:
                break
        if result & 1:
            dlon = ~(result >> 1)
        else:
            dlon = result >> 1
        lon += dlon
        # Return as [lon, lat] for app
        coords.append([lon / 1e6, lat / 1e6])
    return coords


def get_routes(
    start_latitude: float,
    start_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
    mode: str = "walking",
    alternatives: int = 3,
):
    if mode not in VERIFIED_COSTING:
        raise RoutingUpstreamError(f"unverified mode: {mode}")

    costing = VERIFIED_COSTING[mode]
    # Valhalla public server is prototype only (no SLA). Limit alternates.
    alternates = max(0, min(int(alternatives), 3))

    body = {
        "locations": [
            {"lat": start_latitude, "lon": start_longitude},
            {"lat": destination_latitude, "lon": destination_longitude},
        ],
        "costing": costing,
        "alternates": alternates,
        "directions_options": {"units": "kilometers"},
    }

    try:
        response = httpx.post(
            VALHALLA_ROUTE_URL,
            json=body,
            timeout=15,
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

    # A 200 response must still be a Valhalla object; a bare list/scalar is an
    # upstream failure (502 envelope), not an AttributeError escaping as 500.
    if not isinstance(data, dict):
        raise RoutingUpstreamError("routing service returned an unexpected payload")

    candidates = []

    def _extract_trip(trip):
        if not isinstance(trip, dict) or not trip:
            return None
        summary = trip.get("summary") or {}
        if not isinstance(summary, dict):
            summary = {}
        legs = trip.get("legs") or []
        if not isinstance(legs, list) or not legs:
            return None
        # combine shapes from legs (polyline6)
        all_coords = []
        for leg in legs:
            if not isinstance(leg, dict):
                continue
            shape = leg.get("shape") or ""
            if shape:
                all_coords.extend(_decode_polyline6(shape))
        if not all_coords:
            return None
        # validate coordinates
        for c in all_coords:
            if len(c) != 2:
                return None
            lon_c, lat_c = c[0], c[1]
            if not (-180 <= lon_c <= 180 and -90 <= lat_c <= 90):
                return None
        try:
            distance_m = float(summary.get("length") or 0.0) * 1000.0
            duration_s = float(summary.get("time") or 0.0)
        except (TypeError, ValueError):
            return None
        return {
            "distance_m": distance_m,
            "duration_s": duration_s,
            "coordinates": all_coords,
        }

    # primary trip
    primary = _extract_trip(data.get("trip"))
    if primary:
        primary["id"] = "route-0"
        candidates.append(primary)
    # alternates
    alternate_trips = data.get("alternates") or []
    if not isinstance(alternate_trips, list):
        alternate_trips = []
    for alt in alternate_trips:
        # The requested count is a hard cap: it is checked BEFORE an alternate
        # is appended, so "alternates=0" can never yield a second candidate
        # (the upstream may still answer with alternates anyway).
        if len(candidates) >= 1 + alternates:
            break
        trip = alt.get("trip") if isinstance(alt, dict) else None
        if not trip and isinstance(alt, dict):
            trip = alt
        extracted = _extract_trip(trip)
        if extracted:
            extracted["id"] = f"route-{len(candidates)}"
            candidates.append(extracted)

    if not candidates:
        return None

    # approximate snap info from first candidate start
    snapped_start = None
    start_snap_m = None
    if candidates and candidates[0].get("coordinates"):
        c0 = candidates[0]["coordinates"][0]
        snapped_lon, snapped_lat = c0[0], c0[1]
        snapped_start = [snapped_lon, snapped_lat]
        start_snap_m = _haversine_m(
            start_longitude, start_latitude, snapped_lon, snapped_lat
        )

    snapped_end = None
    if candidates and candidates[0].get("coordinates"):
        c1 = candidates[0]["coordinates"][-1]
        snapped_end = [c1[0], c1[1]]

    candidates[0]["snapped_start"] = snapped_start
    candidates[0]["snapped_end"] = snapped_end
    candidates[0]["start_snap_m"] = start_snap_m

    return {
        "candidates": candidates,
        "provider": "valhalla_public",
        "provider_note": "Valhalla public server used (prototype only, no SLA).",
    }
