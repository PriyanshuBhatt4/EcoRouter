import os
from typing import Optional, Dict, Any
import uuid

# Environment variables come from backend/.env (anchored in app/config.py).
try:
    from app.config import load_env
    load_env()
except Exception:
    pass

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer(auto_error=False)


class AuthError(HTTPException):
    def __init__(self, detail: str = "Unauthorized"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthNotConfigured(HTTPException):
    def __init__(self, detail: str = "Authentication is not configured"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
        )
        self.code = "AUTH_NOT_CONFIGURED"


class AuthUpstreamError(HTTPException):
    """Auth *infrastructure* failure (JWKS unreachable, PyJWT not installed).

    Deliberately distinct from AuthError (401): the caller's token is not at
    fault, so this is a service-side outage the client can only retry later.
    The detail is a fixed generic string - no URLs, exception text or other
    internals are ever disclosed.
    """

    def __init__(self, detail: str = "Authentication service is unavailable"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
        )
        self.code = "AUTH_UPSTREAM_ERROR"


def _normalized_supabase_url() -> Optional[str]:
    """SUPABASE_URL with any single trailing "/" removed.

    Users often configure "https://xxx.supabase.co/", and naive interpolation
    would then derive "https://xxx.supabase.co//auth/v1" (issuer, JWKS URL and
    issuer check), breaking token validation. Returns None when unset.
    """
    supabase_url = os.getenv("SUPABASE_URL")
    if supabase_url:
        supabase_url = supabase_url.rstrip("/")
    return supabase_url


def auth_configured() -> bool:
    """True iff a token issuer is resolvable AND a JWKS URL or JWT secret is set."""
    supabase_url = _normalized_supabase_url()
    jwks_url = os.getenv("SUPABASE_JWKS_URL") or (
        f"{supabase_url}/auth/v1/.well-known/jwks.json" if supabase_url else None
    )
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
    issuer = os.getenv("SUPABASE_JWT_ISSUER") or (
        f"{supabase_url}/auth/v1" if supabase_url else None
    )
    return bool(issuer) and bool(jwks_url or jwt_secret)


async def get_current_user_id(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> str:
    if not auth_configured():
        raise AuthNotConfigured()
    if credentials is None or not credentials.credentials:
        raise AuthError("Missing credentials")

    token = credentials.credentials
    supabase_url = _normalized_supabase_url()
    jwks_url = os.getenv("SUPABASE_JWKS_URL") or (f"{supabase_url}/auth/v1/.well-known/jwks.json" if supabase_url else None)
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
    audience = os.getenv("SUPABASE_JWT_AUDIENCE") or os.getenv("SUPABASE_AUDIENCE") or "authenticated"
    issuer = os.getenv("SUPABASE_JWT_ISSUER") or (f"{supabase_url}/auth/v1" if supabase_url else None)

    if not issuer:
        raise AuthError()

    # Lazy import: PyJWT is only required when actually validating a token,
    # so the module (and the app) can import/boot without it installed.
    # If it is missing at *request* time the auth infrastructure is broken,
    # which must surface as the 503 AUTH_UPSTREAM_ERROR envelope rather than
    # an uncaught ImportError (a plain 500 without the error envelope).
    try:
        import jwt
    except Exception:
        raise AuthUpstreamError()

    payload: Optional[Dict[str, Any]] = None

    try:
        if jwks_url:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(jwks_url)
                    resp.raise_for_status()
                    jwks = resp.json()
            except (httpx.TimeoutException, httpx.HTTPError):
                # Auth-infrastructure outage (Supabase unreachable, timeout or
                # 5xx): this is not a bad token, so answer 503 instead of the
                # misleading 401 AuthError the generic fallback below produces.
                raise AuthUpstreamError()
            except ValueError:
                # The JWKS endpoint answered 200 with a body that is not valid
                # JSON: the auth infrastructure is broken, the caller's token
                # was never even looked at. Same 503 treatment as an outage -
                # reporting it as 401 would push healthy users through a
                # pointless re-login loop.
                raise AuthUpstreamError()
            if not isinstance(jwks, dict):
                # Valid JSON, but not a JWKS document (e.g. an error page):
                # still an upstream outage, never a bad-token 401.
                raise AuthUpstreamError()
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            alg = header.get("alg")
            keys = jwks.get("keys") or []
            if not kid:
                raise AuthError()
            key = None
            for k in keys:
                if k.get("kid") == kid:
                    key = k
                    break
            if key is None:
                raise AuthError()
            # Validate key type matches algorithm
            kty = key.get("kty")
            if alg == "RS256" and kty != "RSA":
                raise AuthError()
            if alg == "ES256" and kty != "EC":
                raise AuthError()
            try:
                if alg == "RS256":
                    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                    payload = jwt.decode(
                        token,
                        public_key,
                        algorithms=["RS256"],
                        audience=audience,
                        issuer=issuer,
                        options={"verify_aud": bool(audience), "verify_iss": True, "verify_exp": True},
                    )
                elif alg == "ES256":
                    public_key = jwt.algorithms.ECAlgorithm.from_jwk(key)
                    payload = jwt.decode(
                        token,
                        public_key,
                        algorithms=["ES256"],
                        audience=audience,
                        issuer=issuer,
                        options={"verify_aud": bool(audience), "verify_iss": True, "verify_exp": True},
                    )
                else:
                    raise AuthError()
            except jwt.PyJWTError:
                raise AuthError()
        elif jwt_secret:
            header = jwt.get_unverified_header(token)
            alg = header.get("alg")
            if alg != "HS256":
                raise AuthError()
            try:
                payload = jwt.decode(
                    token,
                    jwt_secret,
                    algorithms=["HS256"],
                    audience=audience,
                    issuer=issuer,
                    options={"verify_aud": bool(audience), "verify_iss": True, "verify_exp": True},
                )
            except jwt.PyJWTError:
                raise AuthError()
        else:
            raise AuthError()
    except (AuthError, AuthUpstreamError):
        # Preserve our own envelopes (401 bad token / 503 auth outage) instead
        # of collapsing them into the generic 401 below.
        raise
    except Exception:
        raise AuthError()

    user_id = payload.get("sub")
    if not user_id or not isinstance(user_id, str):
        raise AuthError()
    try:
        uuid.UUID(user_id)
    except Exception:
        raise AuthError()
    return user_id
