"""Layout regression tests for the backend package layout (reviewer D1).

The dotenv anchor used to live in three different modules and resolved to
`app/.env`, a file that never existed; the environment was only found because
python-dotenv walked up the tree to `backend/.env`. The anchor now lives in
`app/config.py` and points at `backend/.env` explicitly.

These tests lock that layout in place:
- `app.config.ENV_PATH` is `<backend>/.env` and does not depend on the cwd,
- importing the app modules never creates a `.env` file (not in `app/`, not
  in the working directory),
- the three modules no longer carry their own `.env` anchor,
- `load_env()` keeps the previous load semantics.
"""

import ast
import inspect
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR / "app"

# Modules that used to anchor the dotenv lookup themselves.
ANCHORED_MODULES = (
    "app.main",
    "app.db.database",
    "app.auth.supabase",
)


def _module_source(module_name: str) -> str:
    module = __import__(module_name, fromlist=["__name__"])
    source_file = inspect.getsourcefile(module)
    assert source_file is not None
    return Path(source_file).read_text(encoding="utf-8")


def test_config_exposes_backend_root_and_env_path():
    from app import config

    assert Path(config.ENV_PATH).name == ".env"
    assert Path(config.ENV_PATH).parent.name == "backend"
    assert Path(config.ENV_PATH).parent == BACKEND_DIR
    assert Path(config.BACKEND_ROOT) == BACKEND_DIR


def test_env_path_is_independent_of_cwd(tmp_path, monkeypatch):
    from app import config

    monkeypatch.chdir(tmp_path)
    assert Path(config.ENV_PATH).resolve() == (BACKEND_DIR / ".env").resolve()
    assert Path(config.ENV_PATH).parent == BACKEND_DIR


def test_load_env_is_callable():
    from app.config import load_env

    assert callable(load_env)


def test_load_env_uses_explicit_env_path_when_it_exists(tmp_path, monkeypatch):
    from app import config

    calls = []
    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: calls.append(a) or True)
    env_file = tmp_path / ".env"
    env_file.write_text("ECOROUTE_LAYOUT_PROBE=ok\n", encoding="utf-8")
    monkeypatch.setattr(config, "ENV_PATH", str(env_file))

    assert config.load_env() is True
    assert calls == [(str(env_file),)]


def test_load_env_falls_back_to_implicit_search_when_env_path_is_missing(
    tmp_path, monkeypatch
):
    from app import config

    calls = []
    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: calls.append(a) or True)
    monkeypatch.setattr(config, "ENV_PATH", str(tmp_path / "missing" / ".env"))

    assert config.load_env() is True
    # No path argument -> python-dotenv's implicit upward search.
    assert calls == [()]


def test_load_env_populates_the_process_environment(tmp_path, monkeypatch):
    from app import config

    env_file = tmp_path / ".env"
    env_file.write_text("ECOROUTE_LAYOUT_PROBE=ok\n", encoding="utf-8")
    monkeypatch.setattr(config, "ENV_PATH", str(env_file))
    monkeypatch.delenv("ECOROUTE_LAYOUT_PROBE", raising=False)

    config.load_env()
    assert os.environ.get("ECOROUTE_LAYOUT_PROBE") == "ok"


def test_importing_app_modules_creates_no_env_file(tmp_path):
    """Importing the app must not create (or depend on) an `app/.env` file."""
    script = (
        "import pathlib, sys\n"
        f"sys.path.insert(0, {str(BACKEND_DIR)!r})\n"
        "import app\n"
        "import app.main\n"
        "import app.db.database\n"
        "import app.auth.supabase\n"
        "app_dir = pathlib.Path(app.__file__).resolve().parent\n"
        "print('APP_ENVS:' + repr(sorted(str(p) for p in app_dir.rglob('.env'))))\n"
        "cwd = pathlib.Path.cwd()\n"
        "print('CWD_ENVS:' + repr(sorted(str(p) for p in cwd.rglob('.env'))))\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "APP_ENVS:[]" in proc.stdout
    assert "CWD_ENVS:[]" in proc.stdout
    assert not (APP_DIR / ".env").exists()


@pytest.mark.parametrize("module_name", ANCHORED_MODULES)
def test_modules_delegate_dotenv_loading_to_app_config(module_name):
    source = _module_source(module_name)

    # The module must pull the loader from the shared anchor.
    assert "from app.config import load_env" in source
    assert "load_env()" in source

    # ...and must not carry a `.env` string literal (local anchor) anymore.
    tree = ast.parse(source)
    literals = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    assert not any(
        literal == ".env" or literal.endswith("/.env") or literal.endswith("\\.env")
        for literal in literals
    ), f"{module_name} still anchors a .env path locally"


def test_backend_env_file_is_not_inside_the_app_package():
    """The real environment file lives at the backend root, not in app/."""
    assert not (APP_DIR / ".env").exists()
    assert (BACKEND_DIR / ".env").is_file()
