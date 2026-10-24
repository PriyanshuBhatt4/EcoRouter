// Journey Replay screen: animates the RECORDED path of a saved trip through
// the side-car trail storage (constants.js TRAIL_KEY).
//
// Honesty rules (by design):
// - The ONLY path ever drawn here is the trail the user actually traveled —
//   the stream of accepted GPS fixes retained while the trip was tracked.
//   There is deliberately NO planned-route preview: planned polylines were
//   never persisted with trips, and drawing one would label a synthesized
//   line as the user's walked path.
// - Trips recorded before this feature have no stored path (old records keep
//   only distance/duration/mode/date), and a stored trail can also be absent
//   if the side-car was cleared. Both cases land on the same honest
//   "Replay unavailable" card — never a fabricated path.
// - Header stats show the STORED record values verbatim (distance/duration)
//   — nothing is re-derived from the polyline sample.
//
// Controls use no external libs: a plain interval ticker (60 ms) advances
// normalized progress over a fixed 45 s full-path duration, and the scrubber
// is a slim View measured via onLayout + a responder (drag/tap), per the
// project rule of Animated/onLayout-only custom controls.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Text, ScrollView, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmptyState, ModePill, ScreenHeader, StatTile } from '../components/ui';
import { formatDistance, formatDurationLong, formatTripDate } from '../lib/format';
import {
  DEFAULT_REGION,
  TRAIL_KEY,
  parseTrails,
  pointAtProgress,
  progressToIndex,
  trailToCoords,
} from '../constants';
import { DARK_MAP_STYLE } from '../theme/palette';

// Fixed 45 s wall-clock for the full stored path, advanced by one 60 ms tick
// at a time (750 ticks total). Simple and device-independent.
const REPLAY_TICK_MS = 60;
const REPLAY_TICKS = 750;

const UNAVAILABLE_HINT =
  "Trips recorded before this version don't save the path you walked. New trips can be replayed.";

export default function ReplayScreen({ styles, t, isDark, trip, distUnit, onBack }) {
  const mapRef = useRef(null);
  // Trail lifecycle: 'loading' (storage read in flight), 'ready' (>= 2 valid
  // points) or 'none' (no usable trail → the honest unavailable card).
  const [status, setStatus] = useState('loading');
  const [points, setPoints] = useState([]);
  // Normalized replay progress 0..1 (mirrored in progressRef so the interval
  // ticker can resume its sequence without stale closures).
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Scrubber track width from onLayout (no slider dependency).
  const [trackWidth, setTrackWidth] = useState(0);
  const progressRef = useRef(0);
  const intervalRef = useRef(null);
  const pulseRef = useRef(null);
  // Soft opacity pulse on the moving marker while playback runs (Animated
  // only; the animation never drives React state — replaying is a paused
  // static marker otherwise).
  const markerPulse = useRef(new Animated.Value(1)).current;

  const startPulse = () => {
    stopPulse();
    markerPulse.setValue(1);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(markerPulse, { toValue: 0.45, duration: 900, useNativeDriver: false }),
        Animated.timing(markerPulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      ])
    );
    try { pulse.start(); } catch {}
    pulseRef.current = pulse;
  };

  const stopPulse = () => {
    if (pulseRef.current) {
      try { pulseRef.current.stop(); } catch {}
      pulseRef.current = null;
    }
  };

  // Trail lookup: tolerate any storage failure by falling back to the
  // unavailable state — never a crash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let coords = [];
      if (trip) {
        try {
          const raw = await AsyncStorage.getItem(TRAIL_KEY);
          const map = parseTrails(raw);
          coords = trailToCoords((map && map[String(trip.id)]) || []);
        } catch {
          coords = [];
        }
      }
      if (cancelled) return;
      if (coords.length >= 2) {
        setPoints(coords);
        setStatus('ready');
      } else {
        setPoints([]);
        setStatus('none');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trip && trip.id]);

  // Fit the map to the full trail when it arrives (same fit pattern + edge
  // padding the route results use in App.js).
  useEffect(() => {
    if (status !== 'ready' || points.length < 2) return;
    const map = mapRef.current;
    if (!map || typeof map.fitToCoordinates !== 'function') return;
    try {
      map.fitToCoordinates(points, {
        edgePadding: { top: 80, right: 80, bottom: 240, left: 80 },
        animated: false,
      });
    } catch {}
  }, [status, points]);

  const stopPlayback = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopPulse();
    setPlaying(false);
  };

  // Single teardown for the interval ticker + marker pulse (no leak when the
  // screen unmounts mid-playback).
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      stopPulse();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlayPause = () => {
    if (playing || intervalRef.current) {
      stopPlayback();
      return;
    }
    if (progressRef.current >= 1) {
      progressRef.current = 0;
      setProgress(0);
    }
    setPlaying(true);
    startPulse();
    intervalRef.current = setInterval(() => {
      const next = progressRef.current + 1 / REPLAY_TICKS;
      if (next >= 1) {
        progressRef.current = 1;
        setProgress(1);
        stopPlayback();
        return;
      }
      progressRef.current = next;
      setProgress(next);
    }, REPLAY_TICK_MS);
  };

  const onRestart = () => {
    stopPlayback();
    progressRef.current = 0;
    setProgress(0);
  };

  const scrubTo = (locationX) => {
    if (typeof locationX !== 'number' || !Number.isFinite(locationX) || trackWidth <= 0) return;
    const ratio = Math.min(1, Math.max(0, locationX / trackWidth));
    stopPlayback();
    progressRef.current = ratio;
    setProgress(ratio);
  };

  const handleScrub = (evt) => {
    const x = evt && evt.nativeEvent ? evt.nativeEvent.locationX : null;
    if (typeof x === 'number') scrubTo(x);
  };

  // Non-ready states share the header: a small loading row while the trail
  // lookup is in flight, and the honest unavailable card for every cause
  // (unknown trip, pre-feature record, cleared side-car).
  if (trip == null || status !== 'ready') {
    return (
      <View style={styles.container}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
          <ScreenHeader
            styles={styles}
            onBackPress={onBack}
            backAccessibilityRole="button"
            backAccessibilityLabel="Back to trip history"
            backText="‹ Back"
            title="Replay"
          />
          <View style={styles.profileCard}>
            {status === 'loading' ? (
              <View style={styles.historyLoadingRow}>
                <ActivityIndicator size="small" color={t.primary} />
              </View>
            ) : (
              <EmptyState styles={styles} title="Replay unavailable" hint={UNAVAILABLE_HINT} />
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  const idx = progressToIndex(progress, points.length);
  const traveledCoords = points.slice(0, idx + 1);
  const markerPoint = pointAtProgress(points, progress);

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
        <ScreenHeader
          styles={styles}
          onBackPress={onBack}
          backAccessibilityRole="button"
          backAccessibilityLabel="Back to trip history"
          backText="‹ Back"
          title="Replay"
        />

        {/* Trip summary: the STORED record values, as in the History detail. */}
        <View style={styles.profileCard}>
          {trip.title ? (
            <Text style={styles.historyTripTitle} numberOfLines={1}>
              {trip.title}
            </Text>
          ) : null}
          <Text style={styles.tripRowDate}>{formatTripDate(trip.date)}</Text>
          <ModePill styles={styles} mode={trip.mode} />
          <View style={[styles.statTileRow, styles.detailStatsGap]}>
            <StatTile
              styles={styles}
              value={formatDistance(trip.actualDistanceM, distUnit) || '—'}
              label="Distance"
            />
            <StatTile styles={styles} value={formatDurationLong(trip.durationSec)} label="Time" />
          </View>
        </View>

        {/* Map + controls card. Caption makes the honesty scope explicit. */}
        <View style={styles.profileCard}>
          <Text style={styles.replayCaption}>Your recorded path</Text>
          <MapView
            ref={mapRef}
            style={styles.replayMap}
            initialRegion={DEFAULT_REGION}
            customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            {/* Full stored trail in the muted soft-primary tint... */}
            <Polyline coordinates={points} strokeColor={t.primarySoft} strokeWidth={6} />
            {/* ...and the progressive traveled slice in the bright accent. */}
            {idx >= 1 && (
              <Polyline coordinates={traveledCoords} strokeColor={t.primary} strokeWidth={4} />
            )}
            {/* Start + finish anchors of the stored path. */}
            <Marker coordinate={points[0]}>
              <View style={[styles.replayEndpointDot, { backgroundColor: t.primary }]} />
            </Marker>
            <Marker coordinate={points[points.length - 1]}>
              <View style={[styles.replayEndpointDot, { backgroundColor: t.amber }]} />
            </Marker>
            {markerPoint && (
              <Marker coordinate={markerPoint}>
                <Animated.View style={[styles.replayMarkerDot, { opacity: markerPulse }]} />
              </Marker>
            )}
          </MapView>

          <Text style={styles.replayCaption}>Replay playback animates the stored path over about 45 seconds; distances and durations above are the trip&apos;s recorded values.</Text>

          <View style={styles.replayControlsRow}>
            <TouchableOpacity
              style={styles.replayControlBtn}
              onPress={onPlayPause}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause replay' : 'Play replay'}
            >
              <Text style={styles.replayControlText}>{playing ? 'Pause' : 'Play'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.replayControlBtn}
              onPress={onRestart}
              accessibilityRole="button"
              accessibilityLabel="Restart replay"
            >
              <Text style={styles.replayControlText}>Restart</Text>
            </TouchableOpacity>
          </View>

          {/* Custom scrubber: onLayout-measured track, responder drag/tap. */}
          <View
            style={styles.replayScrubber}
            onLayout={(evt) => setTrackWidth(evt.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrub}
            onResponderMove={handleScrub}
            accessibilityRole="adjustable"
            accessibilityLabel="Replay progress"
          >
            <View
              style={[styles.replayScrubberFill, { width: `${Math.round(progress * 10000) / 100}%` }]}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
