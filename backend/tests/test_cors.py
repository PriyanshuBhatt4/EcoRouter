"""CORS regression tests for the hosted public deployment.

The Expo/React Native bundle is not served from a fixed web origin, so the
backend must accept requests from arbitrary origins: preflight OPTIONS requests
must succeed and ordinary responses must carry the CORS headers. These tests
only exercise the middleware - endpoints and their payloads are unchanged.
"""

# Deliberately unrelated to any origin the app itself uses.
ARBITRARY_ORIGIN = "https://some-expo-client.example"


def test_preflight_from_arbitrary_origin_is_permitted(client):
    requested_headers = "authorization,content-type"

    response = client.options(
        "/route",
        headers={
            "Origin": ARBITRARY_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": requested_headers,
        },
    )

    assert response.status_code == 200
    assert response.text == "OK"
    assert response.headers["access-control-allow-origin"] == "*"
    # The API authenticates with a bearer header rather than cookies.
    assert "access-control-allow-credentials" not in response.headers

    allowed_methods = {
        method.strip()
        for method in response.headers["access-control-allow-methods"].split(",")
    }
    assert {"GET", "POST", "PUT", "DELETE", "OPTIONS"} <= allowed_methods
    # Starlette mirrors the requested header list when allow_headers=["*"].
    assert response.headers["access-control-allow-headers"] == requested_headers


def test_simple_get_under_cors_returns_unchanged_body(client):
    response = client.get("/", headers={"Origin": ARBITRARY_ORIGIN})

    assert response.status_code == 200
    assert response.json() == {"message": "EcoRoute backend is working!"}
    assert response.headers["access-control-allow-origin"] == "*"
