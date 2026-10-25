// Pure-layout suite for src/lib/heatmapLayout.js — the month-label placement
// plan + shared explicit content width for the Profile streak heatmap.
//
// The fixture is built with the REAL streakCalendarHeatmap helper (injected
// `now`, no live clock), so the plan is exercised against exactly the shape
// ProfileScreen feeds it. Expectations are derived from the fixture (never
// guessed): the skip-rule expectation is re-implemented independently in the
// test from heat.months + the module constants. A small SYNTHETIC heat is
// used only where the real helper's 365-day geometry cannot produce the
// close-label branch (see that test for why).
import { streakCalendarHeatmap } from '../lib/stats';
import {
  CELL_SIZE,
  CELL_GAP,
  WEEK_PITCH,
  WEEKDAY_COL_WIDTH,
  WEEKDAY_GUTTER,
  MONTH_LABEL_MIN_CLEARANCE_PX,
  LABEL_ROW_HEIGHT,
  GRID_TAIL_PAD,
  computeMonthLabelPlan,
  computeContentWidth,
} from '../lib/heatmapLayout';

// Fixed local noon so the "today" key is stable in every timezone — the same
// convention the stats suites use. Oct 25 2026.
const NOW = new Date(2026, 9, 25, 12);

// A few trips spread across the year: they drive levels/first-trip history
// (so the heat is a realistic one), while the month GROUP sizes follow from
// the injected window alone (Oct 26 2025 → Oct 25 2026, yielding groups of
// varying week counts).
const TRIPS = [
  { date: '2025-10-26T10:00:00' },
  { date: '2025-11-08T08:00:00' },
  { date: '2025-12-14T09:00:00' },
  { date: '2025-12-15T07:00:00' },
  { date: '2026-02-03T06:30:00' },
  { date: '2026-04-19T18:00:00' },
  { date: '2026-06-20T12:00:00' },
  { date: '2026-08-09T07:15:00' },
];

// Same determination the screen makes: the 24px clearance rule re-derived
// independently from heat.months (the honest way to run across the module —
// it is tested against the formula, not against itself).
const expectedPlan = (heat) => {
  const labels = [];
  const skipped = [];
  let startWeekIndex = 0;
  let lastRenderedX = null;
  for (const m of heat.months) {
    const x = 34 + 4 + startWeekIndex * 16;
    if (lastRenderedX === null || x - lastRenderedX >= 24) {
      labels.push({ label: m.label, x });
      lastRenderedX = x;
    } else {
      skipped.push(m.label);
    }
    startWeekIndex += m.weeks.length;
  }
  return { labels, skipped };
};

// Indices (into heat.months) of the groups that got rendered labels —
// rendered-label order and month-group order only diverge at skips.
const renderedGroupIndices = (heat) => {
  const out = [];
  let startWeekIndex = 0;
  let lastRenderedX = null;
  heat.months.forEach((m, i) => {
    const x = 34 + 4 + startWeekIndex * 16;
    if (lastRenderedX === null || x - lastRenderedX >= 24) {
      out.push(i);
      lastRenderedX = x;
    }
    startWeekIndex += m.weeks.length;
  });
  return out;
};

describe('heatmapLayout constants', () => {
  test('geometry constants are self-consistent (square cell, pitch = cell + gap)', () => {
    expect(CELL_SIZE).toBe(13);
    expect(CELL_GAP).toBe(3);
    expect(WEEK_PITCH).toBe(CELL_SIZE + CELL_GAP); // 16 — one week column step
    expect(WEEKDAY_COL_WIDTH).toBe(34);
    expect(WEEKDAY_GUTTER).toBe(4);
    expect(MONTH_LABEL_MIN_CLEARANCE_PX).toBe(24); // 'Oct' @9.5px ≈ 20–22px + 2px breath
    expect(LABEL_ROW_HEIGHT).toBe(14); // === streakMonthLabel lineHeight
    expect(GRID_TAIL_PAD).toBe(6);
    expect(typeof WEEK_PITCH).toBe('number');
    expect(typeof computeMonthLabelPlan).toBe('function');
    expect(typeof computeContentWidth).toBe('function');
  });
});

describe('computeMonthLabelPlan (real heat fixture, now = Oct 25 2026 12:00 local)', () => {
  const heat = streakCalendarHeatmap(TRIPS, NOW);

  test('fixture sanity: the window has month groups of differing week counts', () => {
    expect(heat.months.length).toBeGreaterThanOrEqual(2);
    const sizeSet = new Set(heat.months.map((m) => m.weeks.length));
    expect(sizeSet.size).toBeGreaterThan(1); // groups differ in size, per the fixture brief
  });

  test('plan matches the independently-derived expectation for the full fixture', () => {
    const plan = computeMonthLabelPlan(heat);
    expect(plan).toEqual(expectedPlan(heat));
    // The fixture must actually exercise BOTH branches somewhere: at least
    // one rendered label and (because this window starts on a Sunday in
    // late Oct, giving a 1-week first group followed by a 4-week Nov group
    // at x offset 16 < 24) the helper must skip at least one label.
    expect(plan.labels.length).toBeGreaterThan(0);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(plan.labels.length + plan.skipped.length).toBe(heat.months.length);
  });

  test('rendered x positions increase monotonically with ≥ 24px clearance between neighbors', () => {
    const { labels } = computeMonthLabelPlan(heat);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].x).toBeGreaterThan(labels[i - 1].x);
      expect(labels[i].x - labels[i - 1].x).toBeGreaterThanOrEqual(MONTH_LABEL_MIN_CLEARANCE_PX);
    }
  });

  test('x formula spot-checks: first group and one mid group', () => {
    const { labels } = computeMonthLabelPlan(heat);
    // First group: startWeekIndex 0 → x is exactly column + gutter.
    expect(labels[0].x).toBe(WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER);
    expect(labels[0].x).toBe(38);
    // One mid RENDERED label (index 4, well inside the year): map it back to
    // its month-group index (the two orders diverge wherever a label was
    // skipped), then x must equal the column+gutter offset plus the total
    // weeks BEFORE that group × pitch — summed from the fixture itself, not
    // from the helper.
    const idx = 4;
    const groupIdx = renderedGroupIndices(heat)[idx];
    const weeksBefore = heat.months.slice(0, groupIdx).reduce((s, m) => s + m.weeks.length, 0);
    const rendered = labels[idx].x;
    expect(rendered).toBe(WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER + weeksBefore * WEEK_PITCH);
    // ...and whatever groups before it were skipped, the rendered neighbor
    // still clears by the rule.
    if (idx > 0) {
      expect(rendered - labels[idx - 1].x).toBeGreaterThanOrEqual(MONTH_LABEL_MIN_CLEARANCE_PX);
    }
  });
});

describe('computeContentWidth', () => {
  const heat = streakCalendarHeatmap(TRIPS, NOW);

  test('equals column + gutter + totalWeeks × 16, plus exactly the 6px tail when requested', () => {
    const totalWeeks = heat.months.reduce((s, m) => s + m.weeks.length, 0);
    const base = WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER + totalWeeks * WEEK_PITCH;
    expect(computeContentWidth(heat, false)).toBe(base);
    expect(computeContentWidth(heat, true)).toBe(base + GRID_TAIL_PAD);
  });

  test('labels can never be clipped at the right edge: contentWidth > last rendered x (with room beyond the glyph run)', () => {
    const { labels } = computeMonthLabelPlan(heat);
    const contentWidth = computeContentWidth(heat, true);
    const lastX = labels[labels.length - 1].x;
    expect(contentWidth).toBeGreaterThan(lastX);
    // Stronger right-edge sanity for THIS fixture (last group is a
    // multi-week Oct block, so there is real room): the last label's onset
    // plus an approximate 22px glyph run still lands inside the grid width
    // (contentWidth minus the 6px tail is what the row shares with the
    // grid), i.e. nothing renders past the shared content edge.
    expect(lastX + 22).toBeLessThanOrEqual(contentWidth - GRID_TAIL_PAD);
  });
});

describe('skip rule exercised deterministically (synthetic close-label heat)', () => {
  test('a label closer than 24px to the last RENDERED label is skipped, not squeezed', () => {
    // The real 365-day helper can only produce a 1-week group at the window
    // start, so to pin the skip BRANCH we feed the pure function a synthetic
    // heat of three 1-week groups: nodes are inert (only .label + weeks
    // lengths are read).
    const oneWeekGroup = (label, startKey) => ({
      label,
      startKey,
      weeks: [[null, null, null, null, null, null, null]],
    });
    const heat = {
      months: [
        oneWeekGroup('Oct', '2025-10-26'), // x = 38 (first → always renders)
        oneWeekGroup('Nov', '2025-11-02'), // x = 54 → 16 < 24 → SKIPPED
        oneWeekGroup('Dec', '2025-11-09'), // x = 70 → 70-38 = 32 ≥ 24 → renders
      ],
    };
    const plan = computeMonthLabelPlan(heat);
    expect(plan.labels).toEqual([{ label: 'Oct', x: 38 }, { label: 'Dec', x: 70 }]);
    expect(plan.skipped).toEqual(['Nov']);
    // 'Nov' is absent from the rendered labels but present in skipped: the
    // dashboard never invents room for it, it is honestly absent.
    expect(plan.labels.map((l) => l.label)).not.toContain('Nov');
  });

  test('empty/shapeless heat degrades to no labels and the minimum content width', () => {
    expect(computeMonthLabelPlan({ months: [] })).toEqual({ labels: [], skipped: [] });
    expect(computeMonthLabelPlan(null)).toEqual({ labels: [], skipped: [] });
    expect(computeContentWidth({ months: [] }, false)).toBe(38);
    expect(computeContentWidth({ months: [] }, true)).toBe(44);
  });
});
