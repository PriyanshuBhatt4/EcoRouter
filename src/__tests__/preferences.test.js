import {
  PREFERENCES,
  selectByPreference,
  pickFastest,
  pickShortest,
  pickCleanest,
  pickOptimal,
  preferenceNote,
} from '../lib/preferences';

const pm25 = (value, extra = {}) => ({
  available: true,
  value,
  units: 'µg/m³',
  ...extra,
});

// Candidate shape mirrors App.js's mapped route objects.
const candidate = (id, distanceMeters, durationSeconds, pm25_estimate = null) => ({
  id,
  coordinates: [{ latitude: 28.55, longitude: 77.2 }],
  distanceMeters,
  durationSeconds,
  pm25_estimate,
});

describe('PREFERENCES keys', () => {
  test('exposes the expected preference values', () => {
    expect(PREFERENCES.MANUAL).toBe('manual');
    expect(PREFERENCES.FASTEST).toBe('fastest');
    expect(PREFERENCES.SHORTEST).toBe('shortest');
    expect(PREFERENCES.CLEANEST).toBe('cleanest');
    expect(PREFERENCES.OPTIMAL).toBe('optimal');
  });
});

describe('fastest preference', () => {
  test('picks minimum duration even when slower routes are shorter', () => {
    const candidates = [
      candidate('a', 4200, 900),
      candidate('b', 5000, 720),
      candidate('c', 3800, 1500),
    ];
    expect(pickFastest(candidates).id).toBe('b');
  });

  test('breaks duration ties with the shorter distance', () => {
    const candidates = [
      candidate('a', 4000, 720),
      candidate('b', 3900, 720),
      candidate('c', 4100, 720.0000000001),
    ];
    expect(pickFastest(candidates).id).toBe('b');
  });

  test('treats missing duration as Infinity so it never wins', () => {
    const candidates = [
      candidate('a', 4200, undefined),
      candidate('b', 5000, 900),
    ];
    expect(pickFastest(candidates).id).toBe('b');
  });

  test('first candidate wins when fully tied', () => {
    const candidates = [candidate('a', 1000, 600), candidate('b', 1000, 600)];
    expect(pickFastest(candidates).id).toBe('a');
  });
});

describe('shortest preference', () => {
  test('picks minimum distance even when longer routes are faster', () => {
    const candidates = [
      candidate('a', 3800, 1500),
      candidate('b', 5000, 720),
      candidate('c', 4500, 900),
    ];
    expect(pickShortest(candidates).id).toBe('a');
  });

  test('breaks distance ties with the shorter duration', () => {
    const candidates = [
      candidate('a', 3800, 900),
      candidate('b', 3800, 720),
      candidate('c', 3801, 600),
    ];
    expect(pickShortest(candidates).id).toBe('b');
  });

  test('treats missing distance as Infinity so it never wins', () => {
    const candidates = [
      candidate('a', undefined, 600),
      candidate('b', 3000, 900),
    ];
    expect(pickShortest(candidates).id).toBe('b');
  });
});

describe('cleanest preference', () => {
  test('picks the lowest pm25 value when all candidates are comparable', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
      candidate('c', 3800, 1500, pm25(11.0, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates).id).toBe('b');
  });

  test('returns null (keep selection) when the first candidate lacks can_compare_cleanest', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5)),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('returns null (keep selection) when the first candidate has no pm25 estimate at all', () => {
    const candidates = [
      candidate('a', 4000, 900),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('returns null (keep selection) when the first candidate has an unavailable value', () => {
    const candidates = [
      candidate('a', 4000, 900, { available: false, can_compare_cleanest: true }),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('returns null (keep selection) when the first candidate has a null value', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(null, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('returns null (keep selection) when any later candidate has an unavailable value', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, { available: false, can_compare_cleanest: true }),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('returns null (keep selection) when any later candidate is missing a numeric value', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, pm25(null, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates)).toBeNull();
  });

  test('prefers candidates encountered later that are cleaner than every earlier one', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(20.0, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, pm25(15.0, { can_compare_cleanest: true })),
      candidate('c', 3800, 1500, pm25(3.5, { can_compare_cleanest: true })),
    ];
    expect(pickCleanest(candidates).id).toBe('c');
  });
});

describe('optimal preference (equal weight, normalized distance + duration + pm25)', () => {
  test('minimizes the equal-weight normalized score', () => {
    // scores: a = (0 + 1 + 0)/3 ≈ 0.333 ; b = (1 + 0 + 1)/3 ≈ 0.667 ; c = (0.5 + 1 + 0.5)/3 ≈ 0.667
    const candidates = [
      candidate('a', 1000, 600, pm25(10)),
      candidate('b', 3000, 300, pm25(20)),
      candidate('c', 2000, 600, pm25(15)),
    ];
    expect(pickOptimal(candidates).id).toBe('a');
  });

  test('documented equal-pm behavior: equal pm25 (within 0.1 rounding) contributes a constant 0.5, so distance decides', () => {
    const candidates = [
      candidate('a', 1000, 500, pm25(12.31)),
      candidate('b', 2000, 500, pm25(12.34)),
    ];
    expect(pickOptimal(candidates).id).toBe('a');
  });

  test('all-equal inputs keep the first candidate (strict improvement required)', () => {
    const candidates = [
      candidate('a', 1000, 600, pm25(10)),
      candidate('b', 1000, 600, pm25(10)),
      candidate('c', 1000, 600, pm25(10)),
    ];
    expect(pickOptimal(candidates).id).toBe('a');
  });

  test('returns null (keep selection) when any candidate lacks an available pm25 value', () => {
    const candidates = [
      candidate('a', 1000, 600, pm25(10)),
      candidate('b', 2000, 600, { available: false }),
    ];
    expect(pickOptimal(candidates)).toBeNull();
  });
});

describe('preferenceNote (transparent-selection copy for the chips row)', () => {
  test('manual preference renders no row', () => {
    const candidates = [candidate('a', 1000, 600), candidate('b', 900, 1200)];
    expect(preferenceNote(PREFERENCES.MANUAL, candidates)).toEqual({ show: false, text: '' });
  });

  test('no candidates renders no row for any known preference', () => {
    expect(preferenceNote(PREFERENCES.FASTEST, [])).toEqual({ show: false, text: '' });
    expect(preferenceNote(PREFERENCES.OPTIMAL, [])).toEqual({ show: false, text: '' });
  });

  test('unknown preference returns null (loud at the call site)', () => {
    const candidates = [candidate('a', 1000, 600), candidate('b', 900, 1200)];
    expect(preferenceNote('whatever', candidates)).toBeNull();
  });

  test('single candidate shows the limited-comparison note (fastest active)', () => {
    const candidates = [candidate('only', 1000, 600, pm25(10))];
    const note = preferenceNote(PREFERENCES.FASTEST, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Only one route returned by the routing service — comparison is limited.');
  });

  test('single candidate with manual preference still renders no row', () => {
    const candidates = [candidate('only', 1000, 600, pm25(10))];
    expect(preferenceNote(PREFERENCES.MANUAL, candidates)).toEqual({ show: false, text: '' });
  });

  test('fastest always explains the rule, even when eligible', () => {
    const candidates = [candidate('a', 1000, 900), candidate('b', 2000, 720)];
    const note = preferenceNote(PREFERENCES.FASTEST, candidates);
    expect(note).toEqual({ show: true, text: 'Picks the route with the lowest travel time.' });
  });

  test('shortest always explains the rule, even when eligible', () => {
    const candidates = [candidate('a', 1000, 900), candidate('b', 2000, 720)];
    const note = preferenceNote(PREFERENCES.SHORTEST, candidates);
    expect(note).toEqual({ show: true, text: 'Picks the route with the lowest distance.' });
  });

  test('cleanest eligible states the modelled-PM2.5 rule', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5, { can_compare_cleanest: true })),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    const note = preferenceNote(PREFERENCES.CLEANEST, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Picks the route with the lowest modelled PM2.5 (µg/m³).');
  });

  test('cleanest ineligible says why the manual selection is kept', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5)),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    const note = preferenceNote(PREFERENCES.CLEANEST, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Cleanest needs comparable exposure estimates for all routes.');
  });

  test('cleanest ineligible with indistinguishable_across_routes uses the too-similar copy', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5, {
        can_compare_cleanest: false,
        indistinguishable_across_routes: true,
      })),
      candidate('b', 5000, 720, pm25(12.5, { can_compare_cleanest: false })),
    ];
    const note = preferenceNote(PREFERENCES.CLEANEST, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Exposure estimates are too similar to rank these routes reliably.');
  });

  test('optimal eligible states the equal-weight balance rule', () => {
    const candidates = [
      candidate('a', 1000, 600, pm25(10)),
      candidate('b', 3000, 300, pm25(20)),
    ];
    const note = preferenceNote(PREFERENCES.OPTIMAL, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Balances travel time, distance and exposure equally (1/3 each, normalised).');
  });

  test('optimal ineligible says why the manual selection is kept', () => {
    const candidates = [
      candidate('a', 1000, 600, pm25(10)),
      candidate('b', 2000, 600, { available: false }),
    ];
    const note = preferenceNote(PREFERENCES.OPTIMAL, candidates);
    expect(note.show).toBe(true);
    expect(note.text).toBe('Optimal needs an exposure estimate for every route.');
  });
});

describe('selectByPreference (App.js entry point)', () => {
  test('returns null for an empty candidate list', () => {
    expect(selectByPreference([], PREFERENCES.FASTEST)).toBeNull();
  });

  test('returns null for MANUAL preference (no automatic selection)', () => {
    const candidates = [candidate('a', 1000, 600), candidate('b', 900, 1200)];
    expect(selectByPreference(candidates, PREFERENCES.MANUAL)).toBeNull();
  });

  test('returns null for an unknown preference', () => {
    const candidates = [candidate('a', 1000, 600), candidate('b', 900, 1200)];
    expect(selectByPreference(candidates, 'whatever')).toBeNull();
  });

  test('with a single candidate, any preference selects that candidate (original behavior preserved)', () => {
    const candidates = [candidate('only', 1000, 600, { available: false })];
    expect(selectByPreference(candidates, PREFERENCES.CLEANEST).id).toBe('only');
    expect(selectByPreference(candidates, PREFERENCES.OPTIMAL).id).toBe('only');
    expect(selectByPreference(candidates, PREFERENCES.FASTEST).id).toBe('only');
  });

  test('delegates FASTEST correctly', () => {
    const candidates = [candidate('a', 4200, 900), candidate('b', 5000, 720)];
    expect(selectByPreference(candidates, PREFERENCES.FASTEST).id).toBe('b');
  });

  test('delegates SHORTEST correctly', () => {
    const candidates = [candidate('a', 3800, 1500), candidate('b', 5000, 720)];
    expect(selectByPreference(candidates, PREFERENCES.SHORTEST).id).toBe('a');
  });

  test('delegates CLEANEST and keeps selection (null) when ineligible', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5)),
      candidate('b', 5000, 720, pm25(9.1, { can_compare_cleanest: true })),
    ];
    expect(selectByPreference(candidates, PREFERENCES.CLEANEST)).toBeNull();
  });

  test('delegates OPTIMAL and keeps selection (null) when pm25 data is incomplete', () => {
    const candidates = [
      candidate('a', 4000, 900, pm25(12.5)),
      candidate('b', 5000, 720, null),
    ];
    expect(selectByPreference(candidates, PREFERENCES.OPTIMAL)).toBeNull();
  });
});
