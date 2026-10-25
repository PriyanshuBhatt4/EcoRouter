import React from 'react';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react-native';
import { Alert, Share, Dimensions } from 'react-native';

// Same maps mock as App.smoke.test.js, so MapScreen renders without a native map.
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

// Same native-module mocks as App.smoke.test.js, so the App-level Alert
// confirmation tests can render the real app shell and navigate it. The
// AsyncStorage store is pre-seeded with one saved trip so the History list
// and detail screen have content deterministically.
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
  store.set(
    '@EcoRoute/trips',
    JSON.stringify([
      {
        id: '1',
        date: '2026-01-01T09:00:00.000Z',
        mode: 'walking',
        actualDistanceM: 1500,
        durationSec: 1200,
      },
    ])
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

import { getSheet } from '../theme/styles';
import { makePalette } from '../theme/palette';
import { ATTRIBUTION_TEXT, DEFAULT_PROFILE, DEFAULT_REGION } from '../constants';
import { paceLabel } from '../lib/stats';
import { distanceBetweenFixes } from '../lib/track';
import { formatDistance } from '../lib/format';

import App from '../App';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SavedPlacesScreen from '../screens/SavedPlacesScreen';
import MapPickerScreen from '../screens/MapPickerScreen';

const styles = getSheet('light', 'green');
const t = makePalette('light', 'green');

// Minimal localStorage-free prop stubs; only strings rendered matter here.
const noop = () => {};

// RTL v14 notes (mirrors the App.smoke baseline, which uses no manual flush):
// - render() is async and already act-wrapped, so there is no trailing
//   `await act(async () => {})` flush anywhere in this file — mixing a manual
//   act flush into the awaited-render flow is the classic "overlapping act()
//   calls" trigger and poisons the act environment for later tests.
// - fireEvent (and fireEvent.press) are async and act-wrapped; every call is
//   awaited so the wrapped state update commits before the next query runs.
afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe('Screens smoke test', () => {
  test('MapScreen renders idle state (top bar, bottom card, attribution)', async () => {
    const screen = (
      <MapScreen
        styles={styles}
        t={t}
        isDark={false}
        primary={undefined}
        mapRef={{ current: null }}
        location={DEFAULT_REGION}
        locationError={null}
        locationBannerDismissed={false}
        setLocationBannerDismissed={noop}
        userPos={null}
        followUser={true}
        setFollowUser={noop}
        destinationCoord={null}
        destination={''}
        setDestination={noop}
        routeStatus={'idle'}
        routeError={null}
        candidates={[]}
        selectedId={null}
        setSelectedId={noop}
        preference={'manual'}
        applyPreference={noop}
        setPreference={noop}
        mode={'walking'}
        setMode={noop}
        panelExpanded={true}
        setPanelExpanded={noop}
        profile={DEFAULT_PROFILE}
        chipPhotoFailed={false}
        setChipPhotoFailed={noop}
        tripActive={false}
        tripElapsed={0}
        tripDistance={0}
        lowAccuracyActive={false}
        tripDetailsExpanded={false}
        setTripDetailsExpanded={noop}
        distUnit={'metric'}
        findRoute={noop}
        startTrip={noop}
        finishTrip={noop}
        setView={noop}
      />
    );
    const { getByPlaceholderText, getByText, getByTestId, getByLabelText } = await render(screen);

    expect(getByTestId('map-view')).toBeTruthy();
    expect(getByPlaceholderText('Where to? (e.g., Hauz Khas)')).toBeTruthy();
    expect(getByLabelText('Profile')).toBeTruthy();
    expect(getByText('TRIP MODE')).toBeTruthy();
    expect(getByText('Plan your walk or cycle')).toBeTruthy();
    expect(getByText('Type a destination above to compare up to 3 routes.')).toBeTruthy();
    expect(getByText('Find Routes')).toBeTruthy();
    expect(getByText(ATTRIBUTION_TEXT)).toBeTruthy();
  });

  test('MapScreen renders collapsed active-trip card and success panel content', async () => {
    const draftCandidates = [
      {
        id: 'route-0',
        coordinates: [
          { latitude: 28.5, longitude: 77.2 },
          { latitude: 28.51, longitude: 77.21 },
        ],
        distanceMeters: 1200,
        durationSeconds: 900,
        pm25_estimate: null,
      },
    ];
    const screen = (
      <MapScreen
        styles={styles}
        t={t}
        isDark={false}
        primary={draftCandidates[0]}
        mapRef={{ current: null }}
        location={DEFAULT_REGION}
        locationError={null}
        locationBannerDismissed={true}
        setLocationBannerDismissed={noop}
        userPos={{ latitude: 28.5, longitude: 77.2 }}
        followUser={false}
        setFollowUser={noop}
        destinationCoord={null}
        destination={''}
        setDestination={noop}
        routeStatus={'success'}
        routeError={null}
        candidates={draftCandidates}
        selectedId={'route-0'}
        setSelectedId={noop}
        preference={'manual'}
        applyPreference={noop}
        setPreference={noop}
        mode={'walking'}
        setMode={noop}
        panelExpanded={true}
        setPanelExpanded={noop}
        profile={DEFAULT_PROFILE}
        chipPhotoFailed={false}
        setChipPhotoFailed={noop}
        tripActive={true}
        tripElapsed={65}
        tripDistance={52}
        lowAccuracyActive={false}
        tripDetailsExpanded={false}
        setTripDetailsExpanded={noop}
        distUnit={'metric'}
        findRoute={noop}
        startTrip={noop}
        finishTrip={noop}
        setView={noop}
      />
    );
    const { getByText, getByLabelText } = await render(screen);

    // Collapsed active-trip card (compact row) drives the bottom card here.
    expect(getByLabelText('Show trip details')).toBeTruthy();
    expect(getByText('Details ▾')).toBeTruthy();
    expect(getByText('Finish Trip')).toBeTruthy();
    expect(getByText('Recenter')).toBeTruthy();
  });

  // ADDITIVE distance-pause caption (structural): MapScreen shows the honest
  // "distance is paused" note next to the distance line ONLY when the parent
  // flags it (distancePaused === true) AND a trip is active. Default mount
  // (prop omitted/false) renders nothing — pre-existing behavior untouched.
  test('MapScreen trip card renders the distance-pause caption only while paused', async () => {
    const tripProps = {
      styles,
      t,
      isDark: false,
      primary: undefined,
      mapRef: { current: null },
      location: DEFAULT_REGION,
      locationError: null,
      locationBannerDismissed: true,
      setLocationBannerDismissed: noop,
      userPos: null,
      followUser: true,
      setFollowUser: noop,
      destinationCoord: null,
      destination: '',
      setDestination: noop,
      routeStatus: 'idle',
      routeError: null,
      candidates: [],
      selectedId: null,
      setSelectedId: noop,
      preference: 'manual',
      applyPreference: noop,
      setPreference: noop,
      mode: 'walking',
      setMode: noop,
      panelExpanded: true,
      setPanelExpanded: noop,
      profile: DEFAULT_PROFILE,
      chipPhotoFailed: false,
      setChipPhotoFailed: noop,
      tripActive: true,
      tripElapsed: 65,
      tripDistance: 52,
      lowAccuracyActive: false,
      tripDetailsExpanded: false,
      setTripDetailsExpanded: noop,
      distUnit: 'metric',
      findRoute: noop,
      startTrip: noop,
      finishTrip: noop,
      setView: noop,
    };
    const PAUSED_NOTE = 'Distance is paused while GPS signal is unreliable.';

    // Default: prop omitted entirely (defaults to false) — no caption.
    const unpaused = await render(<MapScreen {...tripProps} />);
    expect(unpaused.queryByText(PAUSED_NOTE)).toBeNull();
    // The collapsed trip card is still the compact row with its distance.
    expect(unpaused.getByText('Finish Trip')).toBeTruthy();

    // Paused: same trip card state, caption present.
    const paused = await render(<MapScreen {...tripProps} distancePaused={true} />);
    expect(paused.getByText(PAUSED_NOTE)).toBeTruthy();
  });

  // Timeout-coherence companion to the 30s client fetch budget: while a
  // search runs (routeStatus 'loading') the map card sets the expectation
  // honestly — a slow-but-succeeding route can take up to about half a
  // minute before either routes or an error appear. The caption exists ONLY
  // while searching: the idle state keeps the plain planner hint (no
  // expectation claim before anything is in flight).
  test('MapScreen shows the slow-search caption while loading and none when idle', async () => {
    const baseProps = {
      styles,
      t,
      isDark: false,
      primary: undefined,
      mapRef: { current: null },
      location: DEFAULT_REGION,
      locationError: null,
      locationBannerDismissed: true,
      setLocationBannerDismissed: noop,
      userPos: null,
      followUser: true,
      setFollowUser: noop,
      destinationCoord: null,
      destination: '',
      setDestination: noop,
      routeError: null,
      candidates: [],
      selectedId: null,
      setSelectedId: noop,
      preference: 'manual',
      applyPreference: noop,
      setPreference: noop,
      mode: 'walking',
      setMode: noop,
      panelExpanded: true,
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
    };

    const searching = await render(<MapScreen {...baseProps} routeStatus={'loading'} />);
    expect(
      searching.getByText('Finding routes — this can take up to about half a minute on slow days.')
    ).toBeTruthy();
    // The existing spinner/heading row is still there next to the caption.
    expect(searching.getByText('Finding routes…')).toBeTruthy();

    const idle = await render(<MapScreen {...baseProps} routeStatus={'idle'} />);
    expect(
      idle.queryByText('Finding routes — this can take up to about half a minute on slow days.')
    ).toBeNull();
    expect(idle.getByText('Plan your walk or cycle')).toBeTruthy();
  });

  test('ProfileScreen renders hero, lifetime totals, streak, badges entry rows', async () => {
    const { getByText, root } = await render(
      <ProfileScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={[]}
        profile={DEFAULT_PROFILE}
        distUnit={'metric'}
        saveProfile={noop}
        changeProfilePhoto={noop}
        removeProfilePhoto={noop}
        openHistory={noop}
        setView={noop}
      />
    );
    expect(getByText('Profile')).toBeTruthy();
    expect(getByText('YOUR DETAILS')).toBeTruthy();
    expect(getByText('LIFETIME TOTALS')).toBeTruthy();
    expect(getByText('TRIP STREAK')).toBeTruthy();
    expect(getByText('ACHIEVEMENTS')).toBeTruthy();
    expect(getByText('RECENT TRIPS')).toBeTruthy();
    expect(getByText('No completed trips yet.')).toBeTruthy();

    // Pre-heatmap streak panel structure: the horizontal grid ScrollView
    // (style streakGridScroll) renders, and it contains at least one activity
    // cell node (style streakCell). No live-clock content is asserted here —
    // the pure streakCalendar helper has its own suite for calendar content.
    // Heatmap redesign (visual-only), structural additions on top:
    const flattenStyle = (s) => (Array.isArray(s) ? s.flatMap(flattenStyle) : [s]);
    const scrollMatches = root.queryAll((inst) =>
      flattenStyle(inst.props.style ?? {}).includes(styles.streakGridScroll)
    );
    expect(scrollMatches.length).toBe(1);
    const cellNodes = scrollMatches[0].queryAll((inst) =>
      flattenStyle(inst.props.style ?? {}).includes(styles.streakCell)
    );
    expect(cellNodes.length).toBeGreaterThan(0);

    // The 7 fixed weekday rows are labeled. The month labels are structural
    // only: the rendered plan is always ≥ 1 (the first group never skips),
    // the clearance skip rule may drop short window-start followers, and a
    // 13-month year window does repeat one month name at both ends (Oct 2025
    // … Oct 2026) — so the invariant is that every ADJACENT rendered pair
    // differs (no month printed twice in a row), never a global unique set.
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(getByText(day)).toBeTruthy();
    }
    const monthLabels = root.queryAll((inst) =>
      flattenStyle(inst.props.style ?? {}).includes(styles.streakMonthLabel)
    );
    expect(monthLabels.length).toBeGreaterThanOrEqual(1);
    const labelTexts = monthLabels.map((n) => n.props.children);
    for (let i = 1; i < labelTexts.length; i++) {
      expect(labelTexts[i]).not.toBe(labelTexts[i - 1]);
    }

    // Explicit-width contract: the month-label row and the grid assembly
    // each carry a numeric pixel width style and the two values are EQUAL —
    // both come from the same computeContentWidth(heat, true) plan, so the
    // rows can never truncate independently at the scroll content edge
    // (regression guard for the right-edge clipping report). Scan style the
    // same lean way as above (queryAll + flattened style array).
    const monthsRowNodes = scrollMatches[0].queryAll((inst) =>
      flattenStyle(inst.props.style ?? {}).includes(styles.streakMonthsRow)
    );
    const gridNodes = scrollMatches[0].queryAll((inst) =>
      flattenStyle(inst.props.style ?? {}).includes(styles.streakGrid)
    );
    expect(monthsRowNodes.length).toBe(1);
    expect(gridNodes.length).toBe(1);
    const explicitWidth = (node) => {
      const entries = flattenStyle(node.props.style ?? {}).filter(
        (s) => s && typeof s === 'object' && typeof s.width === 'number'
      );
      expect(entries.length).toBeGreaterThan(0);
      return entries.map((e) => e.width);
    };
    const rowWidths = explicitWidth(monthsRowNodes[0]);
    const gridWidths = explicitWidth(gridNodes[0]);
    expect(rowWidths).toHaveLength(1);
    expect(gridWidths).toHaveLength(1);
    expect(rowWidths[0]).toBe(gridWidths[0]);
    // Positive, plausible year-window width (38px chrome minimum).
    expect(rowWidths[0]).toBeGreaterThan(38);

    // Legend is fully static (all five swatches render always), so every
    // label is present regardless of trip data or the current date.
    expect(getByText('No activity')).toBeTruthy();
    expect(getByText('1 trip')).toBeTruthy();
    expect(getByText('2 trips')).toBeTruthy();
    expect(getByText('3+ trips')).toBeTruthy();
    expect(getByText('Before first trip')).toBeTruthy();
  });

  test('ProfileScreen with dashboard.recent=false hides the RECENT TRIPS block and keeps a View all history row', async () => {
    const { getByText, getByLabelText, queryByText } = await render(
      <ProfileScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={[]}
        profile={DEFAULT_PROFILE}
        prefs={{
          preferredMode: 'walking',
          dashboard: { week: true, achievements: true, streak: true, recent: false },
        }}
        distUnit={'metric'}
        saveProfile={noop}
        changeProfilePhoto={noop}
        removeProfilePhoto={noop}
        openHistory={noop}
        setView={noop}
      />
    );
    // Hidden block: the RECENT TRIPS header and its rows never render…
    expect(queryByText('RECENT TRIPS')).toBeNull();
    // …but navigation to the full history list stays reachable via the
    // standalone row card.
    expect(getByText('View all history')).toBeTruthy();
    expect(getByLabelText('View all trip history')).toBeTruthy();
  });

  test('HistoryScreen renders empty state, list state and detail state', async () => {
    const trips = [
      {
        id: '1',
        date: new Date('2026-01-01T09:00:00Z').toISOString(),
        mode: 'walking',
        actualDistanceM: 1500,
        durationSec: 1200,
      },
    ];
    const { getByText, getByLabelText, rerender } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={[]}
        tripsLoaded={false}
        detailTripId={null}
        draftTripId={null}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        setView={noop}
      />
    );
    // Loading row on cold start.
    expect(getByText('History')).toBeTruthy();

    // List state with one trip.
    await rerender(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={null}
        draftTripId={null}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        setView={noop}
      />
    );
    expect(getByText('1 trip saved')).toBeTruthy();
    expect(getByLabelText('Open trip details')).toBeTruthy();

    // Detail state (non-null detailTripId).
    await rerender(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'1'}
        draftTripId={'1'}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        setView={noop}
      />
    );
    expect(getByText('Trip')).toBeTruthy();
    expect(getByText('AIR EXPOSURE (EST.)')).toBeTruthy();
    expect(getByText('NOTES')).toBeTruthy();
    expect(getByText('Delete trip')).toBeTruthy();
  });

  // Corrupt stored trip date regression: a trip whose `date` field cannot be
  // parsed (old/wrong-format storage hand-edit) previously rendered JS's
  // 'Invalid Date' in the history LIST row. The row must show the honest
  // 'Date not available' fallback instead — and never any 'Invalid Date'.
  test('HistoryScreen list row shows "Date not available" for a corrupt stored trip date', async () => {
    const { getByText, queryByText, getByLabelText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={[
          {
            id: 'bad-date',
            date: 'not a real date',
            mode: 'walking',
            actualDistanceM: 800,
            durationSec: 600,
          },
        ]}
        tripsLoaded={true}
        detailTripId={null}
        draftTripId={null}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );
    expect(getByText('1 trip saved')).toBeTruthy();
    expect(getByLabelText('Open trip details')).toBeTruthy();
    expect(getByText('Date not available')).toBeTruthy();
    expect(queryByText(/Invalid Date/)).toBeNull();
  });

  // Same corruption surfaced through the DETAIL screen (open by id): the
  // detail card previously rendered 'Invalid Date' for the stored date too.
  test('HistoryScreen detail card shows "Date not available" for a corrupt stored trip date', async () => {
    const { getByText, queryByText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={[
          {
            id: 'bad-date',
            date: 'not a real date',
            mode: 'walking',
            actualDistanceM: 800,
            durationSec: 600,
          },
        ]}
        tripsLoaded={true}
        detailTripId={'bad-date'}
        draftTripId={'bad-date'}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );
    expect(getByText('Trip')).toBeTruthy();
    expect(getByText('Date not available')).toBeTruthy();
    expect(queryByText(/Invalid Date/)).toBeNull();
  });

  test('SettingsScreen renders preferences (units + mode), routing memory, dashboard toggles, data and about sections', async () => {
    const { getByText, getByLabelText } = await render(
      <SettingsScreen
        styles={styles}
        isDark={false}
        profile={DEFAULT_PROFILE}
        trips={[]}
        themeMode={'system'}
        accentName={'green'}
        applyTheme={noop}
        applyAccent={noop}
        applyRememberRouteGoal={noop}
        setDistanceUnit={noop}
        confirmEraseAll={noop}
        setView={noop}
      />
    );
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('APPEARANCE')).toBeTruthy();
    expect(getByText('Theme mode')).toBeTruthy();
    // The former UNITS card is now the PREFERENCES card (units + preferred
    // travel mode per the user-preferences milestone).
    expect(getByText('PREFERENCES')).toBeTruthy();
    expect(getByText('Distance units')).toBeTruthy();
    expect(getByText('Kilometres')).toBeTruthy();
    expect(getByText('Miles')).toBeTruthy();
    expect(getByText('Preferred travel mode')).toBeTruthy();
    expect(getByText('Walking')).toBeTruthy();
    expect(getByText('Cycling')).toBeTruthy();
    expect(getByText('Used when the map screen starts.')).toBeTruthy();
    // ROUTING card: the remembered-goal switch (a dashboard-style row) sits
    // between the PREFERENCES and SAVED PLACES cards. Default prefs keep it
    // unchecked (toggle off = searches start unselected, today's behavior).
    expect(getByText('ROUTING')).toBeTruthy();
    expect(getByText('Remember my route goal')).toBeTruthy();
    expect(getByLabelText('Remember my route goal').props.accessibilityState).toEqual({ checked: false });
    // DASHBOARD card: four persisted visibility switch rows, in card order
    // (between PREFERENCES/ROUTING and DATA so section order stays
    // screen-stable).
    expect(getByText('DASHBOARD')).toBeTruthy();
    expect(getByText('This week summary')).toBeTruthy();
    expect(getByText('Achievements')).toBeTruthy();
    expect(getByText('Trip streak')).toBeTruthy();
    expect(getByText('Recent trips')).toBeTruthy();
    expect(getByText('DATA')).toBeTruthy();
    expect(getByText('No trips saved')).toBeTruthy();
    expect(getByText('Erase all data')).toBeTruthy();
    expect(getByText('ABOUT')).toBeTruthy();
    expect(getByText('EcoRoute')).toBeTruthy();
    expect(getByText(ATTRIBUTION_TEXT)).toBeTruthy();
  });

  test('SettingsScreen routing row fires applyRememberRouteGoal with the flipped flag', async () => {
    const applyRememberRouteGoal = jest.fn();
    const { getByLabelText } = await render(
      <SettingsScreen
        styles={styles}
        isDark={false}
        profile={DEFAULT_PROFILE}
        trips={[]}
        themeMode={'system'}
        accentName={'green'}
        prefs={{
          preferredMode: 'walking',
          dashboard: { week: true, achievements: true, streak: true, recent: true },
          rememberRouteGoal: false,
          lastRouteGoal: null,
        }}
        applyTheme={noop}
        applyAccent={noop}
        applyRememberRouteGoal={applyRememberRouteGoal}
        setDistanceUnit={noop}
        confirmEraseAll={noop}
        setView={noop}
      />
    );
    // Toggle off -> on: the row reports the flipped boolean (App.js persists
    // it through the prefs key; the screen only reports the intent).
    await fireEvent.press(getByLabelText('Remember my route goal'));
    expect(applyRememberRouteGoal).toHaveBeenCalledTimes(1);
    expect(applyRememberRouteGoal).toHaveBeenCalledWith(true);
  });

  test('HistoryScreen detail Share button opens Share.share with the honest trip summary', async () => {
    // Spy on the SAME Share module object HistoryScreen imports, so the real
    // share handler is exercised end-to-end without any native sheet.
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const trips = [
      {
        id: '1',
        date: new Date('2026-01-01T09:00:00Z').toISOString(),
        mode: 'walking',
        actualDistanceM: 1500,
        durationSec: 1200,
      },
    ];
    const { getByLabelText, getByText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'1'}
        draftTripId={'1'}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );

    // The record has no title, so the summary falls back to 'Trip' and the
    // share title does the same (no fabricated headings).
    await fireEvent.press(getByLabelText('Share this trip'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const [arg] = shareSpy.mock.calls[0];
    expect(arg.title).toBe('Trip');
    const lines = arg.message.split('\n');
    expect(lines[0]).toBe('Trip');
    // The date line is the same human rendering the detail card shows
    // (locale-dependent string — asserted loosely as a non-empty line).
    expect(lines[1].length).toBeGreaterThan(0);
    expect(lines).toContain('Mode: Walking');
    expect(lines).toContain('Distance: 1.5 km');
    expect(lines).toContain('Time: 20m 0s');
    // Pace is the shared derived figure, labeled exactly like the detail
    // caption ('Avg pace' for walking) — value from the same paceLabel call.
    expect(lines).toContain(`Avg pace: ${paceLabel(trips[0], 'metric')}`);
    expect(getByText('Delete trip')).toBeTruthy();
  });

  test('HistoryScreen detail Share composite: titled record omits fields it does not have', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const trips = [
      {
        id: '2',
        date: new Date('2026-02-02T09:00:00Z').toISOString(),
        mode: 'cycling',
        actualDistanceM: 5000,
        durationSec: 900,
        title: 'Morning ride',
      },
    ];
    const { getByLabelText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'2'}
        draftTripId={'2'}
        draftTitle={'Morning ride'}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );
    await fireEvent.press(getByLabelText('Share this trip'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const [arg] = shareSpy.mock.calls[0];
    expect(arg.title).toBe('Morning ride');
    const lines = arg.message.split('\n');
    expect(lines[0]).toBe('Morning ride');
    expect(lines).toContain('Mode: Cycling');
    expect(lines).toContain('Distance: 5.0 km');
    expect(lines).toContain('Time: 15m 0s');
    expect(lines).toContain(`Avg speed: ${paceLabel(trips[0], 'metric')}`);
  });

  // Share-sheet caps regression: a stored (legacy) title longer than the
  // notes input's 80-char maxLength is capped to 120 characters on BOTH the
  // message's title line and the sheet's title — neither part floods the
  // preview. (Legacy storage is user-reachable, so lengths beyond the input
  // cap are possible.)
  test('HistoryScreen Share caps both the message and the sheet title to 120 chars', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const longTitle = 'A very long legacy stored title '.repeat(7); // 224 chars
    const trips = [
      {
        id: '4',
        date: new Date('2026-03-03T09:00:00Z').toISOString(),
        mode: 'walking',
        actualDistanceM: 800,
        durationSec: 600,
        title: longTitle,
      },
    ];
    const { getByLabelText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'4'}
        draftTripId={'4'}
        draftTitle={longTitle}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );
    await fireEvent.press(getByLabelText('Share this trip'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const [arg] = shareSpy.mock.calls[0];
    const capped = longTitle.slice(0, 120);
    expect(arg.title).toBe(capped);
    expect(arg.message.split('\n')[0]).toBe(capped);
  });

  test('HistoryScreen detail Share dismiss/reject is silently ignored (no Alert, no crash)', async () => {
    // The sheet being dismissed resolves with 'dismissedAction' on some
    // platforms and REJECTS on others; HistoryScreen must ignore both —
    // never an Alert about a cancel, never an unhandled crash.
    const shareSpy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('user dismissed'));
    const alertSpy = jest.spyOn(Alert, 'alert');
    const trips = [
      {
        id: '3',
        date: new Date('2026-03-03T09:00:00Z').toISOString(),
        mode: 'walking',
        actualDistanceM: 800,
        durationSec: 600,
      },
    ];
    const { getByLabelText, getByText } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'3'}
        draftTripId={'3'}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={noop}
        openReplay={noop}
        setView={noop}
      />
    );
    await fireEvent.press(getByLabelText('Share this trip'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    // The detail screen is still intact after the ignored cancel.
    expect(getByText('Delete trip')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Interaction regressions: these guard against the reconstruction-artifact
  // class of bug (identifier used in a handler but never destructured/passed).
  // ---------------------------------------------------------------------------

  test('MapScreen route-option press selects that candidate via setSelectedId', async () => {
    const setSelectedId = jest.fn();
    const setPreference = jest.fn();
    const candidates = [
      {
        id: 'route-0',
        coordinates: [
          { latitude: 28.5, longitude: 77.2 },
          { latitude: 28.51, longitude: 77.21 },
        ],
        distanceMeters: 1200,
        durationSeconds: 900,
        pm25_estimate: null,
      },
      {
        id: 'route-1',
        coordinates: [
          { latitude: 28.5, longitude: 77.2 },
          { latitude: 28.52, longitude: 77.22 },
        ],
        distanceMeters: 1800,
        durationSeconds: 1100,
        pm25_estimate: null,
      },
    ];
    const { findByText } = await render(
      <MapScreen
        styles={styles}
        t={t}
        isDark={false}
        primary={candidates[0]}
        mapRef={{ current: null }}
        location={DEFAULT_REGION}
        locationError={null}
        locationBannerDismissed={true}
        setLocationBannerDismissed={noop}
        userPos={null}
        followUser={true}
        setFollowUser={noop}
        destinationCoord={null}
        destination={''}
        setDestination={noop}
        routeStatus={'success'}
        routeError={null}
        candidates={candidates}
        selectedId={'route-0'}
        setSelectedId={setSelectedId}
        preference={'manual'}
        applyPreference={noop}
        setPreference={setPreference}
        mode={'walking'}
        setMode={noop}
        panelExpanded={true}
        setPanelExpanded={noop}
        profile={DEFAULT_PROFILE}
        chipPhotoFailed={false}
        setChipPhotoFailed={noop}
        tripActive={false}
        tripElapsed={0}
        tripDistance={0}
        lowAccuracyActive={false}
        tripDetailsExpanded={false}
        setTripDetailsExpanded={noop}
        distUnit={'metric'}
        findRoute={noop}
        startTrip={noop}
        finishTrip={noop}
        setView={noop}
      />
    );

    // Two option cards render (candidates.length > 1); pressing the second
    // must select its candidate id (and drop back to MANUAL preference).
    // fireEvent is async in this RTL version: awaited so the act-wrapped
    // handler call completes before the spy assertions run.
    const route2 = await findByText('Route 2');
    await fireEvent.press(route2);
    expect(setSelectedId).toHaveBeenCalledTimes(1);
    expect(setSelectedId).toHaveBeenCalledWith('route-1');
    expect(setPreference).toHaveBeenCalledWith('manual');
  });

  // Shared success-state fixture for the two panel tests below (same
  // candidate shape as the route-option test above, so the results panel
  // mounts deterministically; only panelExpanded differs per test).
  const panelCandidates = [
    {
      id: 'route-0',
      coordinates: [
        { latitude: 28.5, longitude: 77.2 },
        { latitude: 28.51, longitude: 77.21 },
      ],
      distanceMeters: 1200,
      durationSeconds: 900,
      pm25_estimate: null,
    },
    {
      id: 'route-1',
      coordinates: [
        { latitude: 28.5, longitude: 77.2 },
        { latitude: 28.52, longitude: 77.22 },
      ],
      distanceMeters: 1800,
      durationSeconds: 1100,
      pm25_estimate: null,
    },
  ];
  const panelProps = (overrides = {}) => ({
    styles,
    t,
    isDark: false,
    primary: panelCandidates[0],
    mapRef: { current: null },
    location: DEFAULT_REGION,
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
    candidates: panelCandidates,
    selectedId: 'route-0',
    setSelectedId: noop,
    preference: 'manual',
    applyPreference: noop,
    setPreference: noop,
    mode: 'walking',
    setMode: noop,
    panelExpanded: true,
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
    ...overrides,
  });

  test('MapScreen success panel expanded: handle + pinned header + scrollable middle + fixed Start Trip footer', async () => {
    // Structural assertions only: RTL cannot measure clipping, so this
    // verifies the header (handle + collapse), the scroll container and the
    // fixed footer exist when expanded — and that exactly ONE collapse
    // control renders (the pinned header one; the footer ghost is gone).
    // (One render per test: the awaited-render flow in this file forbids a
    // mid-test unmount/second render — it triggers overlapping act() calls.)
    const expanded = await render(<MapScreen {...panelProps({ panelExpanded: true })} />);

    // Drag-handle affordance at the top of the card content (visual only).
    expect(expanded.getByTestId('panelHandle')).toBeTruthy();
    // Vertical scroll container wraps the route details...
    expect(expanded.getByTestId('routePanelScroll')).toBeTruthy();
    // ...and the footer button renders OUTSIDE it as a fixed sibling.
    expect(expanded.getByText('Start Trip')).toBeTruthy();

    // Collapse moved to the pinned header: the compact control is present,
    // and the old exact 'Collapse' footer label renders nowhere.
    expect(expanded.getByTestId('panelCollapseTouch')).toBeTruthy();
    expect(expanded.getByText('Collapse ▴')).toBeTruthy();
    expect(expanded.queryByText('Collapse')).toBeNull();
  });

  test('MapScreen success panel expanded: header Collapse dispatches setPanelExpanded(false)', async () => {
    // Control contract: pressing the pinned-header collapse touch dispatches
    // the SAME setPanelExpanded(false) the footer ghost dispatched before.
    const setPanelExpanded = jest.fn();
    const expanded = await render(
      <MapScreen {...panelProps({ panelExpanded: true, setPanelExpanded })} />
    );
    await fireEvent.press(expanded.getByTestId('panelCollapseTouch'));
    expect(setPanelExpanded).toHaveBeenCalledTimes(1);
    expect(setPanelExpanded).toHaveBeenCalledWith(false);
  });

  test('MapScreen success panel expanded: routePanelScroll carries a metric-driven pixel maxHeight', async () => {
    // Root-cause contract for "can't scroll": the ScrollView must not rely
    // on a percentage maxHeight from its auto-height parent — it needs a
    // definite pixel bound. MapScreen derives panelScrollMax =
    // max(120, round(window height * 0.58) − 190): the SAME window-height
    // card cap (58%) minus the card's fixed chrome (header row ~46, Start
    // Trip ~48, button gap 12, card padding ~32, safety) so the scroll
    // bound is subtracted from the card cap, never a second independent
    // percentage. The test reads it back from the rendered props (no
    // Dimensions mocking needed — this suite renders the real
    // react-native, whose jest preset provides the window metrics, so the
    // same value the code uses is retrievable via Dimensions.get('window')).
    const expanded = await render(<MapScreen {...panelProps({ panelExpanded: true })} />);
    const scroll = expanded.getByTestId('routePanelScroll');

    const flattenStyle = (s) => (Array.isArray(s) ? s.flatMap(flattenStyle) : [s]);
    const maxHeightEntry = flattenStyle(scroll.props.style)
      .filter(Boolean)
      .find((s) => typeof s === 'object' && s.maxHeight != null);

    expect(maxHeightEntry).toBeTruthy();
    const expected = Math.max(
      120,
      Math.round(Dimensions.get('window').height * 0.58) - 190
    );
    expect(maxHeightEntry.maxHeight).toBe(expected);
    expect(maxHeightEntry.maxHeight).toBeGreaterThan(0);

    // Honest limits: this asserts the CODE passed the bound; it cannot
    // assert on-device scrolling behavior (RTL cannot measure layout), and
    // it leaves the collapsed branch untouched — its existing test below
    // keeps guarding the compact summary + ▾ Expand state.
    expect(expanded.getByText('Start Trip')).toBeTruthy();
  });

  test('MapScreen panel budget invariant: scrollMax + fixed chrome never exceeds the card cap', () => {
    // Pure-formula contract (no rendering): for a spread of device window
    // heights, the scroll bound derived by MapScreen must leave room for
    // exactly the same fixed chrome (190px) it was derived from, i.e.
    // panelScrollMax + 190 ≤ panelCardMax. This locks the formula pairing:
    // if either term drifts (a second percentage, a different subtraction),
    // the scroll could exceed the card again and reintroduce clipping via
    // parent-clamp propagation.
    const FIXED_CHROME = 190;
    for (const h of [560, 640, 720, 800, 915]) {
      const panelCardMax = Math.round(h * 0.58);
      const panelScrollMax = Math.max(120, panelCardMax - FIXED_CHROME);
      expect(panelScrollMax + FIXED_CHROME).toBeLessThanOrEqual(panelCardMax);
      expect(panelScrollMax).toBeGreaterThan(0);
    }
  });

  test('MapScreen success panel collapsed summary: no routePanelScroll, expand affordance present', async () => {
    const collapsed = await render(<MapScreen {...panelProps({ panelExpanded: false })} />);
    expect(collapsed.queryByTestId('routePanelScroll')).toBeNull();
    expect(collapsed.getByText('▾ Expand')).toBeTruthy();
  });

  test('MapScreen route-start connector: dashed map-polyline + honest caption when origin is ~45m from the snapped start', async () => {
    // Route-start snapping representation: candidates begin at the SNAPPED
    // road point, so when the captured request origin sits >= 25m from the
    // selected candidate's start, one dashed connector polyline and one
    // honest caption render. Fixture: currentCoords placed ~45m north of the
    // panelCandidates[0] start along a meridian (haversine-precise via the
    // same pure helper the screen uses — no hand-rounded figures).
    const METERS_PER_DEG_LAT = (Math.PI * 6371000) / 180;
    const start = panelCandidates[0].coordinates[0];
    const cur = {
      latitude: start.latitude + 45 / METERS_PER_DEG_LAT,
      longitude: start.longitude,
    };
    const gap = distanceBetweenFixes(cur, start);
    expect(gap).toBeGreaterThanOrEqual(25);
    const screen = await render(
      <MapScreen
        {...panelProps({ panelExpanded: true })}
        currentCoords={cur}
        currentAccuracy={40}
      />
    );

    // This suite's maps mock stamps EVERY Polyline testID='map-polyline'
    // (trailing testID overrides any passed one); the connector is the only
    // polyline carrying a lineDashPattern, so it is found by prop scan.
    const connector = screen
      .getAllByTestId('map-polyline')
      .find((el) => el.props.lineDashPattern != null);
    expect(connector).toBeTruthy();
    expect(connector.props.coordinates).toHaveLength(2);
    expect(connector.props.coordinates[0]).toEqual(cur);
    expect(connector.props.coordinates[1]).toEqual(start);
    expect(connector.props.strokeWidth).toBe(3);

    // Honest expanded-panel caption (+ drift context: accuracy 40 > 45*0.8).
    expect(
      screen.getByText(
        `Route starts about ${formatDistance(gap, 'metric')} away, at the nearest walkable road. The dashed link shows where you step onto it.`
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Your location marker may drift by about 40 m on this device.')
    ).toBeTruthy();
  });

  test('HistoryScreen Title input blur persists notes for the open draft trip', async () => {
    const saveTripNotes = jest.fn();
    const trips = [
      {
        id: '1',
        date: new Date('2026-01-01T09:00:00Z').toISOString(),
        mode: 'walking',
        actualDistanceM: 1500,
        durationSec: 1200,
      },
    ];
    // Proven chain (matches the composite render above): start in the list
    // state, then rerender into the detail state so the notes inputs mount.
    const { getByPlaceholderText, rerender } = await render(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={null}
        draftTripId={null}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={saveTripNotes}
        setView={noop}
      />
    );
    await rerender(
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={false}
        trips={trips}
        tripsLoaded={true}
        detailTripId={'1'}
        draftTripId={'1'}
        draftTitle={''}
        setDraftTitle={noop}
        draftDescription={''}
        setDraftDescription={noop}
        distUnit={'metric'}
        openTripDetail={noop}
        closeDetail={noop}
        confirmDeleteTrip={noop}
        saveTripNotes={saveTripNotes}
        setView={noop}
      />
    );

    // Blur (not change) is the persistence trigger; the draft trip id must be
    // threaded through so the notes land on the right record.
    const titleInput = await waitFor(() => getByPlaceholderText('Add a title'));
    await fireEvent(titleInput, 'blur');
    expect(saveTripNotes).toHaveBeenCalledTimes(1);
    expect(saveTripNotes).toHaveBeenCalledWith('1');
  });

  test('Delete trip opens the Alert.alert delete confirmation', async () => {
    // Spy on the SAME Alert module object App.js imports, so the real
    // confirmDeleteTrip handler is exercised end-to-end without triggering a
    // native dialog.
    const alertSpy = jest.spyOn(Alert, 'alert');
    const screen = await render(<App />);

    // Map → Profile → History list → trip detail.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('RECENT TRIPS'));
    await fireEvent.press(await screen.findByLabelText('Open trip details'));

    // 'Delete trip' opens the delete confirmation alert.
    await fireEvent.press(await screen.findByText('Delete trip'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [deleteTitle, deleteMessage, deleteButtons] = alertSpy.mock.calls[0];
    expect(deleteTitle).toBe('Delete trip?');
    expect(deleteMessage).toBe('This removes the trip from your history permanently.');
    expect(deleteButtons).toEqual([
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: expect.any(Function) },
    ]);
  });

  test('Erase all data opens the first erase confirmation Alert.alert', async () => {
    // Spy on the SAME Alert module object App.js imports, so the real
    // confirmEraseAll handler is exercised end-to-end without triggering a
    // native dialog.
    const alertSpy = jest.spyOn(Alert, 'alert');
    const screen = await render(<App />);

    // Map → Profile → Settings.
    await fireEvent.press(await screen.findByLabelText('Profile'));
    await fireEvent.press(await screen.findByText('Settings'));

    // 'Erase all data' opens the first erase confirmation alert.
    await fireEvent.press(await screen.findByText('Erase all data'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [eraseTitle, eraseMessage, eraseButtons] = alertSpy.mock.calls[0];
    expect(eraseTitle).toBe('Erase all data?');
    expect(eraseMessage).toBe(
      'This removes your profile, saved trips, saved places and recent searches. It cannot be undone.'
    );
    expect(eraseButtons).toHaveLength(2);
    expect(eraseButtons[0]).toEqual({ text: 'Cancel', style: 'cancel' });
    expect(eraseButtons[1].text).toBe('Erase');
    expect(eraseButtons[1].style).toBe('destructive');
    expect(eraseButtons[1].onPress).toEqual(expect.any(Function));
  });
});

describe('Saved places smoke tests', () => {
  test('SavedPlacesScreen renders empty, populated and pending states', async () => {
    const addPlaceFromSearch = jest.fn(async () => {});
    const submitPendingPlace = jest.fn(async () => {});

    const savedProps = (overrides) => ({
      styles,
      t,
      isDark: false,
      savedPlaces: [],
      pendingPlace: null,
      savedAddStatus: 'idle',
      savedAddError: null,
      savedCoordError: null,
      addPlaceFromSearch,
      addPlaceFromCurrentLocation: noop,
      addPlaceFromCoordinates: noop,
      openMapPicker: noop,
      submitPendingPlace,
      cancelPendingPlace: noop,
      updateSavedPlace: noop,
      confirmDeleteSavedPlace: noop,
      routeToSavedPlace: noop,
      setView: noop,
      ...overrides,
    });

    // Empty state: honest copy, quick-method chips and the inline search bar.
    const first = await render(
      <SavedPlacesScreen {...savedProps({})} />
    );
    expect(first.getByText('Saved places')).toBeTruthy();
    expect(first.getByText('ADD A PLACE')).toBeTruthy();
    expect(first.getByText('No saved places yet.')).toBeTruthy();
    expect(first.getByLabelText('Add from coordinates')).toBeTruthy();
    expect(first.getByLabelText('Add from current location')).toBeTruthy();
    expect(first.getByLabelText('Pick on map')).toBeTruthy();

    // Typing + pressing the Search button forwards the typed text.
    await fireEvent.changeText(first.getByPlaceholderText('Try "India Gate"'), 'India Gate');
    await fireEvent.press(first.getByLabelText('Search place to save'));
    expect(addPlaceFromSearch).toHaveBeenCalledTimes(1);
    expect(addPlaceFromSearch).toHaveBeenCalledWith('India Gate');

    // Populated state: one place renders name + pill + caption + row actions.
    const place = { id: 'p1', name: 'Home', category: 'home', latitude: 28.6, longitude: 77.2 };
    await first.rerender(
      <SavedPlacesScreen {...savedProps({ savedPlaces: [place] })} />
    );
    expect(first.getByText('1 place saved')).toBeTruthy();
    // 'Home' appears twice: the row name and the category pill label.
    expect(first.getAllByText('Home')).toHaveLength(2);
    expect(first.getByText('28.6000, 77.2000')).toBeTruthy();
    expect(first.getByLabelText('Set destination to saved place: Home')).toBeTruthy();
    expect(first.getAllByText('Edit')).toHaveLength(1);
    expect(first.getByLabelText('Delete saved place')).toBeTruthy();

    // Pending confirm card: prefilled name input + category chips enabled save.
    await first.rerender(
      <SavedPlacesScreen
        {...savedProps({
          pendingPlace: { name: 'India Gate', category: 'other', latitude: 28.6129, longitude: 77.2295 },
        })}
      />
    );
    expect(first.getByText('NAME THIS PLACE')).toBeTruthy();
    // Two inputs carry 'India Gate' at this point: the search field's local
    // draft and the prefilled pending-name input.
    expect(first.getAllByDisplayValue('India Gate')).toHaveLength(2);
    expect(first.getByText('Coordinates: 28.6129, 77.2295')).toBeTruthy();
    const saveBtn = first.getByLabelText('Save place');
    expect(saveBtn).not.toBeDisabled();
    await fireEvent.press(saveBtn);
    expect(submitPendingPlace).toHaveBeenCalledTimes(1);
    expect(submitPendingPlace).toHaveBeenCalledWith({ name: 'India Gate', category: 'other' });
  });

  test('MapPickerScreen pick flow: marker appears and button enables', async () => {
    const onPick = jest.fn();
    const { getByTestId, getByLabelText } = await render(
      <MapPickerScreen
        styles={styles}
        t={t}
        isDark={false}
        initialRegion={DEFAULT_REGION}
        onPick={onPick}
        onClose={noop}
      />
    );

    // No coordinate chosen yet: the confirm button is disabled and no marker.
    expect(getByLabelText('Use this location')).toBeDisabled();
    expect(getByLabelText('Choose a map location')).toBeTruthy();
    expect(getByTestId('map-view')).toBeTruthy();

    // Tap the map (mocked MapView forwards onPress): a marker appears and
    // the button enables with the picked coordinate.
    await fireEvent(getByTestId('map-view'), 'onPress', {
      nativeEvent: { coordinate: { latitude: 12.3456, longitude: 56.789 } },
    });
    expect(getByTestId('map-marker')).toBeTruthy();
    const useBtn = getByLabelText('Use this location');
    expect(useBtn).not.toBeDisabled();
    await fireEvent.press(useBtn);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ latitude: 12.3456, longitude: 56.789 });
  });

  test('SettingsScreen shows the Saved places entry row with count', async () => {
    const { getByText, getByLabelText } = await render(
      <SettingsScreen
        styles={styles}
        isDark={false}
        profile={DEFAULT_PROFILE}
        trips={[]}
        savedPlaces={[{ id: 'p1', name: 'Home', category: 'home', latitude: 28.6, longitude: 77.2 }]}
        themeMode={'system'}
        accentName={'green'}
        applyTheme={noop}
        applyAccent={noop}
        setDistanceUnit={noop}
        confirmEraseAll={noop}
        openSavedPlaces={noop}
        setView={noop}
      />
    );
    expect(getByLabelText('Open saved places')).toBeTruthy();
    expect(getByText('Saved places')).toBeTruthy();
    expect(getByText('1 place saved')).toBeTruthy();
  });
});
