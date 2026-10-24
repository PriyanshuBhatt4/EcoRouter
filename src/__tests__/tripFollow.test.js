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
