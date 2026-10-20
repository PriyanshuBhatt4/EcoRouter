import math
from typing import List, Dict, Any

import httpx

AQ_API_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# CAMS/ Open-Meteo air quality (modelled background) - prototype only
EXPOSURE_SOURCE = "open-meteo-cams"


class ExposureError(Exception):
    pass


class ExposureTimeout(ExposureError):
    pass


class ExposureUpstreamError(ExposureError):
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


def _sample_points(coords: List[List[float]], max_samples: int = 12, min_spacing_m: int = 250) -> List[List[float]]:
    if len(coords) == 0:
        return []
    if len(coords) == 1:
        return [coords[0]]
    points = [coords[0]]
    dist = 0.0
    for i in range(1, len(coords)):
        p = coords[i]
        prev = coords[i - 1]
        d = _haversine_m(prev[0], prev[1], p[0], p[1])
        dist += d
        if dist >= min_spacing_m:
            points.append(p)
            dist = 0.0
            if len(points) >= max_samples:
                break
    if len(points) == 1:
        points.append(coords[-1])
    if len(points) > 1 and points[-1] != coords[-1] and len(points) < max_samples:
        # append end if spaced
        last_dist = _haversine_m(points[-1][0], points[-1][1], coords[-1][0], coords[-1][1])
        if last_dist >= min_spacing_m // 2 or len(points) < 3:
            points.append(coords[-1])
    # deduplicate last
    if len(points) > 1 and points[-1] == points[-2]:
        points.pop()
    return points[:max_samples]


def estimate_pm25_route(coords: List[List[float]], total_distance_m: float = 0.0, timeout: int = 10) -> Dict[str, Any]:
    samples = _sample_points(coords)
    if len(samples) == 0:
        return {
            "available": False,
            "reason": "no_sample_points",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level; coarse resolution may make values indistinguishable",
        }

    # Build query
    lats = [p[1] for p in samples]
    lons = [p[0] for p in samples]
    lat_str = ",".join(f"{x:.4f}" for x in lats)
    lon_str = ",".join(f"{x:.4f}" for x in lons)
    params = {
        "latitude": lat_str,
        "longitude": lon_str,
        "hourly": "pm2_5",
        "current": "pm2_5",
        "timezone": "auto",
    }
    try:
        response = httpx.get(AQ_API_URL, params=params, timeout=timeout)
    except httpx.TimeoutException:
        return {
            "available": False,
            "reason": "timeout",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level",
        }
    except httpx.HTTPError:
        return {
            "available": False,
            "reason": "upstream_error",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level",
        }
    if response.status_code != 200:
        return {
            "available": False,
            "reason": f"http_{response.status_code}",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level",
        }
    try:
        data = response.json()
    except ValueError:
        return {
            "available": False,
            "reason": "invalid_json",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level",
        }

    # Parse - API returns list if multiple points, or dict if single
    values = []
    if isinstance(data, list):
        for item in data:
            cur = item.get("current", {})
            pm = cur.get("pm2_5") if cur else None
            if pm is not None:
                try:
                    values.append(float(pm))
                except (ValueError, TypeError):
                    pass
    elif isinstance(data, dict):
        cur = data.get("current", {})
        pm = cur.get("pm2_5") if cur else None
        if pm is not None:
            try:
                values.append(float(pm))
            except (ValueError, TypeError):
                pass
    if len(values) == 0:
        return {
            "available": False,
            "reason": "no_values",
            "metric": "pm2_5",
            "units": "ug/m3",
            "source": EXPOSURE_SOURCE,
            "caveat": "regional model estimate (CAMS) - not street-level",
        }
    if total_distance_m > 0 and len(samples) > 1:
        mean_val = sum(values) / len(values)
    else:
        mean_val = sum(values) / len(values)
    value = round(mean_val, 1)
    # Check if all values same (indistinguishable)
    if len(set(values)) == 1 and len(values) > 1:
        indist = True
    else:
        indist = False
    return {
        "available": True,
        "metric": "pm2_5",
        "value": value,
        "units": "ug/m3",
        "source": EXPOSURE_SOURCE,
        "samples": len(samples),
        "value_variance": values,
        "indistinguishable": indist,
        "caveat": "regional model estimate (CAMS) - not street-level; coarse resolution may make values indistinguishable between nearby routes",
    }
