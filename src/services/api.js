// Route-fetching service: performs the POST to the backend /route endpoint
// and maps the response into polyline-ready route candidates. Errors are
// surfaced as thrown Error objects whose .message matches exactly what the
// caller used to pass to setRouteError.

import { API_BASE_URL, ERROR_MESSAGES } from '../constants';

// Client-side request timeout (~15s). A backend that accepts the TCP
// connection but never answers would otherwise leave the awaiting screen
// spinning forever. The abort surfaces as a fetch REJECTION inside the
// existing try/catch blocks, which map it to ERROR_MESSAGES.NETWORK — the
// exact same error pathway (and user copy) as an unreachable backend. No
// new error string was needed.
const REQUEST_TIMEOUT_MS = 15000;

// fetch wrapper adding an AbortController-based timeout. Request semantics
// are untouched: url and options pass straight through except for the extra
// abort signal, and the timer is always cleared (success, HTTP error or
// rejection) so nothing stays pending longer than the request itself.
export async function fetchWithTimeout(url, options = {}) {
  if (typeof AbortController === 'undefined') {
    // Degenerate runtime without AbortController: keep the pre-timeout
    // behavior instead of blocking the route/search flow entirely.
    return fetch(url, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// destination (text) stays required for the plain text path; the saved-places
// flow additionally passes destinationLatitude/destinationLongitude (+ an
// optional destinationName so the response envelope naming is deterministic).
// The text-only body remains byte-identical: the coordinate fields are only
// added when BOTH floats are present and finite (backend contract: when the
// pair is valid the server skips geocoding and routes to the exact spot).
export async function fetchRouteCandidates({
  latitude,
  longitude,
  destination,
  mode,
  destinationLatitude,
  destinationLongitude,
  destinationName,
}) {
  let response;
  try {
    const body = {
      latitude: latitude,
      longitude: longitude,
      destination: destination,
      mode: mode,
      alternatives: 3,
    };
    if (
      (typeof destinationLatitude === 'number' && Number.isFinite(destinationLatitude)) &&
      (typeof destinationLongitude === 'number' && Number.isFinite(destinationLongitude))
    ) {
      body.destinationLatitude = destinationLatitude;
      body.destinationLongitude = destinationLongitude;
      if (typeof destinationName === 'string' && destinationName.trim()) {
        body.destination = destinationName.trim();
      }
    }
    response = await fetchWithTimeout(`${API_BASE_URL}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(ERROR_MESSAGES.NETWORK);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code = data && data.error && data.error.code;
    const message = data && data.error && data.error.message;
    // Own-property guard: inherited Object.prototype functions such as
    // "constructor" or "toString" as codes cause React to throw.
    if (code === 'INVALID_REQUEST' && message) {
      throw new Error(message);
    }
    throw new Error(
      Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
        ? ERROR_MESSAGES[code]
        : (message || 'Route request failed.')
    );
  }

  const list = data && Array.isArray(data.candidates) ? data.candidates : [];
  if (list.length === 0) {
    throw new Error('The server returned no routes.');
  }

  // One candidate survives mapping only when at least one VALID [lng, lat]
  // pair exists (both entries finite numbers). Previously only the ARRAY-
  // emptiness was checked, so a malformed entry (strings, objects, sparse
  // rows) mapped to { latitude: undefined, longitude: undefined } points
  // that react-native-maps rejects ("Lat/Lng must be valid numbers") — an
  // avoided-crash gate, not a data rewrite.
  const isValidPair = (pair) =>
    Array.isArray(pair) &&
    pair.length >= 2 &&
    typeof pair[0] === 'number' && Number.isFinite(pair[0]) &&
    typeof pair[1] === 'number' && Number.isFinite(pair[1]);

  // Candidate ids back the Polyline/option-card React keys (and the
  // selection find). A backend echo of the same id twice would collide as a
  // list key and tie selection to both rows; later duplicates get a
  // deterministic suffix.
  const seenIds = new Set();

  const candidates = list
    .map((c, idx) => {
      const coords = Array.isArray(c && c.coordinates) ? c.coordinates : [];
      const mapCoords = coords.filter(isValidPair).map(([longitude, latitude]) => ({
        latitude,
        longitude,
      }));
      if (mapCoords.length === 0) return null;
      let id = c.id || `route-${idx}`;
      while (seenIds.has(id)) id = `${id}-dup${idx}`;
      seenIds.add(id);
      return {
        id,
        coordinates: mapCoords,
        distanceMeters: c.distance_m,
        durationSeconds: c.duration_s,
        pm25_estimate: c.pm25_estimate || null,
      };
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    throw new Error('The server returned an empty route.');
  }

  return {
    candidates,
    destination: data && data.destination,
  };
}
