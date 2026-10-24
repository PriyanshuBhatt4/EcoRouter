// Boot robustness regression: ONE corrupt/shape-invalid storage key must not
// veto the rest of the startup load. The App.js mount effect parses the
// profile and trips keys with raw JSON.parse inside ONE shared try/catch, so
// a corrupt PROFILE_KEY stopped the trips/theme/accent/recents/saved-places/
// prefs loads (silently "losing" them for the session), and a valid-but-
// non-array TRIPS_KEY payload (e.g. an object) reached state and crashed the
// History list render (trips.slice on a non-array).
//
// These tests seed corrupt profile + non-array trips payloads alongside VALID
// saved-places and prefs payloads and assert the app still boots with the
// good data (saved places visible, preferred mode honored) and History
// renders its honest empty state instead of crashing.

import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';

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

// Corrupt BOOT data + valid side data, seeded before any App code runs.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  // Corrupt JSON on the profile key (previously vetoed the whole boot chain).
  store.set('@EcoRoute/profile', 'not really json{');
  // Valid JSON, but NOT an array on the trips key (previously reached state
  // and crashed the History list render).
  store.set('@EcoRoute/trips', JSON.stringify({ oops: 'not an array' }));
  // Valid saved places + prefs payload: these MUST still load.
  store.set(
    '@EcoRoute/savedPlaces',
    JSON.stringify([
      { id: 'p1', name: 'Office', category: 'work', latitude: 28.6, longitude: 77.2 },
    ])
  );
  store.set(
    '@EcoRoute/prefs',
    JSON.stringify({
      preferredMode: 'cycling',
      dashboard: { week: true, achievements: true, streak: true, recent: true },
    })
  );
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

describe('boot robustness with corrupt stored keys', () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test('valid saved places + prefs still load; corrupt profile does not veto them', async () => {
    const screen = await render(<App />);

    // Map booted (permission granted, fix acquired).
    expect(await screen.findByTestId('map-view')).toBeTruthy();

    // Saved places loaded SURFACES the Settings entry count: proves the
    // corrupt profile key did not veto the rest of the boot chain.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('Settings'));
    expect(await screen.findByText('1 place saved')).toBeTruthy();

    // The stored preferred mode loaded too (previously vetoed by the same
    // corrupt profile parse): the Cycling chip is the selected one.
    const cyclingChip = await screen.findByLabelText('Preferred travel mode: Cycling');
    expect(cyclingChip.props.accessibilityState).toEqual({ selected: true });
  });

  test('non-array trips payload does not crash the History list (renders empty state)', async () => {
    const screen = await render(<App />);

    // Map booted, then Profile -> History list. With trips state corrupted
    // by an object payload, the old code crashed this render at trips.slice().
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('RECENT TRIPS'));
    expect(await screen.findByText('No trips saved yet.')).toBeTruthy();
  });
});
