import { MET_BY_MODE, lifetimeStats, dayKey, streakCalendar } from '../lib/stats';

describe('lifetimeStats', () => {
  const walkingTrips = [
    { id: '1', date: '2026-01-01T00:00:00Z', mode: 'walking', actualDistanceM: 1200, durationSec: 900 },
    { id: '2', date: '2026-01-02T00:00:00Z', mode: 'walking', actualDistanceM: 800.5, durationSec: 600 },
    { id: '3', date: '2026-01-03T00:00:00Z', mode: 'walking', actualDistanceM: 2500, durationSec: 2100 },
  ];

  test('sums distance, time and counts trips', () => {
    const s = lifetimeStats(walkingTrips, {});
    expect(s.distanceM).toBe(4500.5);
    expect(s.timeSec).toBe(3600);
    expect(s.tripCount).toBe(3);
  });

  test('two 0.5h walking trips at weightKg 70 give 245 kcal (3.5 * 70 * 1h)', () => {
    const trips = [
      { mode: 'walking', actualDistanceM: 2000, durationSec: 1800 },
      { mode: 'walking', actualDistanceM: 2000, durationSec: 1800 },
    ];
    const s = lifetimeStats(trips, { weightKg: '70' });
    // Summed per trip (3.5 * 70 * 0.5) and totaled: exactly 245.
    expect(s.kcal).toBe(245);
  });

  test('cycling uses MET 7.0', () => {
    const s = lifetimeStats(
      [{ mode: 'cycling', actualDistanceM: 10000, durationSec: 3600 }],
      { weightKg: '70' }
    );
    expect(s.kcal).toBeCloseTo(7.0 * 70, 6);
  });

  test('unknown modes fall back to walking MET (most conservative)', () => {
    const s = lifetimeStats([{ mode: 'driving', durationSec: 3600 }], { weightKg: 70 });
    expect(s.kcal).toBeCloseTo(3.5 * 70, 6);
  });

  test.each([
    ['empty string', ''],
    ['non-numeric string', 'abc'],
    ['negative string', '-5'],
    ['zero string', '0'],
    ['undefined', undefined],
    ['NaN number', NaN],
    ['negative number', -5],
  ])('weightKg %s yields kcal null', (_label, w) => {
    const s = lifetimeStats(walkingTrips, { weightKg: w });
    expect(s.kcal).toBeNull();
  });

  test('missing profile yields kcal null', () => {
    expect(lifetimeStats(walkingTrips, undefined).kcal).toBeNull();
    expect(lifetimeStats(walkingTrips, null).kcal).toBeNull();
  });

  test('malformed trip records are handled defensively (no NaN poisoning)', () => {
    const s = lifetimeStats(
      [{ mode: 'walking' }, null, { actualDistanceM: 100, durationSec: NaN }],
      { weightKg: '70' }
    );
    expect(s.distanceM).toBe(100);
    expect(s.timeSec).toBe(0);
    expect(s.tripCount).toBe(3);
    expect(Number.isFinite(s.kcal)).toBe(true);
  });

  test('no trips (empty array or missing) gives all-nulls/zeros and tripCount 0', () => {
    const empty = lifetimeStats([], { weightKg: '70' });
    expect(empty.distanceM).toBe(0);
    expect(empty.timeSec).toBe(0);
    expect(empty.tripCount).toBe(0);
    expect(empty.kcal).toBe(0);
    expect(empty.exposureUgM3).toBeNull();
    expect(MET_BY_MODE.x).toBeUndefined();

    const missing = lifetimeStats(undefined, {});
    expect(missing.tripCount).toBe(0);
    expect(missing.kcal).toBeNull();
    expect(missing.distanceM).toBe(0);
    expect(missing.timeSec).toBe(0);
    expect(missing.exposureUgM3).toBeNull();
  });

  test('today records (no pm fields) keep exposureUgM3 null', () => {
    const s = lifetimeStats(walkingTrips, { weightKg: '70' });
    expect(s.exposureUgM3).toBeNull();
  });

  test('future-compat: plain mean of pm fields present, ignoring trips without them', () => {
    const future = [
      { mode: 'walking', durationSec: 600, pm25: 76.8 },
      { mode: 'walking', durationSec: 1200, pm25: 80.1 },
      { mode: 'walking' }, // no air fields — excluded from the mean
      { mode: 'cycling', pm25Estimate: 10 }, // alternate field counts too
    ];
    const s = lifetimeStats(future, {});
    expect(s.exposureUgM3).toBeCloseTo((76.8 + 80.1 + 10) / 3, 6);
  });

  test('future-compat: a single trip with only exposureUgM3 yields that value', () => {
    const s = lifetimeStats([{ mode: 'walking', exposureUgM3: 42 }], {});
    expect(s.exposureUgM3).toBeCloseTo(42, 6);
  });

  test('future-compat: non-finite pm values do not leak into the mean', () => {
    const s = lifetimeStats(
      [
        { mode: 'walking', pm25: NaN },
        { mode: 'walking', pm25: 'junk' },
        { mode: 'walking', pm25: 50 },
      ],
      {}
    );
    expect(s.exposureUgM3).toBeCloseTo(50, 6);
  });

  test('MET_BY_MODE exposes the documented weights', () => {
    expect(MET_BY_MODE).toEqual({ walking: 3.5, cycling: 7.0 });
  });
});

describe('dayKey', () => {
  test('formats local calendar dates with zero padding (YYYY-MM-DD)', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 10, 21))).toBe('2026-11-21');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  test('accepts ms-since-epoch input', () => {
    const d = new Date(2026, 0, 9, 15, 30);
    expect(dayKey(d.getTime())).toBe('2026-01-09');
  });

  test('uses LOCAL date parts, never a UTC-shifted day (tz/DST safe)', () => {
    // 23:30 UTC can land on the next (or previous) local calendar day; the
    // label must follow the local wall clock in any test environment.
    const local = new Date(Date.UTC(2026, 5, 20, 23, 30));
    const expected =
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(dayKey(local)).toBe(expected);
  });

  test('unparseable input yields null so callers can skip it silently', () => {
    expect(dayKey('not-a-date')).toBeNull();
  });
});

describe('streakCalendar', () => {
  // Fixed local noon so the "today" key is stable in every timezone.
  const NOW = new Date(2026, 5, 20, 12); // Jun 20 2026, local

  test('returns 365 cells with the last one keyed as today, stepping one day at a time', () => {
    const r = streakCalendar([], NOW);
    expect(r.cells).toHaveLength(365);
    expect(r.cells[364].key).toBe('2026-06-20');
    expect(r.cells[363].key).toBe('2026-06-19');
    expect(r.cells[0].key).toBe('2025-06-21'); // 364 days before today
  });

  test('counts completed trips per day and bins levels 0-3', () => {
    const r = streakCalendar(
      [
        { id: '1', date: '2026-06-17T08:00:00', mode: 'walking', actualDistanceM: 900, durationSec: 700 },
        { id: '2', date: '2026-06-17T18:00:00', mode: 'walking', actualDistanceM: 900, durationSec: 700 },
        { id: '3', date: '2026-06-19T08:00:00', mode: 'cycling', actualDistanceM: 1000, durationSec: 600 },
      ],
      NOW
    );
    const byKey = new Map(r.cells.map((c) => [c.key, c]));
    expect(byKey.get('2026-06-17')).toMatchObject({ count: 2, level: 2, inHistory: true });
    expect(byKey.get('2026-06-19')).toMatchObject({ count: 1, level: 1, inHistory: true });
    expect(byKey.get('2026-06-20')).toMatchObject({ count: 0, level: 0, inHistory: true });
  });

  test('level 3 at three or more trips in one day', () => {
    const r = streakCalendar(
      [
        { date: '2026-06-20T07:00:00' },
        { date: '2026-06-20T12:00:00' },
        { date: '2026-06-20T19:00:00' },
      ],
      NOW
    );
    expect(r.cells[364].level).toBe(3);
    expect(r.cells[364].count).toBe(3);
  });

  test('inHistory is false strictly before the first trip day, true after; all-false with no trips', () => {
    const r = streakCalendar(
      [
        { date: '2026-06-18T10:00:00' },
        { date: '2026-06-20T10:00:00' },
      ],
      NOW
    );
    const byKey = new Map(r.cells.map((c) => [c.key, c]));
    expect(byKey.get('2026-06-17').inHistory).toBe(false);
    expect(byKey.get('2026-06-17').level).toBe(0);
    expect(byKey.get('2026-06-18').inHistory).toBe(true);
    expect(byKey.get('2026-06-20').inHistory).toBe(true);

    const empty = streakCalendar([], NOW);
    expect(empty.cells.every((c) => !c.inHistory)).toBe(true);
  });

  test('malformed dates are skipped silently and never poison counts', () => {
    const r = streakCalendar(
      [{ date: 'garbage' }, { date: null }, {}, { date: '2026-06-20T10:00:00' }],
      NOW
    );
    expect(r.cells[364].count).toBe(1);
    expect(r.firstTripDate).toBe('2026-06-20');
  });

  test('firstTripDate is the earliest valid trip day key', () => {
    const r = streakCalendar(
      [
        { date: '2026-06-15T10:00:00' },
        { date: '2026-06-12T10:00:00' },
        { date: '2026-06-18T10:00:00' },
      ],
      NOW
    );
    expect(r.firstTripDate).toBe('2026-06-12');
  });

  test('currentStreak: trips today extend the run (today + yesterday = 2)', () => {
    const r = streakCalendar(
      [{ date: '2026-06-19T10:00:00' }, { date: '2026-06-20T10:00:00' }],
      NOW
    );
    expect(r.currentStreak).toBe(2);
  });

  test('currentStreak grace: zero today but active yesterday still counts', () => {
    const r = streakCalendar([{ date: '2026-06-19T10:00:00' }], NOW);
    expect(r.currentStreak).toBe(1);
  });

  test('currentStreak is 0 when both today and yesterday have no trips', () => {
    const r = streakCalendar([{ date: '2026-06-17T10:00:00' }], NOW);
    expect(r.currentStreak).toBe(0);
  });

  test('longestStreak spans a gap: a 3-day run beats a 1-day run elsewhere', () => {
    // Mar 7-9, 2026 crosses the US spring-forward DST boundary; with
    // Math.round(ms / 86400000) day diffs, consecutive calendar days still
    // step by exactly 1 and the run stays intact.
    const r = streakCalendar(
      [
        { date: '2026-03-07T10:00:00' },
        { date: '2026-03-08T10:00:00' },
        { date: '2026-03-09T10:00:00' },
        { date: '2026-03-11T10:00:00' },
      ],
      NOW
    );
    expect(r.longestStreak).toBe(3);
  });

  test('longestStreak handles a Nov DST fall-back boundary without off-by-one', () => {
    // Nov 1, 2026 is the US fall-back date: rounding the ms day-diff keeps
    // 23h/25h local days pairing as consecutive calendar days.
    const r = streakCalendar(
      [
        { date: '2026-10-31T10:00:00' },
        { date: '2026-11-01T10:00:00' },
        { date: '2026-11-02T10:00:00' },
      ],
      NOW
    );
    expect(r.longestStreak).toBe(3);
  });

  test('streaks stay honest for a brand-new user (no fabricated activity)', () => {
    const r = streakCalendar([], NOW);
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(0);
    expect(r.firstTripDate).toBeNull();
    expect(r.cells.every((c) => c.count === 0 && c.level === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Achievements + week summary (ADD-only additions; everything above is the
// pre-existing suite, unchanged). These run in local time implicitly — the
// '2026-06-…T10:00:00' strings parse as LOCAL dates, matching dayKey().
// ---------------------------------------------------------------------------
import { computeBadges, weekSummary } from '../lib/stats';

describe('computeBadges', () => {
  // Fixed local noon like the streakCalendar suite so "today" is stable.
  const BADGE_NOW = new Date(2026, 5, 20, 12); // Jun 20 2026, local

  // Three consecutive active days ENDING at BADGE_NOW (today has trips, so
  // currentStreak runs Jun 18-20 = 3; longest is also 3).
  const threeDayRun = [
    { id: '1', date: '2026-06-18T10:00:00', mode: 'walking', actualDistanceM: 900, durationSec: 600 },
    { id: '2', date: '2026-06-19T10:00:00', mode: 'walking', actualDistanceM: 900, durationSec: 600 },
    { id: '3', date: '2026-06-20T10:00:00', mode: 'cycling', actualDistanceM: 1200, durationSec: 900 },
  ];

  const byId = (badges) => new Map(badges.map((b) => [b.id, b]));

  test('empty trips: seven badges, all current 0 and not earned', () => {
    const badges = computeBadges([], BADGE_NOW);
    expect(badges).toHaveLength(7);
    for (const b of badges) {
      expect(b.current).toBe(0);
      expect(b.earned).toBe(false);
    }
    // Rows stay in their defined order.
    expect(badges.map((b) => b.id)).toEqual([
      'first-trip', 'five-trips', 'streak-3', 'streak-7', 'dist-25', 'dist-100', 'time-6',
    ]);
  });

  test('exactly one trip earns first-trip at the boundary', () => {
    const b = byId(computeBadges([{ date: '2026-06-20T10:00:00' }], BADGE_NOW));
    expect(b.get('first-trip').target).toBe(1);
    expect(b.get('first-trip').current).toBe(1);
    expect(b.get('first-trip').earned).toBe(true);
    expect(b.get('five-trips').current).toBe(1);
    expect(b.get('five-trips').earned).toBe(false);
  });

  test('exactly five trips earns five-trips', () => {
    const trips = Array.from({ length: 5 }, (_, i) => ({ date: `2026-06-${10 + i}T10:00:00` }));
    const b = byId(computeBadges(trips, BADGE_NOW));
    expect(b.get('five-trips').current).toBe(5);
    expect(b.get('five-trips').earned).toBe(true);
  });

  test('a 3-day consecutive run earns streak-3 but not streak-7 (current vs longest reach)', () => {
    const b = byId(computeBadges(threeDayRun, BADGE_NOW));
    expect(b.get('streak-3').current).toBe(3);
    expect(b.get('streak-3').earned).toBe(true);
    expect(b.get('streak-7').current).toBe(3); // longest is also 3 here
    expect(b.get('streak-7').earned).toBe(false);
  });

  test('streak-3 uses the CURRENT streak, not the all-time longest', () => {
    // The 3-day run is history; today/yesterday are empty so the current
    // streak is 0 (grace day only reaches yesterday) even though 3 was hit.
    const oldRun = [
      { id: '1', date: '2026-06-10T10:00:00', mode: 'walking' },
      { id: '2', date: '2026-06-11T10:00:00', mode: 'walking' },
      { id: '3', date: '2026-06-12T10:00:00', mode: 'walking' },
    ];
    const b = byId(computeBadges(oldRun, BADGE_NOW));
    expect(b.get('streak-3').current).toBe(0);
    expect(b.get('streak-3').earned).toBe(false);
  });

  test('streak-7 uses the all-time longest streak', () => {
    // Longest run of 8 days (Jun 1-8); currently broken, so streak-3 is not
    // earned while streak-7 is (its current = longestStreak).
    const trips = Array.from({ length: 8 }, (_, i) => ({
      id: String(i + 1),
      date: `2026-06-0${i + 1}T10:00:00`,
    }));
    const b = byId(computeBadges(trips, BADGE_NOW));
    expect(b.get('streak-3').earned).toBe(false);
    expect(b.get('streak-7').current).toBe(8);
    expect(b.get('streak-7').earned).toBe(true);
  });

  test('distance badges hit at exactly 25000 m and 100000 m, not below', () => {
    const exact = byId(computeBadges([{ date: '2026-06-20T10:00:00', actualDistanceM: 25000 }], BADGE_NOW));
    expect(exact.get('dist-25').earned).toBe(true);
    expect(exact.get('dist-100').current).toBe(25000);
    expect(exact.get('dist-100').earned).toBe(false);

    const short = byId(computeBadges([{ date: '2026-06-20T10:00:00', actualDistanceM: 24999 }], BADGE_NOW));
    expect(short.get('dist-25').earned).toBe(false);

    const century = byId(computeBadges([{ date: '2026-06-20T10:00:00', actualDistanceM: 100000 }], BADGE_NOW));
    expect(century.get('dist-100').earned).toBe(true);
  });

  test('time-6 badge hits at exactly 21600 s of tracked movement', () => {
    const exact = byId(computeBadges(
      [{ date: '2026-06-20T10:00:00', durationSec: 21600 }],
      BADGE_NOW
    ));
    expect(exact.get('time-6').current).toBe(21600);
    expect(exact.get('time-6').earned).toBe(true);
  });

  test('distance/time badges sum across trips and modes (no weight needed)', () => {
    const trips = [
      { date: '2026-06-19T10:00:00', mode: 'walking', actualDistanceM: 15000, durationSec: 11000 },
      { date: '2026-06-20T10:00:00', mode: 'cycling', actualDistanceM: 10000, durationSec: 11000 },
    ];
    const b = byId(computeBadges(trips, BADGE_NOW));
    expect(b.get('dist-25').current).toBe(25000);
    expect(b.get('time-6').current).toBe(22000);
    expect(b.get('dist-25').earned).toBe(true);
  });

  test('malformed trips are skipped defensively: no NaN currents, junk numbers contribute 0', () => {
    const badges = computeBadges(
      [
        { date: 'garbage', mode: 'walking', actualDistanceM: 'junk', durationSec: NaN },
        null,
        { id: 'ok', date: '2026-06-20T10:00:00', mode: 'walking', actualDistanceM: 1000, durationSec: 600 },
      ],
      BADGE_NOW
    );
    for (const b of badges) {
      expect(Number.isFinite(b.current)).toBe(true);
    }
    const b = byId(badges);
    expect(b.get('dist-25').current).toBe(1000); // junk distance contributes nothing
    expect(b.get('time-6').current).toBe(600);
    expect(b.get('first-trip').current).toBe(3); // records counted, values sanitized
  });

  test('every badge carries an honest short description', () => {
    const badges = computeBadges([], BADGE_NOW);
    for (const b of badges) {
      expect(typeof b.label).toBe('string');
      expect(b.label.length).toBeGreaterThan(0);
      expect(typeof b.description).toBe('string');
      expect(b.description.length).toBeGreaterThan(0);
      expect(b.target).toBeGreaterThan(0);
    }
  });
});

describe('weekSummary', () => {
  const WEEK_NOW = new Date(2026, 9, 21, 12); // Oct 21 2026, local noon

  test('empty trips give zeros', () => {
    const w = weekSummary([], WEEK_NOW);
    expect(w.tripCount).toBe(0);
    expect(w.distanceM).toBe(0);
    const missing = weekSummary(undefined, WEEK_NOW);
    expect(missing.tripCount).toBe(0);
    expect(missing.distanceM).toBe(0);
  });

  test('counts only the last 7 calendar days including today', () => {
    const w = weekSummary(
      [
        { date: '2026-10-15T10:00:00', actualDistanceM: 2000 }, // day 7 back (oldest edge) — in
        { date: '2026-10-16T10:00:00', actualDistanceM: 1500 }, // in
        { date: '2026-10-21T08:00:00', actualDistanceM: 3500 }, // today — in
        { date: '2026-10-14T23:59:00', actualDistanceM: 9000 }, // 7+1 days back — out
        { date: '2026-09-01T10:00:00', actualDistanceM: 9000 }, // old — out
      ],
      WEEK_NOW
    );
    expect(w.tripCount).toBe(3);
    expect(w.distanceM).toBe(7000);
  });

  test('today included with multiple same-day trips', () => {
    const w = weekSummary(
      [
        { date: '2026-10-21T07:00:00', actualDistanceM: 500 },
        { date: '2026-10-21T18:00:00', actualDistanceM: 750 },
      ],
      WEEK_NOW
    );
    expect(w.tripCount).toBe(2);
    expect(w.distanceM).toBe(1250);
  });

  test('malformed records are skipped and never poison the sums', () => {
    const w = weekSummary(
      [
        { date: 'garbage', actualDistanceM: 500 },
        null,
        {},
        { date: '2026-10-20T10:00:00', actualDistanceM: 'junk' },
        { date: '2026-10-20T10:00:00', actualDistanceM: 1200, durationSec: 300 },
      ],
      WEEK_NOW
    );
    expect(w.tripCount).toBe(2); // two valid in-window records (junk-distance one still counts)
    expect(w.distanceM).toBe(1200);
  });
});
