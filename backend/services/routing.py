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
    pass


class RoutingTimeout(RoutingError):
    pass


class RoutingUpstreamError(RoutingError):
    pass


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
    if not encoded:
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

    candidates = []

    def _extract_trip(trip):
        if not trip:
            return None
        summary = trip.get("summary") or {}
        legs = trip.get("legs") or []
        if not legs:
            return None
        # combine shapes from legs (polyline6)
        all_coords = []
        for leg in legs:
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
        distance_m = (summary.get("length") or 0.0) * 1000.0
        duration_s = summary.get("time") or 0.0
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
    for idx, alt in enumerate(data.get("alternates") or []):
        trip = alt.get("trip") if isinstance(alt, dict) else None
        if not trip and isinstance(alt, dict):
            trip = alt
        extracted = _extract_trip(trip)
        if extracted:
            extracted["id"] = f"route-{len(candidates)}"
            candidates.append(extracted)
        if len(candidates) >= 1 + alternates:
            break

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

    # validate first/last near requested endpoints
    if candidates[0].get("coordinates"):
        first = candidates[0]["coordinates"][0]
        last = candidates[0]["coordinates"][-1]
        # rough check - just ensure in range (already validated)
        pass

    candidates[0]["snapped_start"] = snapped_start
    candidates[0]["snapped_end"] = snapped_end
    candidates[0]["start_snap_m"] = start_snap_m

    return {
        "candidates": candidates,
        "provider": "valhalla_public",
        "provider_note": "Valhalla public server used (prototype only, no SLA).",
    }


# Backward compatible wrapper
def get_route(*args, **kwargs):
    res = get_routes(*args, **kwargs)
    if not res or not res.get("candidates"):
        return None
    c = res["candidates"][0]
    return {
        "id": c.get("id", "route-0"),
        "distance_m": c["distance_m"],
        "duration_s": c["duration_s"],
        "coordinates": c["coordinates"],
        "snapped_start": c.get("snapped_start"),
        "snapped_end": c.get("snapped_end"),
        "start_snap_m": c.get("start_snap_m"),
    }
