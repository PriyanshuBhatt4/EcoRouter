import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TRIPS_KEY } from '../constants';

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
  };
});

import App from '../App';

// Note: @testing-library/react-native v13+ render() is async and must be awaited.
describe('App smoke test', () => {
  test('renders the main map screen without crashing', async () => {
    const { getByPlaceholderText, getByText, getByTestId, getByLabelText } = await render(<App />);

    // Map view and search input render.
    expect(getByTestId('map-view')).toBeTruthy();
    expect(getByPlaceholderText('Where to? (e.g., Hauz Khas)')).toBeTruthy();

    // Bottom card content for the idle state (redesigned empty state copy).
    expect(getByText('Plan your walk or cycle')).toBeTruthy();
    expect(getByText('Type a destination above to compare up to 3 routes.')).toBeTruthy();
    expect(getByText('Find Routes')).toBeTruthy();

    // Profile control is now an avatar circle button with an accessible label.
    expect(getByLabelText('Profile')).toBeTruthy();

    // Attribution footer is present. Provider caveats (including the removed
    // cycling-only explainer) are now consolidated into this single line.
    expect(
      getByText('Data: OpenStreetMap (Nominatim, Valhalla public server) · Air: Open-Meteo CAMS (regional model, not street-level) · Prototype, no SLA · Durations are estimates, not live traffic')
    ).toBeTruthy();

    // Flush pending async effects (graceful, avoids post-test act warnings).
    await act(async () => {});
  });

  // The boot location IIFE previously ran requestForegroundPermissionsAsync
  // without a try/catch: a THROWING permission request (interrupted prompt,
  // channel unavailable) rejected the whole boot promise — an unhandled
  // rejection instead of the honest banner. It must boot to the map with the
  // could-not-locate banner (NOT the 'permission was denied' copy) and stay
  // usable.
  test('a throwing (not denied) permission request boots to the map with the fallback banner', async () => {
    Location.requestForegroundPermissionsAsync.mockRejectedValueOnce(
      new Error('permission channel unavailable')
    );
    const { getByTestId, findByText } = await render(<App />);

    // The app booted — the map renders with its default region...
    expect(getByTestId('map-view')).toBeTruthy();
    // ...and the honest banner appears (no crash, no unhandled rejection).
    expect(await findByText('Could not determine your current location.')).toBeTruthy();

    // Flush pending async effects.
    await act(async () => {});
  });

  // Corrupt ENTRY shapes inside the trips array (null / string / id-less
  // object) previously reached state and crashed the History/Profile list
  // renders at their `tr.id` list keys. The boot parse now filters to
  // shape-valid records; the surviving trip still renders.
  test('trips array with junk entries boots to a non-crashing, correct list', async () => {
    await AsyncStorage.setItem(
      TRIPS_KEY,
      JSON.stringify([
        null,
        'oops',
        {
          id: '23',
          date: '2026-04-04T09:00:00.000Z',
          mode: 'walking',
          actualDistanceM: 1200,
          durationSec: 600,
        },
      ])
    );

    const screen = await render(<App />);
    await fireEvent.press(await screen.findByLabelText('Profile'));
    // The junk entries would previously crash the RECENT TRIPS render (their
    // missing/bogus `tr.id` values hit the list-key lookups): the render
    // succeeding here is the regression proof.
    await fireEvent.press(await screen.findByText('RECENT TRIPS'));
    // RECENT TRIPS opens the full history list directly: the count reflects
    // exactly the surviving record and exactly one row (no duplicate keys).
    expect(await screen.findByText('1 trip saved')).toBeTruthy();
    expect(await screen.findByLabelText('Open trip details')).toBeTruthy();
    expect(screen.getAllByLabelText('Open trip details')).toHaveLength(1);

    // Flush pending async effects.
    await act(async () => {});
  });
});
