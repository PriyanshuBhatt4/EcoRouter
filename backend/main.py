from typing import Literal

from fastapi import FastAPI, Request
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
    get_route,
)

app = FastAPI()


class RouteRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    destination: str = Field(min_length=1)
    mode: Literal["driving"] = "driving"


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
        route = get_route(
            request.latitude,
            request.longitude,
            destination_coordinates["latitude"],
            destination_coordinates["longitude"],
        )
    except RoutingTimeout:
        return api_error(
            504, "UPSTREAM_TIMEOUT", "routing service timed out, try again"
        )
    except RoutingUpstreamError:
        return api_error(502, "UPSTREAM_ERROR", "routing service is unavailable")

    if route is None:
        return api_error(
            404,
            "NO_ROUTE_FOUND",
            "no route found between the given points",
        )

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
        "route": route,
    }
