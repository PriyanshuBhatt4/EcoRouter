import os
import threading
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Environment variables come from backend/.env (anchored in app/config.py).
try:
    from app.config import load_env
    load_env()
except Exception:
    pass

DATABASE_URL = os.getenv("DATABASE_URL")

# Engine and session factory are created lazily so the app can boot (and /health
# can respond) when DATABASE_URL is not set. Creation is guarded by a lock
# (double-checked locking) so concurrent first requests cannot build two engines.
engine = None
SessionLocal = None
_session_factory_lock = threading.Lock()


def is_database_configured() -> bool:
    return bool(DATABASE_URL)


def create_session_factory():
    """Create engine/SessionLocal on first use; return the session factory.

    Thread-safe: the fast-path check is a plain read and the slow path (engine
    construction) runs under a module-level lock, re-checking the cached
    factory after acquiring it.
    """
    global engine, SessionLocal
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is required")
    if SessionLocal is None:
        with _session_factory_lock:
            if SessionLocal is None:  # double-checked locking
                engine = create_engine(DATABASE_URL, pool_pre_ping=True)
                SessionLocal = sessionmaker(
                    autocommit=False, autoflush=False, bind=engine
                )
    return SessionLocal


class Base(DeclarativeBase):
    """Declarative base class for every ORM model in the app."""


# Security model note:
# - If DATABASE_URL uses a role that BYPASSES RLS (e.g. service_role/owner), RLS policies on tables
#   are NOT enforced by Postgres for that connection. In that case the backend MUST enforce
#   user ownership in every query (we do: all queries filter by user_id from verified token).
# - If connecting as a role subject to RLS, you can set `request.jwt.claims` via `SET LOCAL` per request
#   so policies using auth.uid() apply. This implementation enforces ownership explicitly regardless.
