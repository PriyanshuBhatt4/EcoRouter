"""/me endpoint degradation tests: no real DB, no auth infrastructure, no network."""

import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest

from tests.helpers import assert_error_envelope

# Test-only credentials; never leave the process.
JWT_SECRET = "offline-test-secret-do-not-use-in-prod"
JWT_ISSUER = "https://offline-test.supabase.co/auth/v1"

# (method, path, json body) covering GET/PUT /me/profile and GET/POST /me/trips
# plus GET /me/stats.
ME_ENDPOINTS = [
    ("get", "/me/profile", None),
    ("put", "/me/profile", {"display_name": "Offline Tester"}),
    ("post", "/me/trips", {"mode": "walking", "actual_distance_m": 1200.0, "duration_sec": 900.0}),
    ("get", "/me/trips", None),
    ("get", "/me/stats", None),
]


def _request(client, method, path, body=None, headers=None):
    headers = headers or {}
    if method == "get":
        return client.get(path, headers=headers)
    if method == "put":
        return client.put(path, json=body, headers=headers)
    if method == "post":
        return client.post(path, json=body, headers=headers)
    raise AssertionError(f"unsupported method: {method}")


@pytest.fixture()
def auth_configured(monkeypatch):
    """Enable HS256 token validation with a local secret (JWKS path stays off:
    SUPABASE_URL / SUPABASE_JWKS_URL were removed by the autouse isolation)."""
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", JWT_ISSUER)


def _make_hs256_token(sub=None):
    now = datetime.now(timezone.utc)
    return pyjwt.encode(
        {
            "sub": sub or str(uuid.uuid4()),
            "iss": JWT_ISSUER,
            "aud": "authenticated",
            "iat": now,
            "exp": now + timedelta(hours=1),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


@pytest.mark.parametrize("method,path,body", ME_ENDPOINTS)
def test_me_without_auth_config_returns_503(client, method, path, body):
    # Autouse isolation guarantees SUPABASE_* is unset -> AUTH_NOT_CONFIGURED.
    response = _request(client, method, path, body)
    assert_error_envelope(response, 503, "AUTH_NOT_CONFIGURED")


@pytest.mark.parametrize("method,path,body", ME_ENDPOINTS)
def test_me_auth_configured_without_token_returns_401(
    client, auth_configured, method, path, body
):
    response = _request(client, method, path, body)
    assert_error_envelope(response, 401, "UNAUTHORIZED")


@pytest.mark.parametrize("method,path,body", ME_ENDPOINTS)
def test_me_valid_token_unconfigured_db_returns_503(
    client, auth_configured, method, path, body
):
    # A cryptographically valid HS256 token passes auth, but the autouse
    # isolation forces app.db.database.DATABASE_URL = None, so the request fails
    # at the DB layer instead.
    headers = {"Authorization": f"Bearer {_make_hs256_token()}"}
    response = _request(client, method, path, body, headers=headers)
    assert_error_envelope(response, 503, "DB_NOT_CONFIGURED")


def test_me_auth_configured_still_excludes_jwks_path(auth_configured):
    # Sanity: with only secret+issuer set, JWKS fetching must stay disabled so
    # no request can ever reach the network during validation.
    import os

    assert not os.getenv("SUPABASE_JWKS_URL")
    assert not os.getenv("SUPABASE_URL")
