from typing import Literal, Optional
from datetime import datetime

from fastapi import FastAPI, Request, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.geocoding import (
    GeocodingTimeout,
    GeocodingUpstreamError,
    geocode_destination,
)
from services.routing import (
    RoutingTimeout,
    RoutingUpstreamError,
    get_routes,
)
from services.exposure import estimate_pm25_route
from auth.supabase import get_current_user_id
from db.database import SessionLocal
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

app = FastAPI()


class RouteRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    destination: str = Field(min_length=1)
    mode: Literal["walking", "driving", "cycling"] = "walking"
    alternatives: int = Field(default=3, ge=0, le=3)


def api_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    first = exc.errors()[0]
    location = ".".join(str(part) for part in first.get("loc", ()))
    message = f"{location}: {first.get('msg', 'invalid value')}"
    return api_error(422, "INVALID_REQUEST", message)


@app.get("/")
def home():
    return {"message": "EcoRoute backend is working !"}


@app.post("/route")
def create_route(request: RouteRequest):
    destination_query = request.destination.strip()
    if not destination_query:
        return api_error(422, "INVALID_REQUEST", "destination must not be blank")

    try:
        destination_coordinates = geocode_destination(destination_query)
    except GeocodingTimeout:
        return api_error(
            504, "UPSTREAM_TIMEOUT", "geocoding service timed out, try again"
        )
    except GeocodingUpstreamError:
        return api_error(
            502, "UPSTREAM_ERROR", "geocoding service is unavailable"
        )

    if destination_coordinates is None:
        return api_error(
            404,
            "NO_GEOCODING_RESULT",
            f"no location found for '{destination_query}'",
        )

    try:
        routes_res = get_routes(
            request.latitude,
            request.longitude,
            destination_coordinates["latitude"],
            destination_coordinates["longitude"],
            mode=request.mode,
            alternatives=request.alternatives,
        )
    except RoutingTimeout:
        return api_error(
            504, "UPSTREAM_TIMEOUT", "routing service timed out, try again"
        )
    except RoutingUpstreamError:
        return api_error(502, "UPSTREAM_ERROR", "routing service is unavailable")

    if not routes_res or not routes_res.get("candidates"):
        return api_error(
            404,
            "NO_ROUTE_FOUND",
            "no route found between the given points",
        )

    candidates = routes_res["candidates"]
    primary = candidates[0]

    enriched_candidates = []
    for c in candidates:
        coords = c.get("coordinates") or []
        dist_m = c.get("distance_m") or 0.0
        try:
            exp = estimate_pm25_route(coords, total_distance_m=dist_m, timeout=10)
        except Exception:
            exp = {
                "available": False,
                "reason": "exception",
                "metric": "pm2_5",
                "units": "ug/m3",
                "source": "open-meteo-cams",
                "caveat": "regional model estimate (CAMS) - not street-level; estimate unavailable",
            }
        c_out = dict(c)
        c_out["pm25_estimate"] = exp
        enriched_candidates.append(c_out)

    # Compute cross-candidate distinguishability - only if all have available estimates
    all_available = True
    values = []
    for c in enriched_candidates:
        exp = c.get("pm25_estimate") or {}
        if not exp.get("available") or exp.get("value") is None:
            all_available = False
            break
        try:
            values.append(float(exp["value"]))
        except (ValueError, TypeError):
            all_available = False
            break
    all_equal_or_unavailable = False
    can_compare_cleanest = False
    if not all_available:
        all_equal_or_unavailable = True
        can_compare_cleanest = False
    else:
        # all available - check if equal
        rounded = [round(v, 1) for v in values]
        if len(set(rounded)) == 1:
            all_equal_or_unavailable = True
            can_compare_cleanest = False
        else:
            all_equal_or_unavailable = False
            can_compare_cleanest = True
    for c in enriched_candidates:
        exp = dict(c.get("pm25_estimate") or {})
        exp["indistinguishable_across_routes"] = all_equal_or_unavailable
        exp["can_compare_cleanest"] = can_compare_cleanest
        if not all_available:
            exp["cross_route_note"] = "PM₂.₅ estimates missing for some routes; cannot compare reliably. Regional model estimate (CAMS) — not street-level."
        elif all_equal_or_unavailable:
            exp["cross_route_note"] = "All candidate routes have equal regional model PM₂.₅ estimates; cannot identify a cleaner route. Regional model estimate (CAMS)."
        else:
            exp["cross_route_note"] = "Regional model PM₂.₅ estimates differ across routes; Cleanest uses lowest estimated PM₂.₅ (model-based). Regional model estimate (CAMS) — not street-level."
        c["pm25_estimate"] = exp

    primary_out = enriched_candidates[0]

    return {
        "origin": {
            "latitude": request.latitude,
            "longitude": request.longitude,
        },
        "destination": {
            "name": destination_query,
            "latitude": destination_coordinates["latitude"],
            "longitude": destination_coordinates["longitude"],
        },
        "mode": request.mode,
        "provider": routes_res.get("provider"),
        "provider_note": routes_res.get("provider_note"),
        "route": primary_out,
        "candidates": enriched_candidates,
        "attribution": {
            "air_quality": {
                "source": "Open-Meteo Air Quality API",
                "provider": "Copernicus Atmosphere Monitoring Service (CAMS)",
                "url": "https://open-meteo.com/en/docs/air-quality-api",
                "note": "Regional model estimate - not street-level pollution or measured personal exposure",
            }
        },
    }


# Authenticated user endpoints (Supabase)
class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=100)
    weight_kg: Optional[float] = Field(default=None, ge=0, le=500)
    age: Optional[int] = Field(default=None, ge=0, le=150)


class TripCreate(BaseModel):
    mode: Literal["walking", "driving", "cycling"]
    actual_distance_m: float = Field(ge=0)
    duration_sec: float = Field(ge=0)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    route_snapshot: Optional[dict] = None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/me/profile")
def get_profile(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    res = db.execute(text("SELECT id, user_id, display_name, weight_kg, age, created_at, updated_at FROM profiles WHERE user_id=:uid"), {"uid": user_id}).mappings().fetchone()
    if res:
        return dict(res)
    db.execute(text("INSERT INTO profiles (user_id) VALUES (:uid)"), {"uid": user_id})
    db.commit()
    res = db.execute(text("SELECT id, user_id, display_name, weight_kg, age, created_at, updated_at FROM profiles WHERE user_id=:uid"), {"uid": user_id}).mappings().fetchone()
    return dict(res)


@app.put("/me/profile")
def update_profile(payload: ProfileUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    fields = []
    params = {"uid": user_id}
    if payload.display_name is not None:
        fields.append("display_name=:display_name")
        params["display_name"] = payload.display_name
    if payload.weight_kg is not None:
        fields.append("weight_kg=:weight_kg")
        params["weight_kg"] = payload.weight_kg
    if payload.age is not None:
        fields.append("age=:age")
        params["age"] = payload.age
    if fields:
        db.execute(text(f"UPDATE profiles SET updated_at=now(), {', '.join(fields)} WHERE user_id=:uid"), params)
    else:
        db.execute(text("UPDATE profiles SET updated_at=now() WHERE user_id=:uid"), {"uid": user_id})
    db.commit()
    res = db.execute(text("SELECT id, user_id, display_name, weight_kg, age, created_at, updated_at FROM profiles WHERE user_id=:uid"), {"uid": user_id}).mappings().fetchone()
    return dict(res)


@app.post("/me/trips")
def create_trip(payload: TripCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    db.execute(
        text(
            "INSERT INTO trips (user_id, mode, actual_distance_m, duration_sec, started_at, finished_at, route_snapshot) VALUES (:uid, :mode, :dist, :dur, :start, :end, CAST(:snap AS jsonb))"
        ),
        {
            "uid": user_id,
            "mode": payload.mode,
            "dist": payload.actual_distance_m,
            "dur": payload.duration_sec,
            "start": payload.started_at,
            "end": payload.finished_at,
            "snap": __import__('json').dumps(payload.route_snapshot) if payload.route_snapshot is not None else None,
        },
    )
    db.commit()
    return {"status": "ok"}


@app.get("/me/trips")
def list_trips(limit: int = 10, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100
    res = db.execute(
        text("SELECT id, mode, actual_distance_m, duration_sec, started_at, finished_at, created_at FROM trips WHERE user_id=:uid ORDER BY created_at DESC LIMIT :limit"),
        {"uid": user_id, "limit": limit},
    ).mappings().fetchall()
    return [dict(r) for r in res]


@app.get("/me/stats")
def stats(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    res = db.execute(
        text("SELECT COALESCE(SUM(actual_distance_m),0) AS total_distance_m, COALESCE(SUM(duration_sec),0) AS total_time_s FROM trips WHERE user_id=:uid"),
        {"uid": user_id},
    ).mappings().fetchone()
    return dict(res) if res else {"total_distance_m": 0, "total_time_s": 0}
