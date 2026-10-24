// Pure-helper tests for the user-preferences storage key (key #9) — parsePrefs
// defaults/tolerance + preferredMode validation + dashboard flags. Storage
// itself is exercised in the smoke suites; everything here is pure.

import {
  PREFS_KEY,
  DEFAULT_PREFS,
  PREF_DASHBOARD_KEYS,
  isValidRouteGoal,
  parsePrefs,
} from '../constants';
import { PREFERENCES } from '../lib/preferences';

const raw = (json) => (json === undefined ? undefined : JSON.stringify(json));

describe('PREFS_KEY / DEFAULT_PREFS shape', () => {
  test('PREFS_KEY is the expected storage key', () => {
    expect(PREFS_KEY).toBe('@EcoRoute/prefs');
  });

  test('DEFAULT_PREFS: walking + every dashboard section visible + goal memory off', () => {
    expect(DEFAULT_PREFS.preferredMode).toBe('walking');
    expect(DEFAULT_PREFS.dashboard).toEqual({
      week: true,
      achievements: true,
      streak: true,
      recent: true,
    });
    // Route-goal memory defaults OFF with nothing recorded, so a fresh or
    // reset install behaves exactly like before the key existed.
    expect(DEFAULT_PREFS.rememberRouteGoal).toBe(false);
    expect(DEFAULT_PREFS.lastRouteGoal).toBeNull();
  });

  test('PREF_DASHBOARD_KEYS are exactly the four toggled flags', () => {
    expect(PREF_DASHBOARD_KEYS).toEqual(['week', 'achievements', 'streak', 'recent']);
  });
});

describe('parsePrefs tolerance', () => {
  test('missing/null/empty raw returns full defaults', () => {
    for (const input of [undefined, null, '']) {
      expect(parsePrefs(input)).toEqual(DEFAULT_PREFS);
      expect(parsePrefs(input)).not.toBe(DEFAULT_PREFS); // fresh object
    }
  });

  test('corrupt JSON parses to defaults without throwing', () => {
    expect(parsePrefs('{not-json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
  });

  test('non-object payloads (array, number, string) parse to defaults', () => {
    expect(parsePrefs(raw([1, 2]))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(raw(42))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(raw('cycling'))).toEqual(DEFAULT_PREFS);
  });

  test('unknown preferredMode values fall back to walking (driving rejected)', () => {
    expect(parsePrefs(raw({ preferredMode: 'driving' })).preferredMode).toBe('walking');
    expect(parsePrefs(raw({ preferredMode: 'WALKING' })).preferredMode).toBe('walking');
    expect(parsePrefs(raw({ preferredMode: 7 })).preferredMode).toBe('walking');
  });

  test('valid preferredMode survives parsing', () => {
    expect(parsePrefs(raw({ preferredMode: 'cycling' })).preferredMode).toBe('cycling');
    expect(parsePrefs(raw({ preferredMode: 'walking' })).preferredMode).toBe('walking');
  });

  test('dashboard flags: exact false is kept, unknown values default to true', () => {
    const parsed = parsePrefs(
      raw({
        dashboard: {
          week: false,
          achievements: true,
          streak: 0, // unknown → default true
          recent: 'no',
        },
      })
    );
    expect(parsed.dashboard).toEqual({
      week: false,
      achievements: true,
      streak: true,
      recent: true,
    });
  });

  test('dashboard: missing/empty dashboards resolve to all-true', () => {
    expect(parsePrefs(raw({})).dashboard).toEqual(DEFAULT_PREFS.dashboard);
    expect(parsePrefs(raw({ dashboard: null })).dashboard).toEqual(DEFAULT_PREFS.dashboard);
  });

  test('dashboard: extra unknown keys are ignored, known keys kept', () => {
    const parsed = parsePrefs(
      raw({
        dashboard: { week: false, nonsense: false },
      })
    );
    expect(parsed.dashboard.week).toBe(false);
    expect(parsed.dashboard.nonsense).toBeUndefined();
    expect(
      PREF_DASHBOARD_KEYS.filter((k) => k !== 'week').every((k) => parsed.dashboard[k] === true)
    ).toBe(true);
  });
});

describe('parsePrefs normalization + isolation', () => {
  test('round-trips parsePrefs output JSON and parses identically', () => {
    const first = parsePrefs(raw({ preferredMode: 'cycling', dashboard: { week: false } }));
    const second = parsePrefs(raw(first));
    expect(second).toEqual(first);
  });

  test('returned objects are fresh — mutating one result never leaks', () => {
    const a = parsePrefs(raw({ dashboard: { week: false } }));
    a.dashboard.week = true;
    a.preferredMode = 'cycling';
    const b = parsePrefs(undefined);
    expect(b).toEqual(DEFAULT_PREFS);
    expect(b.dashboard).not.toBe(DEFAULT_PREFS.dashboard);
  });
});

describe('isValidRouteGoal (the single serialization gate for lastRouteGoal)', () => {
  test('accepts exactly the PREFERENCES values (manual included — it is a chip)', () => {
    for (const value of Object.values(PREFERENCES)) {
      expect(isValidRouteGoal(value)).toBe(true);
    }
  });

  test('rejects everything else', () => {
    expect(isValidRouteGoal('driving')).toBe(false);
    expect(isValidRouteGoal('MANUAL')).toBe(false); // case variants rejected
    expect(isValidRouteGoal('eco-best')).toBe(false);
    expect(isValidRouteGoal(42)).toBe(false);
    expect(isValidRouteGoal(null)).toBe(false);
    expect(isValidRouteGoal(undefined)).toBe(false);
    expect(isValidRouteGoal({})).toBe(false);
  });
});

describe('parsePrefs route-goal memory (rememberRouteGoal + lastRouteGoal)', () => {
  test('legacy payload WITHOUT the new keys parses to toggle-off + null goal', () => {
    // Old prefs object (pre-route-goal keys): must keep working as-is.
    const legacy = { preferredMode: 'cycling', dashboard: { week: false } };
    const parsed = parsePrefs(raw(legacy));
    expect(parsed.preferredMode).toBe('cycling');
    expect(parsed.dashboard).toEqual({ ...DEFAULT_PREFS.dashboard, week: false });
    expect(parsed.rememberRouteGoal).toBe(false);
    expect(parsed.lastRouteGoal).toBeNull();
  });

  test('exact rememberRouteGoal true survives; unknown values fall back to off', () => {
    expect(parsePrefs(raw({ rememberRouteGoal: true })).rememberRouteGoal).toBe(true);
    expect(parsePrefs(raw({ rememberRouteGoal: false })).rememberRouteGoal).toBe(false);
    // Truthy-adjacent strings must NOT enable the toggle — the gate is an
    // exact `=== true`, never a truthiness check.
    expect(parsePrefs(raw({ rememberRouteGoal: 'yes' })).rememberRouteGoal).toBe(false);
    expect(parsePrefs(raw({ rememberRouteGoal: 'true' })).rememberRouteGoal).toBe(false);
    expect(parsePrefs(raw({ rememberRouteGoal: 'false' })).rememberRouteGoal).toBe(false);
    expect(parsePrefs(raw({ rememberRouteGoal: 1 })).rememberRouteGoal).toBe(false);
    expect(parsePrefs(raw({ rememberRouteGoal: null })).rememberRouteGoal).toBe(false);
  });

  test('valid lastRouteGoal values survive parsing', () => {
    for (const value of Object.values(PREFERENCES)) {
      expect(parsePrefs(raw({ lastRouteGoal: value })).lastRouteGoal).toBe(value);
    }
  });

  test('unknown / non-string lastRouteGoal serializes to null — never an invented goal', () => {
    for (const value of ['driving', 'AUTO', 42, true, {}, [], null]) {
      expect(parsePrefs(raw({ lastRouteGoal: value })).lastRouteGoal).toBeNull();
    }
    expect(parsePrefs('null').lastRouteGoal).toBeNull();
  });

  test('both new keys together round-trip through serialize + parse', () => {
    const input = {
      preferredMode: 'walking',
      rememberRouteGoal: true,
      lastRouteGoal: PREFERENCES.SHORTEST,
    };
    const first = parsePrefs(raw(input));
    expect(first.rememberRouteGoal).toBe(true);
    expect(first.lastRouteGoal).toBe('shortest');
    const second = parsePrefs(raw(first));
    expect(second).toEqual(first);
  });

  test('unknown extra keys are ignored and never serialized into the result', () => {
    const parsed = parsePrefs(raw({ rememberRouteGoal: true, lastRouteGoal: 'fastest', nonsense: 'x' }));
    expect(parsed.rememberRouteGoal).toBe(true);
    expect(parsed.lastRouteGoal).toBe('fastest');
    expect(parsed.nonsense).toBeUndefined();
    expect(Object.keys(parsed).sort()).toEqual([
      'dashboard',
      'lastRouteGoal',
      'preferredMode',
      'rememberRouteGoal',
    ]);
  });
});
