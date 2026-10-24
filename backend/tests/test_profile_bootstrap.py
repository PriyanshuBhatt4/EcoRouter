"""GET /me/profile must survive a concurrent first request for the same user.

profiles.user_id carries a UNIQUE constraint (initial migration
8c3660e9d20a). Two simultaneous first-time requests for the same user both
observe "no profile yet" and both try to insert the bootstrap row; the second
one hits the unique constraint and - without an idempotent insert - the
IntegrityError is reported to the client as a misleading 503 DB_UNAVAILABLE.

The fake session below emulates exactly that race window (the row is not
visible to the first SELECT because the concurrent transaction has not
committed yet) and enforces the UNIQUE constraint on the INSERT.
"""

import uuid

from sqlalchemy.exc import IntegrityError

_PROFILE_COLUMNS = (
    "id, user_id, display_name, weight_kg, age, created_at, updated_at"
)


class _FakeResult:
    """Minimal stand-in for a SQLAlchemy Result (row-mapping access only)."""

    def __init__(self, row=None):
        self._row = row

    def mappings(self):
        return self

    def fetchone(self):
        return self._row


class _RacingProfileSession:
    """Session double emulating a concurrent profile insert for the same user."""

    def __init__(self, user_id):
        self.user_id = user_id
        self.select_count = 0
        self.insert_statements = []
        self.committed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        head = sql.lstrip().upper()
        if head.startswith("SELECT"):
            self.select_count += 1
            if self.select_count == 1:
                # Race window: the concurrent request has not committed yet, so
                # this request still sees "no profile".
                return _FakeResult(None)
            return _FakeResult(self._row())
        if head.startswith("INSERT"):
            self.insert_statements.append(sql)
            if "ON CONFLICT" not in sql.upper():
                raise IntegrityError(
                    sql,
                    params,
                    Exception(
                        'duplicate key value violates unique constraint '
                        '"profiles_user_id_key"'
                    ),
                )
            return _FakeResult(None)
        raise AssertionError(f"unexpected statement: {sql}")

    def _row(self):
        return {
            "id": "11111111-1111-1111-1111-111111111111",
            "user_id": self.user_id,
            "display_name": None,
            "weight_kg": None,
            "age": None,
            "created_at": None,
            "updated_at": None,
        }

    def commit(self):
        self.committed = True

    def close(self):
        pass


class _MissingProfileSession:
    """Session double where the user has no profile row yet (PUT before GET)."""

    def __init__(self, user_id):
        self.user_id = user_id
        self.profile = None
        self.insert_statements = []
        self.committed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        head = sql.lstrip().upper()
        if head.startswith("INSERT"):
            self.insert_statements.append(sql)
            self.profile = {
                "id": "22222222-2222-2222-2222-222222222222",
                "user_id": self.user_id,
                "display_name": None,
                "weight_kg": None,
                "age": None,
                "created_at": None,
                "updated_at": None,
            }
            return _FakeResult(None)
        if head.startswith("UPDATE"):
            # Without a pre-existing row the UPDATE matches nothing.
            return _FakeResult(None)
        if head.startswith("SELECT"):
            return _FakeResult(dict(self.profile) if self.profile else None)
        raise AssertionError(f"unexpected statement: {sql}")

    def commit(self):
        self.committed = True

    def close(self):
        pass


def test_profile_bootstrap_is_idempotent_under_concurrent_insert(client, monkeypatch):
    from app import main

    user_id = str(uuid.uuid4())
    session = _RacingProfileSession(user_id)

    monkeypatch.setitem(
        main.app.dependency_overrides, main.get_current_user_id, lambda: user_id
    )
    monkeypatch.setitem(
        main.app.dependency_overrides, main.get_db, lambda: session
    )

    response = client.get("/me/profile")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user_id"] == user_id
    # The bootstrap insert must be idempotent, otherwise the concurrent
    # request dies on the profiles.user_id UNIQUE constraint.
    assert len(session.insert_statements) == 1
    assert "ON CONFLICT" in session.insert_statements[0].upper()
    assert session.committed is True


def test_update_profile_bootstraps_missing_row_instead_of_crashing(
    client, monkeypatch
):
    # PUT /me/profile before GET /me/profile used to update zero rows and then
    # return dict(None) -> 500 INTERNAL_ERROR. The update must create the
    # profile row idempotently (same bootstrap as GET) before applying fields.
    from app import main

    user_id = str(uuid.uuid4())
    session = _MissingProfileSession(user_id)

    monkeypatch.setitem(
        main.app.dependency_overrides, main.get_current_user_id, lambda: user_id
    )
    monkeypatch.setitem(
        main.app.dependency_overrides, main.get_db, lambda: session
    )

    response = client.put("/me/profile", json={"display_name": "Offline Tester"})

    assert response.status_code == 200, response.text
    assert response.json()["user_id"] == user_id
    assert len(session.insert_statements) == 1
    assert "ON CONFLICT" in session.insert_statements[0].upper()
    assert session.committed is True
