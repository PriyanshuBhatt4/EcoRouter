"""Shared backend configuration anchors.

Single source of truth for locating the backend root and the environment
file. Modules must not build their own `__file__`-relative path to a `.env`
file: the old anchors resolved to `app/.env` (which does not exist) and only
worked because python-dotenv silently walked up the directory tree to find
`backend/.env`. That implicit fallback made the effective location depend on
where the process was started from, so the anchor now lives here.
"""

import os

# Canonical comment: the environment file used by the backend is backend/.env.
# app/config.py -> app -> backend (two dirname hops: the file name, then
# the `app` package directory).
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Absolute path to the backend environment file: <backend>/.env
ENV_PATH = os.path.join(BACKEND_ROOT, '.env')


def load_env() -> bool:
    """Load the backend environment file into `os.environ`.

    Mirrors the previous per-module behaviour exactly:

    - if `backend/.env` exists -> load that file explicitly;
    - otherwise -> fall back to python-dotenv's implicit upward search.

    Returns the value reported by python-dotenv (True when a file was
    loaded). A missing python-dotenv installation is not fatal: the caller
    is expected to keep running without environment variables.
    """
    try:
        from dotenv import load_dotenv
    except Exception:
        return False

    if os.path.exists(ENV_PATH):
        return load_dotenv(ENV_PATH)
    return load_dotenv()
