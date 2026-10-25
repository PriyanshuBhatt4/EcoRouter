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
  // --- Windowed trip-distance accountant (see distanceStep below) ---
  // Field evidence (user sitting still in one room for ~7 minutes, device
  // REPORTING 5-20 m accuracy radii) showed the per-step gates above alone
  // cannot stop phantom distance INDOORS: the reported radius is optimistic
  // while the true fix wanders ~15-25 m per 2 s fix in a random walk. Each
  // drifting step that clears the worse reported radius passes as 'ok', and
  // adding `step.meters` immediately accumulated the whole walk path
  // (~200 fixes × ~7 m ≈ 1.4 km) even though NET displacement stayed ~0.
  // A per-step gate cannot see the net-vs-path discrepancy — only a window
  // held back long enough can.
  // DISTANCE_COMMIT_MIN_M: accepted 'ok' meters are held in a pending queue
  // until this much PATH length is pending; the window is then decided once
  // (net-ratio test below). This lag is the honest accounting cost of being
  // able to tell a real walk from standing still, so the DISPLAY (and the
  // final stored distance) shows decidedMeters — up to this many meters
  // behind the raw accepted path sum until the next window lands or the trip
  // is finished (finishTripDistance decides the remainder without the lag).
  DISTANCE_COMMIT_MIN_M: 50,
  // DISTANCE_NET_RATIO_MIN: a window commits (counts as distance) only when
  // NET displacement (window anchor -> last fix) is at least this fraction of
  // the window's PATH sum. Normal walking maintains a ratio of roughly >= 0.8
  // over any ~50 m window; an indoor stationary random walk typically stays
  // below ~0.3. The bound is deliberately CONSERVATIVE: a borderline window
  // is reclassified toward NOT counting (drift), never toward counting, so
  // honest short hops survive and noisy indoor wander is dropped.
  DISTANCE_NET_RATIO_MIN: 0.5,
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

// ---------------------------------------------------------------------------
// Windowed trip-distance accountant (ADDITIVE): closes the indoor-drift hole
// the per-step gates cannot. tripStep() is a conservative PER-STEP verdict,
// but per-step verdicts only see consecutive fixes. Indoors the device often
// REPORTS optimistic accuracy radii (5-20 m) while the true fix wanders in a
// ~15-25 m random walk per fix; every drifting step that clears the worse
// reported radius passes as 'ok'. Adding those meters immediately accumulates
// the WALK PATH while NET displacement stays ~0 — the user's reported
// "7 minutes sitting still → 1.4 km". No per-step rule can distinguish that
// from real travel, because real travel and drift look identical step by
// step; only the accumulated window reveals the discrepancy.
//
// The accountant therefore holds back accepted 'ok' meters in a queue and
// decides windows once a window's PATH sum reaches TRIP_FILTER
// .DISTANCE_COMMIT_MIN_M: the window counts toward distance only when NET
// displacement from its anchor is at least TRIP_FILTER.DISTANCE_NET_RATIO_MIN
// of the PATH sum; otherwise the whole window is dropped as drift. The
// remaining partially-filled queue is decided exactly once, at trip finish,
// by finishTripDistance (which applies the same ratio test regardless of
// window size — a real short final leg has ratio ≈ 1, pure drift ≈ 0).
//
// Pure and synchronous: nothing here imports React Native, mutates its
// inputs, or touches timers/storage. App.js feeds every trusted-arm step
// through distanceStep and assigns the returned state back.
// ---------------------------------------------------------------------------

/**
 * Fresh accountant state: nothing decided, nothing discarded, no pending
 * window and no anchor yet. Also the reset shape App.js assigns at trip
 * start / erase-all.
 */
export function createTripDistanceAccountant() {
  return { decidedMeters: 0, driftDiscardedMeters: 0, queue: [], anchor: null };
}

// Defensive read of any stored accountant shape: unknown/corrupt values fall
// back to a fresh state's fields instead of crashing or inventing meters.
// Returns a NEW object (transformers are pure — the input is never mutated).
function normalizeAccountant(state) {
  const s = state && typeof state === 'object' ? state : {};
  const num = (v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  const queue = Array.isArray(s.queue)
    ? s.queue.filter((e) => e && readablePoint(e && e.point) && num(e.meters) > 0)
    : [];
  return {
    decidedMeters: num(s.decidedMeters),
    driftDiscardedMeters: num(s.driftDiscardedMeters),
    queue,
    anchor: readablePoint(s.anchor) ? s.anchor : null,
  };
}

/**
 * Account one trusted-arm step.
 *
 * Call with the step verdict from tripStep plus the pair of fixes that
 * produced it (prevFix = the trusted reference BEFORE the accepted fix,
 * curFix = the newly accepted fix) in watcher order — prev must be captured
 * BEFORE the reference advances to cur. Only quality 'ok' steps with
 * positive meters enter the queue; every other step (jitter, low_accuracy,
 * jump, the reference-only first fix) leaves the accountant untouched.
 *
 * When the queue's PATH sum reaches TRIP_FILTER.DISTANCE_COMMIT_MIN_M the
 * window is decided in this call:
 *   - net = haversine(anchor, last accepted fix) where the anchor is the
 *     point the window started from (the prevFix of its first pushed step,
 *     or the committed window's last fix for every subsequent window);
 *   - net >= TRIP_FILTER.DISTANCE_NET_RATIO_MIN * path -> the window is real
 *     travel: decidedMeters += path and `added` is the committed increment;
 *   - otherwise the window is stationary drift: driftDiscardedMeters += path
 *     and nothing is added.
 * The queue then resets and the anchor moves to the last accepted fix.
 *
 * @param {object} state Accountant state (createTripDistanceAccountant()).
 * @param {{quality:string, meters:number}} step Verdict from tripStep().
 * @param {{latitude:number, longitude:number}} prevFix Prior trusted fix.
 * @param {{latitude:number, longitude:number}} curFix Newly accepted fix.
 * @returns {{state:object, added:number}} New state (assign it back) and the
 *   meters committed by THIS call (0 unless a window landed here).
 */
export function distanceStep(state, step, prevFix, curFix) {
  const s = normalizeAccountant(state);
  if (
    !step ||
    step.quality !== 'ok' ||
    typeof step.meters !== 'number' ||
    !Number.isFinite(step.meters) ||
    step.meters <= 0 ||
    !readablePoint(curFix)
  ) {
    return { state: s, added: 0 };
  }

  // The window anchor: carried across windows (last committed fix) or, for
  // the window's first push, the fix the travel started from (prevFix).
  const anchor =
    s.anchor ||
    (readablePoint(prevFix)
      ? { latitude: prevFix.latitude, longitude: prevFix.longitude }
      : null);
  const entries = s.queue.concat([
    { meters: step.meters, point: { latitude: curFix.latitude, longitude: curFix.longitude } },
  ]);
  let path = 0;
  for (const e of entries) path += e.meters;

  if (path < TRIP_FILTER.DISTANCE_COMMIT_MIN_M) {
    // Window still filling: hold the meters back, decide nothing yet.
    s.queue = entries;
    s.anchor = anchor;
    return { state: s, added: 0 };
  }

  const lastCur = entries[entries.length - 1].point;
  const net = readablePoint(anchor) ? haversineMeters(anchor, lastCur) : 0;
  let added = 0;
  if (net >= TRIP_FILTER.DISTANCE_NET_RATIO_MIN * path) {
    s.decidedMeters += path;
    added = path;
  } else {
    s.driftDiscardedMeters += path;
  }
  s.queue = [];
  s.anchor = lastCur;
  return { state: s, added };
}

/**
 * Decide the REMAINING (partially-filled or untouched) queue at trip finish,
 * applying the same net-ratio test — but regardless of window size, because
 * the honest accounting lag must not end with a trip losing its last real
 * leg: a genuine short final window has net ≈ path (ratio ≈ 1 → commit),
 * while drift ends with net ≈ 0 (ratio ≈ 0 → discard). Returns the FINAL
 * totals (already including every previously committed/drifted window).
 *
 * lastPrevFix/lastCurFix are the last accepted fix pair for the defensive
 * case of an anchorless-but-readable queue; under normal operation the
 * window's own stored anchor and last queued fix carry the decision.
 *
 * @param {object} state Accountant state.
 * @param {{latitude:number, longitude:number}|null} lastPrevFix
 * @param {{latitude:number, longitude:number}|null} lastCurFix
 * @returns {{meters:number, drifted:number}}
 */
export function finishTripDistance(state, lastPrevFix, lastCurFix) {
  const s = normalizeAccountant(state);
  if (s.queue.length === 0) {
    return { meters: s.decidedMeters, drifted: s.driftDiscardedMeters };
  }
  let path = 0;
  for (const e of s.queue) path += e.meters;
  const anchor = readablePoint(s.anchor)
    ? s.anchor
    : readablePoint(lastPrevFix)
      ? lastPrevFix
      : s.queue[0] && readablePoint(s.queue[0].point)
        ? s.queue[0].point
        : null;
  const end = readablePoint(lastCurFix)
    ? lastCurFix
    : s.queue[s.queue.length - 1].point;
  const net = readablePoint(anchor) && readablePoint(end) ? haversineMeters(anchor, end) : 0;
  if (net >= TRIP_FILTER.DISTANCE_NET_RATIO_MIN * path) {
    s.decidedMeters += path;
  } else {
    s.driftDiscardedMeters += path;
  }
  return { meters: s.decidedMeters, drifted: s.driftDiscardedMeters };
}
