// ---------------------------------------------------------------------------
// Pure layout planner for the Profile streak heatmap (src/screens/
// ProfileScreen.js). NO react-native imports and NO clock: the only input is
// the heatmap value produced by streakCalendarHeatmap (src/lib/stats.js) —
// { months: [{ label, startKey, weeks }] } — so the plan is deterministic and
// fully unit-testable. This module is the single source of truth for the
// heatmap's numeric geometry; theme/styles.js keeps only styling tokens.
// ---------------------------------------------------------------------------

// One activity tile is exactly square: width = height = CELL_SIZE.
export const CELL_SIZE = 13;
export const CELL_GAP = 3;
// One week column step = cell + margin (13 + 3). Exported as its own number
// (mirroring the 13/3 pairs in styles.js) so label math never re-derives it.
export const WEEK_PITCH = CELL_SIZE + CELL_GAP; // 16

// Weekday label column (7 rows of 3-letter day names) + the gap between that
// column and the first week column.
export const WEEKDAY_COL_WIDTH = 34;
export const WEEKDAY_GUTTER = 4;

// Minimum horizontal clearance BETWEEN RENDERED month labels. Coincidence
// note: 24px happens to equal one week pitch, but the token is a typographic
// clearance, not a pitch. Rationale: a 3-letter month label such as 'Oct'
// rendered at ~9.5px is roughly 20–22px of glyph run, plus 2px of breathing
// room — so two labels whose onsets sit closer than 24px visually run
// together / touch. This is exactly what the user saw for 'Oct'/'Nov' when
// short month groups handed each label a 16–32px box.
export const MONTH_LABEL_MIN_CLEARANCE_PX = 24;

// Fixed height of the absolutely-positioned month label row (matches the
// streakMonthLabel lineHeight of 14 in theme/styles.js).
export const LABEL_ROW_HEIGHT = 14;

// Small right-edge pad added to the grid's content width so the final column
// never kisses the scroll viewport's edge.
export const GRID_TAIL_PAD = 6;

// Month label placement plan.
//
// x coordinates: label i sits over its own month group's first week column,
//   x = WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER + (startWeekIndex × WEEK_PITCH),
// where startWeekIndex = total number of week columns in all groups BEFORE
// that group (the first group has startWeekIndex 0).
//
// SKIP RULE (deliberate, LeetCode-style clearance — honest and
// deterministic): a label is rendered only if its x is at least
// MONTH_LABEL_MIN_CLEARANCE_PX to the right of the LAST RENDERED label's x
// (the first group always renders). Groups are iterated strictly left →
// right, so a short month sandwiched between two rendered neighbors may
// simply get no label rather than a label that would collide with them.
// Nothing is stretched or invented to "make room" — the row is left with a
// wider gap where the skipped label would have been.
//
// Returns { labels: [{ label, x }...] (rendered only, in order),
//           skipped: [label strings not rendered] }.
export function computeMonthLabelPlan(heat) {
  const months = (heat && Array.isArray(heat.months)) ? heat.months : [];

  const labels = [];
  const skipped = [];
  let startWeekIndex = 0;
  let lastRenderedX = null;

  for (const group of months) {
    const x = WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER + startWeekIndex * WEEK_PITCH;
    // First group always renders (lastRenderedX null); thereafter the label
    // must clear the last rendered one by the minimum clearance.
    if (lastRenderedX === null || x - lastRenderedX >= MONTH_LABEL_MIN_CLEARANCE_PX) {
      labels.push({ label: group.label, x });
      lastRenderedX = x;
    } else {
      skipped.push(group.label);
    }
    startWeekIndex += group.weeks.length;
  }

  return { labels, skipped };
}

// Explicit content width for BOTH the month-label row and the grid assembly,
// so the two rows can never truncate independently at the ScrollView's
// content edge (the right-edge clipping defect this fixes):
//   WEEKDAY_COL_WIDTH + WEEKDAY_GUTTER + totalWeeks × WEEK_PITCH (+ tail pad).
// totalWeeks = sum of every month group's week-column count.
export function computeContentWidth(heat, includeTailPad) {
  const months = (heat && Array.isArray(heat.months)) ? heat.months : [];
  const totalWeeks = months.reduce((sum, group) => sum + group.weeks.length, 0);
  return (
    WEEKDAY_COL_WIDTH +
    WEEKDAY_GUTTER +
    totalWeeks * WEEK_PITCH +
    (includeTailPad ? GRID_TAIL_PAD : 0)
  );
}
