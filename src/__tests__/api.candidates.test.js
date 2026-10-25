// Route-mapping hardening (services/api.js) — avoided-crash regression tests
// for the shared /route response mapper. Pure module tests: no native mocks
// needed beyond a stubbed global fetch (api.js imports no React modules).
//
// Two crash classes covered:
// 1. Malformed coordinate rows (strings/objects/sparse pairs) previously
//    mapped to { latitude: undefined, longitude: undefined } points that
//    react-native-maps rejects ("Lat/Lng must be valid numbers"). Valid
//    points survive; candidates whose mapped coordinates end up empty are
//    dropped (same honest failure message as an entirely empty route).
// 2. Duplicate backend ids: the mapped ids back the Polyline/option-card
//    React keys and the selection find — collisions would duplicate list
//    keys and tie selection to two rows at once, so later duplicates get a
//    deterministic suffix.

import { fetchRouteCandidates, fetchWithTimeout } from '../services/api';

const wireResponse = (data) => ({
  ok: true,
  json: async () => data,
  status: 200,
});

const tripCandidate = (overrides = {}) => ({
  coordinates: [
    [77.2, 28.6],
    [77.21, 28.605],
  ],
  distance_m: 1200,
  duration_s: 900,
  ...overrides,
});

beforeEach(() => {
  global.fetch = jest.fn(async () => wireResponse({}));
});

afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('fetchRouteCandidates coordinate-row validation (avoided crash)', () => {
  test('valid pairs map to { latitude, longitude } keeping the [lng, lat] wire order', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [tripCandidate()],
      destination: { latitude: 28.605, longitude: 77.21 },
    }));
    const { candidates, destination } = await fetchRouteCandidates({
      latitude: 28.6,
      longitude: 77.2,
      destination: 'Some park',
      mode: 'walking',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].coordinates).toEqual([
      { latitude: 28.6, longitude: 77.2 },
      { latitude: 28.605, longitude: 77.21 },
    ]);
    expect(candidates[0].distanceMeters).toBe(1200);
    expect(candidates[0].durationSeconds).toBe(900);
    expect(candidates[0].pm25_estimate).toBeNull();
    expect(destination).toEqual({ latitude: 28.605, longitude: 77.21 });
  });

  test('malformed rows (strings / objects / wrong arity) are dropped per point, not mapped to undefined', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [
        tripCandidate({
          coordinates: [
            ['77.2', '28.6'], // strings, not numbers
            { latitude: 28.6, longitude: 77.2 }, // object, not a pair
            [77.21], // arity < 2
            [NaN, 28.6], // non-finite longitude
            [null, 28.65], // null entry
            [77.25, 28.62], // valid row amid junk
          ],
        }),
      ],
    }));
    const { candidates } = await fetchRouteCandidates({
      latitude: 28.6,
      longitude: 77.2,
      destination: 'Some park',
      mode: 'walking',
    });
    // Only the one valid row survives; no undefined-coordinate point can
    // reach the Polyline.
    expect(candidates).toHaveLength(1);
    expect(candidates[0].coordinates).toEqual([{ latitude: 28.62, longitude: 77.25 }]);
  });

  test('a candidate whose mapped coordinates all end up empty is dropped (honest empty-route)', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [
        tripCandidate({ coordinates: [[1], ['a', 2]] }),
        tripCandidate(),
      ],
    }));
    const { candidates } = await fetchRouteCandidates({
      latitude: 28.6,
      longitude: 77.2,
      destination: 'Some park',
      mode: 'walking',
    });
    expect(candidates).toHaveLength(1);
  });

  test('ALL candidates with only-malformed rows surface the empty-route failure, never undefined coords', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [tripCandidate({ coordinates: [{}] }), tripCandidate({ coordinates: [] })],
    }));
    await expect(
      fetchRouteCandidates({ latitude: 28.6, longitude: 77.2, destination: 'Some park', mode: 'walking' })
    ).rejects.toThrow('The server returned an empty route.');
  });
});

describe('fetchRouteCandidates id dedupe (React key + selection uniqueness)', () => {
  test('duplicate backend ids keep order with interpolated unique ids for later rows', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [
        tripCandidate({ id: 'same' }),
        tripCandidate({ id: 'same' }),
        tripCandidate({ id: 'other' }),
      ],
    }));
    const { candidates } = await fetchRouteCandidates({
      latitude: 28.6,
      longitude: 77.2,
      destination: 'Some park',
      mode: 'walking',
    });
    expect(candidates.map((c) => c.id)).toEqual(['same', 'same-dup1', 'other']);
  });

  test('fallback ids stay positional (missing/empty id), and remain unique', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({
      candidates: [
        tripCandidate({}),
        tripCandidate({ id: '' }),
        tripCandidate({ id: null }),
      ],
    }));
    const { candidates } = await fetchRouteCandidates({
      latitude: 28.6,
      longitude: 77.2,
      destination: 'Some park',
      mode: 'walking',
    });
    expect(candidates.map((c) => c.id)).toEqual(['route-0', 'route-1', 'route-2']);
  });
});

describe('fetchWithTimeout passthrough via the stubbed fetch', () => {
  test('resolves the response and clears the timer (no hang behavior change)', async () => {
    const wire = wireResponse({ ping: true });
    global.fetch.mockResolvedValueOnce(wire);
    const res = await fetchWithTimeout('http://test.host/route');
    expect(res).toBe(wire);
  });

  // Timeout coherence with the backend's max response math: /geocode can
  // spend up to 10s and /route up to 15s (routing + the optional exposure
  // section capped at ~4s) before their own timeouts short-circuit, so the
  // client budget was raised from 15s to 30s (10 + 15 + slack, finite on
  // purpose). Asserted at the COMPONENT level here — the abort timer's delay
  // is spied while the real (constant-driven) setTimeout call runs, since
  // REQUEST_TIMEOUT_MS itself is module-private.
  test('schedules its abort timer at 30000 ms (backend max response math: 10s geocode + 15s routing + 4s exposure + slack)', async () => {
    global.fetch.mockResolvedValueOnce(wireResponse({ ping: true }));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    await fetchWithTimeout('http://test.host/route');
    // Read the recorded calls BEFORE mockRestore: restoring a spy also resets
    // its call log (the top-level afterEach restoreAllMocks was too late and
    // restore-in-finally emptied the log under our feet).
    const abortTimers = setTimeoutSpy.mock.calls.filter(([, ms]) => typeof ms === 'number');
    expect(abortTimers).toHaveLength(1);
    expect(abortTimers[0][1]).toBe(30000);
    // And it was cleared once the fetch settled (success path, as before).
    expect(clearTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});

// Two-tier API base URL resolution (src/constants.js): the local dev
// EXPO_PUBLIC_API_BASE_URL wins, the build-time EXPO_PUBLIC_API_URL_PRODUCTION
// is next, and neither means API_BASE_URL stays undefined (explicit
// not-configured state — never a silent localhost/IP fallback).
//
// jest-expo does not populate EXPO_PUBLIC_* env (there is no inline-env
// plugin active: runtime `process.env` reads inside constants.js stay live),
// so each test mutates process.env, jest.resetModules()s and require()s a
// FRESH constants module. The top-level import above keeps its original
// binding — the reset only affects requires made AFTER it.
describe('API_BASE_URL two-tier resolution (dev > production > not set)', () => {
  const DEV_ENV = 'EXPO_PUBLIC_API_BASE_URL';
  const PROD_ENV = 'EXPO_PUBLIC_API_URL_PRODUCTION';

  const loadConstants = () => {
    jest.resetModules();
    return require('../constants');
  };

  afterEach(() => {
    delete process.env[DEV_ENV];
    delete process.env[PROD_ENV];
    jest.resetModules();
  });

  test('(a) neither env var set → API_BASE_URL stays undefined (explicit not-configured state)', () => {
    delete process.env[DEV_ENV];
    delete process.env[PROD_ENV];
    const { API_BASE_URL } = loadConstants();
    expect(API_BASE_URL).toBeUndefined();
  });

  test('(b) dev var absent, production var set → production URL used, normalized (trimmed + trailing slashes stripped)', () => {
    process.env[PROD_ENV] = '  https://top-level-backend.example/  ';
    const { API_BASE_URL } = loadConstants();
    expect(API_BASE_URL).toBe('https://top-level-backend.example');
  });

  test('(c) both set → dev var wins (local override over the baked production URL)', () => {
    process.env[DEV_ENV] = '  https://laptop-dev.example//  ';
    process.env[PROD_ENV] = 'https://top-level-backend.example';
    const { API_BASE_URL } = loadConstants();
    expect(API_BASE_URL).toBe('https://laptop-dev.example');
  });

  test('a dev value that normalizes to empty does not shadow a set production URL', () => {
    process.env[DEV_ENV] = '   ';
    process.env[PROD_ENV] = 'https://top-level-backend.example';
    const { API_BASE_URL } = loadConstants();
    expect(API_BASE_URL).toBe('https://top-level-backend.example');
  });
});
