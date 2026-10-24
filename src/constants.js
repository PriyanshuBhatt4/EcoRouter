// Module-scope constants shared across the app shell and screens.

import { PREFERENCES } from './lib/preferences';
import { distanceBetweenFixes } from './lib/track';

// Appearance choices for the Profile segmented control.
export const THEME_CHOICES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// Single attribution string shared by the map screen and the Settings About
// card. Keep the wording in ONE place so the two never drift apart.
export const ATTRIBUTION_TEXT =
  'Data: OpenStreetMap (Nominatim, Valhalla public server) · Air: Open-Meteo CAMS (regional model, not street-level) · Prototype, no SLA · Durations are estimates, not live traffic';

// Normalize an API base URL: trim whitespace and trailing slashes so that
// `${API_BASE_URL}/route` never ends up with a double slash. Non-string
// values (including undefined) pass through unchanged — no invented default.
// A value WITH a '://' scheme opener is accepted as-is like today: we do not
// add scheme validation beyond the typeof check; a present-but-broken URL
// stays "configured" and is covered downstream by the unreachable-backend
// error path (ERROR_MESSAGES.NETWORK). No silent localhost/IP fallback ever.
const normalizeApiUrl = (raw) =>
  typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : raw;

// Two-tier resolution (same trim/slash normalization for BOTH vars):
// (a) EXPO_PUBLIC_API_BASE_URL — local dev setting (.env/.env.local), wins;
// (b) EXPO_PUBLIC_API_URL_PRODUCTION — URL baked at build time for a stable
//     hosted HTTPS backend;
// (c) neither set → undefined, the explicit not-configured state (App.js
//     shows the "Backend address is not configured..." error card).
// A dev var that normalizes to '' (e.g. whitespace only) does not shadow an
// otherwise-present production URL — '' is falsy both here and everywhere
// else the URL is consumed, so this keeps the tiers consistent.
const RAW_API_URL_DEV = normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
const RAW_API_URL_PRODUCTION = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL_PRODUCTION);
export const API_BASE_URL = RAW_API_URL_DEV || RAW_API_URL_PRODUCTION;
if (API_BASE_URL) {
  // Log only the redacted host (and port, if any) — the full URL can carry
  // credentials, so never print it. Name WHICH tier resolved (dev override
  // wins over the baked production URL).
  const tierLabel = RAW_API_URL_DEV ? 'dev URL' : 'production URL';
  let redactedHost = '<unparseable host>';
  try {
    redactedHost = new URL(API_BASE_URL).host;
  } catch {}
  console.log(`EcoRoute backend URL (${tierLabel}):`, redactedHost);
} else {
  console.log(
    'EcoRoute backend URL: NOT SET (set EXPO_PUBLIC_API_BASE_URL for local dev or EXPO_PUBLIC_API_URL_PRODUCTION for a hosted backend)'
  );
}

export const ERROR_MESSAGES = {
  NO_GEOCODING_RESULT: 'No location found for that destination. Try a more specific name.',
  NO_ROUTE_FOUND: 'No route found between your location and that destination.',
  UPSTREAM_TIMEOUT: 'The mapping service timed out. Please try again.',
  UPSTREAM_ERROR: 'The mapping service is currently unavailable. Please try again later.',
  INVALID_REQUEST: 'Invalid request. Check your destination and try again.',
  NETWORK: 'Could not reach the backend. Check your internet connection and try again.',
};

export const MODES = {
  WALKING: 'walking',
  CYCLING: 'cycling',
};

export const PROFILE_KEY = '@EcoRoute/profile';
export const TRIPS_KEY = '@EcoRoute/trips';
export const ACTIVE_TRIP_KEY = '@EcoRoute/activeTrip';
export const THEME_KEY = '@EcoRoute/theme';
// Accent choice is a separate ADDITIVE key (device appearance preference,
// like THEME_KEY — deliberately kept by "Erase all data").
export const ACCENT_KEY = '@EcoRoute/accent';
// Recent destination names (quick re-search chips on the map). ADDITIVE key:
// value is a JSON array of up to RECENT_DESTINATIONS_MAX trimmed strings.
export const RECENT_DESTINATION_KEY = '@EcoRoute/recentDestinations';
export const RECENT_DESTINATIONS_MAX = 5;

// Saved places (persistent destination list shown on Settings + the map).
// ADDITIVE key: value is a JSON array of up to SAVED_PLACES_MAX place records
// ({ id, name, category, latitude, longitude }). Corrupt values parse to an
// empty list and simply hide the chips — never a crash.
export const SAVED_PLACES_KEY = '@EcoRoute/savedPlaces';
export const SAVED_PLACES_MAX = 12;
// Category palette for saved places; every place stores one of these ids and
// unknown/missing categories coerce to 'other'. Labels are the user-facing
// pill text (Home / Work / Other).
export const PLACE_CATEGORIES = [
  { id: 'home', label: 'Home' },
  { id: 'work', label: 'Work' },
  { id: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// User preferences (ADDITIVE key #9): preferred travel mode + profile
// dashboard section visibility. Cleared by "Erase all data" (like every other
// user-data key); appearance keys (THEME_KEY / ACCENT_KEY) are unaffected.
// ---------------------------------------------------------------------------
export const PREFS_KEY = '@EcoRoute/prefs';
// Defaults: mode preselect follows today's behavior (walking), every
// dashboard section stays visible (so an unconfigured install renders
// exactly what it did before this key existed) and the route-goal memory
// stays OFF with no goal recorded — the default session therefore matches
// the pre-remember behavior exactly (searches reset to MANUAL).
export const DEFAULT_PREFS = {
  preferredMode: 'walking',
  dashboard: { week: true, achievements: true, streak: true, recent: true },
  // 'Remember my route goal' settings toggle: OFF by default.
  rememberRouteGoal: false,
  // Last goal-chip pick, one of the PREFERENCES values or null. Recorded on
  // every goal-chip press (even while the toggle is off); it is only USED
  // (to restore the selection) while rememberRouteGoal is true.
  lastRouteGoal: null,
};
// The four dashboard section flags (order = Settings row order).
export const PREF_DASHBOARD_KEYS = ['week', 'achievements', 'streak', 'recent'];

// Membership rule for stored route-goal values: only the exact PREFERENCES
// values the map's chips row can emit count. This is the SINGLE serialization
// gate — writers must never persist anything else, and parsePrefs falls back
// to null for any unknown/legacy value. Importing PREFERENCES here (instead
// of restating the value list) keeps the two definitions locked together.
export function isValidRouteGoal(value) {
  return typeof value === 'string' && Object.values(PREFERENCES).includes(value);
}

// Parse a stored prefs payload into a safe defaults-shaped object. Tolerant
// by design: corrupt JSON, non-object payloads and missing fields all land
// on the defaults (never a crash, never a partially-rebuilt object).
// - preferredMode accepts exactly 'walking' | 'cycling'; anything else
//   (including 'driving' and case variants) falls back to 'walking'.
// - dashboard flags keep an exact false; true and any UNKNOWN value
//   (missing, strings, numbers, null) resolve to the default true.
// - rememberRouteGoal keeps an exact true; any other value (missing on
//   legacy payloads, strings, numbers) resolves to the default false.
// - lastRouteGoal survives only when it is exactly one of the PREFERENCES
//   values (isValidRouteGoal); missing/unknown/legacy values become null so
//   no invented goal can ever reach the restore path. Old payloads without
//   the new keys keep working: they simply parse to toggle-off + null goal.
// Returns a fresh deep object every call so callers can mutate freely.
export function parsePrefs(raw) {
  const dashboard = {};
  for (const key of PREF_DASHBOARD_KEYS) dashboard[key] = true;
  const result = {
    preferredMode: 'walking',
    dashboard,
    rememberRouteGoal: false,
    lastRouteGoal: null,
  };
  if (raw == null || raw === '') return prefsClone(result);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return prefsClone(result);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return prefsClone(result);
  }
  if (parsed.preferredMode === 'walking' || parsed.preferredMode === 'cycling') {
    result.preferredMode = parsed.preferredMode;
  }
  result.rememberRouteGoal = parsed.rememberRouteGoal === true ? true : false;
  result.lastRouteGoal = isValidRouteGoal(parsed.lastRouteGoal) ? parsed.lastRouteGoal : null;
  const dash = parsed.dashboard;
  if (dash && typeof dash === 'object' && !Array.isArray(dash)) {
    for (const key of PREF_DASHBOARD_KEYS) {
      dashboard[key] = dash[key] === false ? false : true;
    }
  }
  return prefsClone(result);
}

// Pure deep clone for parsePrefs early-exits (keeps the "fresh object every
// call" contract once accumulators were already filled).
function prefsClone(source) {
  return {
    preferredMode: source.preferredMode,
    dashboard: { ...source.dashboard },
    rememberRouteGoal: source.rememberRouteGoal,
    lastRouteGoal: source.lastRouteGoal,
  };
}

// True when (lat, lng) are both finite numbers inside the same ranges the
// backend /route rate-checks (lat ±90, lng ±180). Used by parseSavedPlaces.
function isValidLatLng(latitude, longitude) {
  return (
    typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  );
}

function normalizePlaceCategory(category) {
  return PLACE_CATEGORIES.some((cat) => cat.id === category) ? category : 'other';
}

// Parse a stored saved-places payload into safe place records. An entry
// survives only when it is an object with a non-empty trimmed string name,
// finite coordinates inside ±90/±180 and a known (or coerced 'other')
// category. Order is kept; the result is capped at SAVED_PLACES_MAX. Stored
// non-empty string ids are kept, otherwise a fresh unique id is synthesized.
export function parseSavedPlaces(raw) {
  if (raw == null || raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const list = [];
  // Duplicate stored ids (legacy/hand-edited payloads) would collide as React
  // list keys and tie rename/delete updates to BOTH rows; later duplicates
  // get a fresh synthesized id, exactly like id-less entries.
  const seenPlaceIds = new Set();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    if (!isValidLatLng(item.latitude, item.longitude)) continue;
    let id = typeof item.id === 'string' && item.id ? item.id : '';
    if (!id || seenPlaceIds.has(id)) id = `${Date.now().toString(36)}-${list.length}`;
    seenPlaceIds.add(id);
    list.push({
      id,
      name,
      category: normalizePlaceCategory(item.category),
      latitude: item.latitude,
      longitude: item.longitude,
    });
    if (list.length >= SAVED_PLACES_MAX) break;
  }
  return list;
}

// Pure factory for a new saved-place record. Validation-first: the name must
// be a trimmed non-empty string of up to 60 chars, coordinates must be finite
// and inside ±90/±180, and an unknown/missing category coerces to 'other'.
// THROWS an error object { code: 'INVALID_PLACE', field, message } on the
// first invalid field (field: 'name' | 'latitude' | 'longitude') so callers
// can show an inline error message directly.
export function buildSavedPlace({ name, category, latitude, longitude }) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    throw Object.assign(new Error('Give the place a name before saving.'), {
      code: 'INVALID_PLACE',
      field: 'name',
    });
  }
  if (trimmedName.length > 60) {
    throw Object.assign(new Error('Keep the place name to 60 characters or fewer.'), {
      code: 'INVALID_PLACE',
      field: 'name',
    });
  }
  if (!isValidLatLng(latitude, longitude)) {
    throw Object.assign(
      new Error('Coordinates must be finite numbers inside ±90 latitude / ±180 longitude.'),
      { code: 'INVALID_PLACE', field: !(
          typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        )
        ? 'latitude'
        : 'longitude' }
    );
  }
  return {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    name: trimmedName,
    category: normalizePlaceCategory(category),
    latitude,
    longitude,
  };
}

// Case-insensitive normalized name key shared by BOTH recents paths (recall
// parse below and pushRecentDestination) so the two can never disagree about
// what counts as a duplicate. Non-string inputs normalize to '' (they are
// dropped before the key is compared in both paths).
function recentNameKey(text) {
  return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

// Parse a stored recent-destinations payload into safe strings. Only string
// entries survive; each is trimmed, empties dropped, CASE-INSENSITIVE
// duplicates collapsed (first spelling wins, same rule as the push path via
// the shared recentNameKey helper), order kept, capped at
// RECENT_DESTINATIONS_MAX. Returns { list, ok } — ok is false only when a
// stored payload existed but could not be parsed into an array.
export function parseRecentDestinations(raw) {
  if (raw == null || raw === '') return { list: [], ok: true };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { list: [], ok: false };
  }
  if (!Array.isArray(parsed)) return { list: [], ok: false };
  const list = [];
  const seen = new Set();
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = recentNameKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(trimmed);
    if (list.length >= RECENT_DESTINATIONS_MAX) break;
  }
  return { list, ok: true };
}

// Pure add-to-front for the recents list. The entry must be a non-empty
// string; existing case-insensitive duplicates collapse into the new
// (trimmed) spelling moved to the front; the result always stays capped at
// RECENT_DESTINATIONS_MAX. Returns { list, changed } — changed is false when
// nothing would change, so the caller can skip a redundant storage write.
export function pushRecentDestination(list, entry) {
  const name = typeof entry === 'string' ? entry.trim() : '';
  if (!name) return { list, changed: false };
  const current = Array.isArray(list) ? list.slice() : [];
  // Shared helper keeps push-time dedupe in lockstep with the recall parse.
  const lower = recentNameKey(name);
  const without = current.filter((item) => recentNameKey(item) !== lower);
  const next = [name, ...without].slice(0, RECENT_DESTINATIONS_MAX);
  const changed =
    next.length !== current.length || next.some((item, i) => item !== current[i]);
  return { list: next, changed };
}

// ---------------------------------------------------------------------------
// Journey Replay: recorded-path trails (side-car storage; the trip RECORD is
// untouched). Trip records keep exactly { id, date, mode, actualDistanceM,
// durationSec } (+ optional additive title/description) — the GPS path lives
// under a SEPARATE key, so old records and old code paths are unaffected.
// TRAIL_KEY value shape (JSON): { [tripId]: [[lat, lng], ...] } — points are
// the ACCEPTED fix stream retained while tracking (see App.js + lib/track.js
// shouldRetainSample), i.e. an observational sample of the user's real path.
// ---------------------------------------------------------------------------
export const TRAIL_KEY = '@EcoRoute/tripTrails';
// Per-trip point cap. Display sampling only — deliberately independent of the
// tracking filter (TRIP_FILTER in lib/track.js), which is a distance/accuracy
// mechanism, not a storage one. Excess points are thinned (endpoints kept).
export const TRAIL_MAX_POINTS = 600;
// Minimum meters between retained trail samples during recording. Pure
// display sampling: a new fix only joins the trail when it has moved this far
// from the last retained sample. Unrelated to TRIP_FILTER.MIN_STEP_M.
export const TRAIL_MIN_STEP_M = 10;

// Validate one stored [lat, lng] pair: an array of exactly 2 finite numbers
// inside the same ±90 / ±180 bounds the saved-places parser uses.
function isValidTrailPair(pair) {
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    typeof pair[0] === 'number' && Number.isFinite(pair[0]) && pair[0] >= -90 && pair[0] <= 90 &&
    typeof pair[1] === 'number' && Number.isFinite(pair[1]) && pair[1] >= -180 && pair[1] <= 180
  );
}

// Ratio-based thinning for oversized trails: keeps ESSENTIALLY EVENLY spaced
// indices (always including the first and last point — a trimmed path must
// still start and end where the trip did) and lands at or below maxPoints.
// Pure and deterministic: the same input always yields the same output.
export function thinTrailPoints(points, maxPoints = TRAIL_MAX_POINTS) {
  const clean = Array.isArray(points) ? points.filter(isValidTrailPair) : [];
  if (clean.length <= maxPoints) return clean;
  if (maxPoints < 2) return [clean[0], clean[clean.length - 1]].filter(Boolean);
  const kept = new Set();
  for (let k = 0; k < maxPoints; k += 1) {
    const index = Math.round((k * (clean.length - 1)) / (maxPoints - 1));
    kept.add(Math.min(clean.length - 1, Math.max(0, index)));
  }
  kept.add(0);
  kept.add(clean.length - 1);
  return clean.filter((_, i) => kept.has(i));
}

// Parse a stored TRAIL_KEY payload into a safe { tripId: [[lat, lng], ...] }
// map. Tolerant: a corrupt payload parses to an empty map; invalid entries
// (non-arrays, malformed points, out-of-range coordinates) and trips without
// any valid point are dropped; oversized trails are thinned via
// thinTrailPoints. Returns a plain object even on failure — never a crash.
export function parseTrails(raw) {
  if (raw == null || raw === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const map = {};
  for (const tripId of Object.keys(parsed)) {
    const points = thinTrailPoints(parsed[tripId], TRAIL_MAX_POINTS);
    if (points.length === 0) continue;
    map[String(tripId)] = points;
  }
  return map;
}

// Convert a parsed trail ([[lat, lng], ...]) into the { latitude, longitude }
// coordinate array the map draw uses. Invalid entries are skipped again here
// so the replay draw never sees a malformed point.
export function trailToCoords(points) {
  if (!Array.isArray(points)) return [];
  const coords = [];
  for (const pair of points) {
    if (!isValidTrailPair(pair)) continue;
    coords.push({ latitude: pair[0], longitude: pair[1] });
  }
  return coords;
}

// Trail thinning decision during recording (pure, extracted for testability):
// the incoming ACCEPTED fix is retained when it is the first sample of the
// trail (null last) or when it has moved at least minStepM from the last
// retained sample. Invalid fixes never join the trail.
export function shouldRetainSample(last, cur, minStepM = TRAIL_MIN_STEP_M) {
  const readable =
    !!cur &&
    typeof cur.latitude === 'number' && Number.isFinite(cur.latitude) &&
    typeof cur.longitude === 'number' && Number.isFinite(cur.longitude);
  if (!readable) return false;
  if (!last) return true;
  return distanceBetweenFixes(last, cur) >= minStepM;
}

// Map a normalized replay progress (0..1) to a trail point index. 0 -> the
// first point, 1 -> the last point, and everything in between distributes
// evenly across the stored path. Pure and defensive: invalid progress or
// degenerate counts fall back to index 0.
export function progressToIndex(progress, count) {
  if (
    !Number.isFinite(progress) ||
    count !== Math.floor(count) ||
    count <= 0
  ) {
    return 0;
  }
  if (count === 1) return 0;
  const clamped = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  return Math.floor(clamped * (count - 1));
}

// Smooth point-on-path lookup for the replay marker: interpolation BETWEEN
// the two points flanking the current progress (progressToIndex's left
// neighbor and the next one). Degenerate inputs return the first point.
export function pointAtProgress(points, progress) {
  const count = Array.isArray(points) ? points.length : 0;
  if (count === 0) return null;
  if (count === 1) return { ...points[0] };
  const idx = progressToIndex(progress, count);
  const a = points[idx];
  const b = points[idx < count - 1 ? idx + 1 : idx];
  if (b === a) return { ...a };
  const startSpan = idx / (count - 1);
  const endSpan = (idx + 1) / (count - 1);
  const frac =
    progress <= startSpan ? 0 : progress >= endSpan ? 1 : (progress - startSpan) / (endSpan - startSpan);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * frac,
    longitude: a.longitude + (b.longitude - a.longitude) * frac,
  };
}

// Reset literal used by the startup load path and "Erase all data".
export const DEFAULT_PROFILE = { name: '', weightKg: '' };

// Fallback map region used when the user's location is unknown
// (e.g., location permission denied so routing/Profile stays reachable).
export const DEFAULT_REGION = {
  latitude: 28.5494,
  longitude: 77.2001,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
