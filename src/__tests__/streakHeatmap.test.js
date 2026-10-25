// Pure-layout suite for the Profile streak heatmap. Everything runs against
// the ADDITIVE streakCalendarHeatmap(trips, now) helper with an injected
// `now` — no live-clock content anywhere; the streakCalendar semantics
// themselves have their own suite in stats.test.js (touched not at all
// here).
import { streakCalendarHeatmap, streakCalendar } from '../lib/stats';

describe('streakCalendarHeatmap', () => {
  // Fixed local noon so the "today" key is stable in every timezone — the
  // same fixture date the streakCalendar suite uses.
  const NOW = new Date(2026, 5, 20, 12); // Jun 20 2026, local (Saturday)

  // Mirror of the helper's label table.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // 'YYYY-MM-DD' -> local Date built from Y/M/D only (never parses to UTC).
  const parseKey = (key) => {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };

  // Chronological slot list across the whole layout (month groups → weeks →
  // 7 rows), keeping null slots so structure checks can see the padding.
  const allWeeks = (hm) => hm.months.flatMap((m) => m.weeks);
  const realSlots = (hm) => allWeeks(hm).flat().filter((c) => c !== null);

  test('returns a plain JSON structure and is deterministic for the same injected now', () => {
    const trips = [{ date: '2026-06-17T10:00:00' }];
    const a = streakCalendarHeatmap(trips, NOW);
    const b = streakCalendarHeatmap(trips, NOW);
    // JSON-plain: the structure survives a stringify round-trip untouched.
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
    expect(Array.isArray(a.months)).toBe(true);
    expect(a.months.length).toBeGreaterThanOrEqual(2); // 365-day window guarantee
    for (const m of a.months) {
      expect(typeof m.label).toBe('string');
      expect(typeof m.startKey).toBe('string');
      expect(m.weeks.length).toBeGreaterThan(0);
      for (const week of m.weeks) expect(week).toHaveLength(7);
    }
  });

  test('the 365 real cells appear exactly once across all month groups (any window shape)', () => {
    for (const now of [new Date(2024, 0, 2, 12), NOW, new Date(2024, 1, 29, 12)]) {
      const real = realSlots(streakCalendarHeatmap([], now));
      expect(real).toHaveLength(365);
      expect(new Set(real.map((c) => c.key)).size).toBe(365);
    }
  });

  test('Sunday alignment: the first column starts on a Sunday, pre-window slots are null and match getDay of the first real day', () => {
    const hm = streakCalendarHeatmap([], NOW);
    const firstWeek = allWeeks(hm)[0];
    const firstRealIdx = firstWeek.findIndex((c) => c !== null);
    // Pre-window head: everything before the first real cell is null and the
    // virtual slot at row 0 lands on a Sunday when stepped back from it.
    for (let i = 0; i < firstRealIdx; i++) expect(firstWeek[i]).toBeNull();
    const slotZero = parseKey(firstWeek[firstRealIdx].key);
    slotZero.setDate(slotZero.getDate() - firstRealIdx); // local Y/M/D rollover
    expect(slotZero.getDay()).toBe(0);
    expect(firstWeek[firstRealIdx].key).toBe('2025-06-21'); // window start (Saturday)
    expect(firstRealIdx).toBe(6);
  });

  test('trailing future days after today render as null in the final week', () => {
    const now = new Date(2024, 0, 2, 12); // Tuesday
    const hm = streakCalendarHeatmap([], now);
    const weeks = allWeeks(hm);
    const lastWeek = weeks[weeks.length - 1];
    const todayIdx = lastWeek.findIndex((c) => c && c.key === '2024-01-02');
    expect(todayIdx).toBe(new Date(2024, 0, 2).getDay()); // row = getDay()
    for (let i = todayIdx + 1; i < 7; i++) expect(lastWeek[i]).toBeNull();
  });

  test('weekday placement via getDay: 2024-01-04 (Thursday) sits in row 4, 2024-01-07 (Sunday) in row 0, no leak into neighbor rows', () => {
    const now = new Date(2024, 4, 1, 12); // May 1 2024 — window covers early 2024
    const hm = streakCalendarHeatmap([], now);
    const weeks = allWeeks(hm);
    expect(parseKey('2024-01-04').getDay()).toBe(4); // fixture sanity
    expect(parseKey('2024-01-07').getDay()).toBe(0);

    const thuWeek = weeks.find((w) => w.some((c) => c && c.key === '2024-01-04'));
    expect(thuWeek[4].key).toBe('2024-01-04');
    expect(thuWeek[3].key).toBe('2024-01-03'); // Wednesday, same column
    expect(thuWeek[5].key).toBe('2024-01-05');

    const sunWeek = weeks.find((w) => w.some((c) => c && c.key === '2024-01-07'));
    expect(sunWeek[0].key).toBe('2024-01-07'); // Sunday opens the column
    expect(sunWeek[6].key).toBe('2024-01-13'); // column closes on Saturday
  });

  test('month binning follows each column\u2019s Wednesday (row 3): Feb 2024 / Mar 2024 groups are contiguous and the straddling column keeps adjacent days', () => {
    const now = new Date(2024, 4, 1, 12);
    const hm = streakCalendarHeatmap([], now);
    const labels = hm.months.map((m) => m.label);
    expect(labels).toContain('Feb');
    expect(labels).toContain('Mar');
    expect(labels.indexOf('Feb')).toBeLessThan(labels.indexOf('Mar'));

    // Spec rule: every column bins to its middle day's month.
    for (const m of hm.months) {
      const mi = MONTHS.indexOf(m.label);
      for (const week of m.weeks) {
        const middle = week[3] || week.find((c) => c !== null);
        expect(parseKey(middle.key).getMonth()).toBe(mi);
      }
    }

    // The leap month ends Feb 29 (Thursday) and Mar 1 (Friday) sits directly
    // below it in the same week column - the transition stays row-adjacent
    // inside one column (binned by that column's middle day), never reflowed
    // into separate columns by an off-by-one.
    const weeks = allWeeks(hm);
    const feb29Week = weeks.find((w) => w.some((c) => c && c.key === '2024-02-29'));
    expect(feb29Week[5].key).toBe('2024-03-01');
  });

  test('year boundary: 2023-12-31 (Sunday) and 2024-01-01 (Monday) share one column, binned deterministically', () => {
    const now = new Date(2024, 4, 1, 12);
    const hm = streakCalendarHeatmap([], now);
    const weeks = allWeeks(hm);
    const boundaryWeek = weeks.find((w) => w.some((c) => c && c.key === '2023-12-31'));
    expect(boundaryWeek[0].key).toBe('2023-12-31');
    expect(boundaryWeek[1].key).toBe('2024-01-01');
  });

  test('leap day 2024-02-29 exists inside a February group', () => {
    const now = new Date(2024, 4, 1, 12);
    const hm = streakCalendarHeatmap([], now);
    const feb = hm.months.find((m) => m.label === 'Feb');
    const keys = feb.weeks.flat().filter((c) => c !== null).map((c) => c.key);
    expect(keys).toContain('2024-02-29');
  });

  test('counts/aggregation: 1 / 2 / 3+ trips on a day produce levels 1 / 2 / 3 with matching counts', () => {
    const trips = [
      { date: '2026-06-17T08:00:00' },
      { date: '2026-06-17T18:00:00' },
      { date: '2026-06-19T10:00:00' },
      { date: '2026-06-20T07:00:00' },
      { date: '2026-06-20T12:00:00' },
      { date: '2026-06-20T19:00:00' },
    ];
    const hm = streakCalendarHeatmap(trips, NOW);
    const byKey = new Map(realSlots(hm).map((c) => [c.key, c]));
    expect(byKey.get('2026-06-17')).toEqual({ key: '2026-06-17', count: 2, level: 2, inHistory: true });
    expect(byKey.get('2026-06-19')).toEqual({ key: '2026-06-19', count: 1, level: 1, inHistory: true });
    expect(byKey.get('2026-06-20')).toEqual({ key: '2026-06-20', count: 3, level: 3, inHistory: true });
  });

  test('every real slot is value-identical to the cell streakCalendar produced (tiles can never disagree)', () => {
    const trips = [{ date: '2026-06-18T10:00:00' }, { date: '2026-06-19T10:00:00' }];
    const ring = streakCalendar(trips, NOW);
    const real = realSlots(streakCalendarHeatmap(trips, NOW));
    // Same key order and deep-equal cells for every one of the 365 slots.
    // (The helper embeds streakCalendar's own cell objects by construction;
    // a second call builds fresh objects, so identity-to-outside is not
    // assertable here - value parity is what tiles depend on.)
    expect(real.length).toBe(ring.cells.length);
    expect(real.map((c) => c.key)).toEqual(ring.cells.map((c) => c.key));
    for (let i = 0; i < real.length; i++) expect(real[i]).toEqual(ring.cells[i]);
  });

  test('malformed trip dates are skipped silently; undefined trips behaves as []', () => {
    const hm = streakCalendarHeatmap([{ date: 'garbage' }, {}, { date: '2026-06-20T10:00:00' }], NOW);
    const real = realSlots(hm);
    expect(real[real.length - 1]).toEqual({ key: '2026-06-20', count: 1, level: 1, inHistory: true });
    expect(real.filter((c) => c.count !== 0).map((c) => c.key)).toEqual(['2026-06-20']);
    expect(streakCalendarHeatmap(undefined, NOW)).toEqual(streakCalendarHeatmap([], NOW));
  });
});
