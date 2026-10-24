from typing import Literal, Optional
from datetime import datetime
import json
import logging
import math

# Environment variables come from backend/.env (anchored in app/config.py).
try:
    from app.config import load_env
    load_env()
except Exception:
    pass

from fastapi import FastAPI, HTTPException, Request, Depends, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.geocoding import (
    GeocodingTimeout,
    GeocodingUpstreamError,
    geocode_destination,
)
from app.services.routing import (
    RoutingTimeout,
    RoutingUpstreamError,
    get_routes,
)
from app.services.exposure import _as_of, estimate_pm25_route
from app.auth.supabase import auth_configured, get_current_user_id
from app.db.database import create_session_factory, is_database_configured
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

app = FastAPI()

# Public prototype deployment: the Expo/React Native bundle can run from any
# origin, so requests are accepted from arbitrary origins. Credentials are
# disabled on purpose - the API authenticates with an Authorization bearer
# header, never cookies, and browsers reject "*" combined with credentials.
# This also keeps local behavior identical (CORS response headers only; the
# request handlers themselves are untouched).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

logger = logging.getLogger("ecorouter")


class RouteRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    # The destination text is required unless the caller supplies exact
    # destination coordinates (destinationLatitude/destinationLongitude); the
    # blank check itself lives in the handler so the two cases can share it.
    destination: Optional[str] = Field(default=None, max_length=200)
    mode: Literal["walking", "driving", "cycling"] = "walking"
    alternatives: int = Field(default=3, ge=0, le=3)
    # Optional exact destination coordinates (saved places). Both must be
    # supplied together and be in range; when present, geocoding is skipped
    # and routing uses these coordinates verbatim.
    destinationLatitude: Optional[float] = Field(default=None)
    destinationLongitude: Optional[float] = Field(default=None)
    # Optional human-readable label for the destination (saved places).
    destinationName: Optional[str] = Field(default=None, max_length=200)


def api_error(
    status_code: int, code: str, message: str, headers: Optional[dict] = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=headers,
    )


class DBNotConfigured(HTTPException):
    def __init__(self, detail: str = "Database is not configured"):
        super().__init__(status_code=503, detail=detail)
        self.code = "DB_NOT_CONFIGURED"


class DBUnavailable(HTTPException):
    def __init__(self, detail: str = "Database is unavailable"):
        super().__init__(status_code=503, detail=detail)
        self.code = "DB_UNAVAILABLE"


# Registered on both classes: router-generated errors (404/405/...) are raised
# as starlette.exceptions.HTTPException, while dependencies raise
# fastapi.HTTPException subclasses. Starlette resolves handlers by walking the
# exception's MRO, so the Starlette-keyed registration also covers the FastAPI
# subclass (and vice versa); registering both keeps the mapping explicit.
@app.exception_handler(StarletteHTTPException)
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    code = getattr(exc, "code", None)
    if code is None:
        if exc.status_code == 401:
            code = "UNAUTHORIZED"
        elif exc.status_code == 403:
            code = "FORBIDDEN"
        elif exc.status_code == 404:
            code = "NOT_FOUND"
        elif exc.status_code == 405:
            code = "METHOD_NOT_ALLOWED"
        elif exc.status_code == 422:
            code = "INVALID_REQUEST"
        else:
            code = "HTTP_ERROR"
    return api_error(exc.status_code, code, str(exc.detail), headers=exc.headers)


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    return api_error(503, "DB_UNAVAILABLE", "Database is unavailable")


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    errors = exc.errors()
    if not errors:
        # Defensive: FastAPI currently always supplies an error, but the
        # handler must still answer with the 422 envelope if it does not.
        return api_error(422, "INVALID_REQUEST", "invalid request")
    first = errors[0]
    location = ".".join(str(part) for part in first.get("loc", ()))
    message = f"{location}: {first.get('msg', 'invalid value')}"
    return api_error(422, "INVALID_REQUEST", message)


# Catch-all last resort: anything that is not an HTTPException /
# RequestValidationError / SQLAlchemyError (e.g. a ValueError raised while
# parsing a malformed upstream payload) must still reach the client inside the
# {"error": {code, message}} envelope instead of escaping as a bare 500.
# Starlette runs this via its outermost ServerErrorMiddleware, then re-raises
# the exception so servers/test clients can log it; the traceback itself is
# logged here once and never sent to the client.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "Unhandled server error on %s %s", request.method, request.url.path
    )
    return api_error(500, "INTERNAL_ERROR", "Unexpected server error")


@app.get("/")
def home():
    return {"message": "EcoRoute backend is working!"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "database_configured": is_database_configured(),
        "auth_configured": auth_configured(),
        "providers": {
            "geocoding": "nominatim",
            "routing": "valhalla_public",
            "air_quality": "open-meteo-cams",
        },
    }


@app.post("/route")
def create_route(request: RouteRequest):
    destination_query = (request.destination or "").strip()

    # Optional exact destination coordinates (saved places). When both are
    # supplied the request skips geocoding entirely and routes to the given
    # point; when neither is supplied the behaviour is exactly as before.
    supplied_latitude = request.destinationLatitude
    supplied_longitude = request.destinationLongitude
    has_supplied_coordinates = (
        supplied_latitude is not None or supplied_longitude is not None
    )

    if has_supplied_coordinates:
        if (
            supplied_latitude is None
            or supplied_longitude is None
            or not (-90 <= supplied_latitude <= 90)
            or not (-180 <= supplied_longitude <= 180)
        ):
            return api_error(
                422,
                "INVALID_REQUEST",
                "destinationLatitude and destinationLongitude must be provided together with valid range",
            )
        destination_coordinates = {
            "latitude": supplied_latitude,
            "longitude": supplied_longitude,
        }
    else:
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

    # Name for the response envelope: explicit destinationName > destination
    # text > deterministic "lat, lng" fallback (coordinates-only requests).
    destination_name = (request.destinationName or "").strip() or destination_query
    if not destination_name:
        destination_name = (
            f"{destination_coordinates['latitude']:.4f}, "
            f"{destination_coordinates['longitude']:.4f}"
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

    enriched_candidates = []
    for c in candidates:
        coords = c.get("coordinates") or []
        dist_m = c.get("distance_m") or 0.0
        try:
            exp = estimate_pm25_route(coords, total_distance_m=dist_m, timeout=10)
        except Exception:
            # Defensive fallback: same payload shape as the service, including
            # the "as of" stamp, so the client can always render a timestamp.
            # The failure itself is logged (never sent to the client) so a
            # broken exposure service is not invisible in production.
            logger.exception("PM2.5 exposure estimation failed for a route candidate")
            exp = {
                "available": False,
                "reason": "exception",
                "metric": "pm2_5",
                "units": "ug/m3",
                "source": "open-meteo-cams",
                "caveat": "regional model estimate (CAMS) - not street-level; estimate unavailable",
                "as_of": _as_of(),
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
        # Half-up to 1 decimal, matching the client's Math.round(v * 10) / 10.
        # Python's round() uses banker's rounding (round(12.25, 1) -> 12.2)
        # while the client shows 12.3, which would make the comparison
        # disagree with what the user actually sees on screen.
        replaced_rounded = [math.floor(v * 10 + 0.5) / 10 for v in values]
        if len(set(replaced_rounded)) == 1:
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
            "name": destination_name,
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


# Lightweight place lookup for the saved-places feature: resolves a free-text
# query to coordinates without running the (heavier) routing pipeline. No DB,
# no auth, no API keys - it reuses app.services.geocoding.geocode_destination
# verbatim, so the upstream error mapping matches POST /route exactly.
@app.get("/geocode")
def geocode_place(
    q: str = Query(
        ...,
        max_length=200,
        description="Free-text place name to resolve to coordinates",
    ),
):
    query = q.strip()
    if not query:
        return api_error(422, "INVALID_REQUEST", "q must not be blank")

    try:
        result = geocode_destination(query)
    except GeocodingTimeout:
        return api_error(
            504, "UPSTREAM_TIMEOUT", "geocoding service timed out, try again"
        )
    except GeocodingUpstreamError:
        return api_error(
            502, "UPSTREAM_ERROR", "geocoding service is unavailable"
        )

    if result is None:
        return api_error(
            404,
            "NO_GEOCODING_RESULT",
            f"no location found for '{query}'. Try a more specific name.",
        )

    # displayName: Nominatim's own label when app.services.geocoding preserves
    # it, otherwise the (trimmed) queried text as a stable human fallback.
    display_name = (result.get("display_name") or "").strip() or query

    return {
        "latitude": result["latitude"],
        "longitude": result["longitude"],
        "displayName": display_name,
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
    if not is_database_configured():
        raise DBNotConfigured()
    try:
        db = create_session_factory()()
    except Exception as exc:
        raise DBUnavailable() from exc
    try:
        yield db
    finally:
        db.close()


@app.get("/me/profile")
def get_profile(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    res = db.execute(text("SELECT id, user_id, display_name, weight_kg, age, created_at, updated_at FROM profiles WHERE user_id=:uid"), {"uid": user_id}).mappings().fetchone()
    if res:
        return dict(res)
    # Idempotent bootstrap: profiles.user_id carries a UNIQUE constraint, so a
    # concurrent first request for the same user would fail this INSERT with an
    # IntegrityError (reported as a misleading 503 DB_UNAVAILABLE).
    db.execute(text("INSERT INTO profiles (user_id) VALUES (:uid) ON CONFLICT (user_id) DO NOTHING"), {"uid": user_id})
    db.commit()
    res = db.execute(text("SELECT id, user_id, display_name, weight_kg, age, created_at, updated_at FROM profiles WHERE user_id=:uid"), {"uid": user_id}).mappings().fetchone()
    return dict(res)


@app.put("/me/profile")
def update_profile(payload: ProfileUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    # Bootstrap the row first (same idempotent insert as GET): a PUT may arrive
    # before the first GET, and updating zero rows followed by dict(None) used
    # to surface as a misleading 500 INTERNAL_ERROR.
    db.execute(text("INSERT INTO profiles (user_id) VALUES (:uid) ON CONFLICT (user_id) DO NOTHING"), {"uid": user_id})
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
            "snap": json.dumps(payload.route_snapshot) if payload.route_snapshot is not None else None,
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
