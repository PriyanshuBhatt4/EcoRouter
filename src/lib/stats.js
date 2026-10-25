// Pure lifetime-stat computation for the Profile screen. No React Native
// imports — this module must stay testable with plain Jest.

// Metabolic equivalent (MET) values used for the calorie estimate. These are
// ROUGH estimates only, tied to the user's reported body weight — not medical
// figures. Walking ~3.5 MET is the most conservative assumption and any mode
// without an entry falls back to it; cycling ~7.0 MET approximates moderate
// riding.
const MET_BY_MODE = { walking: 3.5, cycling: 7.0 };

// Only trust finite numbers: NaN, Infinity, non-numbers and inherited junk
// are all treated as absent (0) so one bad stored record can never poison
// the totals.
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseWeightKg(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Calorie honesty: kcal = MET * weightKg * hours, summed per trip. The body
// weight comes from a free-text field, so anything missing/non-numeric/
// non-positive means we show NO calorie figure at all rather than a
// misleading one.
function accumulateKcal(trip, weightKg) {
  const met = MET_BY_MODE[trip.mode] != null ? MET_BY_MODE[trip.mode] : MET_BY_MODE.walking;
  const hours = finiteNumber(trip.durationSec) / 3600;
  return met * weightKg * hours;
}

// Air figure per trip: completed trips written since the PM-capture milestone
// carry `plannedPm25` — the RAW value of the selected planned route's
// pm25_estimate at trip start (only present when the backend marked the
// estimate available and the value was finite; the App handler re-validates
// on both write paths). The older future-compat keys below still count for
// any legacy/experimental records, so the plain MEAN of the values PRESENT
// is exposed (no duration weighting). Units are the caller's concern for
// display; a trip without any finite air field is simply excluded.
function tripAirValue(trip) {
  for (const key of ['pm25', 'pm25Estimate', 'exposureUgM3', 'plannedPm25']) {
    const v = trip[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function lifetimeStats(trips, profile) {
  const list = Array.isArray(trips) ? trips : [];
  const tripCount = list.length;

  const distanceM = list.reduce((s, t) => s + finiteNumber(t && t.actualDistanceM), 0);
  const timeSec = list.reduce((s, t) => s + finiteNumber(t && t.durationSec), 0);

  const weightKg = parseWeightKg(profile && profile.weightKg);
  let kcal = null;
  if (weightKg !== null && weightKg > 0) {
    kcal = list.reduce((s, t) => s + (t ? accumulateKcal(t, weightKg) : 0), 0);
  }

  const airValues = [];
  for (const trip of list) {
    if (!trip) continue;
    const v = tripAirValue(trip);
    if (v !== null) airValues.push(v);
  }
  const exposureUgM3 =
    airValues.length > 0
      ? airValues.reduce((a, b) => a + b, 0) / airValues.length
      : null;

  return { distanceM, timeSec, tripCount, kcal, exposureUgM3 };
}

// ---------------------------------------------------------------------------
// Trip-activity streak calendar (Profile panel). Pure functions only — no
// React Native imports, stays testable with plain Jest.
// ---------------------------------------------------------------------------

// Two-digit pad helper for dayKey (01..09).
function pad2(n) {
  return n >= 10 ? String(n) : `0${n}`;
}

// 'YYYY-MM-DD' label for a trip timestamp, computed in LOCAL time on purpose.
// The streak calendar counts calendar days as the user experiences them; a
// UTC-based key would shift trips that happen near local midnight by a full
// day whenever the UTC date differs from the local one. Uses local
// getFullYear/getMonth/getDate so the label always matches the user's
// wall-clock calendar. Accepts a Date or a ms-since-epoch number; returns
// null for unparseable input so callers can skip malformed records silently.
export function dayKey(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Steps a day key by N calendar days using wall-clock date components (the
// Date constructor normalizes month/year rollover). Deliberately NOT raw
// 86400000 millisecond arithmetic: across a DST transition a local day is
// 23h or 25h, so ms stepping can skip or repeat a calendar date when
// building the grid.
function shiftDayKey(key, deltaDays) {
  const parts = key.split('-');
  return dayKey(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + deltaDays));
}

// Heat level for a day with `count` completed trips: 0 = none, 1 = one,
// 2 = two, 3 = three or more.
function levelForCount(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

// Builds the 365-day activity grid plus streak figures for the Profile
// panel. `now` is injectable so tests are deterministic; nothing here reads
// the clock on its own.
export function streakCalendar(trips, now = new Date()) {
  const src = Array.isArray(trips) ? trips : [];

  // dayKey -> number of completed trips that day; malformed dates are
  // skipped silently so one bad stored record cannot poison the grid.
  const counts = new Map();
  let firstTripDate = null;
  for (const t of src) {
    if (!t || !t.date) continue;
    const parsed = new Date(t.date);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKey(parsed);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (firstTripDate === null || key < firstTripDate) firstTripDate = key;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const todayKey = dayKey(nowDate);
  if (todayKey === null) {
    return { cells: [], currentStreak: 0, longestStreak: 0, firstTripDate };
  }

  // 365 daily cells ending at today. Walk back one calendar day at a time
  // via shiftDayKey so DST-shifted days cannot merge in the grid.
  const cells = new Array(365);
  let cursor = todayKey;
  for (let i = 364; i >= 0; i--) {
    const count = counts.get(cursor) || 0;
    // Honesty rule: days BEFORE the user's earliest saved trip have no
    // recorded history at all — they render hollow, never as plain
    // "inactive 0" days that would imply the user did nothing.
    const inHistory = firstTripDate !== null && cursor >= firstTripDate;
    cells[i] = {
      key: cursor,
      count,
      level: inHistory ? levelForCount(count) : 0,
      inHistory,
    };
    cursor = shiftDayKey(cursor, -1);
  }

  // Current streak: consecutive active days ending at today. GitHub-style
  // grace — if today has no trips yet the run may still start at yesterday,
  // but never earlier; if both today and yesterday are empty it is 0.
  let streakIdx = 364;
  if (cells[364].count === 0 && cells[363]) streakIdx = 363;
  let currentStreak = 0;
  for (let i = streakIdx; i >= 0 && cells[i].count > 0; i--) currentStreak++;

  // Longest streak across ALL saved history (not just the visible year):
  // walk the distinct active days in order, extending a run only when the
  // day distance is exactly 1. Distance is computed from UTC-midnight
  // ordinals built out of the key's Y/M/D, diffed in milliseconds with
  // Math.round(diff / 86400000) — rounding to the nearest day keeps adjacent
  // calendar days at exactly 1 even where a naive floor() over raw local ms
  // would turn a 23h DST day into 0 and split a real run.
  const keys = Array.from(counts.keys()).sort();
  let longestStreak = 0;
  let run = 0;
  let prevMs = null;
  for (const key of keys) {
    const parts = key.split('-');
    const ms = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const step = prevMs === null ? Infinity : Math.round((ms - prevMs) / 86400000);
    run = step === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prevMs = ms;
  }

  return { cells, currentStreak, longestStreak, firstTripDate };
}

// ---------------------------------------------------------------------------
// Streak heatmap layout (Profile contribution grid). PURE presentation mapping
// over streakCalendar's cells — it derives no data of its own and never reads
// the clock (`now` is injectable exactly like streakCalendar's). Counts come
// from REUSING streakCalendar(trips, now) internally, so heatmap tiles can
// never disagree with the streak tiles or badges.
// ---------------------------------------------------------------------------

// Short month labels via a local const array — no Intl/locale dependency, so
// labels are identical on every device and JS engine.
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Returns { months: [{ label, startKey, weeks: [cell|null × 7] }, ...] }.
// Rows are the 7 weekdays, index 0 = Sunday .. 6 = Saturday, read from each
// day key with a LOCAL Date getDay(); columns are calendar weeks in order.
// The leading partial week extends BACK to the window's Sunday (pre-window
// slots are null), trailing future days (after today) are null, and every one
// of the 365 real cells is the EXACT object streakCalendar produced —
// key/count/level/inHistory untouched, no re-derivation.
//
// All date work is Y/M/D local arithmetic (the same shape shiftDayKey uses —
// the Date constructor normalizes the rollover), so leap days and month/year
// boundaries roll over exactly like the streak grid does; deliberately NO
// raw-millisecond stepping anywhere in this mapping.
export function streakCalendarHeatmap(trips, now = new Date()) {
  const ring = streakCalendar(trips, now);
  if (ring.cells.length === 0) return { months: [] };

  // Weekday (0 = Sunday) of a 'YYYY-MM-DD' key, parsed through local Date
  // construction.
  const weekdayOfKey = (key) => {
    const p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
  };

  const firstDow = weekdayOfKey(ring.cells[0].key);
  const lastDow = weekdayOfKey(ring.cells[ring.cells.length - 1].key);

  // Full padded slot list: nulls back to the window's Sunday, the 365 real
  // cells, then future-day nulls padding the final week up to row 6. (first
  // pad + 365 + last pad is always 371 = 53 × 7, because the window spans a
  // whole number of weeks from Sunday to the same weekday.)
  const slots = new Array(firstDow).fill(null).concat(ring.cells);
  for (let pad = lastDow + 1; pad <= 6; pad++) slots.push(null);

  // Chunk the slot list into fixed 7-slot week columns.
  const weeks = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));

  // Month binning: a week column belongs to the month of its middle day
  // (row 3, Wednesday) — deterministic for straddling weeks. At the padded
  // edges that slot can be null (first column before the window starts / last
  // column after today); the column's first real cell then carries the bin.
  const monthIndexOfWeek = (week) => {
    const middle = week[3] || week.find((c) => c !== null);
    return Number(middle.key.split('-')[1]) - 1;
  };

  const months = [];
  for (const week of weeks) {
    const label = MONTH_LABELS[monthIndexOfWeek(week)];
    const last = months[months.length - 1];
    if (last && last.label === label) {
      last.weeks.push(week);
    } else {
      months.push({ label, startKey: week.find((c) => c !== null).key, weeks: [week] });
    }
  }

  return { months };
}

export { MET_BY_MODE };

// ---------------------------------------------------------------------------
// Achievements (Profile card). Pure functions only — no React Native imports.
// Every figure below is derived from the SAVED trips array alone, never
// fabricated; weight is deliberately NOT involved so badges stay meaningful
// for users who never set it.
// ---------------------------------------------------------------------------

// Local shorthand sums over the saved-trips array. Only finite numbers
// contribute, so one corrupted stored record can never poison a threshold.
function sumDistanceM(list) {
  return list.reduce((s, t) => s + finiteNumber(t && t.actualDistanceM), 0);
}

function sumTimeSec(list) {
  return list.reduce((s, t) => s + finiteNumber(t && t.durationSec), 0);
}

// Ordered badge list. `current` is always a LIFETIME value computed from the
// saved trips; `earned` is a plain threshold comparison (current >= target),
// so hitting the target exactly earns the badge.
export function computeBadges(trips, now = new Date()) {
  const list = Array.isArray(trips) ? trips : [];
  const tripCount = list.length;
  const distanceM = sumDistanceM(list);
  const timeSec = sumTimeSec(list);
  // Streak figures reuse the exact streakCalendar semantics (grace day for
  // "today", longest run across all history, malformed dates skipped) so the
  // badges can never disagree with the Profile streak panel.
  const ring = streakCalendar(list, now);

  const defs = [
    { id: 'first-trip', label: 'First trip', description: 'Your first completed trip', target: 1, current: tripCount },
    { id: 'five-trips', label: 'Getting around', description: '5 trips', target: 5, current: tripCount },
    { id: 'streak-3', label: 'Habit streak', description: '3 days in a row', target: 3, current: ring.currentStreak },
    { id: 'streak-7', label: 'Week warrior', description: '7 days in a row', target: 7, current: ring.longestStreak },
    { id: 'dist-25', label: '25 km club', description: '25 km total distance, any mode', target: 25000, current: distanceM },
    { id: 'dist-100', label: 'Century club', description: '100 km by foot or bike', target: 100000, current: distanceM },
    { id: 'time-6', label: 'Six hours moving', description: '6 hours of tracked movement', target: 21600, current: timeSec },
  ];

  return defs.map((b) => ({ ...b, earned: b.current >= b.target }));
}

// ---------------------------------------------------------------------------
// "This week" summary (Profile, Lifetime Totals area). Counts completed trips
// over the LAST 7 CALENDAR DAYS including today using the same LOCAL dayKey
// parity as the streak grid, so a trip near local midnight is binned the
// same way everywhere. Malformed records are skipped silently.
// ---------------------------------------------------------------------------
export function weekSummary(trips, now = new Date()) {
  const src = Array.isArray(trips) ? trips : [];

  const nowDate = now instanceof Date ? now : new Date(now);
  const todayKey = dayKey(nowDate);
  if (todayKey === null) return { tripCount: 0, distanceM: 0 };

  // The 7-day window: today plus the six previous calendar days, stepped one
  // wall-clock day at a time (shiftDayKey) so DST-shifted days cannot merge.
  const windowKeys = new Set();
  let cursor = todayKey;
  for (let i = 0; i < 7; i++) {
    windowKeys.add(cursor);
    cursor = shiftDayKey(cursor, -1);
  }

  let tripCount = 0;
  let distanceM = 0;
  for (const t of src) {
    if (!t || !t.date) continue;
    const parsed = new Date(t.date);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKey(parsed);
    if (key === null || !windowKeys.has(key)) continue;
    tripCount++;
    distanceM += finiteNumber(t.actualDistanceM);
  }

  return { tripCount, distanceM };
}

// ---------------------------------------------------------------------------
// Per-trip pace/speed label (Trip detail screen). Pure — no React Native
// imports, no clock reads; the figure is derived ONLY from the stored
// actualDistanceM / durationSec pair.
//
// DECISION: pace stats are human-activity figures, so only the two activity
// modes exist here — walking uses minutes-per-km, cycling uses km/h. Unknown
// or legacy 'driving' records return null (no invented figure rather than a
// dishonest "avg pace" for a mode that has none).
//
// `unit` ('metric' | 'imperial', default metric) matches the user's display
// unit: imperial swaps in min/mi and mph (m -> mi via 1609.344). Anything
// missing, non-finite, or non-positive returns null so the UI can omit the
// row entirely instead of showing a fabricated figure.
// ---------------------------------------------------------------------------
export function paceLabel(trip, unit = 'metric') {
  if (!trip || typeof trip !== 'object') return null;
  const mode = trip.mode;
  if (mode !== 'walking' && mode !== 'cycling') return null;

  const distanceM = trip.actualDistanceM;
  const durationSec = trip.durationSec;
  if (
    typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM <= 0 ||
    typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0
  ) return null;

  if (mode === 'cycling') {
    const hours = durationSec / 3600;
    return unit === 'imperial'
      ? `${((distanceM / 1609.344) / hours).toFixed(1)} mph`
      : `${((distanceM / 1000) / hours).toFixed(1)} km/h`;
  }
  const minutes = durationSec / 60;
  return unit === 'imperial'
    ? `${Math.round(minutes / (distanceM / 1609.344))} min/mi`
    : `${Math.round(minutes / (distanceM / 1000))} min/km`;
}
