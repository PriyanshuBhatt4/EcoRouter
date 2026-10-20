import os
from typing import Optional, Dict, Any
import uuid

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()


class AuthError(HTTPException):
    def __init__(self, detail: str = "Unauthorized"):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = credentials.credentials
    supabase_url = os.getenv("SUPABASE_URL")
    jwks_url = os.getenv("SUPABASE_JWKS_URL") or (f"{supabase_url}/auth/v1/.well-known/jwks.json" if supabase_url else None)
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
    audience = os.getenv("SUPABASE_JWT_AUDIENCE") or os.getenv("SUPABASE_AUDIENCE") or "authenticated"
    issuer = os.getenv("SUPABASE_JWT_ISSUER") or (f"{supabase_url}/auth/v1" if supabase_url else None)

    if not issuer:
        raise AuthError()

    payload: Optional[Dict[str, Any]] = None

    try:
        if jwks_url:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(jwks_url)
                resp.raise_for_status()
                jwks = resp.json()
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
    except AuthError:
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
