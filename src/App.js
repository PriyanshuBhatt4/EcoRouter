import React, { useState, useEffect, useRef } from 'react';
import { Text, View, ActivityIndicator, Alert, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PREFERENCES, selectByPreference } from './lib/preferences';
import { createTripDistanceAccountant, distanceStep, finishTripDistance, tripStep } from './lib/track';
import { fetchRouteCandidates, fetchWithTimeout } from './services/api';
import MapScreen from './screens/MapScreen';
import ProfileScreen from './screens/ProfileScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import SavedPlacesScreen from './screens/SavedPlacesScreen';
import MapPickerScreen from './screens/MapPickerScreen';
import ReplayScreen from './screens/ReplayScreen';
import {
  API_BASE_URL,
  ACCENT_KEY,
  ACTIVE_TRIP_KEY,
  DEFAULT_PROFILE,
  ERROR_MESSAGES,
  MODES,
  PLACE_CATEGORIES,
  PREFS_KEY,
  PROFILE_KEY,
  RECENT_DESTINATION_KEY,
  SAVED_PLACES_KEY,
  SAVED_PLACES_MAX,
  TRAIL_KEY,
  TRAIL_MAX_POINTS,
  TRIPS_KEY,
  THEME_KEY,
} from './constants';
import {
  buildSavedPlace,
  isValidRouteGoal,
  parsePrefs,
  parseRecentDestinations,
  parseSavedPlaces,
  parseTrails,
  pushRecentDestination,
  shouldRetainSample,
  thinTrailPoints,
} from './constants';
import { ACCENTS, makePalette } from './theme/palette';
import { getSheet } from './theme/styles';

export default function App() {
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [currentAccuracy, setCurrentAccuracy] = useState(null);
  const [destination, setDestination] = useState('');
  const [routeStatus, setRouteStatus] = useState('idle');
  const [routeError, setRouteError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [preference, setPreference] = useState(PREFERENCES.MANUAL);
  const [mode, setMode] = useState(MODES.WALKING);
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [view, setView] = useState('map');
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [trips, setTrips] = useState([]);
  const [tripActive, setTripActive] = useState(false);
  const [tripStartTime, setTripStartTime] = useState(null);
  const [tripElapsed, setTripElapsed] = useState(0);
  const [tripDistance, setTripDistance] = useState(0);
  const [lowAccuracyActive, setLowAccuracyActive] = useState(false);
  // Distance-pause flag (ADDITIVE): true while consecutive low-accuracy fixes
  // (>= LOW_ACCURACY_PAUSE_FIXES below) say GPS is too unreliable to accept
  // trusted steps, so the windowed accountant's pending meters cannot be
  // decided honestly. Display-only honesty: the trip filter itself, the
  // low-accuracy warning and the marker are untouched.
  const [distancePaused, setDistancePaused] = useState(false);
  const [userPos, setUserPos] = useState(null);
  const [followUser, setFollowUser] = useState(true);
  // Latest-value mirror of followUser for the long-lived trip position
  // watcher: watchPositionAsync's callback is registered ONCE per trip, so
  // reading the followUser STATE there sees only the value from trip start
  // (a stale closure that kept re-centering the camera over the user's pan
  // after they had turned follow off). The effect below keeps it in sync.
  const followUserRef = useRef(true);
  const [destinationCoord, setDestinationCoord] = useState(null);
  const [locationBannerDismissed, setLocationBannerDismissed] = useState(false);
  // Appearance preference: 'light' | 'dark' | 'system' (default follows OS).
  const [themeMode, setThemeMode] = useState('system');
  // Accent theme: one of ACCENTS keys (default 'green' = current palette).
  // Persisted at a dedicated key; unknown/missing values fall back to green.
  const [accentName, setAccentName] = useState('green');
  // User preferences (ADDITIVE key): preferred travel mode + dashboard
  // section visibility. Loaded at startup via parsePrefs; unknown/corrupt
  //   values resolve to the defaults, so behavior before first save matches
  //   today exactly (walking mode, all dashboard sections visible). The state
  //   initializes from a parsePrefs(null) DEEP CLONE, never the DEFAULT_PREFS
  //   constant itself: useState would alias the shared constant otherwise,
  //   letting the erase-all reset (setPrefs(DEFAULT_PREFS)) put the exact same
  //   dashboard object reference into every subscriber.
  const [prefs, setPrefs] = useState(() => parsePrefs(null));
  // True once the mount-time AsyncStorage read of the prefs key has RESOLVED
  // (success or failure). Prefs writes that race the boot read are dropped:
  // before the read lands, a write merged from defaults could be persisted
  // AFTER the loaded value and silently clobber it.
  const prefsLoadedRef = useRef(false);
  // Latest-value mirror of prefs for callbacks that run OUTSIDE the render
  // cycle (applyRouteResults fires inside an awaited search whose closure
  // still holds the prefs snapshot from when the search started — a user can
  // flip the Remember toggle in Settings while that fetch is in flight, and
  // the route-card result must reflect the flip). The sync effect below keeps
  // the mirror current after every commit, like followUserRef; state remains
  // the UI source of truth.
  const prefsRef = useRef(prefs);
  // stored photo URI fails to load (stale/invalid data URI must not crash).
  const [chipPhotoFailed, setChipPhotoFailed] = useState(false);
  // Collapsed-vs-expanded active trip card (compact row by default).
  const [tripDetailsExpanded, setTripDetailsExpanded] = useState(false);
  // True once the mount-time AsyncStorage read of trips has resolved; drives
  // the History screen's loading row only (Profile rendering is unchanged).
  const [tripsLoaded, setTripsLoaded] = useState(false);
  // Recent destinations (quick re-search chips on the map): up to 5 trimmed
  // destination names, newest first. ADDITIVE storage key; corrupt values
  // parse to an empty list and simply hide the chips.
  const [recentDestinations, setRecentDestinations] = useState([]);
  // Saved places: persistent destination records ({ id, name, category,
  // latitude, longitude }), newest first, capped at SAVED_PLACES_MAX.
  // ADDITIVE storage key; corrupt stored values parse to an empty list.
  const [savedPlaces, setSavedPlaces] = useState([]);
  // Add-a-place flow: which quick-action is in flight ('idle' | 'searching' |
  // 'locating'), its surfaced error string, and the coordinate-form field
  // errors ({ latitude?: string, longitude?: string }).
  const [savedAddStatus, setSavedAddStatus] = useState('idle');
  const [savedAddError, setSavedAddError] = useState(null);
  const [savedCoordError, setSavedCoordError] = useState(null);
  // The not-yet-saved place being confirmed/edited (name + category are
  // editable before it becomes a saved record): null hides the confirm card.
  const [pendingPlace, setPendingPlace] = useState(null);
  // Trip History navigation: which screen is open ('history'), and which
  // saved trip's detail screen is open (detailTripId, null = list).
  const [detailTripId, setDetailTripId] = useState(null);
  // Detail screen note drafts (title/description). Local-only until blur or
  // leaving the detail screen persists them into the trip record.
  const [draftTripId, setDraftTripId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  // Journey Replay navigation: which saved trip's replay screen is open.
  const [replayTripId, setReplayTripId] = useState(null);
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  // Current trusted reference reading for trip-distance filtering
  // ({ latitude, longitude, accuracy, timestamp }); null until the first
  // accepted fix arrives. Filtering decisions live in lib/track.js.
  const tripFilterRef = useRef(null);
  const tripDistanceRef = useRef(0);
  // Windowed trip-distance accountant (see lib/track.js distanceStep): holds
  // back accepted 'ok' meters until a ~50 m window's NET displacement proves
  // it is real travel rather than an indoor standing-still random walk.
  // tripDistanceRef mirrors its decidedMeters so every existing read of the
  // mirror keeps the same semantics; finishTrip consults the accountant's
  // remaining-window decision for the final (honest, possibly smaller)
  // figure. Pure module state — no timers, no storage.
  const distanceAccountantRef = useRef(createTripDistanceAccountant());
  // Consecutive rejected low-accuracy fixes (resets on any quality 'ok'
  // fix). Reaching the pause threshold flips distancePaused so the trip card
  // can honestly say the distance readout is paused while GPS is unreliable.
  const consecutiveLowAccuracyRef = useRef(0);
  // Last trusted accept pair ({ prev, cur }): the prev/cur of the previously
  // accepted 'ok' fix, for finishTrip's final accountant decision.
  const lastTrustedPairRef = useRef(null);
  // Journey Replay trail (ADDITIVE side-car, observational only): the stream
  // of ACCEPTED fixes retained while tracking, thinned by TRAIL_MIN_STEP_M.
  // Never part of distance calculation — tripDistanceRef above stays the sole
  // source of truth for the trip record's distance.
  const trailRef = useRef([]);
  // Last routing attempt ({ kind: 'text', query } | { kind: 'saved', place })
  // for the error card's 'Try again' retry — it re-runs the SAME attempt
  // (saved-place retries keep the exact stored origin/target coordinates).
  const lastRouteAttemptRef = useRef(null);
  // ---------------------------------------------------------------------------
  // Synchronous reentrancy guards (refs, not state). The routeStatus /
  // tripActive STATE flags are only committed at render, so two tap events
  // landing in the same frame both run against the pre-flush closure and BOTH
  // pass an `if (state) return` guard — double-fetching a search or
  // saving/registering a trip twice. These mirrors flip synchronously inside
  // the handlers; state stays the UI source of truth.
  // ---------------------------------------------------------------------------
  // Search claim: set before the awaits in findRoute/routeToSavedPlace,
  // cleared in their finally, so a same-frame (and mid-flight) second press
  // no-ops even while the loading state has not committed yet.
  const routeBusyRef = useRef(false);
  // Trip claim: startTrip sets it before any await (and checks it again once
  // the async watcher registration resolves — a Finish/erase that ran while
  // registration was pending drops the just-installed subscription instead of
  // leaking it into the finished trip); finishTrip claims it before persisting
  // so a same-frame double-tap cannot save two identical records (the second
  // call's `trips` closure does not contain the first record yet).
  const tripActiveRef = useRef(false);
  // PM2.5 capture for the active trip (ADDITIVE): the raw `value` of the
  // selected route's pm25_estimate at Start Trip, exactly as the backend
  // payload carried it into the candidate (no rounding applied here — same
  // figure the PM estimate card showed). Null when there were no candidates,
  // no usable selection, or the estimate was unavailable/non-finite (old
  // behavior — nothing was stored then, either). A ref mirror (like
  // tripDistanceRef) so finishTrip reads the value captured at trip start
  // without a re-read of the ACTIVE_TRIP_KEY record that stores the same
  // field; both stay absent/null for trips without an estimate, keeping the
  // record shape backward-compatible with all pre-existing trips.
  const plannedPm25Ref = useRef(null);
  // Erase-all epoch: doEraseAll bumps it; a search whose fetch was in flight
  // during the erase completes afterwards but MUST NOT apply its results
  // (or push a recent destination) onto the freshly-erased state/storage.
  // Captured at search start, checked right after the awaits.
  const dataEpochRef = useRef(0);

  // Resolve the effective theme: an explicit choice wins; 'system' follows
  // the OS color scheme (null scheme safely falls back to light).
  const scheme = useColorScheme();
  const resolvedTheme = themeMode === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : themeMode;
  const isDark = resolvedTheme === 'dark';
  // Effective sheet/palette pair comes from the lazy (theme, accent) cache —
  // picking a different accent instantly swaps in its prebuilt sheet.
  const styles = getSheet(resolvedTheme, accentName);
  const t = makePalette(resolvedTheme, accentName);

  useEffect(() => {
    (async () => {
      try {
        const p = await AsyncStorage.getItem(PROFILE_KEY);
        // Per-key guarded, shape-checked parses: one corrupt or wrong-shaped
        // key is SKIPPED, not allowed to veto the rest of the boot (the
        // previous single shared try/catch meant a corrupt profile stopped
        // trips/theme/accent/recents/saved-places/prefs from ever loading,
        // and a valid-but-non-array trips payload crashed later renders).
        if (p) {
          try {
            const parsedProfile = JSON.parse(p);
            if (parsedProfile && typeof parsedProfile === 'object' && !Array.isArray(parsedProfile)) {
              setProfile(parsedProfile);
            }
          } catch {}
        }
        const tr = await AsyncStorage.getItem(TRIPS_KEY);
        if (tr) {
          try {
            const parsedTrips = JSON.parse(tr);
            if (Array.isArray(parsedTrips)) {
              // Shape-check each ENTRY as well: the array guard above accepts
              // ANY array, but junk entries (null, strings, id-less objects)
              // reach the History/Profile list renders and crash at their
              // `tr.id` list keys. Records the app writes always carry an id.
              setTrips(parsedTrips.filter((trip) => (
                !!trip && typeof trip === 'object' &&
                (typeof trip.id === 'string' && trip.id !== '' ||
                  typeof trip.id === 'number')
              )));
            }
          } catch {}
        }
        const th = await AsyncStorage.getItem(THEME_KEY);
        if (th === 'light' || th === 'dark' || th === 'system') setThemeMode(th);
        // Accent preference: only a known accent name is accepted; a missing
        // or unknown stored value silently keeps the 'green' default.
        const ac = await AsyncStorage.getItem(ACCENT_KEY);
        if (typeof ac === 'string' && Object.prototype.hasOwnProperty.call(ACCENTS, ac)) {
          setAccentName(ac);
        }
        // Recent destinations: parse defensively; a corrupt stored value just
        // means no chips render, never a crash.
        const rd = await AsyncStorage.getItem(RECENT_DESTINATION_KEY);
        const { list } = parseRecentDestinations(rd);
        if (list.length > 0) setRecentDestinations(list);
        // Saved places: parse defensively the same way; a corrupt value just
        // means an empty saved list.
        const sp = await AsyncStorage.getItem(SAVED_PLACES_KEY);
        setSavedPlaces(parseSavedPlaces(sp));
        // User preferences: parse defensively (tolerant defaults) so a
        // corrupt stored value simply keeps today's default behavior.
        const pf = await AsyncStorage.getItem(PREFS_KEY);
        const parsedPrefs = parsePrefs(pf);
        // Same deep-clone discipline as the initializer: the state and its
        // mirror hold a fresh object, never a shared constant reference.
        prefsRef.current = parsedPrefs;
        setPrefs(parsedPrefs);
        // Boot one-shot chip preselect (toggle ON + valid stored goal): sets
        // the chip STATE only — no candidates exist yet, so nothing is
        // auto-picked here; it is just the chip rendering as active before
        // any search. Every search path (text and saved place) resets the
        // selection to MANUAL via resetRouteStateForSearch while loading;
        // applyRouteResults re-applies the stored goal (same selection rule
        // as the chips) after the results commit. Invalid/legacy stored
        // goals were already normalized to null by parsePrefs, so with the
        // toggle ON and no recorded goal this keeps the manual default.
        if (parsedPrefs.rememberRouteGoal === true && isValidRouteGoal(parsedPrefs.lastRouteGoal)) {
          setPreference(parsedPrefs.lastRouteGoal);
        }
        await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
      } catch {
      } finally {
        // Marks the History screen's loading state resolved, even if the
        // storage read errored — the list then renders its real content.
        setTripsLoaded(true);
        // Unlocks the prefs single-persist path (updatePrefs drops writes
        // until the boot read has resolved), also on a failed read.
        prefsLoadedRef.current = true;
      }
    })();
    (async () => {
      let status = null;
      try {
        // A THROWING permission request (interrupted/dead permission prompt,
        // module unavailable mid-boot) must not reject this boot promise — a
        // rejection here was previously an unhandled rejection. It is mapped
        // below onto the same honest could-not-locate banner a failed fix uses.
        ({ status } = await Location.requestForegroundPermissionsAsync());
      } catch {
        status = null;
      }
      if (status !== 'granted') {
        setLocationBannerDismissed(false);
        setLocationError(
          status === null
            // Thrown request (not an explicit denial): reuse the failed-fix copy
            // rather than claiming the user denied anything.
            ? 'Could not determine your current location.'
            : 'Location permission was denied. Enable it to route from your current position.'
        );
        return;
      }
      try {
        const currentLocation = await Location.getCurrentPositionAsync({});
        setLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      } catch {
        setLocationBannerDismissed(false);
        setLocationError('Could not determine your current location.');
      }
    })();
  }, []);

  // A new/changed photo URI should get a fresh load attempt; only a failed
  // load of the CURRENT photo keeps the initial-avatar fallback this mount.
  useEffect(() => {
    setChipPhotoFailed(false);
  }, [profile.photo]);

  // Keep the watcher's follow mirror current (runs after every commit).
  useEffect(() => {
    followUserRef.current = followUser;
  }, [followUser]);

  // Keep the prefs mirror current (same stale-closure guard, see prefsRef).
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const applyTheme = (next) => {
    setThemeMode(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  };

  // Accent choice applies instantly (state-driven) and persists separately.
  const applyAccent = (next) => {
    if (!Object.prototype.hasOwnProperty.call(ACCENTS, next)) return;
    setAccentName(next);
    AsyncStorage.setItem(ACCENT_KEY, next).catch(() => {});
  };

  // Single persist path for user preferences (state first, then the key —
  // same pattern as persistTrips/saveProfile). Takes a PATCH, not a full
  // prefs object, and merges it from prefsRef.current — the committed latest
  // value — instead of a possibly-stale render snapshot (two Settings rows
  // pressed across renders, or a callback holding an old closure, must not
  // resurrect a stale field). Writes before the boot read resolves are
  // dropped: merging into defaults and persisting before the stored value
  // loaded could clobber it.
  const updatePrefs = (patch) => {
    if (!prefsLoadedRef.current) return;
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // Preferred travel mode (Settings): only walking/cycling are offered, so
  // anything else is ignored. The map's mode row reads this preference at
  // app load (effect below); mode-row taps never write prefs.
  const applyPreferredMode = (next) => {
    if (next !== MODES.WALKING && next !== MODES.CYCLING) return;
    updatePrefs({ preferredMode: next });
  };

  // Dashboard section visibility flags (Settings → DASHBOARD): instant,
  // state-driven like the theme controls; unknown flag keys are ignored.
  // The toggle builds on the committed dashboard (prefsRef mirror).
  const applyDashboardToggle = (key) => {
    const stored = (prefsRef.current && prefsRef.current.dashboard) || {};
    updatePrefs({
      dashboard: {
        week: true,
        achievements: true,
        streak: true,
        recent: true,
        ...stored,
        [key]: !stored[key],
      },
    });
  };

  // 'Remember my route goal' settings toggle: flips the persisted flag only.
  // - Turning it ON mid-session does NOT retroactively change the live chip
  //   selection; the stored goal re-applies after the NEXT completed search
  //   (and once at boot, in the startup load above).
  // - Turning it OFF restores today's behavior exactly: the next search
  //   resets to MANUAL (the restore in applyRouteResults is gated on the
  //   flag). lastRouteGoal keeps being recorded either way, so the next
  //   toggle-on immediately has a goal to restore.
  const applyRememberRouteGoal = (next) => {
    updatePrefs({ rememberRouteGoal: next === true });
  };

  // Preferred-mode preselect rule (implement exactly): the map's live mode
  // selection follows the preference (a) at app load when the preference
  // first arrives, and (b) at the moment Settings changes it WHILE the map
  // is idle and no trip is running. Mode-row taps never write prefs, so
  // their selection never fights this sync.
  const prefsPreferredMode = prefs && prefs.preferredMode;
  useEffect(() => {
    if (prefsPreferredMode !== MODES.WALKING && prefsPreferredMode !== MODES.CYCLING) return;
    if (routeStatus !== 'idle' || tripActive) return;
    setMode(prefsPreferredMode);
    // Deliberately keyed on the preference only: busy-idle transitions
    // after a manual mid-session change must not reset the live selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsPreferredMode]);

  // Effective distance unit: an additive optional profile field; anything
  // missing/unset keeps today's metric behavior.
  const distUnit = profile && profile.distanceUnit === 'imperial' ? 'imperial' : 'metric';

  const setDistanceUnit = (next) => {
    if (next !== 'metric' && next !== 'imperial') return;
    if ((profile && profile.distanceUnit) === next) return;
    saveProfile({ ...profile, distanceUnit: next });
  };

  // Erase-all: two stacked confirmations, then a full reset of USER data.
  // THEME_KEY and ACCENT_KEY are deliberately KEPT — appearance is a device
  // preference, not user trip/profile data, so it survives erasure.
  const confirmEraseAll = () => {
    Alert.alert(
      'Erase all data?',
      'This removes your profile, saved trips, saved places and recent searches. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Really erase?', 'All trips, places and profile details will be gone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Yes, erase everything', style: 'destructive', onPress: doEraseAll },
            ]);
          },
        },
      ]
    );
  };

  const doEraseAll = async () => {
    // A search that started before this erase must lose when it finishes: the
    // epoch bump below makes its post-await apply/persist steps skip (see
    // findRoute / routeToSavedPlace).
    dataEpochRef.current += 1;
    // If a trip is somehow still active, unwind tracking state first using
    // the same teardown finishTrip performs (stop the watcher, clear the
    // active-trip key and timers) — no half-open state left behind. The REF
    // is checked alongside the state: a same-frame race could have flipped
    // the ref without a render committing yet.
    if (tripActive || tripActiveRef.current) {
      tripActiveRef.current = false;
      if (locationSubRef.current) {
        try { locationSubRef.current.remove(); } catch {}
        locationSubRef.current = null;
      }
      tripDistanceRef.current = 0;
      // Same reset family as the distance mirror: the accountant's pending
      // window is discarded with the trip (fresh shape, nothing carried).
      distanceAccountantRef.current = createTripDistanceAccountant();
      lastTrustedPairRef.current = null;
      consecutiveLowAccuracyRef.current = 0;
      setDistancePaused(false);
      tripFilterRef.current = null;
      plannedPm25Ref.current = null;
      trailRef.current = [];
      setTripActive(false);
      setTripStartTime(null);
      setTripElapsed(0);
      setLowAccuracyActive(false);
      setTripDetailsExpanded(false);
    }
    try {
      if (typeof AsyncStorage.multiRemove === 'function') {
        await AsyncStorage.multiRemove([
          PROFILE_KEY,
          TRIPS_KEY,
          ACTIVE_TRIP_KEY,
          RECENT_DESTINATION_KEY,
          SAVED_PLACES_KEY,
          TRAIL_KEY,
          PREFS_KEY,
        ]);
      } else {
        // Fallback for environments without multiRemove: same keys, one by one.
        await Promise.all([
          AsyncStorage.removeItem(PROFILE_KEY),
          AsyncStorage.removeItem(TRIPS_KEY),
          AsyncStorage.removeItem(ACTIVE_TRIP_KEY),
          AsyncStorage.removeItem(RECENT_DESTINATION_KEY),
          AsyncStorage.removeItem(SAVED_PLACES_KEY),
          AsyncStorage.removeItem(TRAIL_KEY),
          AsyncStorage.removeItem(PREFS_KEY),
        ]);
      }
    } catch {}
    // Reset to the same literals the startup load path uses; prefs returns
    // to a fresh deep clone of the defaults (parsePrefs(null)), never a
    // reference to the shared DEFAULT_PREFS constant.
    setTrips([]);
    setProfile(DEFAULT_PROFILE);
    setSavedPlaces([]);
    setRecentDestinations([]);
    const freshPrefs = parsePrefs(null);
    prefsRef.current = freshPrefs;
    setPrefs(freshPrefs);
    setDetailTripId(null);
    setDraftTripId(null);
    setReplayTripId(null);
    setView('profile'); // Profile then shows its honest empty states
  };

  const BACKEND_NOT_CONFIGURED_MSG =
    'Backend address is not configured. Set EXPO_PUBLIC_API_BASE_URL in .env.local (local dev) or EXPO_PUBLIC_API_URL_PRODUCTION (hosted backend) and restart Expo.';

  // Shared route prep: clears stale candidates/error state before a new
  // search begins. Used by both the text-search and saved-place paths so the
  // two never diverge on what gets reset.
  const resetRouteStateForSearch = () => {
    setCandidates([]);
    setSelectedId(null);
    setPreference(PREFERENCES.MANUAL);
    setDestinationCoord(null);
    setRouteError(null);
  };

  // Shared origin acquisition (extracted from findRoute verbatim): a fresh
  // high-accuracy fix, falling back to the OS-cached last known position
  // before giving up. Also keeps the map region in sync; throws an Error with
  // the user-facing message when neither fix is available.
  const acquireOrigin = async () => {
    let fresh = null;
    try {
      fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {}
    if (!fresh || !fresh.coords) {
      // High-accuracy fix failed; fall back to the last known position
      // (cached by the OS) before giving up.
      try {
        fresh = await Location.getLastKnownPositionAsync();
      } catch {}
    }
    if (!fresh || !fresh.coords) {
      throw new Error('Could not get your current location (high accuracy).');
    }
    const startLat = fresh.coords.latitude;
    const startLon = fresh.coords.longitude;
    setCurrentCoords({ latitude: startLat, longitude: startLon });
    setCurrentAccuracy(fresh.coords.accuracy);
    if (!location) {
      setLocation({
        latitude: startLat,
        longitude: startLon,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
    return { latitude: startLat, longitude: startLon };
  };

  // Shared route-result application (extracted from findRoute verbatim):
  // commit the candidates, preselect the first, and fit the map to the route
  // plus the geocoded destination marker when the response carries one.
  const applyRouteResults = (result) => {
    const mapped = result.candidates;

    setCandidates(mapped);
    setSelectedId(mapped[0].id);
    setPreference(PREFERENCES.MANUAL);
    setPanelExpanded(false);

    // Remembered route goal restore (settings toggle ON): re-apply the
    // stored goal after EVERY completed search instead of leaving this
    // search's MANUAL reset — with EXACTLY the same selection rule the goal
    // chips run through applyPreference: selectByPreference picks the best
    // candidate when the goal is eligible; when it is not, the preselected
    // first candidate stays and the map's existing preferenceNote explains
    // the ineligibility. Reads `mapped` (not the still-stale candidates
    // state) so the pick matches the response that just committed. With the
    // toggle OFF nothing changes here — exactly today's behavior.
    //
    // The toggle and goal are read from the prefsRef MIRROR, not this
    // render's snapshot: the search await can span several commits, and a
    // Remember toggle flipped in Settings while the fetch was in flight must
    // be honored here (the stale closure would silently use the old value).
    const prefsNow = prefsRef.current;
    const storedGoal =
      prefsNow && prefsNow.rememberRouteGoal === true && isValidRouteGoal(prefsNow.lastRouteGoal)
        ? prefsNow.lastRouteGoal
        : null;
    if (storedGoal !== null) {
      setPreference(storedGoal);
      const picked = selectByPreference(mapped, storedGoal);
      if (picked) setSelectedId(picked.id);
    }

    // Geocoded destination from the backend response, if provided.
    let destinationPoint = null;
    const dest = result.destination;
    if (dest) {
      const destLat = typeof dest.latitude === 'number' ? dest.latitude : typeof dest.lat === 'number' ? dest.lat : null;
      const destLon = typeof dest.longitude === 'number' ? dest.longitude : typeof dest.lng === 'number' ? dest.lng : null;
      if (destLat !== null && destLon !== null) {
        destinationPoint = { latitude: destLat, longitude: destLon };
        setDestinationCoord(destinationPoint);
      }
    }

    // Fit the map to the selected route (plus the destination marker, if any).
    const fitPoints = Array.isArray(mapped[0] && mapped[0].coordinates)
      ? mapped[0].coordinates.slice()
      : [];
    if (destinationPoint) fitPoints.push(destinationPoint);
    if (fitPoints.length > 0 && mapRef.current) {
      try {
        mapRef.current.fitToCoordinates(fitPoints, {
          edgePadding: { top: 80, right: 80, bottom: 300, left: 80 },
          animated: true,
        });
      } catch {}
    }
  };

  const findRoute = async (queryOverride) => {
    // Fresh searches use the live input; recent-destination chips pass the
    // name explicitly so the search runs the instant the input is refilled.
    // Only a plain string counts — event objects from onPress/onSubmitEditing
    // fall through to the input-driven query.
    const query = (typeof queryOverride === 'string' ? queryOverride : destination).trim();
    // Reentrancy: the ref claim covers a same-frame second press that would
    // otherwise read the still-'idle' routeStatus checkpoint below.
    if (routeStatus === 'loading' || routeBusyRef.current) return;
    // Record THIS attempt (retained even on the failure paths below) so the
    // error card's 'Try again' re-runs the exact same text search.
    lastRouteAttemptRef.current = { kind: 'text', query };
    // Epoch captured at attempt start (see dataEpochRef): a mid-flight
    // erase-all must not let this search apply onto the fresh session.
    const epochAtStart = dataEpochRef.current;

    if (!query) {
      resetRouteStateForSearch();
      setRouteStatus('error');
      setRouteError('Enter a destination first.');
      return;
    }

    if (!API_BASE_URL) {
      resetRouteStateForSearch();
      setRouteStatus('error');
      setRouteError(BACKEND_NOT_CONFIGURED_MSG);
      return;
    }

    // Synchronous claim (see routeBusyRef): the routeStatus state check above
    // only protects against searches that have already COMMITTED 'loading'.
    routeBusyRef.current = true;
    resetRouteStateForSearch();
    setRouteStatus('loading');

    try {
      const origin = await acquireOrigin();

      const result = await fetchRouteCandidates({
        latitude: origin.latitude,
        longitude: origin.longitude,
        destination: query,
        mode: mode,
      });

      // Erase-all raced this search: everything below would write search
      // results (and recents) onto the freshly-erased state and storage.
      // Return to idle instead — the map shows its honest pre-search state.
      if (dataEpochRef.current !== epochAtStart) {
        setRouteStatus('idle');
        return;
      }

      applyRouteResults(result);
      setRouteStatus('success');

      // SETTLED successful route: remember the searched destination for the
      // quick re-search chips. Only a truly successful response reaches here
      // (errors throw into the catch below), so failed searches never pollute
      // the recents list. changed=false skips a redundant storage write.
      const pushed = pushRecentDestination(recentDestinations, query);
      if (pushed.changed) {
        setRecentDestinations(pushed.list);
        saveRecentDestinations(pushed.list);
      }
    } catch (err) {
      setRouteStatus('error');
      setRouteError(err && err.message ? err.message : ERROR_MESSAGES.NETWORK);
    } finally {
      routeBusyRef.current = false;
    }
  };

  // Route to a saved place: same origin/mode/alternatives assembly as the
  // text path (shared helpers above), but the destination goes over the wire
  // as exact coordinates + name, so no geocoding happens for the search.
  // Recents are deliberately NOT pushed: a saved place is coordinate-anchored
  // (its name alone would re-route via text geocoding and might resolve to a
  // different spot), so the name-only recent chip would not be equivalent.
  const routeToSavedPlace = async (place) => {
    // Same reentrancy rules as findRoute (routeBusyRef claim + epoch capture).
    if (!place || routeStatus === 'loading' || routeBusyRef.current) return;
    // Record THIS attempt so 'Try again' retries the same saved place with
    // the exact origin/target coordinates (never the name-geocode path).
    lastRouteAttemptRef.current = { kind: 'saved', place };
    const epochAtStart = dataEpochRef.current;

    if (!API_BASE_URL) {
      resetRouteStateForSearch();
      setRouteStatus('error');
      setRouteError(BACKEND_NOT_CONFIGURED_MSG);
      return;
    }

    routeBusyRef.current = true;
    setDestination(place.name);
    setView('map');
    resetRouteStateForSearch();
    setRouteStatus('loading');

    try {
      const origin = await acquireOrigin();

      const result = await fetchRouteCandidates({
        latitude: origin.latitude,
        longitude: origin.longitude,
        destination: place.name,
        mode: mode,
        destinationLatitude: place.latitude,
        destinationLongitude: place.longitude,
        destinationName: place.name,
      });

      // Erase-all raced this search (see findRoute): jump back to idle
      // instead of committing onto the fresh session.
      if (dataEpochRef.current !== epochAtStart) {
        setRouteStatus('idle');
        return;
      }

      applyRouteResults(result);
      setRouteStatus('success');
      // Recent-destination push intentionally omitted for saved places (see
      // comment above the handler).
    } catch (err) {
      setRouteStatus('error');
      setRouteError(err && err.message ? err.message : ERROR_MESSAGES.NETWORK);
    } finally {
      routeBusyRef.current = false;
    }
  };

  // 'Try again' on the map error card: re-runs the attempt that produced the
  // current error. No stored attempt (e.g. first-launch banner state) falls
  // back to a plain text re-search of the live input. findRoute /
  // routeToSavedPlace both no-op while a search is in flight, so a retry
  // spam-press cannot double-fetch.
  const retryRoute = () => {
    const last = lastRouteAttemptRef.current;
    if (!last) {
      findRoute();
      return;
    }
    if (last.kind === 'saved') {
      routeToSavedPlace(last.place);
    } else {
      findRoute(last.query);
    }
  };

  // Goal-chip press (the map's preference chips row): the picked goal is
  // ALWAYS recorded as lastRouteGoal first (validated membership; redundant
  // same-value writes skipped) — recording happens even while the Remember
  // toggle is off, because the toggle only decides when a recorded goal is
  // USED, never whether it is written. Route-option card presses keep
  // calling setPreference directly and never touch the recorded goal.
  // The recorded-goal check reads the prefsRef mirror (not the render
  // snapshot) so a redundant same-value pick is skipped against the latest
  // committed value.
  const applyPreference = (pref) => {
    const prefsLatest = prefsRef.current;
    if (isValidRouteGoal(pref) && (prefsLatest && prefsLatest.lastRouteGoal) !== pref) {
      updatePrefs({ lastRouteGoal: pref });
    }
    if (candidates.length === 0) return;
    setPreference(pref);
    const picked = selectByPreference(candidates, pref);
    if (picked) setSelectedId(picked.id);
  };

  // The currently selected candidate (falls back to the first one).
  const primary = candidates.find((c) => c.id === selectedId) || candidates[0];

  const startTrip = async () => {
    // Claim synchronously (see tripActiveRef): a same-frame second tap would
    // otherwise also pass and register a SECOND position watcher (whose
    // subscription then overwrites or duplicates the first).
    if (!primary || tripActiveRef.current) return;
    tripActiveRef.current = true;
    setTripActive(true);
    setTripStartTime(Date.now());
    setTripElapsed(0);
    setTripDistance(0);
    setTripDetailsExpanded(false);
    tripDistanceRef.current = 0;
    distanceAccountantRef.current = createTripDistanceAccountant();
    lastTrustedPairRef.current = null;
    consecutiveLowAccuracyRef.current = 0;
    setDistancePaused(false);
    tripFilterRef.current = null;
    // Mirror the reference/distance cleanup for the replay trail: a fresh
    // trip starts with an EMPTY path (the first accepted fix becomes its
    // first trail sample — never a carryover from a previous trip).
    trailRef.current = [];
    setLowAccuracyActive(false);
    setFollowUser(true);
    // PM2.5 capture (ADDITIVE): read the SELECTED route in App state directly
    // (`primary` — the selectedId candidate, falling back to the first, whose
    // Start Trip card is the one on screen; MapScreen's props contract stays
    // untouched). A record gains plannedPm25 only when the backend marked the
    // estimate available AND the value is a finite number; otherwise the
    // field is absent (null mirror) and both storage keys behave exactly as
    // they did before. Raw value — the same number the PM card displayed.
    const pmEstimate = primary && primary.pm25_estimate;
    const plannedPm25 =
      pmEstimate &&
      pmEstimate.available === true &&
      typeof pmEstimate.value === 'number' &&
      Number.isFinite(pmEstimate.value)
        ? pmEstimate.value
        : null;
    plannedPm25Ref.current = plannedPm25;
    try {
      const activeRecord = { startedAt: Date.now(), mode };
      if (plannedPm25 !== null) activeRecord.plannedPm25 = plannedPm25;
      await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(activeRecord));
    } catch {}
    if (locationSubRef.current) {
      try { locationSubRef.current.remove(); } catch {}
    }
    try {
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
        (pos) => {
          // Distance filtering runs FIRST and drives everything below: the
          // displayed marker and the follow-camera may move ONLY for fixes
          // the filter TRUSTS. (Previously the raw fix moved marker/camera
          // before the verdict, so low-accuracy noise and rejected jumps
          // visibly dragged the trip pin and the map around.)
          // prev comes from tripFilterRef, so its accuracy is always that of
          // an already-accepted fix. Captured BEFORE the reference advances:
          // the accountant also needs the pair that produced the step.
          const prevFix = tripFilterRef.current;
          const cur = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords?.accuracy,
            timestamp: pos.timestamp,
          };
          const step = tripStep(prevFix, cur);
          if (prevFix == null || step.quality === 'ok') {
            // TRUSTED accept arm. The first fix (no reference yet) is a
            // reference-only accept QUALIFYING for display too — tripStep
            // returns quality 'ok' for it regardless of accuracy, so marker
            // and camera track the filter verdict exactly, including for the
            // very first fix of a trip.
            const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setUserPos(p);
            // followUser via the ref (not the captured state): this callback is
            // registered once per trip, and the state it closes over would be
            // stale — panning the map (setFollowUser(false)) must stop the
            // camera re-centering on every subsequent fix.
            if (followUserRef.current && mapRef.current) {
              try {
                mapRef.current.animateCamera({ center: p, zoom: 17 }, { duration: 400 });
              } catch {}
            }
            // Accumulate distance once a reference exists (the first fix is
            // reference-only, meters 0). ADDITIVE windowed accounting: the
            // step's meters are held in the accountant's pending window and
            // only count when the window's NET displacement proves real
            // travel (see lib/track.js windowed accountant header) — an
            // indoor standing-still random walk ends up discarded. The
            // display shows decidedMeters: honest lag of at most
            // TRIP_FILTER.DISTANCE_COMMIT_MIN_M (50 m) until the next window
            // lands or finishTrip commits the remainder.
            if (prevFix) {
              const account = distanceStep(distanceAccountantRef.current, step, prevFix, cur);
              distanceAccountantRef.current = account.state;
              tripDistanceRef.current = account.state.decidedMeters;
              if (account.added) {
                setTripDistance(account.state.decidedMeters);
              }
            }
            tripFilterRef.current = cur;
            lastTrustedPairRef.current = { prev: prevFix, cur };
            // ADDITIVE trail retention (journey replay side-car). Mirrors the
            // accept decision: the accepted fix may join the trail when the
            // first sample (no last yet) or far enough (TRAIL_MIN_STEP_M,
            // pure display sampling — unrelated to the distance filter) from
            // the last retained one. Purely observational: breaking this
            // sample retention could not change distance, results or the
            // stored trip record.
            const trail = trailRef.current;
            const lastTrail = trail.length > 0 ? trail[trail.length - 1] : null;
            if (shouldRetainSample(lastTrail, cur)) {
              trail.push({ latitude: cur.latitude, longitude: cur.longitude });
            }
          } else if (step.quality === 'low_accuracy' || step.quality === 'jitter') {
            // UNTRUSTED/JITTER: keep the previous trusted reference. The
            // displayed marker/camera also stay on the last TRUSTED fix
            // (no reference update, no distance, no marker/camera move).
          } else if (step.quality === 'jump') {
            // Impossible jump (bad fix or teleport): re-sync the filter
            // reference to the rejected position so later real fixes measure
            // from there, but do NOT move the displayed marker/camera to it —
            // it is rejected ground, not traveled ground (the trail must not
            // take it either, or a fabricated straight segment would appear).
            // The marker resumes moving on the next TRUSTED fix only.
            tripFilterRef.current = cur;
          }
          // ADDITIVE distance-pause tracking: TWO consecutive low-accuracy
          // fixes pause the DISTANCE readout (MapScreen shows an honest
          // caption while this flag is up). jitter/jump leave it untouched,
          // any quality 'ok' fix resets it. Deliberately separate from
          // lowAccuracyActive below, which keeps its own single-fix notice
          // behavior untouched.
          if (step.quality === 'low_accuracy') {
            consecutiveLowAccuracyRef.current += 1;
            setDistancePaused(consecutiveLowAccuracyRef.current >= 2);
          } else if (step.quality === 'ok') {
            consecutiveLowAccuracyRef.current = 0;
            setDistancePaused(false);
          }
          setLowAccuracyActive(step.lowAccuracy);
        }
      );
      if (!tripActiveRef.current) {
        // The trip ENDED while the watcher was still being installed (an
        // immediate Finish Trip, or erase-all ran mid-await): drop the
        // subscription here so no watcher stays alive for a finished/rebuilt
        // session (storing it would leak and keep driving setUserPos).
        try { subscription.remove(); } catch {}
      } else {
        locationSubRef.current = subscription;
      }
    } catch {}
  };

  // Single persist path for EVERY saved-trips write (finishTrip, deletion,
  // note edits): state first, then the same TRIPS_KEY AsyncStorage write
  // finishTrip has always used. One key, one record shape — no second
  // storage format, stored data stays backward-compatible.
  const persistTrips = async (updated) => {
    setTrips(updated);
    try {
      await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(updated));
    } catch {}
  };

  // Journey Replay side-car writer. Persists `{ [tripId]: [[lat, lng], ...] }`
  // for the finished trip from the retained trail (first + last kept, thinned
  // by TRAIL_MIN_STEP_M during tracking). The write is best-effort: any
  // failure leaves the trip record intact and just makes that trip
  // non-replayable. Ratio thinning on this write keeps storage bounded even
  // for very long trips (TRAIL_MAX_POINTS; endpoints never dropped).
  const saveTrail = async (tripId, points) => {
    if (!tripId) return;
    if (!Array.isArray(points) || points.length < 2) return; // 1 point can't be replayed
    try {
      const raw = await AsyncStorage.getItem(TRAIL_KEY);
      const map = parseTrails(raw);
      map[String(tripId)] = thinTrailPoints(
        points.map((pt) => [pt.latitude, pt.longitude]),
        TRAIL_MAX_POINTS
      );
      await AsyncStorage.setItem(TRAIL_KEY, JSON.stringify(map));
    } catch {}
  };

  // Removes one trip's side-car entry (used by trip deletion so the trail
  // never outlives its trip record).
  const pruneTrail = async (tripId) => {
    if (!tripId) return;
    try {
      const raw = await AsyncStorage.getItem(TRAIL_KEY);
      const map = parseTrails(raw);
      if (!Object.prototype.hasOwnProperty.call(map, String(tripId))) return;
      delete map[String(tripId)];
      await AsyncStorage.setItem(TRAIL_KEY, JSON.stringify(map));
    } catch {}
  };

  const finishTrip = async () => {
    // Claim synchronously (see tripActiveRef): a same-frame double-tap of
    // Finish Trip would otherwise pass the old `if (!tripActive) return`
    // checkpoint twice — both closures see tripActive as true before any
    // re-render — and persist TWO identical trip records (the second call's
    // `trips` snapshot does not yet contain the first record).
    if (!tripActiveRef.current) return;
    tripActiveRef.current = false;
    const end = Date.now();
    const elapsedSec = tripStartTime ? (end - tripStartTime) / 1000 : tripElapsed;
    // Final distance from the WINDOWED ACCOUNTANT (network truth, not the
    // raw path sum): decidedMeters already cover every committed window and
    // finishTripDistance decides the remaining queue regardless of size —
    // a real short final leg commits (ratio ≈ 1), a drift-dominated one is
    // discarded (ratio ≈ 0). A trip where standing-still drift dominated
    // therefore ends with an honestly SMALLER number than the old path sum.
    // lastTrustedPairRef carries the last accepted fix pair (prev captured
    // before the reference advanced); tripFilterRef stays the last accepted
    // fix until the resets below.
    const finishAccount = finishTripDistance(
      distanceAccountantRef.current,
      lastTrustedPairRef.current ? lastTrustedPairRef.current.prev : null,
      tripFilterRef.current
    );
    const distM = finishAccount.meters;
    tripDistanceRef.current = distM;
    if (locationSubRef.current) {
      try { locationSubRef.current.remove(); } catch {}
      locationSubRef.current = null;
    }
    const trip = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      mode,
      actualDistanceM: distM,
      durationSec: elapsedSec,
    };
    // Carried from the active trip (see plannedPm25Ref): present only when a
    // usable PM2.5 estimate was captured at Start Trip. Re-validated here so
    // a stale/mis-shaped mirror can never write a non-finite field; old
    // records (and estimate-less new trips) simply keep omitting the field.
    const plannedPm25 = plannedPm25Ref.current;
    if (typeof plannedPm25 === 'number' && Number.isFinite(plannedPm25)) {
      trip.plannedPm25 = plannedPm25;
    }
    plannedPm25Ref.current = null;
    // Trip record FIRST (shape untouched), then the side-car trail — a
    // failed trail write must never lose or delay the trip record.
    const updated = [trip, ...trips];
    await persistTrips(updated);
    await saveTrail(trip.id, trailRef.current);
    try {
      await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
    } catch {}
    setTripActive(false);
    setTripStartTime(null);
    setTripElapsed(0);
    setLowAccuracyActive(false);
    setDistancePaused(false);
    consecutiveLowAccuracyRef.current = 0;
    // Same reset family as tripDistance/tripFilter (handled at the next
    // startTrip): clear the accountant's pending window and last accepted
    // pair so nothing can leak into a future trip.
    distanceAccountantRef.current = createTripDistanceAccountant();
    lastTrustedPairRef.current = null;
    setTripDetailsExpanded(false);
  };

  useEffect(() => {
    if (!tripActive || !tripStartTime) return;
    const id = setInterval(() => {
      setTripElapsed((Date.now() - tripStartTime) / 1000);
    }, 1000);
    return () => clearInterval(id);
  }, [tripActive, tripStartTime]);

  const saveProfile = async (newProfile) => {
    setProfile(newProfile);
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newProfile));
    } catch {}
  };

  // Single persist path for the recent-destinations write (same pattern as
  // persistTrips/saveProfile: state first, then the dedicated key).
  const saveRecentDestinations = async (list) => {
    try {
      await AsyncStorage.setItem(RECENT_DESTINATION_KEY, JSON.stringify(list));
    } catch {}
  };

  // Clear chip on the map: drops all recents from state and storage.
  const clearRecentDestinations = () => {
    setRecentDestinations([]);
    AsyncStorage.removeItem(RECENT_DESTINATION_KEY).catch(() => {});
  };

  // ---------------------------------------------------------------------------
  // Saved places: persistent destination records. Add flows converge on one
  // pending-place object the user reviews (name + category editable) before
  // it becomes a saved record; storage goes through the single persist path
  // below, exactly like persistTrips.
  // ---------------------------------------------------------------------------

  const persistSavedPlaces = async (updated) => {
    setSavedPlaces(updated);
    try {
      await AsyncStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(updated));
    } catch {}
  };

  // Enter the Saved Places screen (from Settings) with a clean add flow.
  const openSavedPlaces = () => {
    setPendingPlace(null);
    setSavedAddError(null);
    setSavedCoordError(null);
    setView('saved');
  };

  const showPendingPlace = ({ name, category, latitude, longitude }) => {
    setSavedAddError(null);
    setSavedCoordError(null);
    setPendingPlace({
      name,
      category: PLACE_CATEGORIES.some((cat) => cat.id === category) ? category : 'other',
      latitude,
      longitude,
    });
  };

  // Geocode a free-text query against the lightweight GET /geocode endpoint.
  // Error mapping is by envelope CODE into the EXISTING ERROR_MESSAGES strings
  // (INVALID_REQUEST surfaces the server's own message, same as /route) — no
  // new copy invented for codes the backend already defines.
  const geocodePlaceQuery = async (queryText) => {
    const q = typeof queryText === 'string' ? queryText.trim() : '';
    if (!q) throw new Error('Type a place to search for.');
    if (!API_BASE_URL) throw new Error(BACKEND_NOT_CONFIGURED_MSG);
    let response;
    try {
      // fetchWithTimeout (shared with the /route service) aborts a hung
      // backend after ~15s; the AbortError rejects here and is mapped by
      // the SAME catch below that covers an unreachable backend
      // (ERROR_MESSAGES.NETWORK) — no separate error copy for timeouts.
      response = await fetchWithTimeout(`${API_BASE_URL}/geocode?q=${encodeURIComponent(q)}`);
    } catch {
      throw new Error(ERROR_MESSAGES.NETWORK);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const code = data && data.error && data.error.code;
      const message = data && data.error && data.error.message;
      if (code === 'INVALID_REQUEST' && message) throw new Error(message);
      throw new Error(
        Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.NETWORK
      );
    }
    const lat = data && typeof data.latitude === 'number' && Number.isFinite(data.latitude) ? data.latitude : null;
    const lng = data && typeof data.longitude === 'number' && Number.isFinite(data.longitude) ? data.longitude : null;
    if (lat === null || lng === null) throw new Error(ERROR_MESSAGES.NO_GEOCODING_RESULT);
    // The API returns a single normalized result (no fake multi-results);
    // displayName is the Nominatim label or the queried text fallback.
    const displayName = data && typeof data.displayName === 'string' ? data.displayName.trim() : '';
    return { latitude: lat, longitude: lng, displayName: displayName || q };
  };

  // Add method 1: search. Packs the single geocode result into the
  // edit-confirm row (name prefilled from the API label, category 'other').
  const addPlaceFromSearch = async (queryText) => {
    setPendingPlace(null);
    setSavedCoordError(null);
    setSavedAddError(null);
    setSavedAddStatus('searching');
    try {
      const { latitude, longitude, displayName } = await geocodePlaceQuery(queryText);
      showPendingPlace({ name: displayName, category: 'other', latitude, longitude });
    } catch (err) {
      setSavedAddError(err && err.message ? err.message : ERROR_MESSAGES.NETWORK);
    } finally {
      setSavedAddStatus('idle');
    }
  };

  // Add method 2: coordinates. Numeric + range validation happens here so
  // the coordinate inputs show INLINE field errors (no Alert spam).
  const addPlaceFromCoordinates = (latStr, lngStr) => {
    const latText = typeof latStr === 'string' ? latStr.trim() : '';
    const lngText = typeof lngStr === 'string' ? lngStr.trim() : '';
    const latNum = Number(latText);
    const lngNum = Number(lngText);
    const errors = {};
    if (latText === '' || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      errors.latitude = 'Enter a latitude between -90 and 90.';
    }
    if (lngText === '' || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      errors.longitude = 'Enter a longitude between -180 and 180.';
    }
    setPendingPlace(null);
    setSavedAddError(null);
    setSavedCoordError(errors);
    if (errors.latitude || errors.longitude) return;
    showPendingPlace({ name: '', category: 'other', latitude: latNum, longitude: lngNum });
  };

  // Add method 3: current location. Reuses the SAME acquisition + copy as the
  // startup path (mocked in tests via requestForegroundPermissionsAsync /
  // getCurrentPositionAsync) and the banner's permission-denied semantics.
  const addPlaceFromCurrentLocation = async () => {
    setPendingPlace(null);
    setSavedCoordError(null);
    setSavedAddError(null);
    setSavedAddStatus('locating');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setSavedAddError('Location permission was denied. Enable it to save your current position.');
        return;
      }
      const currentLocation = await Location.getCurrentPositionAsync({});
      if (
        !currentLocation || !currentLocation.coords ||
        typeof currentLocation.coords.latitude !== 'number' ||
        typeof currentLocation.coords.longitude !== 'number'
      ) {
        setSavedAddError('Could not determine your current location.');
        return;
      }
      showPendingPlace({
        name: '',
        category: 'other',
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    } catch {
      setSavedAddError('Could not determine your current location.');
    } finally {
      setSavedAddStatus('idle');
    }
  };

  // Add method 4: map picker. Navigates to the full-screen picker; it returns
  // a { latitude, longitude } through confirmMapPick below.
  const addPlaceFromMapPick = () => {
    setPendingPlace(null);
    setSavedCoordError(null);
    setSavedAddError(null);
    setView('savedPick');
  };

  const confirmMapPick = (coords) => {
    if (
      !coords ||
      typeof coords.latitude !== 'number' || !Number.isFinite(coords.latitude) ||
      typeof coords.longitude !== 'number' || !Number.isFinite(coords.longitude)
    ) {
      return;
    }
    setView('saved');
    showPendingPlace({ name: '', category: 'other', latitude: coords.latitude, longitude: coords.longitude });
  };

  // Commit the pending place through buildSavedPlace (its thrown error object
  // { code, field, message } lands as an inline add-flow error).
  const submitPendingPlace = async (fields) => {
    if (!pendingPlace) return;
    const name = fields && typeof fields.name === 'string' ? fields.name : pendingPlace.name;
    const category = fields && typeof fields.category === 'string' ? fields.category : pendingPlace.category;
    try {
      const place = buildSavedPlace({
        name,
        category,
        latitude: pendingPlace.latitude,
        longitude: pendingPlace.longitude,
      });
      await persistSavedPlaces([place, ...savedPlaces].slice(0, SAVED_PLACES_MAX));
      setPendingPlace(null);
    } catch (err) {
      setSavedAddError(err && err.message ? err.message : 'Could not save that place.');
    }
  };

  const cancelPendingPlace = () => {
    setPendingPlace(null);
    setSavedAddError(null);
    setSavedCoordError(null);
  };

  // Rename / recategorize a saved place. Returns { ok: true } or
  // { ok: false, field } (union style, consistent with the add flow's thrown
  // error objects: field 'name' → inline rename error in the screen).
  const updateSavedPlace = async (id, fields) => {
    const existing = savedPlaces.find((pl) => pl && pl.id === id);
    if (!existing) return { ok: false, field: 'id' };
    const name = fields && typeof fields.name === 'string' ? fields.name.trim() : existing.name;
    if (!name || name.length > 60) return { ok: false, field: 'name' };
    const category = typeof (fields && fields.category) === 'string'
      ? (PLACE_CATEGORIES.some((cat) => cat.id === fields.category) ? fields.category : 'other')
      : existing.category;
    await persistSavedPlaces(
      savedPlaces.map((pl) => (pl && pl.id === id ? { ...pl, name, category } : pl))
    );
    return { ok: true };
  };

  // Delete flow: confirm first (system Alert, EXACT same confirm style as
  // delete-trip), then remove via the single persist path. Chips and the
  // saved list refresh from state naturally; nothing references the deleted
  // record afterwards.
  const confirmDeleteSavedPlace = (id) => {
    Alert.alert(
      'Delete saved place?',
      'This removes the place from your saved list. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => doDeleteSavedPlace(id) },
      ]
    );
  };

  const doDeleteSavedPlace = async (id) => {
    await persistSavedPlaces(savedPlaces.filter((pl) => pl && pl.id !== id));
  };

  const changeProfilePhoto = async () => {
    try {
      // Read-only picker: media-library permission gates gallery access.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        // Graceful refusal: explain, then stop. No crash, profile untouched.
        Alert.alert('Photo permission needed', 'Allow photo library access to choose a profile picture.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        // Installed expo-image-picker 17.x types accept a MediaType[] array
        // here ('images' | 'videos' | 'livePhotos'); MediaTypeOptions is
        // deprecated in favor of the array form.
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        // quality 0.35 + the 1:1 crop keeps the JPEG small (typically 30-60 KB
        // of base64 at avatar sizes), so the profile record fits comfortably
        // in AsyncStorage while still looking crisp at 48x48.
        quality: 0.35,
        base64: true,
      });
      if (res.canceled || !(res.assets && res.assets.length)) {
        // User picked nothing — leave the profile exactly as it was.
        return;
      }
      const asset = res.assets[0];
      // base64 is preferred so the photo persists across sessions in Expo Go;
      // a content:// or ph:// uri alone can stop resolving after a reload,
      // so it is only used as a fallback if base64 is unavailable.
      const photo = asset.base64
        ? `data:image/jpeg;base64,${asset.base64}`
        : (asset.uri || null);
      // `photo` is an additive optional field on the stored profile object —
      // older records without it simply render the default initial avatar.
      saveProfile({ ...profile, photo });
    } catch {
      // Picker unavailable or failed — do nothing rather than crash.
    }
  };

  const removeProfilePhoto = () => {
    saveProfile({ ...profile, photo: null });
  };

  // ---------------------------------------------------------------------------
  // Trip History navigation + detail notes + deletion (view-level, UI only).
  // ---------------------------------------------------------------------------

  const openHistory = () => {
    setDetailTripId(null);
    setDraftTripId(null);
    setView('history');
  };

  const openTripDetail = (id) => {
    const trip = trips.find((tr) => tr && tr.id === id);
    if (!trip) return;
    // Seed local drafts from the stored record; old records without
    // title/description simply start empty (placeholders show).
    setDraftTripId(id);
    setDraftTitle(typeof trip.title === 'string' ? trip.title : '');
    setDraftDescription(typeof trip.description === 'string' ? trip.description : '');
    setDetailTripId(id);
  };

  // Notes are additive optional fields (title/description) on the trip record.
  // Old records without them keep working; stored values are a trimmed string
  // or null — never undefined — so no broken shape ever reaches storage.
  // Fires on blur of either input and on leaving the detail screen (the
  // unchanged guard below makes repeat calls no-ops).
  const saveTripNotes = async (tripId) => {
    if (!tripId) return;
    const trip = trips.find((tr) => tr && tr.id === tripId);
    if (!trip) return;
    const title = draftTitle.trim();
    const description = draftDescription.trim();
    const nextTitle = title === '' ? null : title;
    const nextDescription = description === '' ? null : description;
    if ((trip.title ?? null) === nextTitle && (trip.description ?? null) === nextDescription) return;
    const updatedTrip = { ...trip, title: nextTitle, description: nextDescription };
    // Id-based update preserves the array's existing order.
    await persistTrips(trips.map((tr) => (tr && tr.id === tripId ? updatedTrip : tr)));
  };

  // Leaving the detail screen: persist any differing draft first, then go
  // back to the History list (blurred inputs have usually already saved).
  const closeDetail = () => {
    if (draftTripId) {
      saveTripNotes(draftTripId); // no-op when the draft matches the record
    }
    setDraftTripId(null);
    setDetailTripId(null);
  };

  // Journey Replay navigation. Trails do NOT live in app state — the replay
  // screen reads the side-car storage on demand — so opening is cheap and
  // resolution ("can replay" vs the honest unavailable card) happens inside
  // the replay screen. The back affordance returns to the History screen,
  // which shows the detail view again when one was open (detailTripId is
  // left untouched).
  const openReplay = (id) => {
    const trip = trips.find((tr) => tr && tr.id === id);
    if (!trip) return;
    setReplayTripId(id);
    setView('replay');
  };

  const closeReplay = () => {
    setReplayTripId(null);
    setView('history');
  };

  // If the open detail trip no longer resolves (deleted mid-flight), drop
  // back to the History list instead of rendering a dangling detail screen.
  useEffect(() => {
    if (detailTripId === null || !tripsLoaded) return;
    if (!trips.some((tr) => tr && tr.id === detailTripId)) {
      setDraftTripId(null);
      setDetailTripId(null);
    }
  }, [detailTripId, tripsLoaded, trips]);

  // Delete flow: confirm first (system Alert), then remove from state and
  // persist through the same path used when saving. Lifetime totals and the
  // streak panel recompute from the `trips` state every render, so deletion
  // needs only this state update — no extra recompute step.
  const confirmDeleteTrip = (id) => {
    Alert.alert(
      'Delete trip?',
      'This removes the trip from your history permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => doDeleteTrip(id) },
      ]
    );
  };

  const doDeleteTrip = async (id) => {
    const updated = trips.filter((tr) => tr && tr.id !== id);
    await persistTrips(updated);
    // Journey replay side-car: a trip's trail never outlives the trip.
    await pruneTrail(id);
    if (detailTripId === id) {
      setDraftTripId(null);
      setDetailTripId(null); // back to the History list
    }
    if (replayTripId === id) {
      setReplayTripId(null);
    }
  };

  // Location errors are non-blocking: the map still renders (centered on a
  // default region if needed) with a dismissible banner, so routing and the
  // Profile screen stay reachable. The loading screen only shows while the
  // initial fix is still pending.
  if (!location && !locationError && view === 'map') {
    return (
      <View style={styles.messageContainer}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={t.primary} />
        <Text style={styles.messageTitle}>Setting up your map</Text>
        <Text style={styles.messageText}>Finding your location...</Text>
      </View>
    );
  }

  if (view === 'savedPick') {
    return (
      <MapPickerScreen
        styles={styles}
        t={t}
        isDark={isDark}
        initialRegion={location}
        onPick={confirmMapPick}
        onClose={() => setView('saved')}
      />
    );
  }

  if (view === 'saved') {
    return (
      <SavedPlacesScreen
        styles={styles}
        t={t}
        isDark={isDark}
        savedPlaces={savedPlaces}
        pendingPlace={pendingPlace}
        savedAddStatus={savedAddStatus}
        savedAddError={savedAddError}
        savedCoordError={savedCoordError}
        addPlaceFromSearch={addPlaceFromSearch}
        addPlaceFromCurrentLocation={addPlaceFromCurrentLocation}
        addPlaceFromCoordinates={addPlaceFromCoordinates}
        openMapPicker={addPlaceFromMapPick}
        submitPendingPlace={submitPendingPlace}
        cancelPendingPlace={cancelPendingPlace}
        updateSavedPlace={updateSavedPlace}
        confirmDeleteSavedPlace={confirmDeleteSavedPlace}
        routeToSavedPlace={routeToSavedPlace}
        setView={setView}
      />
    );
  }

  if (view === 'profile') {
    return (
      <ProfileScreen
        styles={styles}
        t={t}
        isDark={isDark}
        trips={trips}
        profile={profile}
        prefs={prefs}
        distUnit={distUnit}
        saveProfile={saveProfile}
        changeProfilePhoto={changeProfilePhoto}
        removeProfilePhoto={removeProfilePhoto}
        openHistory={openHistory}
        setView={setView}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsScreen
        styles={styles}
        isDark={isDark}
        profile={profile}
        trips={trips}
        savedPlaces={savedPlaces}
        themeMode={themeMode}
        accentName={accentName}
        prefs={prefs}
        applyTheme={applyTheme}
        applyAccent={applyAccent}
        applyPreferredMode={applyPreferredMode}
        applyRememberRouteGoal={applyRememberRouteGoal}
        applyDashboardToggle={applyDashboardToggle}
        setDistanceUnit={setDistanceUnit}
        confirmEraseAll={confirmEraseAll}
        openSavedPlaces={openSavedPlaces}
        setView={setView}
      />
    );
  }

  if (view === 'history') {
    return (
      <HistoryScreen
        styles={styles}
        t={t}
        isDark={isDark}
        trips={trips}
        tripsLoaded={tripsLoaded}
        detailTripId={detailTripId}
        draftTripId={draftTripId}
        draftTitle={draftTitle}
        setDraftTitle={setDraftTitle}
        draftDescription={draftDescription}
        setDraftDescription={setDraftDescription}
        distUnit={distUnit}
        openTripDetail={openTripDetail}
        closeDetail={closeDetail}
        confirmDeleteTrip={confirmDeleteTrip}
        saveTripNotes={saveTripNotes}
        openReplay={openReplay}
        setView={setView}
      />
    );
  }

  // Journey Replay: reads its own side-car trail on demand (never part of
  // app state); unavailable trips get the honest explanation card there.
  if (view === 'replay') {
    const replayTrip = replayTripId
      ? trips.find((tr) => tr && tr.id === replayTripId) || null
      : null;
    return (
      <ReplayScreen
        styles={styles}
        t={t}
        isDark={isDark}
        trip={replayTrip}
        distUnit={distUnit}
        onBack={closeReplay}
      />
    );
  }

  return (
    <MapScreen
      styles={styles}
      t={t}
      isDark={isDark}
      primary={primary}
      mapRef={mapRef}
      location={location}
      // Raw request origin + accuracy captured by acquireOrigin (the same
      // fix the route request consumed); MapScreen uses these only for the
      // dashed route-start connector representation — no route state changes.
      currentCoords={currentCoords}
      currentAccuracy={currentAccuracy}
      locationError={locationError}
      locationBannerDismissed={locationBannerDismissed}
      setLocationBannerDismissed={setLocationBannerDismissed}
      userPos={userPos}
      followUser={followUser}
      setFollowUser={setFollowUser}
      destinationCoord={destinationCoord}
      destination={destination}
      setDestination={setDestination}
      routeStatus={routeStatus}
      routeError={routeError}
      candidates={candidates}
      recentDestinations={recentDestinations}
      clearRecentDestinations={clearRecentDestinations}
      savedPlaces={savedPlaces}
      routeToSavedPlace={routeToSavedPlace}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      preference={preference}
      applyPreference={applyPreference}
      setPreference={setPreference}
      mode={mode}
      setMode={setMode}
      panelExpanded={panelExpanded}
      setPanelExpanded={setPanelExpanded}
      profile={profile}
      chipPhotoFailed={chipPhotoFailed}
      setChipPhotoFailed={setChipPhotoFailed}
      tripActive={tripActive}
      tripElapsed={tripElapsed}
      tripDistance={tripDistance}
      lowAccuracyActive={lowAccuracyActive}
      distancePaused={distancePaused}
      tripDetailsExpanded={tripDetailsExpanded}
      setTripDetailsExpanded={setTripDetailsExpanded}
      distUnit={distUnit}
      findRoute={findRoute}
      retryRoute={retryRoute}
      startTrip={startTrip}
      finishTrip={finishTrip}
      setView={setView}
    />
  );
}
