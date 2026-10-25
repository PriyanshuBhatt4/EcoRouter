// Trip-tracking camera-follow regression: the watchPositionAsync callback
// installed by startTrip closes over the followUser STATE value captured at
// trip start, so after the user pans the map (setFollowUser(false) via
// onPanDrag), every subsequent GPS fix still re-centers the camera through
// the stale closure (followUser === true from trip start) — the map kept
// snapping back to the user while they were trying to look at an area.
// The fix mirrors followUser into a ref the watcher callback reads.
//
// Proof path (RTL idioms: awaited render, awaited fireEvent, findBy*):
// render App -> find a route -> Start Trip -> onPanDrag (the Recenter pill
// proves followUser is false) -> fire accepted GPS fixes into the captured
// watcher callback -> assert animateCamera is NOT called again.
//
// Two test-environment notes:
// - jest-expo does not populate EXPO_PUBLIC_* env, so API_BASE_URL is
//     overridden via the constants mock below (requireActual keeps every
//     other shared constant identical); the route service itself is still
//     module-mocked so no real HTTP happens anyway.
// - The watcher callback is not a React event, so RTL has no fireEvent shim
//     for it; each external fix is invoked inside a single act() wrapper
//     (the required act usage for out-of-band callbacks — deliberately NOT
//     the post-render trailing-flush pattern the codebase rule forbids).

import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';
import * as Location from 'expo-location';

// Native modules mocked exactly like the baseline smoke suites.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mockAnimateCamera = jest.fn();
  const MapView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
    }));
    return <View {...props} testID="map-view" />;
  });
  const Polyline = (props) => <View {...props} testID="map-polyline" />;
  const Marker = (props) => <View {...props} testID="map-marker" />;
  return {
    __esModule: true,
    default: MapView,
    Polyline,
    Marker,
    __mockAnimateCamera: mockAnimateCamera,
  };
});

// The watcher callback is captured through the mock's call args
// (Location.watchPositionAsync.mock.calls[0][1]).
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 28.6, longitude: 77.2, accuracy: 5 },
  })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  watchPositionAsync: jest.fn(async (options, callback) => ({ remove: () => {} })),
  Accuracy: { Low: 1, Balanced: 2, High: 3, BestForNavigation: 6 },
}));

// Backend reachability + a deterministic /route response (payload lives
// INSIDE the factory: factories must not reference out-of-scope bindings).
jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  API_BASE_URL: 'http://test-backend.local',
}));
jest.mock('../services/api', () => ({
  fetchRouteCandidates: jest.fn(async () => ({
    candidates: [
      {
        id: 'route-0',
        coordinates: [
          [77.2, 28.6],
          [77.21, 28.605],
        ],
        distance_m: 700,
        duration_s: 500,
        pm25_estimate: null,
      },
    ],
    destination: { latitude: 28.605, longitude: 77.21 },
  })),
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
  };
});

import App from '../App';
// Namespace import: __mockAnimateCamera lives on the module object exposed by
// the mock factory (the default export is the mocked MapView component).
import * as MockMaps from 'react-native-maps';
import { formatDistance } from '../lib/format';
// Pure haversine with the EXACT formula/thresholds the App's trip filter uses,
// so expected accepted distances below are computed the same way App computes
// them (no hand-rounded figures).
import { distanceBetweenFixes } from '../lib/track';

describe('trip watcher does not re-center after the user disables follow', () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test('GPS fixes accepted after onPanDrag never animate the camera again', async () => {
    const animateCamera = MockMaps.__mockAnimateCamera;
    const screen = await render(<App />);

    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    await fireEvent.press(await screen.findByText('Find Routes'));

    // Success panel starts collapsed; expand it to reach Start Trip.
    await fireEvent.press(await screen.findByText('▾ Expand'));
    await fireEvent.press(await screen.findByText('Start Trip'));

    // The trip installs the position watcher; grab its callback.
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    const fixCallback = Location.watchPositionAsync.mock.calls[0][1];

    // Baseline: an accepted fix while still following IS allowed to animate
    // (followUser was true at trip start) — this also proves the mock is
    // wired through the app and would catch a false-positive "not called".
    await act(async () => {
      fixCallback({ coords: { latitude: 28.6, longitude: 77.2, accuracy: 5 }, timestamp: 1700000000000 });
    });
    expect(animateCamera).toHaveBeenCalled();
    animateCamera.mockClear();

    // User pans: followUser state goes false (Recenter pill appears).
    await fireEvent(await screen.getByTestId('map-view'), 'onPanDrag');
    expect(await screen.findByText('Recenter')).toBeTruthy();

    // Two further accepted fixes (56 m step, accuracy 5 m, 4 s apart — well
    // inside the trip filter's limits). With the stale closure both would
    // re-animate the camera; after the fix neither does.
    await act(async () => {
      fixCallback({ coords: { latitude: 28.6, longitude: 77.2, accuracy: 5 }, timestamp: 1700000004000 });
    });
    await act(async () => {
      fixCallback({ coords: { latitude: 28.6005, longitude: 77.2005, accuracy: 5 }, timestamp: 1700000008000 });
    });
    expect(animateCamera).not.toHaveBeenCalled();
  });
});

// GPS-noise gate regression: the watcher callback used to update the RAW fix
// marker (setUserPos) and camera BEFORE the lib/track tripStep verdict, so a
// low-accuracy/jitter fix or a rejected impossible jump visibly dragged the
// trip pin and the map. The fix evaluates the filter FIRST and only the
// TRUSTED accept arm (first-fix reference accept, or quality === 'ok') moves
// the marker/camera; 'jump' only resyncs the filter reference while the
// marker stays on the last trusted fix.
//
// Fix fixtures (degrees): 0.000009° lat ≈ 1 m, 0.0005° lat ≈ 55.6 m,
// 0.009° lat ≈ 1000.8 m — chosen so each verdict under TRIP_FILTER is exact:
//   f1    (first fix, reference-only accept, displayed)
//   jit   1 m step < MIN_STEP_M(1.5)                    -> jitter
//   la    accuracy 40 > MAX_TRUSTED_ACCURACY_M(30)      -> low_accuracy
//   ok    ~74 m step, accuracy 5, dt 6 s (12 m/s)       -> ok
//   j     ~1000 m step, dt 2 s (≈ 500 m/s > 25)         -> jump
//   k     ~44.5 m step from the JUMP position, dt 2 s   -> ok (resync proof)
describe('trip marker/camera track only TRUSTED fixes (GPS-noise gate)', () => {
  const T0 = 1700000000000;
  // The mocked boot position is (28.6, 77.2); trip fixes deliberately start
  // elsewhere so "marker at f1" proves the first fix moved it (not boot).
  const F1 = { latitude: 28.6002, longitude: 77.2003 };
  const JIT = { latitude: 28.600209, longitude: 77.2003 }; // ≈ 1.0 m from F1
  const LA = { latitude: 28.6102, longitude: 77.2103 }; // big hop, accuracy 40
  const OK = { latitude: 28.6007, longitude: 77.2008 }; // ≈ 74 m from F1
  const JP = { latitude: 28.6097, longitude: 77.2008 }; // ≈ 1000 m from OK
  const OK2 = { latitude: 28.6101, longitude: 77.2008 }; // ≈ 44.5 m from JP
  // Second consecutive low-accuracy fix (accuracy 40 > 30 rejects it like
  // LA; the move is irrelevant since the reference is never advanced).
  const LA2 = { latitude: 28.6103, longitude: 77.2104 };
  const DEST = { latitude: 28.605, longitude: 77.21 }; // mocked route destination
  // ADDITIVE distance-pause caption, rendered next to the distance line in
  // both trip card states while two consecutive low-accuracy fixes have
  // paused the readout.
  const PAUSED_NOTE = 'Distance is paused while GPS signal is unreliable.';

  const markerCoordList = (screen) =>
    screen
      .getAllByTestId('map-marker')
      .map((m) => m.props.coordinate)
      .filter((c) => c && typeof c.latitude === 'number' && typeof c.longitude === 'number');

  const markerAt = (screen, point) =>
    markerCoordList(screen).some(
      (c) => c.latitude === point.latitude && c.longitude === point.longitude
    );

  const startTripAndCaptureWatcher = async () => {
    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    await fireEvent.press(await screen.findByText('Find Routes'));
    // Success panel starts collapsed; expand it to reach Start Trip.
    await fireEvent.press(await screen.findByText('▾ Expand'));
    await fireEvent.press(await screen.findByText('Start Trip'));

    // startTrip collapses trip details: the COMPACT card (chip only) shows.
    // Expand to the full trip card so the "Actual distance:" line and the
    // GPS-accuracy notice are reachable for assertions.
    await fireEvent.press(await screen.findByText('Details ▾'));

    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    const fixCallback = Location.watchPositionAsync.mock.calls[0][1];

    const sendFix = async ({ latitude, longitude, accuracy, timestamp }) => {
      await act(async () => {
        fixCallback({ coords: { latitude, longitude, accuracy }, timestamp });
      });
    };
    const distanceText = (approx, lowGps) =>
      lowGps
        ? `Actual distance: ≈ ${formatDistance(approx, 'metric')} (low GPS)`
        : `Actual distance: ${formatDistance(approx, 'metric')}`;
    return { screen, sendFix, distanceText };
  };

  beforeEach(() => {
    // Watcher/camera mocks accumulate calls across the file's describes;
    // zero them so per-test call counts stay meaningful.
    Location.watchPositionAsync.mockClear();
    MockMaps.__mockAnimateCamera.mockClear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test('first fix is displayed (reference-only accept) even though tripStep never measured it', async () => {
    const { screen, sendFix } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });
    expect(markerAt(screen, F1)).toBe(true);
    expect(screen.queryByText('GPS accuracy is low — distance may be unreliable')).toBeNull();
  });

  test('(a) jitter fix: marker and camera stay on the last trusted fix, distance stays 0', async () => {
    const camera = MockMaps.__mockAnimateCamera;
    const { screen, sendFix, distanceText } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });
    expect(camera).toHaveBeenCalled(); // trusted first fix may re-center
    camera.mockClear();

    await sendFix({ ...JIT, accuracy: 5, timestamp: T0 + 2000 });
    expect(markerAt(screen, F1)).toBe(true);
    expect(markerAt(screen, JIT)).toBe(false);
    expect(camera).not.toHaveBeenCalled();
    expect(await screen.findByText(distanceText(0, false))).toBeTruthy();
  });

  test('(b) low-accuracy fix: marker/camera unchanged AND the low-accuracy notice still sets', async () => {
    const camera = MockMaps.__mockAnimateCamera;
    const { screen, sendFix } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });
    camera.mockClear();

    await sendFix({ ...LA, accuracy: 40, timestamp: T0 + 2000 });
    expect(markerAt(screen, F1)).toBe(true);
    expect(markerAt(screen, LA)).toBe(false);
    expect(camera).not.toHaveBeenCalled();
    // Rejected fix still drives the accuracy NOTICE (setLowAccuracyActive
    // reads step.lowAccuracy regardless of the verdict).
    expect(await screen.findByText('GPS accuracy is low — distance may be unreliable')).toBeTruthy();
    // Rejected fix added no distance; the low-GPS line shape still renders.
    expect(
      await screen.findByText(`Actual distance: ≈ ${formatDistance(0, 'metric')} (low GPS)`)
    ).toBeTruthy();
  });

  test('(c) trusted fix after rejected ones: marker moves again and distance accumulates', async () => {
    const camera = MockMaps.__mockAnimateCamera;
    const { screen, sendFix, distanceText } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });
    await sendFix({ ...JIT, accuracy: 5, timestamp: T0 + 2000 }); // jitter
    await sendFix({ ...LA, accuracy: 40, timestamp: T0 + 4000 }); // low_accuracy
    camera.mockClear();

    // Reference is still F1 (both rejects kept it): ~74 m step, dt 6 s.
    await sendFix({ ...OK, accuracy: 5, timestamp: T0 + 6000 });
    expect(markerAt(screen, OK)).toBe(true);
    expect(markerAt(screen, LA)).toBe(false);
    expect(camera).toHaveBeenCalled(); // camera resumes for trusted fixes
    // Only the trusted step's meters were added — nothing for the rejects.
    expect(
      await screen.findByText(distanceText(distanceBetweenFixes(F1, OK), false))
    ).toBeTruthy();
  });

  test('(e) two consecutive low-accuracy fixes pause the distance readout; a trusted fix resumes it', async () => {
    const { screen, sendFix, distanceText } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });

    // ONE low-accuracy fix: the single-fix low-GPS notice shows (unchanged,
    // see test (b)) but the readout is NOT paused yet.
    await sendFix({ ...LA, accuracy: 40, timestamp: T0 + 2000 });
    expect(screen.queryByText(PAUSED_NOTE)).toBeNull();

    // Second consecutive low-accuracy fix: distancePaused flips and the
    // honest caption renders next to the distance line.
    await sendFix({ ...LA2, accuracy: 40, timestamp: T0 + 4000 });
    expect(await screen.findByText(PAUSED_NOTE)).toBeTruthy();

    // A trusted fix resumes the readout: caption gone, distance commits
    // (the windowed accountant: the ~74 m F1->OK leg is a pure ratio-1
    // window, so it commits on this very fix — the pauses never touched the
    // window since low-accuracy fixes never enter it).
    await sendFix({ ...OK, accuracy: 5, timestamp: T0 + 6000 });
    expect(screen.queryByText(PAUSED_NOTE)).toBeNull();
    expect(
      await screen.findByText(distanceText(distanceBetweenFixes(F1, OK), false))
    ).toBeTruthy();
  });

  test('(d) jump fix: filter reference resyncs (proven by later accepted math) but marker never moves to it', async () => {
    const camera = MockMaps.__mockAnimateCamera;
    const { screen, sendFix, distanceText } = await startTripAndCaptureWatcher();
    await sendFix({ ...F1, accuracy: 5, timestamp: T0 });
    await sendFix({ ...OK, accuracy: 5, timestamp: T0 + 6000 }); // trusted, ~74 m
    const trustedMeters = distanceBetweenFixes(F1, OK);
    camera.mockClear();

    // ≈ 1000 m in 2 s ≈ 500 m/s: impossible -> jump. Marker must NOT follow.
    await sendFix({ ...JP, accuracy: 5, timestamp: T0 + 8000 });
    expect(markerAt(screen, OK)).toBe(true);
    expect(markerAt(screen, JP)).toBe(false);
    expect(camera).not.toHaveBeenCalled();
    expect(await screen.findByText(distanceText(trustedMeters, false))).toBeTruthy();

    // Resync proof: the next trusted fix is measured from the JUMP position.
    // 44.5 m in 2 s ≈ 22 m/s (< 25) so it is accepted with meters = dist(JP,
    // OK2) — measured from OK instead it would be ~1000 m in 4 s
    // (≈ 263 m/s) and have been REJECTED as a second jump, so this leg can
    // only appear via the resynced reference.
    await sendFix({ ...OK2, accuracy: 5, timestamp: T0 + 10000 });
    expect(markerAt(screen, OK2)).toBe(true);

    // ADDITIVE windowed-accountant honesty: a single 44.5 m leg is BELOW the
    // 50 m commit threshold, so the readout still shows the committed window
    // (the ~74 m F1->OK walk) and holds the resynced leg back — the
    // documented honest lag of at most TRIP_FILTER.DISTANCE_COMMIT_MIN_M.
    expect(await screen.findByText(distanceText(trustedMeters, false))).toBeTruthy();

    // A further 100 m trusted fix (6 s, ≈ 16.7 m/s < 25) closes the pending
    // window: path ≈ 144.6 ≥ 50, net from the last committed point ≈ 114.6
    // (ratio ≈ 0.79). The committed total now contains the JUMP-resynced
    // leg — measured without the resync the 44.5 m step could never have
    // been accepted, so this exact total can only appear via the resynced
    // reference.
    const OK3 = { latitude: OK2.latitude + (100 * 180) / (Math.PI * 6371000), longitude: OK2.longitude };
    await sendFix({ ...OK3, accuracy: 5, timestamp: T0 + 16000 });
    expect(markerAt(screen, OK3)).toBe(true);
    const totalMeters =
      trustedMeters + distanceBetweenFixes(JP, OK2) + distanceBetweenFixes(OK2, OK3);
    expect(await screen.findByText(distanceText(totalMeters, false))).toBeTruthy();
  });
});
