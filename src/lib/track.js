// Pure GPS trip-filtering helpers extracted from App.js.
//
// No React Native or Expo imports: this module is unit-testable in isolation
// and is the single authority for what counts as "distance travelled" while a
// trip is being tracked. App.js feeds raw position fixes in and accumulates
// only the meters this module approves.
//
// Decision order implemented by tripStep():
//   1. First reading (no previous reference)          -> reference only, meters 0.
//   2. Accuracy worse than trusted / missing / unreadable -> 'low_accuracy', meters 0.
//   3. Step below MIN_STEP_M                          -> 'jitter', meters 0.
//   4. Step inside the worse accuracy radius          -> 'jitter', meters 0.
//   5. Step implying impossible speed                 -> 'jump', meters 0.
//   6. Otherwise                                      -> accept, meters = step.

// Thresholds are module-level constants so they stay visible and tunable in
// one place. They are chosen for handheld/cycling GPS (expo-location reports
// accuracy as the estimated horizontal error radius in meters).
export const TRIP_FILTER = {
  // Steps smaller than this are treated as stationary GPS jitter (< typical
  // handheld CEP while standing still); they are never added as distance.
  MIN_STEP_M: 1.5,
  // Readings reporting accuracy worse than this (or with no accuracy value)
  // are 'low quality': we keep tracking but do NOT add their distance,
  // because the noise radius is larger than any trustworthy movement.
  MAX_TRUSTED_ACCURACY_M: 30,
  // When current accuracy exceeds this the UI shows a "GPS accuracy is low"
  // notice (notice threshold is softer than the trust threshold so the user
  // is warned before distance becomes unusable).
  LOW_ACCURACY_NOTICE_M: 15,
  // A step is treated as jitter (not real movement) when it is smaller than
  // this multiple of the WORSE of the two readings' accuracy radii; the
  // reference point is then NOT advanced, so real movement later is measured
  // from the original reference instead of drifted noise.
  JITTER_ACCURACY_FACTOR: 1.0,
  // Steps implying movement faster than this (m/s ≈ 90 km/h) are impossible
  // for walking/cycling trips (walking ≈ 1.4, cycling ≈ <20); a step beyond
  // this is rejected and the reference re-synced to the new position so a
  // bogus jump doesn't keep rejecting later real positions.
  MAX_SPEED_MPS: 25,
  // Fallback cap when no usable timestamps are available: a single step this
  // large is treated as an impossible jump.
  MAX_STEP_NO_TIMESTAMP_M: 50,
};

// Great-circle distance in meters. Faithful copy of the haversine previously
// inlined in App.js (R = Earth mean radius 6371000), kept precise.
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const aHav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aHav), Math.sqrt(1 - aHav));
  return R * c;
}

/**
 * Pure great-circle distance (meters) between two position fixes, ADDITIVELY
 * reusing the module's existing haversine (no duplicated formula). Used by the
 * journey-replay trail thinning (constants.js shouldRetainSample) — it reads
 * the same fix coordinate shape the trip filter works with, but changes
 * nothing about filtering, thresholds or acceptance behavior.
 *
 * Returns 0 for any unreadable input so callers can chain it defensively.
 *
 * @param {{latitude:number, longitude:number}|null} a
 * @param {{latitude:number, longitude:number}|null} b
 * @returns {number} distance in meters (0 when either point is unusable)
 */
export function distanceBetweenFixes(a, b) {
  if (!readablePoint(a) || !readablePoint(b)) return 0;
  return haversineMeters(a, b);
}

function readablePoint(p) {
  return (
    !!p &&
    typeof p.latitude === 'number' &&
    Number.isFinite(p.latitude) &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.longitude)
  );
}

/**
 * Classify one position update against the current trusted reference.
 *
 * Decision order (first match wins):
 *   1. No previous reference -> 0 m, 'ok' (caller stores cur as reference,
 *      WITHOUT adding distance — the first reading is reference-only).
 *   2. Current accuracy missing or worse than MAX_TRUSTED_ACCURACY_M ->
 *      0 m, 'low_accuracy' (caller keeps the old reference; movement cannot
 *      be measured from noise).
 *   3. Step below MIN_STEP_M -> 0 m, 'jitter' (caller keeps the old
 *      reference; the reading is stationary GPS noise).
 *   4. Step inside JITTER_ACCURACY_FACTOR * the worse of the two accuracy
 *      radii -> 0 m, 'jitter' (caller keeps the old reference).
 *   5. Step implying speed above MAX_SPEED_MPS (or, without usable
 *      timestamps, a step above MAX_STEP_NO_TIMESTAMP_M) -> 0 m, 'jump'
 *      (caller re-syncs the reference to cur without adding distance).
 *   6. Otherwise the step is real: return meters = haversine(prev, cur),
 *      quality 'ok' (caller adds meters and advances the reference).
 *
 * `lowAccuracy` is always present: true when cur's accuracy is missing or
 * above LOW_ACCURACY_NOTICE_M, so the caller can show/hide the on-screen
 * notice regardless of whether the step was added.
 *
 * @param {{latitude:number, longitude:number, accuracy?:number, timestamp?:number}|null} prev
 *   The current trusted reference reading (an already-accepted fix).
 * @param {{latitude:number, longitude:number, accuracy?:number, timestamp?:number}} cur
 *   The incoming raw reading.
 * @returns {{meters:number, quality:'ok'|'jitter'|'low_accuracy'|'jump', lowAccuracy:boolean}}
 */
export function tripStep(prev, cur) {
  // A reading without a usable position can never become a reference nor
  // produce distance; treat it like an untrusted fix (caller keeps prev).
  if (!readablePoint(cur)) {
    return { meters: 0, quality: 'low_accuracy', lowAccuracy: true };
  }

  const lowAccuracy =
    cur.accuracy == null || cur.accuracy > TRIP_FILTER.LOW_ACCURACY_NOTICE_M;

  // First reading: nothing to measure yet; it only anchors the reference.
  if (!readablePoint(prev)) {
    return { meters: 0, quality: 'ok', lowAccuracy };
  }

  const dist = haversineMeters(prev, cur);

  // Low-quality fix: the noise radius swamps any possible movement, so we
  // cannot even tell jitter from travel. Keep the previous trusted reference.
  if (cur.accuracy == null || cur.accuracy > TRIP_FILTER.MAX_TRUSTED_ACCURACY_M) {
    return { meters: 0, quality: 'low_accuracy', lowAccuracy };
  }

  // Too small to be real movement: stationary jitter. The caller must keep
  // the reference unchanged, otherwise drift would accumulate as "distance"
  // while standing still (and slowly relocate the reference point).
  if (dist < TRIP_FILTER.MIN_STEP_M) {
    return { meters: 0, quality: 'jitter', lowAccuracy };
  }

  // Within the worse accuracy radius the step could still be pure noise
  // (e.g. a reported 3 m hop with 8 m error bars). Same rule: keep the
  // reference so movement is later measured from the original point.
  // prev accuracy is normally known (the caller stores trusted fixes); a
  // missing value falls back to the most conservative trusted radius.
  const prevRadius =
    prev.accuracy == null || !Number.isFinite(prev.accuracy)
      ? TRIP_FILTER.MAX_TRUSTED_ACCURACY_M
      : prev.accuracy;
  const curRadius = cur.accuracy;
  const worseRadius = Math.max(prevRadius, curRadius);
  if (dist <= TRIP_FILTER.JITTER_ACCURACY_FACTOR * worseRadius) {
    return { meters: 0, quality: 'jitter', lowAccuracy };
  }

  // Speed sanity check. dt comes from the reading timestamps (ms); when
  // unavailable or non-positive, fall back to a per-step distance cap.
  // Note on gaps: when location is temporarily unavailable no readings
  // arrive, so the next reading has a large dt and therefore a small implied
  // speed — genuine continuing movement is accepted in full, and no distance
  // is invented for the period the fix was down.
  const dt = (cur.timestamp - prev.timestamp) / 1000;
  if (Number.isFinite(dt) && dt > 0) {
    if (dist / dt > TRIP_FILTER.MAX_SPEED_MPS) {
      // Impossible for walk/cycle speeds: a bad fix or a teleport. The
      // caller re-syncs the reference to cur so subsequent real positions
      // are not repeatedly rejected against the stale point.
      return { meters: 0, quality: 'jump', lowAccuracy };
    }
  } else if (dist > TRIP_FILTER.MAX_STEP_NO_TIMESTAMP_M) {
    // Same reasoning, using distance alone when timestamps are unusable.
    return { meters: 0, quality: 'jump', lowAccuracy };
  }

  // Everything passed: this is real movement.
  return { meters: dist, quality: 'ok', lowAccuracy };
}
