// Pure formatting helpers extracted from App.js.
// Behavior must stay identical to the original inline implementations.

export function formatDistance(meters, unit = 'metric') {
  if (!Number.isFinite(meters)) return null;
  if (unit === 'imperial') {
    // Imperial: below 0.1 mi a mile figure carries no useful precision, so
    // feet are shown instead (m -> ft via 3.28084). At/above 0.1 mi the same
    // one-decimal style as metric kilometres is used.
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatDurationLong(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Air-quality units prettifier: the backend ships metric keys in ASCII
// ('ug/m3'); display uses the proper micro/subscript glyphs (µ U+00B5,
// superscript ³ U+00B3). Any unknown unit collapses to '' so callers can omit
// the units segment entirely instead of printing a raw string they do not
// understand; backend payloads themselves are never altered.
export function formatPmUnits(units) {
  if (typeof units !== 'string') return '';
  if (units === 'ug/m3') return 'µg/m³';
  return '';
}

// Coordinates caption for saved places / the map picker: 4 decimals to match
// the backend's deterministic 'lat, lng' destination-name fallback exactly
// (POST /route envelope uses f"{lat:.4f}, {lng:.4f}"). Returns null for any
// non-finite input — callers decide how to render the absence.
export function formatLatLng(latitude, longitude) {
  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) ||
    typeof longitude !== 'number' || !Number.isFinite(longitude)
  ) {
    return null;
  }
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

// Honest fallback shown wherever a stored trip `date` value is missing or
// cannot be parsed: previously JS's 'Invalid Date' leaked into the user
// interface (History list row, History detail card, Profile recent rows and
// the Replay summary all call toLocaleString on the raw stored value).
export const TRIP_DATE_FALLBACK = 'Date not available';

// Localized trip-date rendering from the STORED record's `date` field (an
// ISO string saved by this app, but storage is user-reachable). Renders the
// same `new Date(value).toLocaleString()` display for a parsable value;
// anything unparseable (or a missing/non-string-or-number value, which would
// otherwise silently render the 1970 epoch for null) shows TRIP_DATE_FALLBACK.
export function formatTripDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return TRIP_DATE_FALLBACK;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return TRIP_DATE_FALLBACK;
  return parsed.toLocaleString();
}
