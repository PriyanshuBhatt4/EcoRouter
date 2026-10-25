// Route-start snapping REPRESENTATION tests.
//
// CAUSE: Valhalla snaps the raw GPS start to the nearest walkable road, so
// every candidate polyline begins at the SNAPPED point — not at the request
// origin where the user actually stands (App's acquireOrigin sends the raw
// fix unchanged and stores it in currentCoords/currentAccuracy; the route
// itself is never moved). MapScreen's honest fix is REPRESENTATION only:
// when the SELECTED candidate's start sits >= 25m from the captured origin,
// it draws ONE dashed connector polyline from the origin to the snapped
// start plus an honest caption in the expanded panel. Below 25m GPS noise
// dominates: no connector, no caption.
//
// The gap is computed client-side per SELECTED candidate with the existing
// pure haversine (distanceBetweenFixes, src/lib/track.js) — same formula the
// trip filter uses. Fixtures here build distances along a meridian with the
// exact same helper, so no hand-rounded figures are involved.
//
// Mock notes (follows the existing suites' react-native-maps mock shape,
// with one documented difference): the smoke-suite mock overwrites every
// Polyline's testID with 'map-polyline', which would hide the connector's
// own testID. This suite keeps the exact same mock shape but lets an
// explicit testID pass through; candidate polylines (no testID passed)
// still land on 'map-polyline' exactly as before all suites.

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((props, ref) => (
    <View ref={ref} {...props} testID="map-view" />
  ));
  // Same Polyline mock as every suite; explicit testIDs pass through so the
  // routeConnector is queryable by its own id (default stays 'map-polyline').
  const Polyline = (props) => <View {...props} testID={props.testID || 'map-polyline'} />;
  const Marker = (props) => <View {...props} testID={props.testID || 'map-marker'} />;
  return { __esModule: true, default: MapView, Polyline, Marker };
});

import MapScreen from '../screens/MapScreen';
import { getSheet } from '../theme/styles';
import { makePalette } from '../theme/palette';
import { DEFAULT_PROFILE, DEFAULT_REGION } from '../constants';
import { distanceBetweenFixes } from '../lib/track';
import { formatDistance } from '../lib/format';

const styles = getSheet('light', 'green');
const t = makePalette('light', 'green');
const noop = () => {};

// Meridian geometry: MapScreen's gap helper is the R=6371000 haversine.
const METERS_PER_DEG_LAT = (Math.PI * 6371000) / 180;

// Snapped start of candidate route-0.
const START_0 = { latitude: 28.5, longitude: 77.2 };
// Second candidate route-0b (same start — exercises dashes alongside routes).
const START_ALT = { latitude: 28.503, longitude: 77.205 };

const candidates = (starts, firstName = 'route-0', secondName = 'route-1') => [
  {
    id: firstName,
    coordinates: [starts[0], { latitude: starts[0].latitude + 0.005, longitude: starts[0].longitude + 0.01 }],
    distanceMeters: 1200,
    durationSeconds: 900,
    pm25_estimate: null,
  },
  {
    id: secondName,
    coordinates: [
      starts[1],
      { latitude: starts[1].latitude + 0.005, longitude: starts[1].longitude + 0.01 },
    ],
    distanceMeters: 1800,
    durationSeconds: 1100,
    pm25_estimate: null,
  },
];

// A point `meters` due north of `start` (haversine-precise along a meridian).
const northOf = (start, meters) => ({
  latitude: start.latitude + meters / METERS_PER_DEG_LAT,
  longitude: start.longitude,
});

const baseProps = ({ cur, accuracy, candidates: list, selectedId = 'route-0', panelExpanded = false }) => ({
  styles,
  t,
  isDark: false,
  primary: list.find((c) => c.id === selectedId) || list[0],
  mapRef: { current: null },
  location: DEFAULT_REGION,
  currentCoords: cur,
  currentAccuracy: accuracy,
  locationError: null,
  locationBannerDismissed: true,
  setLocationBannerDismissed: noop,
  userPos: null,
  followUser: true,
  setFollowUser: noop,
  destinationCoord: null,
  destination: '',
  setDestination: noop,
  routeStatus: 'success',
  routeError: null,
  candidates: list,
  selectedId,
  setSelectedId: noop,
  preference: 'manual',
  applyPreference: noop,
  setPreference: noop,
  mode: 'walking',
  setMode: noop,
  panelExpanded,
  setPanelExpanded: noop,
  profile: DEFAULT_PROFILE,
  chipPhotoFailed: false,
  setChipPhotoFailed: noop,
  tripActive: false,
  tripElapsed: 0,
  tripDistance: 0,
  lowAccuracyActive: false,
  tripDetailsExpanded: false,
  setTripDetailsExpanded: noop,
  distUnit: 'metric',
  findRoute: noop,
  startTrip: noop,
  finishTrip: noop,
  setView: noop,
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('route-start connector (dashed representation of the road snap)', () => {
  test('gap >= 25m renders the connector polyline from origin to the snapped start', async () => {
    const cur = northOf(START_0, 45); // ~45m from the snapped start
    const gap = distanceBetweenFixes(cur, START_0);
    expect(gap).toBeGreaterThanOrEqual(25);

    const list = candidates([START_0, START_ALT]);
    const { getByTestId } = await render(
      <MapScreen {...baseProps({ cur, accuracy: null, candidates: list })}
      />
    );

    const connector = getByTestId('routeConnector');
    // Exactly two points: request origin -> candidate's snapped start.
    expect(connector.props.coordinates).toHaveLength(2);
    expect(connector.props.coordinates[0]).toEqual(cur);
    expect(connector.props.coordinates[1]).toEqual(START_0);
    // Visually distinct from route lines: dashed, thinner, amber, translucent.
    expect(connector.props.lineDashPattern).toEqual([3, 6]);
    expect(connector.props.strokeWidth).toBe(3);
    expect(connector.props.strokeColor).toBe(t.amber);
    expect(connector.props.opacity).toBe(0.7);
  });

  test('gap < 25m renders no connector (GPS noise dominates below the threshold)', async () => {
    const cur = northOf(START_0, 20);
    const gap = distanceBetweenFixes(cur, START_0);
    expect(gap).toBeLessThan(25);

    const list = candidates([START_0, START_ALT]);
    const { queryByTestId } = await render(
      <MapScreen {...baseProps({ cur, accuracy: 5, candidates: list })} />
    );
    expect(queryByTestId('routeConnector')).toBeNull();
  });

  test('no captured origin (currentCoords null / non-finite) renders no connector', async () => {
    const list = candidates([START_0, START_ALT]);
    const absent1 = await render(
      <MapScreen {...baseProps({ cur: null, accuracy: null, candidates: list })} />
    );
    expect(absent1.queryByTestId('routeConnector')).toBeNull();

    const cur = { latitude: Number.NaN, longitude: START_0.longitude };
    const absent2 = await render(
      <MapScreen {...baseProps({ cur, accuracy: null, candidates: list })} />
    );
    expect(absent2.queryByTestId('routeConnector')).toBeNull();
  });

  test('no selectedId yet renders no connector', async () => {
    const cur = northOf(START_0, 45);
    const list = candidates([START_0, START_ALT]);
    const { queryByTestId } = await render(
      <MapScreen {...baseProps({ cur, accuracy: null, candidates: list, selectedId: null })} />
    );
    expect(queryByTestId('routeConnector')).toBeNull();
  });

  test('expanded panel shows the honest caption at ~45m; unknown accuracy adds no drift sentence', async () => {
    const cur = northOf(START_0, 45);
    const gap = distanceBetweenFixes(cur, START_0);
    const list = candidates([START_0, START_ALT]);
    const { getByTestId, getByText, queryByText } = await render(
      <MapScreen {...baseProps({ cur, accuracy: null, candidates: list, panelExpanded: true })} />
    );

    expect(getByTestId('routeConnector')).toBeTruthy();
    expect(
      getByText(
        `Route starts about ${formatDistance(gap, 'metric')} away, at the nearest walkable road. The dashed link shows where you step onto it.`
      )
    ).toBeTruthy();
    // Accuracy unknown -> the drift context sentence stays out entirely.
    expect(queryByText(/may drift by about/)).toBeNull();
  });

  test('accuracy comparable to the gap adds the drift sentence (accuracy 40m at gap ~45m)', async () => {
    const cur = northOf(START_0, 45);
    const gap = distanceBetweenFixes(cur, START_0);
    expect(40).toBeGreaterThan(gap * 0.8);

    const list = candidates([START_0, START_ALT]);
    const { getByText } = await render(
      <MapScreen
        {...baseProps({ cur, accuracy: 40, candidates: list, panelExpanded: true })}
      />
    );
    expect(
      getByText('Your location marker may drift by about 40 m on this device.')
    ).toBeTruthy();
  });

  test('collapsed panel shows no caption (collapsed branch untouched)', async () => {
    const cur = northOf(START_0, 45);
    const list = candidates([START_0, START_ALT]);
    const { getByTestId, queryByText } = await render(
      <MapScreen {...baseProps({ cur, accuracy: 40, candidates: list, panelExpanded: false })} />
    );
    // The dashed link still draws on the map...
    expect(getByTestId('routeConnector')).toBeTruthy();
    // ...but the caption exists only in the expanded panel.
    expect(queryByText(/away, at the nearest walkable road/)).toBeNull();
    expect(queryByText(/may drift by about/)).toBeNull();
  });

  test('connector anchors to the SELECTED candidate start (per-alternate gap, not candidates[0])', async () => {
    // Selected alternate starts at START_ALT (~45m from cur), while
    // candidates[0] starts at ANOTHER point far away — if the connector
    // wrongly used candidates[0], its second endpoint would differ.
    const farStart0 = northOf(START_0, 300);
    const cur = northOf(START_ALT, 45);
    const gapFromSelected = distanceBetweenFixes(cur, START_ALT);
    const gapFromFirst = distanceBetweenFixes(cur, farStart0);
    expect(gapFromSelected).toBeGreaterThanOrEqual(25);
    expect(gapFromFirst).toBeGreaterThan(gapFromSelected);

    const list = candidates([farStart0, START_ALT]);
    const { getByTestId, getByText } = await render(
      <MapScreen
        {...baseProps({
          cur,
          accuracy: null,
          candidates: list,
          selectedId: 'route-1',
          panelExpanded: true,
        })}
      />
    );
    const connector = getByTestId('routeConnector');
    expect(connector.props.coordinates).toHaveLength(2);
    expect(connector.props.coordinates[1]).toEqual(START_ALT);
    expect(getByText(
      `Route starts about ${formatDistance(gapFromSelected, 'metric')} away, at the nearest walkable road. The dashed link shows where you step onto it.`
    )).toBeTruthy();
  });
});
