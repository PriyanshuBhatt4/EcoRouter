// 'Remember my route goal' (persisted preference) — App-shell regression.
//
// Behavior contract:
// - Goal-chip presses ALWAYS record lastRouteGoal at @EcoRoute/prefs
//   (validated PREFERENCES member), even while the Remember toggle is off —
//   recording happens unconditionally; only its USE depends on the toggle.
// - rememberRouteGoal=false: EXACTLY the old behavior — every search starts
//   unselected (applyRouteResults resets to MANUAL, no restore).
// - rememberRouteGoal=true: after EVERY completed search the stored goal is
//   re-applied — same selection rule as the chips (selectByPreference); the
//   best candidate is picked when the goal is eligible, otherwise the first
//   candidate stays and the map's preferenceNote explains why.
// - Toggling the Settings row on mid-session does not retroactively change
//   the live selection; the next completed search uses it. Toggling off
//   restores the old reset-to-MANUAL behavior.
//
// Proof paths use await fireEvent / findBy* (RTL v14 async idioms, no manual
// act flushes). candidates come from a module-mocked /route response with TWO
// candidates so shortest/fastest selection is decisive (route-0: 1200 m /
// 900 s; route-1: 800 m / 1100 s — shortest -> route-1).

import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { getSheet } from '../theme/styles';

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

// API_BASE_URL must be truthy for the search flow to run; requireActual keeps
// every other shared constant (including parsePrefs) identical.
jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  API_BASE_URL: 'http://test-backend.local',
}));

jest.mock('../services/api', () => ({
  // The mock returns the SERVICE OUTPUT shape (mapped candidates), since the
  // real fetchRouteCandidates never runs: distanceMeters/durationSeconds are
  // the fields the map screen, chips selection and notes actually read.
  fetchRouteCandidates: jest.fn(async () => ({
    candidates: [
      {
        id: 'route-0',
        coordinates: [
          { latitude: 28.6, longitude: 77.2 },
          { latitude: 28.605, longitude: 77.21 },
        ],
        distanceMeters: 1200,
        durationSeconds: 900,
        pm25_estimate: null,
      },
      {
        id: 'route-1',
        coordinates: [
          { latitude: 28.6, longitude: 77.2 },
          { latitude: 28.61, longitude: 77.215 },
        ],
        distanceMeters: 800,
        durationSeconds: 1100,
        pm25_estimate: null,
      },
    ],
    destination: { latitude: 28.61, longitude: 77.215 },
  })),
  // App imports fetchWithTimeout alongside fetchRouteCandidates (used by the
  // saved-places geocode path, never called in these flows): passthrough to
  // the real implementation keeps the import resolvable and honest if a
  // future case does reach it.
  fetchWithTimeout: jest.fn((url, options) => jest.requireActual('../services/api').fetchWithTimeout(url, options)),
}));

// Handle onto the module mock so individual tests can stage rejections /
// one-off responses for the route search.
const { fetchRouteCandidates } = require('../services/api');

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
    clear: jest.fn(async () => {
      store.clear();
      return undefined;
    }),
  };
});

import App from '../App';

const SHORTEST_NOTE = 'Picks the route with the lowest distance.';
const FASTEST_NOTE = 'Picks the route with the lowest travel time.';

const storedPrefs = async () => {
  const raw = await AsyncStorage.getItem('@EcoRoute/prefs');
  return raw ? JSON.parse(raw) : null;
};

describe('Remember my route goal (App shell)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  const searchAndExpand = async (screen, destination) => {
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, destination);
    await fireEvent.press(await screen.findByText('Find Routes'));
    // Success panel starts collapsed; expand it to reach the chips + notes.
    await fireEvent.press(await screen.findByText('▾ Expand'));
    // Two route option cards prove the mocked response committed.
    await screen.findByText('Route 2');
  };

  test('toggle OFF (default): a completed search starts unselected — the previous behavior', async () => {
    const screen = await render(<App />);
    await searchAndExpand(screen, 'Some park');

    // No preference is active after the search: no shortest note, and the
    // preselected first candidate stays the primary (1200 m stat box).
    expect(screen.queryByText(SHORTEST_NOTE)).toBeNull();
    expect(screen.queryByText(FASTEST_NOTE)).toBeNull();
    expect(screen.queryByText('800 m')).toBeNull();

    // And nothing was written to the prefs key by the search itself.
    expect(await storedPrefs()).toBeNull();
  });

  test('remember ON: every completed search re-applies the stored goal and picks its best candidate', async () => {
    await AsyncStorage.setItem(
      '@EcoRoute/prefs',
      JSON.stringify({
        preferredMode: 'walking',
        rememberRouteGoal: true,
        lastRouteGoal: 'shortest',
      })
    );
    const screen = await render(<App />);
    await searchAndExpand(screen, 'Some park');

    // The stored goal is active again (its transparency note renders) and
    // the selection pick re-ran: shortest selects route-1 (800 m) over the
    // preselected route-0 (1200 m) — same rule as the goal chips.
    expect(await screen.findByText(SHORTEST_NOTE)).toBeTruthy();
    expect(await screen.findByText('800 m')).toBeTruthy();
  });

  test('goal-chip press records lastRouteGoal even while the toggle is off (recording vs using)', async () => {
    const screen = await render(<App />);
    await searchAndExpand(screen, 'Some park');

    // User picks the Shortest goal chip with the Remember toggle OFF.
    await fireEvent.press(await screen.findByText('Shortest'));

    const prefs = await storedPrefs();
    expect(prefs).not.toBeNull();
    expect(prefs.lastRouteGoal).toBe('shortest');
    // Recording does not flip the toggle; nothing extra was invented.
    expect(prefs.rememberRouteGoal).toBe(false);
  });

  test('Settings toggle ON mid-session: next completed search restores the goal; OFF resets to manual', async () => {
    // Goal recorded earlier (toggle still off — e.g. from a previous session).
    await AsyncStorage.setItem(
      '@EcoRoute/prefs',
      JSON.stringify({
        preferredMode: 'walking',
        rememberRouteGoal: false,
        lastRouteGoal: 'fastest',
      })
    );
    const screen = await render(<App />);
    await searchAndExpand(screen, 'First stop');
    // Toggle off: old behavior — goal NOT applied on the completed search.
    expect(screen.queryByText(FASTEST_NOTE)).toBeNull();

    // Settings: flip the Remember row on.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('Settings'));
    await fireEvent.press(await screen.findByLabelText('Remember my route goal'));

    // The toggle persisted immediately (and left the recorded goal alone).
    let prefs = await storedPrefs();
    expect(prefs.rememberRouteGoal).toBe(true);
    expect(prefs.lastRouteGoal).toBe('fastest');

    // Back to the map (panel is still expanded — view switches do not reset
    // state) and collapse, then run a NEW search: the stored goal is applied
    // by the completed search itself (collapse first so the panel state the
    // second search starts from is unambiguous).
    await fireEvent.press(await screen.findByText('‹ Back')); // Settings -> Profile
    await fireEvent.press(await screen.findByText('‹ Map')); // Profile -> Map
    await fireEvent.press(await screen.findByText('Collapse'));
    await fireEvent.press(await screen.findByText('Find Routes'));
    await fireEvent.press(await screen.findByText('▾ Expand'));
    expect(await screen.findByText(FASTEST_NOTE)).toBeTruthy();

    // Toggle back off, search again: legacy reset-to-MANUAL behavior.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('Settings'));
    await fireEvent.press(await screen.findByLabelText('Remember my route goal'));
    await fireEvent.press(await screen.findByText('‹ Back')); // Settings -> Profile
    await fireEvent.press(await screen.findByText('‹ Map')); // Profile -> Map
    await fireEvent.press(await screen.findByText('Collapse'));
    // Re-run the search on the same destination input.
    await fireEvent.press(await screen.findByText('Find Routes'));
    await fireEvent.press(await screen.findByText('▾ Expand'));
    expect(screen.queryByText(FASTEST_NOTE)).toBeNull();

    // The recorded goal survives toggling off (only its USE turned off).
    prefs = await storedPrefs();
    expect(prefs.rememberRouteGoal).toBe(false);
    expect(prefs.lastRouteGoal).toBe('fastest');
  });

  test('a FAILED search commits nothing: error card, no goal application, no selection, no pref note', async () => {
    // Remember toggle is ON with a stored shortest goal: a failed search must
    // still surface the error honestly — applyRouteResults never runs, so no
    // preference/state writes escape behind the failure.
    await AsyncStorage.setItem(
      '@EcoRoute/prefs',
      JSON.stringify({
        preferredMode: 'walking',
        rememberRouteGoal: true,
        lastRouteGoal: 'shortest',
      })
    );
    fetchRouteCandidates.mockRejectedValueOnce(new Error('boom'));

    // Module-mock jest.fns accumulate calls across the file's tests (the
    // existing tests share them), so the once-guard is asserted RELATIVE to
    // the calls made before this flow.
    const callsBefore = fetchRouteCandidates.mock.calls.length;

    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    await fireEvent.press(await screen.findByText('Find Routes'));

    // The error card renders with the failure (and its Try again affordance).
    expect(await screen.findByText('Route unavailable')).toBeTruthy();
    expect(await screen.findByText('boom')).toBeTruthy();

    // Nothing route-shaped was committed: no candidates, no selected option,
    // and no transparency note for the stored goal.
    expect(screen.queryByText('Route 2')).toBeNull();
    expect(screen.queryByText(SHORTEST_NOTE)).toBeNull();
    // Exactly ONE search call for this flow — the failure path must not
    // re-fetch or re-apply anything.
    expect(fetchRouteCandidates.mock.calls.length).toBe(callsBefore + 1);

    // Stored prefs were untouched by the failed flow.
    const prefs = await storedPrefs();
    expect(prefs.rememberRouteGoal).toBe(true);
    expect(prefs.lastRouteGoal).toBe('shortest');
  });

  test('remember ON with a stored cleanest goal: ineligible pm25 data keeps the FIRST candidate and explains why', async () => {
    // Stored goal = cleanest, toggle ON; the backend marks the enrichment as
    // NOT cross-route comparable (can_compare_cleanest false on both rows).
    await AsyncStorage.setItem(
      '@EcoRoute/prefs',
      JSON.stringify({
        preferredMode: 'walking',
        rememberRouteGoal: true,
        lastRouteGoal: 'cleanest',
      })
    );
    fetchRouteCandidates.mockImplementationOnce(async () => ({
      candidates: [
        {
          id: 'route-0',
          coordinates: [
            { latitude: 28.6, longitude: 77.2 },
            { latitude: 28.605, longitude: 77.21 },
          ],
          distanceMeters: 1200,
          durationSeconds: 900,
          pm25_estimate: { available: true, can_compare_cleanest: false, value: 12.5 },
        },
        {
          id: 'route-1',
          coordinates: [
            { latitude: 28.6, longitude: 77.2 },
            { latitude: 28.61, longitude: 77.215 },
          ],
          distanceMeters: 800,
          durationSeconds: 1100,
          pm25_estimate: { available: true, can_compare_cleanest: false, value: 9.1 },
        },
      ],
      destination: { latitude: 28.61, longitude: 77.215 },
    }));

    const screen = await render(<App />);
    await searchAndExpand(screen, 'Some park');

    // The ineligible CLEANEST note explains why the manual selection was
    // kept — and the eligible-rule note does NOT render.
    expect(await screen.findByText('Cleanest needs comparable exposure estimates for all routes.')).toBeTruthy();
    expect(screen.queryByText('Picks the route with the lowest modelled PM2.5 (µg/m³).')).toBeNull();

    // Selection stays on the preselected FIRST candidate: the Option-card
    // title style proves it (no auto-pick happened for an ineligible goal).
    const styles = getSheet('light', 'green');
    const selectedTitle = screen.getByText('Route 1');
    const selectedStyles = Array.isArray(selectedTitle.props.style)
      ? selectedTitle.props.style
      : [selectedTitle.props.style];
    expect(selectedStyles).toContain(styles.optionTitleSelected);
    const otherTitle = screen.getByText('Route 2');
    const otherStyles = Array.isArray(otherTitle.props.style)
      ? otherTitle.props.style
      : [otherTitle.props.style];
    expect(otherStyles).not.toContain(styles.optionTitleSelected);
    // The primary stat box shows the first candidate's distance.
    expect(await screen.findByText('1.2 km')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Same-frame reentrancy + erase-all race guards (App shell). Two tap events
// landing in the same frame run against the same pre-flush closure — the
// STATE checkpoints alone would let both through. Handlers claim refs
// (routeBusyRef / tripActiveRef) synchronously so the second call no-ops;
// erase-all bumps a data epoch so a search finishing AFTER the erase commits
// nothing onto the fresh session. Each press pair runs inside ONE act() so no
// render commit can land between the two handler invocations.
// ---------------------------------------------------------------------------
describe('Reentrancy + erase-all race guards (App shell)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  // Same-frame double-taps: two unawaited presses on the SAME node inside one
  // act() — both handlers run against the same pre-flush closure (the
  // committed 'loading' state cannot have rendered between them), so only the
  // synchronous ref claim can stop the second invocation. (React logs an
  // overlapping-act warning for the nested scopes; that is the deliberate
  // simulation, not a leak into the app.)
  test('a same-frame double-tap on Find Routes fetches exactly once', async () => {
    // Module-mocked calls accumulate across this file's tests: assert
    // relative to the calls made before this flow.
    const callsBefore = fetchRouteCandidates.mock.calls.length;
    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    const findBtn = await screen.findByText('Find Routes');

    await act(async () => {
      fireEvent.press(findBtn);
      fireEvent.press(findBtn);
    });
    expect(fetchRouteCandidates.mock.calls.length).toBe(callsBefore + 1);
  });

  test('a same-frame double-tap on Start Trip registers exactly one position watcher', async () => {
    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    await fireEvent.press(await screen.findByText('Find Routes'));
    await fireEvent.press(await screen.findByText('▾ Expand'));

    const startBtn = await screen.findByText('Start Trip');
    await act(async () => {
      fireEvent.press(startBtn);
      fireEvent.press(startBtn);
    });
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  test('a same-frame double-tap on Finish Trip persists exactly one trip record', async () => {
    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    await fireEvent.press(await screen.findByText('Find Routes'));
    await fireEvent.press(await screen.findByText('▾ Expand'));
    await fireEvent.press(await screen.findByText('Start Trip'));

    // Collapsed trip card exposes Finish Trip. Without the sync claim the
    // second close-over run of finishTrip would persist a duplicate record
    // (its `trips` closure lacks the first one).
    const finishBtn = await screen.findByText('Finish Trip');
    await act(async () => {
      fireEvent.press(finishBtn);
      fireEvent.press(finishBtn);
    });
    const raw = await AsyncStorage.getItem('@EcoRoute/trips');
    expect(JSON.parse(raw)).toHaveLength(1);
  });

  test('erase-all during an in-flight search: the late result applies nothing and persists nothing', async () => {
    // Hold the fetch open so the search is guaranteed in flight across the
    // whole erase flow.
    let pendingResolve;
    fetchRouteCandidates.mockImplementationOnce(
      () => new Promise((resolve) => { pendingResolve = resolve; })
    );
    const alertSpy = jest.spyOn(Alert, 'alert');

    const screen = await render(<App />);
    const input = await screen.findByPlaceholderText('Where to? (e.g., Hauz Khas)');
    await fireEvent.changeText(input, 'Some park');
    const findBtn = await screen.findByText('Find Routes');
    // Awaited presses hang here: fireEvent wraps dispatch in react act(),
    // which does not settle while the handler awaits the still-pending
    // fetch — so dispatch WITHOUT awaiting the promise. The handler's
    // synchronous part (state -> loading) still runs inside its act body.
    void fireEvent.press(findBtn);

    // Start the erase flow while the search is pending (Profile → Settings →
    // Erase all data), then confirm BOTH dialogs.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('Settings'));
    await fireEvent.press(await screen.findByText('Erase all data'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      alertSpy.mock.calls[0][2][1].onPress(); // first dialog: 'Erase'
    });
    expect(alertSpy).toHaveBeenCalledTimes(2);
    await act(async () => {
      alertSpy.mock.calls[1][2][1].onPress(); // second dialog: 'Yes, erase everything'
      await Promise.resolve(); // let doEraseAll's awaits settle
    });

    // Now the held search completes AFTER the erase:
    await act(async () => {
      pendingResolve({
        candidates: [
          {
            id: 'route-0',
            coordinates: [
              { latitude: 28.6, longitude: 77.2 },
              { latitude: 28.605, longitude: 77.21 },
            ],
            distanceMeters: 1200,
            durationSeconds: 900,
            pm25_estimate: null,
          },
        ],
        destination: { latitude: 28.605, longitude: 77.21 },
      });
    });

    // Nothing route-shaped leaked onto the erased session: no recent chip
    // written, no candidates/selection applied (the map returns to idle).
    expect(await AsyncStorage.getItem('@EcoRoute/recentDestinations')).toBeNull();
    // doEraseAll leaves the app on Profile itself — go straight back to Map.
    await fireEvent.press(await screen.findByText('‹ Map'));
    expect(await screen.findByText('Plan your walk or cycle')).toBeTruthy();
    expect(screen.queryByText('Route 1')).toBeNull();
  });
});
