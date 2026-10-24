"""Auth-infrastructure failure tests (offline).

JWKS outages and a missing PyJWT must surface as the 503
AUTH_UPSTREAM_ERROR envelope - auth is broken *server-side*, which is a
different signal from a bad token (still 401; see
test_app_endpoints.test_invalid_token_returns_401_envelope_with_www_authenticate
and test_me_degradation).

Also locks the SUPABASE_URL trailing-slash normalization: a configured
"https://x.supabase.co/" must derive "https://x.supabase.co/auth/v1/..." -
never a double slash - for the JWKS URL, the issuer and the issuer check.
"""
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt as pyjwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from tests.helpers import assert_error_envelope

# One RSA keypair for the whole module: lets the JWKS happy path authenticate
# a real RS256 token while every HTTP call stays faked (no network).
_RSA_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_JWKS_URL = "https://abc.supabase.co/auth/v1/.well-known/jwks.json"


class _OkJwksResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FailingJwksResponse:
    """A JWKS endpoint answering 503: raise_for_status must raise HTTPStatusError."""

    def __init__(self, url=_JWKS_URL, status_code=503):
        self.status_code = status_code
        self._url = url

    def raise_for_status(self):
        request = httpx.Request("GET", self._url)
        raise httpx.HTTPStatusError(
            f"{self.status_code} Server Error",
            request=request,
            response=httpx.Response(self.status_code, request=request),
        )

    def json(self):  # pragma: no cover - unreachable after a failed status
        raise AssertionError("body must not be parsed after a failed status")


class _InvalidJsonJwksResponse:
    """A JWKS endpoint answering HTTP 200 with a body that is not valid JSON."""

    def raise_for_status(self):
        return None

    def json(self):
        raise json.JSONDecodeError("Expecting value", "<html>not json</html>", 0)


def _async_client_stub(handler):
    """httpx.AsyncClient stand-in whose .get(url) delegates to handler(url).

    handler may raise (simulating an outage) or return a response object.
    """

    class _StubAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def get(self, url, **kwargs):
            return handler(url)

    return _StubAsyncClient


def test_auth_configured_true_with_trailing_slash_supabase_url(monkeypatch):
    # auth_configured() must derive its issuer/JWKS URLs from the slash-
    # stripped base ("https://x.supabase.co/", not "https://x.supabase.co//").
    from app.auth.supabase import auth_configured

    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")

    assert auth_configured() is True


def test_jwks_timeout_returns_503_auth_upstream_error(client, monkeypatch):
    # Outage: the JWKS request times out. This must be a 503
    # AUTH_UPSTREAM_ERROR (auth infra down), not a misleading 401 - and the
    # requested URL must be single-slashed despite the trailing "/".
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    requested = {}

    def handler(url):
        requested["url"] = url
        raise httpx.ConnectTimeout("connection timed out after 5 seconds")

    monkeypatch.setattr(httpx, "AsyncClient", _async_client_stub(handler))

    response = client.get(
        "/me/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert requested["url"] == _JWKS_URL
    assert_error_envelope(response, 503, "AUTH_UPSTREAM_ERROR")
    # Fixed generic detail: no exception text, URL or other internals leak.
    assert (
        response.json()["error"]["message"] == "Authentication service is unavailable"
    )
    assert "timed out" not in response.text
    assert "supabase" not in response.text


def test_jwks_http_status_error_returns_503_auth_upstream_error(
    client, monkeypatch
):
    # Outage variant: Supabase answers the JWKS request with a 5xx, so
    # raise_for_status() raises httpx.HTTPStatusError (an httpx.HTTPError).
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(
        httpx, "AsyncClient", _async_client_stub(lambda url: _FailingJwksResponse(url))
    )

    response = client.get(
        "/me/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert_error_envelope(response, 503, "AUTH_UPSTREAM_ERROR")
    assert (
        response.json()["error"]["message"] == "Authentication service is unavailable"
    )
    assert "Server Error" not in response.text


def test_jwks_invalid_json_returns_503_auth_upstream_error(client, monkeypatch):
    # The JWKS endpoint answered 200 with a body that is not valid JSON: the
    # auth infrastructure is broken, the caller's token was never even looked
    # at. This must be the 503 AUTH_UPSTREAM_ERROR envelope - reporting it as
    # 401 would tell a healthy user that their session is invalid and send
    # them through a pointless re-login loop.
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _async_client_stub(lambda url: _InvalidJsonJwksResponse()),
    )

    response = client.get(
        "/me/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert_error_envelope(response, 503, "AUTH_UPSTREAM_ERROR")
    assert (
        response.json()["error"]["message"] == "Authentication service is unavailable"
    )
    assert "not json" not in response.text


def test_jwks_non_object_payload_returns_503_auth_upstream_error(client, monkeypatch):
    # Valid JSON, but not a JWKS object (e.g. an error page serialized to a
    # list): still an auth-infrastructure outage, so 503 - never 401.
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _async_client_stub(lambda url: _OkJwksResponse(["not-a-jwks-document"])),
    )

    response = client.get(
        "/me/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert_error_envelope(response, 503, "AUTH_UPSTREAM_ERROR")
    assert (
        response.json()["error"]["message"] == "Authentication service is unavailable"
    )


def test_missing_pyjwt_returns_503_auth_upstream_error(client, monkeypatch):
    # PyJWT absent at *request* time (the module-level lazy import defers the
    # dependency): must yield the 503 envelope, not a raw ModuleNotFoundError
    # escaping as an un-enveloped 500.
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "unit-test-secret-do-not-use-in-prod")
    monkeypatch.setenv(
        "SUPABASE_JWT_ISSUER", "https://offline-test.supabase.co/auth/v1"
    )
    # sys.modules[name] = None makes `import jwt` raise ModuleNotFoundError.
    monkeypatch.setitem(sys.modules, "jwt", None)

    response = client.get(
        "/me/profile", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert_error_envelope(response, 503, "AUTH_UPSTREAM_ERROR")
    assert (
        response.json()["error"]["message"] == "Authentication service is unavailable"
    )
    assert "jwt" not in response.text.lower()


def test_jwks_valid_key_with_trailing_slash_url_still_authenticates(
    client, monkeypatch
):
    # Happy path guard for the auth changes: with SUPABASE_URL carrying a
    # trailing "/", a correctly signed RS256 token must still pass JWKS
    # validation (a double-slash issuer would fail verify_iss -> 401).
    # The request then stops at the unconfigured test DB -> 503
    # DB_NOT_CONFIGURED, which proves auth itself succeeded.
    public_jwk = json.loads(RSAAlgorithm.to_jwk(_RSA_PRIVATE_KEY.public_key()))
    public_jwk.update({"kid": "unit-test-rs256-key", "alg": "RS256"})

    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    issuer = "https://abc.supabase.co/auth/v1"  # derived issuer, single slash
    now = datetime.now(timezone.utc)
    token = pyjwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "iss": issuer,
            "aud": "authenticated",
            "iat": now,
            "exp": now + timedelta(hours=1),
        },
        _RSA_PRIVATE_KEY,
        algorithm="RS256",
        headers={"kid": "unit-test-rs256-key"},
    )

    requested = {}

    def handler(url):
        requested["url"] = url
        return _OkJwksResponse({"keys": [public_jwk]})

    monkeypatch.setattr(httpx, "AsyncClient", _async_client_stub(handler))

    response = client.get(
        "/me/profile", headers={"Authorization": f"Bearer {token}"}
    )

    assert requested["url"] == _JWKS_URL
    assert_error_envelope(response, 503, "DB_NOT_CONFIGURED")
