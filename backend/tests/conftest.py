"""Shared fixtures for the offline M2 pytest suite.

Every test runs with:
- no network (httpx.get/post/AsyncClient are replaced with hard failures unless
  a test explicitly monkeypatches them),
- no database (app.db.database.DATABASE_URL is forced to None),
- no auth env config (all SUPABASE_* keys are removed for the duration of the
  test and restored afterwards by monkeypatch).
"""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    # Allows `from app import main` / `from app.services import ...` regardless
    # of how pytest resolves rootdir/imports when invoked from backend/.
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

# Env keys that must never leak from the host environment (or a stray .env)
# into the tests. monkeypatch restores them after each test.
_SUPABASE_ENV_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_JWKS_URL",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_JWT_ISSUER",
    "SUPABASE_JWT_AUDIENCE",
    "SUPABASE_AUDIENCE",
)


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    """Force the deterministic 'not configured' state for DB and auth."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for key in _SUPABASE_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    # app.db.database.DATABASE_URL is captured at import time, so clearing the
    # process env alone is not enough; force the module attribute too.
    from app.db import database

    monkeypatch.setattr(database, "DATABASE_URL", None)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Fail fast if anything tries to perform real HTTP during a test."""
    import httpx

    def _blocked(name):
        def _fail(*args, **kwargs):
            raise AssertionError(
                f"network disabled in tests: unexpected httpx.{name}() call"
            )

        return _fail

    monkeypatch.setattr(httpx, "get", _blocked("get"))
    monkeypatch.setattr(httpx, "post", _blocked("post"))
    monkeypatch.setattr(httpx, "AsyncClient", _blocked("AsyncClient"))


@pytest.fixture()
def client():
    from app import main

    with TestClient(main.app) as test_client:
        yield test_client
