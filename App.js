import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Dimensions, ActivityIndicator, ScrollView } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
console.log('EcoRoute backend URL:', API_BASE_URL);

const ERROR_MESSAGES = {
  NO_GEOCODING_RESULT: 'No location found for that destination. Try a more specific name.',
  NO_ROUTE_FOUND: 'No route found between your location and that destination.',
  UPSTREAM_TIMEOUT: 'The mapping service timed out. Please try again.',
  UPSTREAM_ERROR: 'The mapping service is currently unavailable. Please try again later.',
  INVALID_REQUEST: 'Invalid request. Check your destination and try again.',
  NETWORK: 'Could not reach the backend server. Check that it is running and your device is on the same network.',
};

const MODES = {
  WALKING: 'walking',
  CYCLING: 'cycling',
  DRIVING: 'driving',
};

const PREFERENCES = {
  MANUAL: 'manual',
  FASTEST: 'fastest',
  SHORTEST: 'shortest',
  CLEANEST: 'cleanest',
  OPTIMAL: 'optimal',
};

const PROFILE_KEY = '@EcoRoute/profile';
const TRIPS_KEY = '@EcoRoute/trips';
const ACTIVE_TRIP_KEY = '@EcoRoute/activeTrip';

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function formatDurationLong(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

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
  const [profile, setProfile] = useState({ name: '', weightKg: '' });
  const [trips, setTrips] = useState([]);
  const [tripActive, setTripActive] = useState(false);
  const [tripStartTime, setTripStartTime] = useState(null);
  const [tripElapsed, setTripElapsed] = useState(0);
  const [tripDistance, setTripDistance] = useState(0);
  const [userPos, setUserPos] = useState(null);
  const [followUser, setFollowUser] = useState(true);
  const [maneuvers, setManeuvers] = useState([]);
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  const lastPosRef = useRef(null);
  const tripDistanceRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const p = await AsyncStorage.getItem(PROFILE_KEY);
        if (p) setProfile(JSON.parse(p));
        const t = await AsyncStorage.getItem(TRIPS_KEY);
        if (t) setTrips(JSON.parse(t));
        await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
      } catch {}
    })();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission was denied. Enable it to route from your current position.');
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
        setLocationError('Could not determine your current location.');
      }
    })();
  }, []);

  const findRoute = async () => {
    const query = destination.trim();
    if (routeStatus === 'loading') return;

    if (!query) {
      setCandidates([]);
      setSelectedId(null);
      setPreference(PREFERENCES.MANUAL);
      setRouteStatus('error');
      setRouteError('Enter a destination first.');
      return;
    }

    if (!API_BASE_URL) {
      setCandidates([]);
      setSelectedId(null);
      setPreference(PREFERENCES.MANUAL);
      setRouteStatus('error');
      setRouteError('Backend address is not configured. Set EXPO_PUBLIC_API_BASE_URL in .env or .env.local and restart Expo.');
      return;
    }

    setCandidates([]);
    setSelectedId(null);
    setPreference(PREFERENCES.MANUAL);
    setRouteError(null);
    setRouteStatus('loading');

    let startLat;
    let startLon;
    try {
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      startLat = fresh.coords.latitude;
      startLon = fresh.coords.longitude;
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
    } catch {
      setRouteStatus('error');
      setRouteError('Could not get your current location (high accuracy).');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: startLat,
          longitude: startLon,
          destination: query,
          mode: mode,
          alternatives: 3,
        }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const code = data && data.error && data.error.code;
        const message = data && data.error && data.error.message;
        setRouteStatus('error');
        if (code === 'INVALID_REQUEST' && message) {
          setRouteError(message);
        } else {
          setRouteError(ERROR_MESSAGES[code] || message || 'Route request failed.');
        }
        return;
      }

      const list = data && Array.isArray(data.candidates) ? data.candidates : [];
      if (list.length === 0) {
        setRouteStatus('error');
        setRouteError('The server returned no routes.');
        return;
      }

      const mapped = list
        .map((c, idx) => {
          const coords = Array.isArray(c && c.coordinates) ? c.coordinates : [];
          if (coords.length === 0) return null;
          const mapCoords = coords.map(([longitude, latitude]) => ({
            latitude,
            longitude,
          }));
          const id = c.id || `route-${idx}`;
          return {
            id,
            coordinates: mapCoords,
            distanceMeters: c.distance_m,
            durationSeconds: c.duration_s,
            pm25_estimate: c.pm25_estimate || null,
          };
        })
        .filter(Boolean);

      if (mapped.length === 0) {
        setRouteStatus('error');
        setRouteError('The server returned an empty route.');
        return;
      }

      setCandidates(mapped);
      setSelectedId(mapped[0].id);
      setPreference(PREFERENCES.MANUAL);
      setPanelExpanded(false);
      let mans = [];
      if (data.candidates && data.candidates[0]) {
        const c0 = data.candidates[0];
        if (Array.isArray(c0.legs)) {
          for (const leg of c0.legs) {
            if (Array.isArray(leg.maneuvers)) mans = mans.concat(leg.maneuvers);
          }
        } else if (Array.isArray(c0.maneuvers)) {
          mans = c0.maneuvers;
        }
      }
      setManeuvers(mans);
      setRouteStatus('success');
    } catch {
      setRouteStatus('error');
      setRouteError(ERROR_MESSAGES.NETWORK);
    }
  };

  const applyPreference = (pref) => {
    if (candidates.length === 0) return;
    if (pref === PREFERENCES.MANUAL) {
      setPreference(pref);
      return;
    }
    if (candidates.length === 1) {
      setPreference(pref);
      setSelectedId(candidates[0].id);
      return;
    }
    if (pref === PREFERENCES.FASTEST) {
      let best = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const b = best;
        const cDur = c.durationSeconds ?? Infinity;
        const bDur = b.durationSeconds ?? Infinity;
        if (cDur < bDur - 1e-9) {
          best = c;
        } else if (Math.abs(cDur - bDur) < 1e-9) {
          if ((c.distanceMeters ?? Infinity) < (b.distanceMeters ?? Infinity)) {
            best = c;
          }
        }
      }
      setPreference(pref);
      setSelectedId(best.id);
      return;
    } else if (pref === PREFERENCES.SHORTEST) {
      let best = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const b = best;
        const cDist = c.distanceMeters ?? Infinity;
        const bDist = b.distanceMeters ?? Infinity;
        if (cDist < bDist - 1e-9) {
          best = c;
        } else if (Math.abs(cDist - bDist) < 1e-9) {
          if ((c.durationSeconds ?? Infinity) < (b.durationSeconds ?? Infinity)) {
            best = c;
          }
        }
      }
      setPreference(pref);
      setSelectedId(best.id);
      return;
    } else if (pref === PREFERENCES.CLEANEST) {
      const firstExp = candidates[0].pm25_estimate;
      if (!firstExp || firstExp.can_compare_cleanest !== true) {
        setPreference(pref);
        return;
      }
      let best = candidates[0];
      let bestVal = candidates[0].pm25_estimate && candidates[0].pm25_estimate.value;
      for (let i = 1; i < candidates.length; i++) {
        const exp = candidates[i].pm25_estimate;
        if (!exp || !exp.available || exp.value === undefined || exp.value === null) {
          setPreference(pref);
          return;
        }
        const v = exp.value;
        if (bestVal === undefined || bestVal === null) {
          best = candidates[i];
          bestVal = v;
          continue;
        }
        if (v < bestVal) {
          best = candidates[i];
          bestVal = v;
        }
      }
      setPreference(pref);
      setSelectedId(best.id);
      return;
    } else if (pref === PREFERENCES.OPTIMAL) {
      if (candidates.length === 0) return;
      let allPmAvailable = true;
      for (let i = 0; i < candidates.length; i++) {
        const exp = candidates[i].pm25_estimate;
        if (!exp || !exp.available || exp.value === undefined || exp.value === null) {
          allPmAvailable = false;
          break;
        }
      }
      if (!allPmAvailable) {
        setPreference(pref);
        return;
      }
      const pmValues = candidates.map((c) => c.pm25_estimate.value);
      const pmEqual = new Set(pmValues.map((v) => Math.round(v * 10) / 10)).size === 1;
      const distVals = candidates.map((c) => c.distanceMeters ?? 0);
      const durVals = candidates.map((c) => c.durationSeconds ?? 0);
      const dMin = Math.min(...distVals);
      const dMax = Math.max(...distVals);
      const tMin = Math.min(...durVals);
      const tMax = Math.max(...durVals);
      const pMin = Math.min(...pmValues);
      const pMax = Math.max(...pmValues);
      const norm = (v, minv, maxv) => {
        if (maxv === minv) return 0.5;
        return (v - minv) / (maxv - minv);
      };
      let best = candidates[0];
      let bestScore = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const nd = norm(c.distanceMeters ?? 0, dMin, dMax);
        const nt = norm(c.durationSeconds ?? 0, tMin, tMax);
        const np = pmEqual ? 0.5 : norm(c.pm25_estimate.value, pMin, pMax);
        const score = (nd + nt + np) / 3.0;
        if (score < bestScore - 1e-9) {
          bestScore = score;
          best = c;
        }
      }
      setPreference(pref);
      setSelectedId(best.id);
      return;
    }
  };

  const startTrip = async () => {
    if (!primary) return;
    setTripActive(true);
    setTripStartTime(Date.now());
    setTripElapsed(0);
    setTripDistance(0);
    tripDistanceRef.current = 0;
    lastPosRef.current = null;
    setFollowUser(true);
    try {
      await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify({ startedAt: Date.now(), mode }));
    } catch {}
    if (locationSubRef.current) {
      try { locationSubRef.current.remove(); } catch {}
    }
    try {
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
        (pos) => {
          const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setUserPos(p);
          if (followUser && mapRef.current) {
            try {
              mapRef.current.animateCamera({ center: p, zoom: 17 }, { duration: 400 });
            } catch {}
          }
          if (lastPosRef.current) {
            const R = 6371000;
            const toRad = (x) => (x * Math.PI) / 180;
            const dLat = toRad(p.latitude - lastPosRef.current.latitude);
            const dLon = toRad(p.longitude - lastPosRef.current.longitude);
            const lat1 = toRad(lastPosRef.current.latitude);
            const lat2 = toRad(p.latitude);
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const dist = R*c;
            if (dist > 1 && dist < 150) {
              tripDistanceRef.current += dist;
              setTripDistance(tripDistanceRef.current);
            }
          }
          lastPosRef.current = p;
        }
      );
    } catch {}
  };

  const finishTrip = async () => {
    if (!tripActive) return;
    const end = Date.now();
    const elapsedSec = tripStartTime ? (end - tripStartTime) / 1000 : tripElapsed;
    const distM = tripDistanceRef.current;
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
    const updated = [trip, ...trips];
    setTrips(updated);
    try {
      await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(updated));
      await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
    } catch {}
    setTripActive(false);
    setTripStartTime(null);
    setTripElapsed(0);
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

  const lifetimeDist = trips.reduce((s,t)=>s + (t.actualDistanceM||0), 0);
  const lifetimeTime = trips.reduce((s,t)=>s + (t.durationSec||0), 0);

  const nextMan = maneuvers && maneuvers.length > 0 ? maneuvers[0] : null;

  if (locationError && view === 'map') {
    return (
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>{locationError}</Text>
      </View>
    );
  }

  if (!location && view === 'map') {
    return (
      <View style={styles.messageContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.messageText}>Finding your location...</Text>
      </View>
    );
  }

  const primary = candidates.find((c) => c.id === selectedId) || candidates[0];

  if (view === 'profile') {
    return (
      <View style={styles.container}>
        <View style={styles.profileHeader}>
          <Text style={styles.profileTitle}>Profile</Text>
          <TouchableOpacity onPress={() => setView('map')}>
            <Text style={{ color: '#2563EB' }}>Back to Map</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.profileBody}>
          <Text style={styles.cardTitle}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={profile.name}
            onChangeText={(t) => saveProfile({ ...profile, name: t })}
            placeholder="Your name"
          />
          <Text style={[styles.cardTitle, { marginTop: 12 }]}>Body Weight (kg, optional)</Text>
          <TextInput
            style={styles.input}
            value={profile.weightKg}
            onChangeText={(t) => saveProfile({ ...profile, weightKg: t })}
            placeholder="e.g., 70"
            keyboardType="numeric"
          />
          <Text style={[styles.cardTitle, { marginTop: 16 }]}>Lifetime Totals</Text>
          <Text style={styles.smallText}>Distance: {formatDistance(lifetimeDist) || '—'}</Text>
          <Text style={styles.smallText}>Time: {formatDurationLong(lifetimeTime)}</Text>
          <Text style={[styles.cardTitle, { marginTop: 16 }]}>Recent Trips</Text>
          {trips.slice(0, 10).map((tr) => (
            <View key={tr.id} style={{ marginBottom: 8, padding: 8, backgroundColor: '#F9FAFB', borderRadius: 8 }}>
              <Text style={styles.smallText}>{new Date(tr.date).toLocaleString()}</Text>
              <Text style={styles.smallText}>Mode: {tr.mode} | {formatDistance(tr.actualDistanceM) || '—'} | {formatDurationLong(tr.durationSec)}</Text>
            </View>
          ))}
          {trips.length === 0 && <Text style={styles.smallText}>No completed trips yet.</Text>}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={location}
        showsUserLocation={true}
        onPanDrag={() => setFollowUser(false)}
      >
        {candidates.map((c) => (
          <Polyline
            key={c.id}
            coordinates={c.coordinates}
            strokeColor={c.id === selectedId ? '#10B981' : '#9CA3AF'}
            strokeWidth={c.id === selectedId ? 6 : 4}
            opacity={c.id === selectedId ? 1 : 0.6}
          />
        ))}
        {tripActive && userPos && <Marker coordinate={userPos} pinColor="#2563EB" />}
      </MapView>

      <View style={styles.searchBox}>
        <TextInput
          style={styles.input}
          placeholder="Where to? (e.g., Hauz Khas)"
          placeholderTextColor="#666"
          value={destination}
          onChangeText={setDestination}
        />
      </View>

      <View style={{ position: 'absolute', top: 110, right: 20 }}>
        <TouchableOpacity style={styles.smallBtn} onPress={() => setView('profile')}>
          <Text style={styles.smallBtnText}>Profile</Text>
        </TouchableOpacity>
        {!followUser && (
          <TouchableOpacity style={[styles.smallBtn, { marginTop: 6 }]} onPress={() => { setFollowUser(true); if (userPos && mapRef.current) { try { mapRef.current.animateCamera({ center: userPos, zoom: 17 }, { duration: 400 }); } catch {} } }}>
            <Text style={styles.smallBtnText}>Recenter</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.bottomCard}>
        <Text style={styles.cardSubtitle}>Mode: {mode === MODES.CYCLING ? 'cycling' : mode === MODES.DRIVING ? 'driving' : 'walking'} (Valhalla public server — prototype only, no SLA)</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity style={[styles.modeBtn, mode === MODES.WALKING && styles.modeBtnActive]} onPress={() => setMode(MODES.WALKING)}>
            <Text style={[styles.modeText, mode === MODES.WALKING && styles.modeTextActive]}>Walking</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, mode === MODES.CYCLING && styles.modeBtnActive]} onPress={() => setMode(MODES.CYCLING)}>
            <Text style={[styles.modeText, mode === MODES.CYCLING && styles.modeTextActive]}>Cycling</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.smallText, { fontSize: 11 }]}>Cycling uses Valhalla bicycle costing (public server). Durations are provider estimates, not live traffic.</Text>

        {routeStatus === 'idle' && (
          <Text style={styles.cardSubtitle}>Enter a destination to see routes.</Text>
        )}

        {routeStatus === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#10B981" />
            <Text style={styles.cardSubtitle}>Finding routes...</Text>
          </View>
        )}

        {routeStatus === 'error' && (
          <View>
            <Text style={styles.cardTitle}>Route unavailable</Text>
            <Text style={styles.errorText}>{routeError}</Text>
          </View>
        )}

        {routeStatus === 'success' && primary && !tripActive && (
          <View>
            <Text style={styles.cardTitle}>
              Routes returned: {candidates.length}
              {candidates.length === 1 ? ' (only one route available)' : ''}
            </Text>

            {!panelExpanded ? (
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.smallText} numberOfLines={1}>
                    {mode} • {preference} • {formatDistance(primary.distanceMeters) || '—'} • {formatDuration(primary.durationSeconds) || '—'} (est.)
                  </Text>
                  <TouchableOpacity onPress={() => setPanelExpanded(true)}>
                    <Text style={[styles.smallText, { color: '#2563EB', marginLeft: 8 }]}>Expand</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                {candidates.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
                    {candidates.map((c, idx) => {
                      const selected = c.id === selectedId;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.optionCard, selected && styles.optionCardSelected]}
                          onPress={() => {
                            setPreference(PREFERENCES.MANUAL);
                            setSelectedId(c.id);
                          }}
                        >
                          <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                            Route {idx + 1}
                          </Text>
                          <Text style={styles.optionText}>
                            {formatDistance(c.distanceMeters) || '—'} • {formatDuration(c.durationSeconds) || '—'} (est.)
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}

                <View style={styles.prefRow}>
                  <TouchableOpacity style={[styles.prefBtn, preference === PREFERENCES.FASTEST && styles.prefBtnActive]} onPress={() => applyPreference(PREFERENCES.FASTEST)}>
                    <Text style={[styles.prefText, preference === PREFERENCES.FASTEST && styles.prefTextActive]}>Fastest</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.prefBtn, preference === PREFERENCES.SHORTEST && styles.prefBtnActive]} onPress={() => applyPreference(PREFERENCES.SHORTEST)}>
                    <Text style={[styles.prefText, preference === PREFERENCES.SHORTEST && styles.prefTextActive]}>Shortest</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.prefBtn, preference === PREFERENCES.CLEANEST && styles.prefBtnActive]} onPress={() => applyPreference(PREFERENCES.CLEANEST)}>
                    <Text style={[styles.prefText, preference === PREFERENCES.CLEANEST && styles.prefTextActive]}>Cleanest</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.prefBtn, preference === PREFERENCES.OPTIMAL && styles.prefBtnActive]} onPress={() => applyPreference(PREFERENCES.OPTIMAL)}>
                    <Text style={[styles.prefText, preference === PREFERENCES.OPTIMAL && styles.prefTextActive]}>Optimal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.prefBtn, preference === PREFERENCES.MANUAL && styles.prefBtnActive]} onPress={() => setPreference(PREFERENCES.MANUAL)}>
                    <Text style={[styles.prefText, preference === PREFERENCES.MANUAL && styles.prefTextActive]}>Manual</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.smallText}>
                  Pref: {preference} | Mode: {mode} | Durations are provider estimates.
                </Text>

                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Distance</Text>
                    <Text style={styles.statValue}>{formatDistance(primary.distanceMeters) || '—'}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Time</Text>
                    <Text style={styles.statValue}>{formatDuration(primary.durationSeconds) || '—'} (est.)</Text>
                  </View>
                </View>

                {primary.pm25_estimate && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={styles.smallText}>
                      PM₂.₅ (regional model): {primary.pm25_estimate.available ? `${primary.pm25_estimate.value} ${primary.pm25_estimate.units}` : 'Unavailable'}
                    </Text>
                    {primary.pm25_estimate.cross_route_note ? (
                      <Text style={[styles.smallText, { fontSize: 11 }]}>{primary.pm25_estimate.cross_route_note}</Text>
                    ) : null}
                  </View>
                )}

                {nextMan && (
                  <View style={{ marginBottom: 6 }}>
                    <Text style={styles.smallText}>Next maneuver (Valhalla): {nextMan.instruction || nextMan.type || '—'}</Text>
                    {nextMan.length ? <Text style={[styles.smallText, { fontSize: 11 }]}>Distance to maneuver: {(nextMan.length).toFixed(2)} km (leg units)</Text> : null}
                  </View>
                )}
                {!nextMan && maneuvers.length === 0 && <Text style={[styles.smallText, { fontSize: 11 }]}>No turn maneuvers available from provider.</Text>}

                <TouchableOpacity style={[styles.button, { marginTop: 6 }]} onPress={startTrip}>
                  <Text style={styles.buttonText}>Start Trip</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPanelExpanded(false)}>
                  <Text style={[styles.smallText, { color: '#2563EB', marginTop: 6 }]}>Collapse</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {tripActive && (
          <View>
            <Text style={styles.cardTitle}>Trip in Progress</Text>
            <Text style={styles.smallText}>Elapsed: {formatDurationLong(tripElapsed)}</Text>
            <Text style={styles.smallText}>Actual distance: {formatDistance(tripDistance) || '—'}</Text>
            {nextMan && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.smallText}>Next: {nextMan.instruction || nextMan.type || '—'}</Text>
              </View>
            )}
            <TouchableOpacity style={[styles.button, { marginTop: 8 }]} onPress={finishTrip}>
              <Text style={styles.buttonText}>Finish Trip</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, routeStatus === 'loading' && styles.buttonDisabled]}
          onPress={findRoute}
          disabled={routeStatus === 'loading'}
        >
          <Text style={styles.buttonText}>{routeStatus === 'loading' ? 'Finding...' : 'Find Routes'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  messageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  messageText: { marginTop: 10, fontSize: 15, color: '#444', textAlign: 'center' },
  searchBox: {
    position: 'absolute',
    top: 50,
    width: '90%',
    alignSelf: 'center',
    backgroundColor: 'white',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 12,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
  },
  input: { fontSize: 16, color: '#333', backgroundColor: '#F9FAFB', padding: 8, borderRadius: 8 },
  bottomCard: {
    position: 'absolute',
    bottom: 30,
    width: '90%',
    alignSelf: 'center',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    maxHeight: Dimensions.get('window').height * 0.6,
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#111', marginBottom: 8 },
  cardSubtitle: { fontSize: 13, color: '#666', marginBottom: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  errorText: { fontSize: 14, color: '#B91C1C', lineHeight: 20 },
  optionsScroll: { marginBottom: 10 },
  optionCard: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 8,
  },
  optionCardSelected: { backgroundColor: '#D1FAE5' },
  optionTitle: { fontSize: 13, fontWeight: 'bold', color: '#111' },
  optionTitleSelected: { color: '#065F46' },
  optionText: { fontSize: 12, color: '#444' },
  prefRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 8 },
  prefBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 8,
    marginHorizontal: 4,
    marginBottom: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  prefBtnActive: { backgroundColor: '#DBEAFE' },
  prefText: { fontSize: 12, color: '#111' },
  prefTextActive: { fontWeight: 'bold', color: '#1E40AF' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginTop: 8 },
  statBox: { alignItems: 'center' },
  statLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  smallText: { fontSize: 12, color: '#666', marginTop: 4 },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  modeBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 6,
    marginHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#DBEAFE' },
  modeText: { fontSize: 12, color: '#111' },
  modeTextActive: { fontWeight: 'bold', color: '#1E40AF' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  smallBtn: { backgroundColor: 'white', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, elevation: 3 },
  smallBtnText: { fontSize: 12, color: '#111' },
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 50, backgroundColor: 'white' },
  profileTitle: { fontSize: 20, fontWeight: 'bold' },
  profileBody: { flex: 1, backgroundColor: 'white', padding: 16 },
});
