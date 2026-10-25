// Windowed trip-distance accountant (src/lib/track.js) — pure unit tests.
//
// CAUSE ENCODED: the per-step tripStep gates are conservative but cannot see
// net-vs-path. Indoors, a device REPORTING optimistic accuracy radii (5-20 m)
// can drift in a ~15-25 m random walk per fix while still passing every
// per-step gate; summing accepted meters immediately accumulated the walk
// path (~1.4 km) although NET displacement stayed ~0 (user sitting still in
// one room for ~7 minutes). The accountant holds accepted 'ok' meters back
// until a window's PATH reaches TRIP_FILTER.DISTANCE_COMMIT_MIN_M (50) and
// then commits only when NET displacement from the window anchor maintains
// TRIP_FILTER.DISTANCE_NET_RATIO_MIN (0.5) of the path; everything else is
// dropped as drift. The remaining queue is decided once at trip finish with
// the same ratio test, regardless of window size (a real short final leg has
// ratio ≈ 1; pure drift ≈ 0).
//
// Geometry follows the track.test.js convention: steps along a meridian, so
// the module's R=6371000 haversine converts meters exactly (positive meters
// = due north, negative = due south) and every expected net/path figure is
// arithmetic, not hand-rounded GPS approximations.

import {
  createTripDistanceAccountant,
  distanceStep,
  finishTripDistance,
  TRIP_FILTER,
} from '../lib/track';

const START = { latitude: 12.9716, longitude: 77.5946 };
const METERS_PER_DEG = (Math.PI * 6371000) / 180;

// Point `meters` due north of `point` (negative meters go south).
const northOf = (point, meters) => ({
  latitude: point.latitude + meters / METERS_PER_DEG,
  longitude: point.longitude,
});

// Walk a sequence of accepted steps ({ meters, quality }) the way the
// App watcher does: prevFix = the previous fix (BEFORE any reference
// advance), curFix = the fix after the step. Positive meters walk due
// north, negative due south — but the VERDICT's meters are always the
// positive magnitude (tripStep returns a haversine distance; the direction
// lives in the fixes), so the accountant is fed |meters|. Returns the final
// accountant state plus the cumulative `added` total, so tests can assert
// both.
function walkSequence(state0, steps) {
  let state = state0;
  let addedTotal = 0;
  let prev = START;
  let cur = START;
  for (const s of steps) {
    cur = northOf(prev, s.meters);
    const account = distanceStep(
      state,
      { quality: s.quality, meters: Math.abs(s.meters) },
      prev,
      cur
    );
    state = account.state;
    addedTotal += account.added;
    prev = cur;
  }
  return { state, addedTotal };
}

const ok = (meters) => ({ quality: 'ok', meters });

describe('windowed accountant: stationary drift (the encoded incident)', () => {
  test('indoor random walk (zigzag ±20 m, net ~0) is discarded, never decided', () => {
    // Each back-and-forth pair cancels, so at the first crossing (path 60)
    // the net is a single 20 m leg: ratio ≈ 0.33, far below the walker's
    // honest worst case — exactly the standing-still signature.
    const { state } = walkSequence(createTripDistanceAccountant(), [
      ok(20), ok(-20), ok(20),
    ]);
    expect(state.decidedMeters).toBe(0);
    expect(state.driftDiscardedMeters).toBeGreaterThanOrEqual(50);
    expect(state.driftDiscardedMeters).toBe(60);
    expect(state.queue).toEqual([]);
  });

  test('meters are held back with an honest lag; nothing decided below 50 m of path', () => {
    let state = createTripDistanceAccountant();
    let prev = START;
    let cur = prev;
    for (const meters of [20, 20]) {
      cur = northOf(prev, meters);
      const account = distanceStep(state, ok(meters), prev, cur);
      state = account.state;
      expect(account.added).toBe(0);
      expect(state.decidedMeters).toBe(0);
      prev = cur;
    }
    expect(state.queue.length).toBe(2);
  });
});

describe('windowed accountant: real movement commits', () => {
  test('a straight ~60 m walk commits in full (ratio ≈ 1)', () => {
    const { state, addedTotal } = walkSequence(createTripDistanceAccountant(), [
      ok(20), ok(20), ok(20),
    ]);
    expect(state.decidedMeters).toBe(60);
    expect(addedTotal).toBe(60);
    expect(state.driftDiscardedMeters).toBe(0);
    expect(state.queue).toEqual([]);
  });

  test('a zigzagging real walk with ratio about 0.8 commits (walker worst case)', () => {
    // +25, +20, -5 along the meridian: path 50, net 40 -> ratio 0.8, which
    // every normal walking window clears.
    const { state, addedTotal } = walkSequence(createTripDistanceAccountant(), [
      ok(25), ok(20), ok(-5),
    ]);
    expect(state.decidedMeters).toBe(50);
    expect(addedTotal).toBe(50);
    expect(state.driftDiscardedMeters).toBe(0);
  });

  test('a borderline window below the ratio (≈ 0.45) is conservatively DISCARDED', () => {
    // +25, +20, -17: path 62, net 28 -> ratio ≈ 0.452. Reclassification errs
    // toward NOT counting, so this window must end up in the drift bucket.
    const { state, addedTotal } = walkSequence(createTripDistanceAccountant(), [
      ok(25), ok(20), ok(-17),
    ]);
    expect(state.decidedMeters).toBe(0);
    expect(addedTotal).toBe(0);
    expect(state.driftDiscardedMeters).toBe(62);
  });

  test('the anchor moves to the last accepted fix after each decision (no stale carry)', () => {
    // Window 1: +24/-24/+24 -> path 72, net 24 (ratio 1/3) -> discarded; the
    // anchor MUST reset to the last accepted fix (+24 north). Window 2
    // continues drifting: with the fresh anchor its net is 20/60 (discard);
    // with a stale START anchor it would read 44/60 ≈ 0.73 and wrongly
    // commit drift. Deciding 0/132 proves the reset happened.
    const { state } = walkSequence(createTripDistanceAccountant(), [
      ok(24), ok(-24), ok(24),
      ok(20), ok(-20), ok(20),
    ]);
    expect(state.decidedMeters).toBe(0);
    expect(state.driftDiscardedMeters).toBe(132);
  });
});

describe('windowed accountant: only trusted steps enter the queue', () => {
  test('jitter / low_accuracy / jump steps with meters are ignored', () => {
    let state = createTripDistanceAccountant();
    let prev = START;
    let cur = prev;
    for (const step of [
      { quality: 'jitter', meters: 30 },
      { quality: 'low_accuracy', meters: 30 },
      { quality: 'jump', meters: 30 },
    ]) {
      cur = northOf(prev, 30);
      const account = distanceStep(state, step, prev, cur);
      state = account.state;
      expect(account.added).toBe(0);
      prev = cur;
    }
    expect(state.queue).toEqual([]);
    expect(state.decidedMeters).toBe(0);
    expect(state.driftDiscardedMeters).toBe(0);
  });

  test('the reference-only first fix (ok, 0 meters) is ignored too', () => {
    const state0 = createTripDistanceAccountant();
    const account = distanceStep(state0, { quality: 'ok', meters: 0 }, null, START);
    expect(account.added).toBe(0);
    expect(account.state.queue).toEqual([]);
    expect(account.state.anchor).toBeNull();
  });
});

describe('finishTripDistance decides the remaining queue', () => {
  test('a real short final leg commits regardless of window size', () => {
    // One 30 m accepted leg (queue 30 < 50, undecided), then the trip ends
    // with the fix 40 m north of the anchor: net 40 >= 0.5 * 30 -> commit.
    const { state } = walkSequence(createTripDistanceAccountant(), [ok(30)]);
    const lastFix = northOf(START, 30);
    const finished = finishTripDistance(state, northOf(START, 0), lastFix);
    expect(finished.meters).toBe(30);
    expect(finished.drifted).toBe(0);
  });

  test('a drift-dominated remainder is discarded (final number stays honest, smaller)', () => {
    // +20 north then -20 south: queue 40 (< 50), net 0; the walk ends back
    // at START (last prev = the +20 fix, last cur = START). Even though the
    // trip finished before any window closed, the remainder is pure drift.
    const { state } = walkSequence(createTripDistanceAccountant(), [ok(20), ok(-20)]);
    const finished = finishTripDistance(state, northOf(START, 20), START);
    expect(finished.meters).toBe(0);
    expect(finished.drifted).toBe(40);
  });

  test('an empty queue returns the running totals unchanged', () => {
    const state = createTripDistanceAccountant();
    const finished = finishTripDistance(state, null, null);
    expect(finished.meters).toBe(0);
    expect(finished.drifted).toBe(0);
  });
});

describe('windowed accountant: mid-trip cycles', () => {
  test('commit -> drift -> commit accumulates each bucket independently', () => {
    // Walk + drift + walk: the two walking windows commit 50 each; the
    // stationary zigzag between them is discarded.
    const { state } = walkSequence(createTripDistanceAccountant(), [
      ok(25), ok(20), ok(-5), // commit: path 50, ratio 0.8
      ok(24), ok(-24), ok(24), // drift: path 72, ratio 1/3
      ok(25), ok(20), ok(-5), // commit again from the new anchor
    ]);
    expect(state.decidedMeters).toBe(100);
    expect(state.driftDiscardedMeters).toBe(72);
    expect(state.queue).toEqual([]);
  });

  test('thresholds are the documented constants', () => {
    expect(TRIP_FILTER.DISTANCE_COMMIT_MIN_M).toBe(50);
    expect(TRIP_FILTER.DISTANCE_NET_RATIO_MIN).toBe(0.5);
  });
});
