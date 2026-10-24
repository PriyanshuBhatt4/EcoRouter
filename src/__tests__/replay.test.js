// Journey Replay: unit tests for the pure trail helpers + additive RTL
// screens tests (both playthrough states via the real App shell, exactly like
// the existing smoke files).
//
// RTL v14 idioms (same as __tests__/screens.smoke.test.js): render() is async
// and act-wrapped, fireEvent is awaited, findBy* used for async resolvers,
// NO manual act() flushes anywhere, afterEach cleanup + restoreAllMocks.

import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((props, ref) => (
    <View ref={ref} {...props} testID="map-view" />
  ));
  const Polyline = (props) => <View {...props} testID="map-polyline" />;
  const Marker = (props) => <View {...props} testID="map-marker" />;
  return { __esModule: true, default: MapView, Polyline, Marker };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 28.6, longitude: 77.2, accuracy: 5 },
  })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  watchPositionAsync: jest.fn(async () => ({ remove: () => {} })),
  Accuracy: { Low: 1, Balanced: 2, High: 3, BestForNavigation: 6 },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => {
      store.set(key, value);
      return undefined;
    }),
    removeItem: jest.fn(async (key) => {
      store.delete(key);
      return undefined;
    }),
    __store: store,
  };
});

import App from '../App';
import {
  TRAIL_KEY,
  TRAIL_MAX_POINTS,
  parseTrails,
  pointAtProgress,
  progressToIndex,
  shouldRetainSample,
  thinTrailPoints,
  trailToCoords,
} from '../constants';
import { distanceBetweenFixes } from '../lib/track';

// Degrees-per-meter through the SAME mean-Earth sphere lib/track's haversine
// uses (R = 6371000): pi*R/180 ≈ 111194.93 m per degree of latitude.
const BASE = { latitude: 12.9716, longitude: 77.5946 };
const latDelta = (meters) => (meters * 180) / (Math.PI * 6371000);
const fixAt = (meters) => ({ ...BASE, latitude: BASE.latitude + latDelta(meters) });

// Seeded trip in the CURRENT record shape (no path fields; trails live in the
// side-car under TRAIL_KEY — the trip record itself must stay untouched).
const TRIP = {
  id: '1',
  date: '2026-01-05T09:00:00.000Z',
  mode: 'walking',
  actualDistanceM: 1500,
  durationSec: 1200,
};
// Stored trail for TRIP: three valid [lat, lng] pairs a few tens of meters
// apart (> TRAIL_MIN_STEP_M sampling steps, >= 2 points so it is usable).
const TRAIL = [
  [12.9716, 77.5946],
  [12.9761, 77.5946],
  [12.9806, 77.5946],
];

beforeEach(() => {
  const store = AsyncStorage.__store;
  store.clear();
  store.set('@EcoRoute/trips', JSON.stringify([TRIP]));
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe('parseTrails (tolerant side-car parsing)', () => {
  test('null, empty and malformed payloads parse to an empty map', () => {
    expect(parseTrails(null)).toEqual({});
    expect(parseTrails('')).toEqual({});
    expect(parseTrails('not json {{')).toEqual({});
    expect(parseTrails('[1,2,3]')).toEqual({}); // array is not a map
    expect(parseTrails('"plain string"')).toEqual({});
  });

  test('keeps valid trips, drops invalid points and empty trips', () => {
    const raw = JSON.stringify({
      '1': [
        [10.5, 76.2],
        [10.5, 76.2, 76.2], // wrong arity
        ['10.5', 76.2], // non-numeric
        [95, 76.2], // latitude out of range
        [10.5, 200], // longitude out of range
        [10.6, 76.3],
      ],
      '2': [], // no valid points at all -> dropped
    });
    const map = parseTrails(raw);
    expect(Object.keys(map).sort()).toEqual(['1']);
    expect(map['1']).toEqual([
      [10.5, 76.2],
      [10.6, 76.3],
    ]);
  });

  test('caps oversized trips to TRAIL_MAX_POINTS, keeping both endpoints', () => {
    const points = [];
    for (let i = 0; i < 1000; i += 1) {
      points.push([latDelta(i * 10) * 180 / Math.PI * -1 + 10, 76.0]);
    }
    const map = parseTrails(JSON.stringify({ '1': points }));
    expect(map['1'].length).toBeLessThanOrEqual(TRAIL_MAX_POINTS);
    expect(map['1'][0]).toEqual(points[0]);
    expect(map['1'][map['1'].length - 1]).toEqual(points[points.length - 1]);
  });
});

describe('thinTrailPoints (ratio thinning)', () => {
  test('below the cap the input passes through with identical contents', () => {
    const points = [[10.0, 76.0], [10.0005, 76.0], [10.001, 76.0]];
    const out = thinTrailPoints(points);
    expect(out).toEqual(points); // same order/contents; thinning may rebuild the array
    expect(out[0]).toBe(points[0]); // surviving pairs are the same references
  });

  test('non-array input yields an empty list', () => {
    expect(thinTrailPoints(null)).toEqual([]);
    expect(thinTrailPoints('nope')).toEqual([]);
  });

  test('oversized input lands at/below the cap, endpoints intact, deterministic', () => {
    const points = [];
    for (let i = 0; i < 800; i += 1) {
      points.push([latDelta(i) * 180 / Math.PI * -1 + 10, 76.0]);
    }
    const first = thinTrailPoints(points, 300);
    const second = thinTrailPoints(points, 300);
    expect(first.length).toBeLessThanOrEqual(300);
    expect(first[0]).toEqual(points[0]);
    expect(first[first.length - 1]).toEqual(points[points.length - 1]);
    expect(first).toEqual(second); // pure + deterministic
  });
});

describe('shouldRetainSample (trail thinning decision)', () => {
  test('the first accepted fix always joins the trail', () => {
    expect(shouldRetainSample(null, fixAt(0))).toBe(true);
  });

  test('unreadable fixes never join the trail', () => {
    expect(shouldRetainSample(null, null)).toBe(false);
    expect(shouldRetainSample(fixAt(0), { latitude: 'x', longitude: 77 })).toBe(false);
    expect(shouldRetainSample(fixAt(0), {})).toBe(false);
  });

  test('moves below the step threshold are not retained, clearly above are', () => {
    const last = fixAt(0);
    expect(shouldRetainSample(last, fixAt(9))).toBe(false); // < 10 m
    expect(shouldRetainSample(last, fixAt(11))).toBe(true); // > 10 m
  });

  test('a custom threshold is honored (call-site override only)', () => {
    const last = fixAt(0);
    expect(shouldRetainSample(last, fixAt(9), 5)).toBe(true);
    expect(shouldRetainSample(last, fixAt(9), 15)).toBe(false);
  });
});

describe('progressToIndex (scrubber mapping)', () => {
  test('0 maps to the first index and 1 to the last', () => {
    expect(progressToIndex(0, 5)).toBe(0);
    expect(progressToIndex(1, 5)).toBe(4);
  });

  test('mid progress floors onto the left point', () => {
    expect(progressToIndex(0.5, 5)).toBe(2);
    expect(progressToIndex(0.49, 5)).toBe(1);
    expect(progressToIndex(0.999, 5)).toBe(3);
  });

  test('out-of-range and invalid progress clamp to index 0 or the last', () => {
    expect(progressToIndex(1.5, 5)).toBe(4);
    expect(progressToIndex(-0.5, 5)).toBe(0);
    expect(progressToIndex(NaN, 5)).toBe(0);
  });

  test('degenerate counts always return 0', () => {
    expect(progressToIndex(0, 0)).toBe(0);
    expect(progressToIndex(1, 1)).toBe(0);
    expect(progressToIndex(0.5, 1.5)).toBe(0); // non-integer count
  });
});

describe('pointAtProgress (smooth marker lookup)', () => {
  const points = [
    { latitude: 10.0, longitude: 76.0 },
    { latitude: 10.001, longitude: 76.001 },
  ];

  test('empty and single-point paths are safe', () => {
    expect(pointAtProgress([], 0.5)).toBeNull();
    expect(pointAtProgress([{ latitude: 8, longitude: 77 }], 1)).toEqual({
      latitude: 8,
      longitude: 77,
    });
  });

  test('endpoints are exact and the middle interpolates linearly', () => {
    expect(pointAtProgress(points, 0)).toEqual({ latitude: 10.0, longitude: 76.0 });
    expect(pointAtProgress(points, 1)).toEqual({ latitude: 10.001, longitude: 76.001 });
    const mid = pointAtProgress(points, 0.5);
    expect(mid.latitude).toBeCloseTo(10.0005, 12);
    expect(mid.longitude).toBeCloseTo(76.0005, 12);
  });
});

describe('distanceBetweenFixes (pure, reuses the module haversine)', () => {
  test('identical fixes measure zero', () => {
    expect(distanceBetweenFixes(BASE, BASE)).toBe(0);
  });

  test('unreadable inputs measure zero', () => {
    expect(distanceBetweenFixes(null, BASE)).toBe(0);
    expect(distanceBetweenFixes(BASE, {})).toBe(0);
  });

  test('one degree of latitude is ~111194.93 m through the same math', () => {
    const far = { ...BASE, latitude: BASE.latitude + 1 };
    const meters = distanceBetweenFixes(BASE, far);
    expect(Math.abs(meters - (Math.PI * 6371000) / 180)).toBeLessThan(1);
  });
});

describe('trailToCoords', () => {
  test('converts valid pairs and skips malformed entries', () => {
    expect(
      trailToCoords([
        [12.9716, 77.5946],
        [200, 77.5946], // out of range
        'junk',
        [12.9761, 77.5946],
      ])
    ).toEqual([
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9761, longitude: 77.5946 },
    ]);
    expect(trailToCoords(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Screens tests through the real App shell (history list row + detail Replay
// affordances, unavailable card, available replay UI from a seeded side-car).
// ---------------------------------------------------------------------------

async function openHistoryList(screen) {
  await fireEvent.press(await screen.findByLabelText('Profile'));
  await fireEvent.press(await screen.findByText('RECENT TRIPS'));
}

describe('Replay screens (via App shell)', () => {
  test('old-format trip (no side-car) shows the honest unavailable card from the history row', async () => {
    const screen = await render(<App />);
    await openHistoryList(screen);

    // The list row carries the small Replay text action.
    await fireEvent.press(await screen.findByText('Replay'));

    // Honest copy, exactly as worded.
    expect(await screen.findByText('Replay unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        "Trips recorded before this version don't save the path you walked. New trips can be replayed."
      )
    ).toBeTruthy();

    // Back returns to the History list.
    await fireEvent.press(await screen.findByLabelText('Back to trip history'));
    expect(await screen.findByText('1 trip saved')).toBeTruthy();
  });

  test('unavailable card also renders from the detail-screen Replay button and returns to the detail', async () => {
    const screen = await render(<App />);
    await openHistoryList(screen);
    await fireEvent.press(await screen.findByLabelText('Open trip details'));

    // Detail 'Replay' primary affordance (between stats and delete).
    await fireEvent.press(await screen.findByLabelText('Replay this trip'));
    expect(await screen.findByText('Replay unavailable')).toBeTruthy();

    // Back reopens the SAME detail screen (NOTES card proves it is the detail).
    await fireEvent.press(await screen.findByLabelText('Back to trip history'));
    expect(await screen.findByText('NOTES')).toBeTruthy();
  });

  test('available replay: seeded side-car renders the recorded-path UI with stored record stats', async () => {
    AsyncStorage.__store.set(TRAIL_KEY, JSON.stringify({ '1': TRAIL }));

    const screen = await render(<App />);
    await openHistoryList(screen);
    await fireEvent.press(await screen.findByText('Replay'));

    // Replay UI: map, honesty caption, play controls and the scrubber.
    expect(await screen.findByTestId('map-view')).toBeTruthy();
    expect(screen.getByText('Your recorded path')).toBeTruthy();
    expect(screen.getByText('Play')).toBeTruthy();
    expect(screen.getByText('Restart')).toBeTruthy();
    expect(screen.getByLabelText('Replay progress')).toBeTruthy();

    // StatTiles show the STORED record values (never re-derived from the
    // trail): 1500 m -> '1.5 km', 1200 s -> '20m 0s'; mode pill 'Walking'.
    expect(screen.getByText('1.5 km')).toBeTruthy();
    expect(screen.getByText('20m 0s')).toBeTruthy();
    expect(screen.getByText('Walking')).toBeTruthy();
    expect(screen.getByText('Distance')).toBeTruthy();
    expect(screen.getByText('Time')).toBeTruthy();
  });

  test('a stored trip without a matching side-car entry degrades to the unavailable card', async () => {
    // Trail storage exists but points at some OTHER trip (e.g. cleared).
    AsyncStorage.__store.set(TRAIL_KEY, JSON.stringify({ '999': TRAIL }));

    const screen = await render(<App />);
    await openHistoryList(screen);
    await fireEvent.press(await screen.findByText('Replay'));

    expect(await screen.findByText('Replay unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        "Trips recorded before this version don't save the path you walked. New trips can be replayed."
      )
    ).toBeTruthy();
  });
});
