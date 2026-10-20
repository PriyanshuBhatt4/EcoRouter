import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# Security model note:
# - If DATABASE_URL uses a role that BYPASSES RLS (e.g. service_role/owner), RLS policies on tables
#   are NOT enforced by Postgres for that connection. In that case the backend MUST enforce
#   user ownership in every query (we do: all queries filter by user_id from verified token).
# - If connecting as a role subject to RLS, you can set `request.jwt.claims` via `SET LOCAL` per request
#   so policies using auth.uid() apply. This implementation enforces ownership explicitly regardless.
