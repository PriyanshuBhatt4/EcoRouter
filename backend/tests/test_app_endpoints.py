"""App-level endpoint tests: /health, router-generated 404/405 envelopes, the
catch-all 500 INTERNAL_ERROR envelope, and the auth (401) / database (503)
failure envelopes.

Offline and deterministic: conftest blocks all httpx network access, forces
DATABASE_URL unset, and strips every SUPABASE_* key, so each test opts back in
to exactly the configuration it needs.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest

from tests.helpers import assert_error_envelope, patch_geocode, route_body

# Test-only credentials; never leave the process (mirrors test_me_degradation).
JWT_SECRET = "offline-test-secret-do-not-use-in-prod"
JWT_ISSUER = "https://offline-test.supabase.co/auth/v1"


@pytest.fixture()
def hs256_auth(monkeypatch):
    """Enable HS256 token validation with a local secret (JWKS path stays off:
    SUPABASE_URL / SUPABASE_JWKS_URL were removed by the autouse isolation)."""
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", JWT_ISSUER)


@pytest.fixture()
def override_user_id():
    """Bypass token validation by overriding the get_current_user_id dependency."""
    from app import main

    main.app.dependency_overrides[main.get_current_user_id] = lambda: str(uuid.uuid4())
    yield
    main.app.dependency_overrides.pop(main.get_current_user_id, None)


def _make_token(secret, sub=None):
    now = datetime.now(timezone.utc)
    return pyjwt.encode(
        {
            "sub": sub or str(uuid.uuid4()),
            "iss": JWT_ISSUER,
            "aud": "authenticated",
            "iat": now,
            "exp": now + timedelta(hours=1),
        },
        secret,
        algorithm="HS256",
    )


def test_health_reports_ok_unconfigured_state(client):
    """GET /health: 200 ok with both integrations reported unconfigured and the
    static provider map present - no upstream calls involved."""
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database_configured"] is False
    assert body["auth_configured"] is False
    providers = body["providers"]
    assert set(providers.keys()) == {"geocoding", "routing", "air_quality"}
    for name, provider in providers.items():
        assert isinstance(provider, str) and provider, name


def test_unknown_path_returns_not_found_envelope(client):
    # Router-generated 404s are raised as starlette.exceptions.HTTPException;
    # they must hit the shared {"error": {code, message}} envelope handler
    # (review fix #1) instead of Starlette's plain-text default.
    response = client.get("/nope")

    assert_error_envelope(response, 404, "NOT_FOUND")
    assert response.json()["error"]["message"]


def test_method_not_allowed_returns_405_envelope(client):
    # Router-generated 405 (GET against the POST-only /route path) must use
    # the same {"error": {code, message}} envelope as 404.
    response = client.get("/route")

    assert_error_envelope(response, 405, "METHOD_NOT_ALLOWED")
    assert response.json()["error"]["message"]


def test_request_validation_handler_tolerates_empty_errors():
    # FastAPI always supplies at least one error today, but the handler must not
    # index into an empty list if a future/custom validator hands it one.
    from fastapi.exceptions import RequestValidationError

    from app import main

    response = asyncio.run(
        main.request_validation_exception_handler(None, RequestValidationError([]))
    )

    assert response.status_code == 422
    assert json.loads(response.body) == {
        "error": {"code": "INVALID_REQUEST", "message": "invalid request"}
    }


def test_unhandled_exception_returns_500_internal_error_envelope(monkeypatch):
    # Catch-all handler: an exception that is not an HTTPException /
    # RequestValidationError / SQLAlchemyError - e.g. a ValueError while
    # parsing a malformed upstream payload - must still reach the client
    # inside the envelope, with a fixed generic message and no traceback.
    from fastapi.testclient import TestClient

    from app import main

    patch_geocode(monkeypatch, ValueError("malformed upstream payload: 'shape'"))

    # Starlette's ServerErrorMiddleware re-raises the exception *after* the
    # catch-all handler has sent its response (so servers can log it);
    # raise_server_exceptions=False makes TestClient return that response
    # instead of propagating the exception into the test.
    with TestClient(main.app, raise_server_exceptions=False) as no_raise_client:
        response = no_raise_client.post("/route", json=route_body())

    assert_error_envelope(response, 500, "INTERNAL_ERROR")
    assert response.json()["error"]["message"] == "Unexpected server error"
    # The exception details must never leak to the client.
    assert "malformed upstream payload" not in response.text
    assert "ValueError" not in response.text


def test_invalid_token_returns_401_envelope_with_www_authenticate(
    client, hs256_auth
):
    # Structurally valid HS256 token, but signed with the WRONG secret, so the
    # signature check fails and auth must answer with the 401 envelope.
    token = _make_token("wrong-secret-do-not-use-in-prod-32-plus-bytes")

    response = client.get("/me/profile", headers={"Authorization": f"Bearer {token}"})

    assert_error_envelope(response, 401, "UNAUTHORIZED")
    # app.auth.supabase.AuthError must advertise the challenge (review fix #6).
    assert response.headers.get("www-authenticate") == "Bearer"


def test_db_unavailable_returns_503_envelope(client, monkeypatch, override_user_id):
    from app import main
    from sqlalchemy.exc import SQLAlchemyError

    # Pretend the DB is configured, then make session-factory creation blow up
    # with a SQLAlchemyError. get_db's existing wiring converts that into
    # DBUnavailable (code DB_UNAVAILABLE), which must reach the client as a
    # 503 error envelope.
    monkeypatch.setattr(main, "is_database_configured", lambda: True)

    def broken_session_factory():
        raise SQLAlchemyError("engine creation failed")

    monkeypatch.setattr(main, "create_session_factory", broken_session_factory)

    response = client.get("/me/profile")

    assert_error_envelope(response, 503, "DB_UNAVAILABLE")
