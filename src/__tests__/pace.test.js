// Feature tests: pace/speed labels (lib/stats.paceLabel) and the recent
// destination helpers (constants.parseRecentDestinations / pushRecentDestination).
// Pure-function suites only — no React rendering, no storage, no Date reads.

import { paceLabel } from '../lib/stats';
import {
  RECENT_DESTINATION_KEY,
  RECENT_DESTINATIONS_MAX,
  parseRecentDestinations,
  pushRecentDestination,
} from '../constants';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('paceLabel', () => {
  // 1000 m in 600 s = 10 min/km (walking), 6.0 km/h (cycling).
  test('walking metric: perfect km -> whole-min label', () => {
    expect(paceLabel({ mode: 'walking', actualDistanceM: 1000, durationSec: 600 })).toBe('10 min/km');
  });

  test('walking metric: rounding to nearest whole minute', () => {
    // 2500 m in 1840 s -> 1840/60/2.5 = 12.27 min/km -> 12
    expect(paceLabel({ mode: 'walking', actualDistanceM: 2500, durationSec: 1840 })).toBe('12 min/km');
    // 1200 m in 2100 s -> 2100/60/1.2 = 29.17 -> 29
    expect(paceLabel({ mode: 'walking', actualDistanceM: 1200, durationSec: 2100 })).toBe('29 min/km');
  });

  test('walking imperial: minutes-per-mile from the same stored record', () => {
    // 1609.344 m (exactly 1 mi) in 600 s -> 10 min/mi
    expect(paceLabel({ mode: 'walking', actualDistanceM: 1609.344, durationSec: 600 }, 'imperial')).toBe('10 min/mi');
    // 805 m (0.5 mi) in 600 s -> 20 min/mi
    expect(paceLabel({ mode: 'walking', actualDistanceM: 804.672, durationSec: 600 }, 'imperial')).toBe('20 min/mi');
  });

  test('cycling metric: one-decimal km/h', () => {
    expect(paceLabel({ mode: 'cycling', actualDistanceM: 6000, durationSec: 3600 })).toBe('6.0 km/h');
    // 10 km in 2100 s -> 17.142857 km/h -> '17.1'
    expect(paceLabel({ mode: 'cycling', actualDistanceM: 10000, durationSec: 2100 })).toBe('17.1 km/h');
  });

  test('cycling imperial: one-decimal mph', () => {
    expect(paceLabel({ mode: 'cycling', actualDistanceM: 1609.344, durationSec: 3600 }, 'imperial')).toBe('1.0 mph');
    // 10 mi in 2100 s -> 17.142857 mph -> '17.1'
    expect(paceLabel({ mode: 'cycling', actualDistanceM: 16093.44, durationSec: 2100 }, 'imperial')).toBe('17.1 mph');
  });

  test('default unit is metric (omitted second arg = explicit metric call)', () => {
    const trip = { mode: 'cycling', actualDistanceM: 6000, durationSec: 3600 };
    expect(paceLabel(trip)).toBe(paceLabel(trip, 'metric'));
    expect(paceLabel(trip)).toBe('6.0 km/h');
  });

  test.each([
    ['missing distance', { mode: 'walking', durationSec: 600 }],
    ['missing duration', { mode: 'walking', actualDistanceM: 1000 }],
    ['zero distance', { mode: 'walking', actualDistanceM: 0, durationSec: 600 }],
    ['zero duration', { mode: 'walking', actualDistanceM: 1000, durationSec: 0 }],
    ['negative distance', { mode: 'walking', actualDistanceM: -5, durationSec: 600 }],
    ['negative duration', { mode: 'walking', actualDistanceM: 1000, durationSec: -5 }],
    ['NaN distance', { mode: 'walking', actualDistanceM: NaN, durationSec: 600 }],
    ['NaN duration', { mode: 'walking', actualDistanceM: 1000, durationSec: NaN }],
    ['Infinity duration', { mode: 'walking', actualDistanceM: 1000, durationSec: Infinity }],
    ['string distance', { mode: 'walking', actualDistanceM: '1000', durationSec: 600 }],
    ['null distance', { mode: 'walking', actualDistanceM: null, durationSec: 600 }],
  ])('bad data (%s) returns null — row is omitted, never fabricated', (_label, trip) => {
    expect(paceLabel(trip)).toBeNull();
  });

  test('non-object and unknown/legacy modes return null (driving gets no honest pace figure)', () => {
    expect(paceLabel(null)).toBeNull();
    expect(paceLabel(undefined)).toBeNull();
    expect(paceLabel('walking')).toBeNull();
    expect(paceLabel({ mode: 'driving', actualDistanceM: 1000, durationSec: 600 })).toBeNull();
    expect(paceLabel({ mode: 'unknown', actualDistanceM: 1000, durationSec: 600 })).toBeNull();
  });

  test('metric explicitly requested stays identical to default for imperial-agnostic trips', () => {
    expect(paceLabel({ mode: 'walking', actualDistanceM: 1000, durationSec: 600 }, 'metric')).toBe('10 min/km');
  });
});

describe('RECENT_DESTINATION_KEY', () => {
  test('is the documented additive storage key with a cap of 5', () => {
    expect(RECENT_DESTINATION_KEY).toBe('@EcoRoute/recentDestinations');
    expect(RECENT_DESTINATIONS_MAX).toBe(5);
  });
});

describe('parseRecentDestinations', () => {
  test('empty payload (null/undefined/empty string) parses to an empty list, ok', () => {
    expect(parseRecentDestinations(null)).toEqual({ list: [], ok: true });
    expect(parseRecentDestinations(undefined)).toEqual({ list: [], ok: true });
    expect(parseRecentDestinations('')).toEqual({ list: [], ok: true });
  });

  test('corrupt JSON returns an empty list with ok false', () => {
    expect(parseRecentDestinations('{not json')).toEqual({ list: [], ok: false });
    expect(parseRecentDestinations('[broken')).toEqual({ list: [], ok: false });
  });

  test('a non-array JSON payload returns an empty list with ok false', () => {
    expect(parseRecentDestinations('"Hauz Khas"')).toEqual({ list: [], ok: false });
    expect(parseRecentDestinations('42')).toEqual({ list: [], ok: false });
    expect(parseRecentDestinations('{"name": "x"}')).toEqual({ list: [], ok: false });
  });

  test('filters non-strings, trims, drops empties, and keeps order', () => {
    const raw = JSON.stringify(['  Hauz Khas  ', 42, null, { name: 'x' }, '   ', 'India Gate', true]);
    const { list, ok } = parseRecentDestinations(raw);
    expect(list).toEqual(['Hauz Khas', 'India Gate']);
    expect(ok).toBe(true);
  });

  test('caps at 5 entries, keeping the FIRST five in stored order', () => {
    const raw = JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(parseRecentDestinations(raw).list).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('a well-formed array is returned as-is (modulo trim/empty rules)', () => {
    const raw = JSON.stringify(['Saket', 'Connaught Place']);
    expect(parseRecentDestinations(raw).list).toEqual(['Saket', 'Connaught Place']);
  });

  // Recall-side dedupe: stored duplicates (e.g. an older build that pushed
  // case variants, or hand-edited storage) collapse case-insensitively so the
  // recall path agrees with pushRecentDestination's push-time dedupe. The
  // FIRST spelling seen is kept, order preserved, cap still applies.
  test('collapses case-insensitive duplicates from stored values, keeping the first spelling', () => {
    const raw = JSON.stringify(['hauz khas', '  HAUZ KHAS  ', 'Saket', 'saket']);
    const { list, ok } = parseRecentDestinations(raw);
    expect(list).toEqual(['hauz khas', 'Saket']);
    expect(ok).toBe(true);
  });
});

describe('pushRecentDestination', () => {
  test('adds a new entry to the front and reports changed', () => {
    const { list, changed } = pushRecentDestination(['Old'], 'New');
    expect(list).toEqual(['New', 'Old']);
    expect(changed).toBe(true);
  });

  test('trims the entry and never stores an empty result step', () => {
    const { list, changed } = pushRecentDestination(['A'], '   ');
    expect(list).toEqual(['A']);
    expect(changed).toBe(false);
  });

  test('non-string entries leave the list untouched (changed false)', () => {
    const list = ['A'];
    expect(pushRecentDestination(list, undefined)).toEqual({ list, changed: false });
    expect(pushRecentDestination(list, null)).toEqual({ list, changed: false });
    expect(pushRecentDestination(list, 42)).toEqual({ list, changed: false });
  });

  test('dedupes case-insensitively and moves the match to the front', () => {
    const { list, changed } = pushRecentDestination(['B', 'hauz khas', 'C'], 'HAUZ KHAS');
    expect(list).toEqual(['HAUZ KHAS', 'B', 'C']);
    expect(changed).toBe(true);
  });

  test('exact duplicate already at the front is a no-op (changed false)', () => {
    expect(pushRecentDestination(['A', 'B'], 'A')).toEqual({ list: ['A', 'B'], changed: false });
  });

  test('exact duplicate NOT at the front still moves to the front (changed true)', () => {
    const { list, changed } = pushRecentDestination(['A', 'B', 'C'], 'B');
    expect(list).toEqual(['B', 'A', 'C']);
    expect(changed).toBe(true);
  });

  test('caps at 5: pushing a sixth drops the oldest', () => {
    const { list, changed } = pushRecentDestination(['a', 'b', 'c', 'd', 'e'], 'f');
    expect(list).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(changed).toBe(true);
    expect(list.length).toBe(RECENT_DESTINATIONS_MAX);
  });

  test('input list is never mutated', () => {
    const list = ['A', 'B'];
    pushRecentDestination(list, 'C');
    expect(list).toEqual(['A', 'B']);
  });
});
