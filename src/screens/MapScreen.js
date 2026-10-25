import React from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  useWindowDimensions,
} from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { StatusBar } from 'expo-status-bar';
import { formatDistance, formatDuration, formatDurationLong, formatPmUnits } from '../lib/format';
import { distanceBetweenFixes } from '../lib/track';
import { PREFERENCES, preferenceNote } from '../lib/preferences';
import { ATTRIBUTION_TEXT, DEFAULT_REGION, MODES } from '../constants';
import { DARK_MAP_STYLE } from '../theme/palette';
import { ModePill, PrimaryButton, GhostButton } from '../components/ui';

// PM card meta caption: source → readable-label map is hardcoded. Every current
// estimate comes from open-meteo-cams, a modelled background product, so
// 'Model estimate' is the honest prefix; an unknown-but-present source falls
// back to the raw source string after the same prefix, and with no source at
// all the prefix still stands alone (backend payloads are never altered).
const PM_SOURCE_LABELS = { 'open-meteo-cams': 'Model estimate · Open-Meteo CAMS' };

function pmMetaCaption(estimate) {
  if (!estimate) return null;
  const source =
    typeof estimate.source === 'string' && estimate.source ? estimate.source : null;
  const base = PM_SOURCE_LABELS[source || ''] || (source ? `Model estimate · ${source}` : 'Model estimate');
  // 'as of' segment only shows when as_of parses as a date (UTC clock time);
  // an unparseable value omits it safely rather than printing 'Invalid Date'.
  if (typeof estimate.as_of === 'string') {
    const when = new Date(estimate.as_of);
    if (!Number.isNaN(when.getTime())) {
      const hh = String(when.getUTCHours()).padStart(2, '0');
      const mm = String(when.getUTCMinutes()).padStart(2, '0');
      return `${base} · as of ${hh}:${mm} UTC`;
    }
  }
  return base;
}

// Availability-aware PM2.5 card: prettified units, meta caption (source +
// read time) and the verbatim backend caveat line under the value.
function PmEstimate({ styles, estimate }) {
  const units = formatPmUnits(estimate.units);
  return (
    <View style={[styles.pmCard, estimate.available ? styles.pmCardOk : styles.pmCardWarn]}>
      <Text style={[styles.pmTitle, estimate.available && styles.pmTitleOk]}>
        PM₂.₅ estimate (regional model)
      </Text>
      <Text style={estimate.available ? styles.pmValue : styles.pmValueMuted}>
        {estimate.available
          ? units
            ? `${estimate.value} ${units}`
            : `${estimate.value}`
          : 'Unavailable'}
      </Text>
      <Text style={styles.pmMeta}>{pmMetaCaption(estimate)}</Text>
      {estimate.caveat ? <Text style={styles.pmCaveat}>{estimate.caveat}</Text> : null}
      {estimate.cross_route_note ? (
        <Text style={styles.pmNote}>{estimate.cross_route_note}</Text>
      ) : null}
    </View>
  );
}

export default function MapScreen({
  // theming
  styles,
  t,
  isDark,
  primary,
  // map + location state
  mapRef,
  location,
  // Raw REQUEST-ORIGIN state from App (acquireOrigin -> setCurrentCoords /
  // setCurrentAccuracy): the exact GPS fix the route request consumed,
  // surfaced only for the route-start connector representation below. The
  // route never moves and the request is unchanged — this is display only.
  currentCoords = null,
  currentAccuracy = null,
  locationError,
  locationBannerDismissed,
  setLocationBannerDismissed,
  userPos,
  followUser,
  setFollowUser,
  destinationCoord,
  // search / routing state
  destination,
  setDestination,
  routeStatus,
  routeError,
  // recent destinations (quick re-search chips); [] hides the row entirely
  recentDestinations = [],
  clearRecentDestinations,
  // saved places (quick-route chips under the recents row); [] hides the row
  savedPlaces = [],
  routeToSavedPlace,
  candidates,
  selectedId,
  setSelectedId,
  preference,
  applyPreference,
  setPreference,
  mode,
  setMode,
  panelExpanded,
  setPanelExpanded,
  // profile chip
  profile,
  chipPhotoFailed,
  setChipPhotoFailed,
  // trip state
  tripActive,
  tripElapsed,
  tripDistance,
  lowAccuracyActive,
  // ADDITIVE: true while consecutive low-accuracy fixes paused the distance
  // readout (windowed accountant holding back unverifiable meters). Defaults
  // to false so every pre-existing MapScreen mount behaves identically.
  distancePaused = false,
  tripDetailsExpanded,
  setTripDetailsExpanded,
  distUnit,
  // handlers
  findRoute,
  // Retry affordance: re-runs the SAME attempt that produced the current
  // error (text search or saved-place routing with the exact coordinates).
  // Falls back to the text-path handler when the parent doesn't provide it.
  retryRoute = () => findRoute && findRoute(),
  startTrip,
  finishTrip,
  setView,
}) {
  // Transparent-selection note for the preference chips row: explains what the
  // active preference does, or why a fallback kept the manual selection. Pure
  // helper; {show:false} for manual/empty states, null only for unknown
  // preference keys (which never occur from the chips UI).
  const prefNoteState = preferenceNote(preference, candidates);

  // Route-start snapping REPRESENTATION (honest fix, display only): Valhalla
  // snaps the raw start to the nearest walkable road, so every candidate
  // polyline begins at the SNAPPED point — not at the request origin where
  // the user actually stands. acquireOrigin already sent the raw GPS fix and
  // App stored it in currentCoords/currentAccuracy; nothing about the route
  // or the request changes here. When the SELECTED candidate's start sits
  // >= 25m from that captured origin, we draw ONE dashed connector polyline
  // on the map and one honest caption in the expanded panel showing where
  // the step onto the road happens. Below 25m GPS noise dominates: no
  // connector, no caption. The gap is computed CLIENT-SIDE per selected
  // candidate with the existing pure haversine (distanceBetweenFixes,
  // src/lib/track.js) — deliberately NOT the backend's candidates[0]
  // .start_snap_m, which reports the snap of the PRIMARY route only and
  // could mismatch the selected alternate. Route math/selection untouched.
  const routeConnector = (() => {
    if (routeStatus !== 'success' || !candidates || candidates.length === 0 || !selectedId) {
      return null;
    }
    const originOk =
      currentCoords &&
      typeof currentCoords.latitude === 'number' &&
      Number.isFinite(currentCoords.latitude) &&
      typeof currentCoords.longitude === 'number' &&
      Number.isFinite(currentCoords.longitude);
    if (!originOk) return null;
    const selected = candidates.find((c) => c && c.id === selectedId) || candidates[0];
    const rawStart =
      selected && Array.isArray(selected.coordinates) && selected.coordinates.length > 0
        ? selected.coordinates[0]
        : null;
    // candidates from services/api.js are already mapped to
    // {latitude, longitude} objects; a raw [lng, lat] pair is tolerated
    // defensively with the same [1],[0] conversion api.js applies.
    const snapPoint =
      rawStart &&
      typeof rawStart.latitude === 'number' &&
      Number.isFinite(rawStart.latitude) &&
      typeof rawStart.longitude === 'number' &&
      Number.isFinite(rawStart.longitude)
        ? { latitude: rawStart.latitude, longitude: rawStart.longitude }
        : Array.isArray(rawStart) &&
          typeof rawStart[0] === 'number' &&
          Number.isFinite(rawStart[0]) &&
          typeof rawStart[1] === 'number' &&
          Number.isFinite(rawStart[1])
          ? { latitude: rawStart[1], longitude: rawStart[0] }
          : null;
    if (!snapPoint) return null;
    const gapM = distanceBetweenFixes(currentCoords, snapPoint);
    if (!(gapM >= 25)) return null;
    // Honest accuracy context, appended only when the device reports a
    // horizontal error at least comparable to the gap itself; omitted
    // entirely when accuracy is unknown (never shames the fix).
    const accuracyNote =
      typeof currentAccuracy === 'number' &&
      Number.isFinite(currentAccuracy) &&
      currentAccuracy > gapM * 0.8
        ? `Your location marker may drift by about ${
            formatDistance(currentAccuracy, distUnit) || '—'
          } on this device.`
        : null;
    return { snapPoint, gapM, accuracyNote };
  })();
  // SINGLE-SOURCE PANEL BUDGET (root-cause fix): both the card's pixel cap
  // and the scroll area's pixel cap derive from ONE dim.height value so
  // neither depends on the other's clamp propagating. The card keeps its
  // 58% visual token in styles.bottomCard, but we also pin that exact pixel
  // value inline so the scroll bound below can subtract the card's fixed
  // chrome from the SAME number instead of guessing a second percentage:
  //   panelCardMax = round(h * 0.58)            — the card's pixel cap
  //   panelScrollMax = max(120, round − 190)    — the scroll's pixel cap
  // The 190px subtraction covers everything stacked INSIDE the card above
  // and below the scroll area: panel header row ~46 (routes title +
  // Collapse), Start Trip button ~48, the buttonGapCard gap 12, and ~64 of
  // card padding + chrome (grabs/labels), plus a small safety margin. The
  // max(120, …) floor keeps a usable scroll on very short windows. Invariant:
  // panelScrollMax + 190 ≤ panelCardMax, so the scroll can never exceed the
  // card regardless of window height.
  const dim = useWindowDimensions();
  const panelCardMax = Math.round(dim.height * 0.58);
  const panelScrollMax = Math.max(120, panelCardMax - 190);
  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={location || DEFAULT_REGION}
        showsUserLocation={true}
        customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
        onPanDrag={() => setFollowUser(false)}
      >
        {candidates.map((c) => (
          <Polyline
            key={c.id}
            coordinates={c.coordinates}
            strokeColor={c.id === selectedId ? t.brand : t.textTertiary}
            strokeWidth={c.id === selectedId ? 6 : 4}
            opacity={c.id === selectedId ? 1 : 0.6}
          />
        ))}
        {/* Route-start connector (dashed, visually distinct from route
            lines): runs from the raw request origin to the selected
            candidate's snapped start whenever they sit >= 25m apart. The
            route polyline itself is unchanged; this only shows the walk to
            the nearest road, so the blue dot stays honest and no route is
            moved. */}
        {routeConnector ? (
          <Polyline
            testID="routeConnector"
            coordinates={[
              { latitude: currentCoords.latitude, longitude: currentCoords.longitude },
              routeConnector.snapPoint,
            ]}
            strokeWidth={3}
            lineDashPattern={[3, 6]}
            strokeColor={t.amber}
            opacity={0.7}
          />
        ) : null}
        {destinationCoord && candidates.length > 0 && (
          <Marker coordinate={destinationCoord} pinColor={t.amber} />
        )}
        {tripActive && userPos && <Marker coordinate={userPos} pinColor={t.accent} />}
      </MapView>

      <View style={styles.topBar}>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            placeholder="Where to? (e.g., Hauz Khas)"
            placeholderTextColor={t.textTertiary}
            value={destination}
            onChangeText={setDestination}
            maxLength={200}
            returnKeyType="search"
            onSubmitEditing={findRoute}
          />
        </View>
        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => setView('profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          {profile.photo && !chipPhotoFailed ? (
            // Photo chip: same state that drives the Profile hero avatar, so
            // it updates after restart automatically. A stale/invalid URI
            // falls back to the initial via onError instead of crashing.
            <Image
              source={{ uri: profile.photo }}
              style={styles.profileBtnImage}
              onError={() => setChipPhotoFailed(true)}
            />
          ) : (
            <Text style={styles.profileBtnText}>
              {profile.name ? profile.name.trim().charAt(0).toUpperCase() : 'Me'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Quick re-search chips for recent destinations: idle only (never
          while routes are shown or a trip is running). A chip refills the
          input AND runs the same findRoute flow as the search button via the
          explicit-name argument, so loading state and errors behave
          identically. Hidden entirely when no recents are stored. */}
      {recentDestinations.length > 0 && routeStatus === 'idle' && !tripActive && (
        <View style={styles.recentChipRow} pointerEvents="box-none">
          {recentDestinations.slice(0, 4).map((name) => (
            <TouchableOpacity
              key={name}
              style={styles.recentChip}
              onPress={() => {
                setDestination(name);
                findRoute(name);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Use recent destination: ${name}`}
            >
              <Text style={styles.recentChipText} numberOfLines={1}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.recentChipClear}
            onPress={clearRecentDestinations}
            accessibilityRole="button"
            accessibilityLabel="Clear recent destinations"
          >
            <Text style={styles.recentChipText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Quick-route chips for saved places: same chip look/idle-only rules
          as the recents row, placed directly under it (offset applied only
          when the recents row renders). Pressing a chip routes to the exact
          stored coordinates via routeToSavedPlace — it also refills the
          input so the search field shows what is being routed to. */}
      {savedPlaces.length > 0 && routeStatus === 'idle' && !tripActive && (
        <View
          style={[
            styles.recentChipRow,
            recentDestinations.length > 0 && styles.savedChipRowOffset,
          ]}
          pointerEvents="box-none"
        >
          {savedPlaces.slice(0, 4).map((place) => (
            <TouchableOpacity
              key={place.id}
              style={styles.recentChip}
              onPress={() => routeToSavedPlace(place)}
              accessibilityRole="button"
              accessibilityLabel={`Set destination to saved place: ${place.name}`}
            >
              <Text style={styles.recentChipText} numberOfLines={1}>
                {place.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!followUser && (
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={() => { setFollowUser(true); if (userPos && mapRef.current) { try { mapRef.current.animateCamera({ center: userPos, zoom: 17 }, { duration: 400 }); } catch {} } }}
        >
          <Text style={styles.recenterText}>Recenter</Text>
        </TouchableOpacity>
      )}

      <View
        style={[
          styles.bottomCard,
          tripActive && !tripDetailsExpanded && styles.bottomCardCompact,
          // Inline PIXEL cap mirroring the same dim.height the scroll bound
          // below derives from (one source, two bounds — see the budget
          // comment above). The inline pixel value overrides the '%' token
          // in styles.bottomCard, which stays untouched for any other
          // render branch of this shared style. In the compact trip state
          // the card is small, so the cap never binds there.
          { maxHeight: panelCardMax },
        ]}
      >
        {tripActive && !tripDetailsExpanded ? (
          <>
            <View style={styles.compactTripCard}>
              <View style={styles.compactRow}>
                <ModePill styles={styles} mode={mode} style={styles.compactPill} />
                <View style={styles.compactStats}>
                  <Text style={styles.compactDist} numberOfLines={1}>
                    Distance{' '}
                    {lowAccuracyActive
                      ? `\u2248 ${formatDistance(tripDistance, distUnit) || '—'} (low GPS)`
                      : (formatDistance(tripDistance, distUnit) || '—')}
                  </Text>
                  {/* ADDITIVE honest caption: the windowed accountant has
                      paused distance while GPS is unreliable; text only, the
                      low-accuracy warning and the distance figures above are
                      untouched. */}
                  {distancePaused === true && tripActive && (
                    <Text style={styles.distancePausedNote}>
                      Distance is paused while GPS signal is unreliable.
                    </Text>
                  )}
                  <Text style={styles.compactElapsed} numberOfLines={1}>
                    {formatDurationLong(tripElapsed)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.compactBtn, styles.compactBtnGhost]}
                  onPress={() => setTripDetailsExpanded(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Show trip details"
                >
                  <Text style={styles.compactGhostText}>Details ▾</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.compactBtn, styles.compactBtnPrimary]}
                  onPress={finishTrip}
                  accessibilityRole="button"
                >
                  <Text style={styles.compactPrimaryText}>Finish Trip</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Legal attribution folds into the collapsed card's bottom edge —
                it stays visible on every map screen state. */}
            <Text style={styles.compactAttribution}>{ATTRIBUTION_TEXT}</Text>
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>TRIP MODE</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modeBtn, mode === MODES.WALKING && styles.modeBtnActive]} onPress={() => setMode(MODES.WALKING)}>
                <Text style={[styles.modeText, mode === MODES.WALKING && styles.modeTextActive]}>Walking</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeBtn, mode === MODES.CYCLING && styles.modeBtnActive]} onPress={() => setMode(MODES.CYCLING)}>
                <Text style={[styles.modeText, mode === MODES.CYCLING && styles.modeTextActive]}>Cycling</Text>
              </TouchableOpacity>
            </View>

            {routeStatus === 'idle' && (
              <View style={styles.idleState}>
                <Text style={styles.idleTitle}>Plan your walk or cycle</Text>
                <Text style={styles.idleHint}>Type a destination above to compare up to 3 routes.</Text>
              </View>
            )}

            {routeStatus === 'loading' && (
              <View>
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={t.primary} />
                  <Text style={styles.loadingText}>Finding routes…</Text>
                </View>
                {/* Honest expectation-setting for the client's 30s fetch
                    budget: geocoding + routing + the optional exposure
                    section can legitimately take a while (the backend's own
                    timeouts run up to ~10s + ~15s + ~4s) before the search
                    either surfaces routes or an error. No spinner spin-forever
                    silence and no fake progress — one honest line. */}
                <Text style={styles.loadingCaption}>
                  Finding routes — this can take up to about half a minute on slow days.
                </Text>
              </View>
            )}

            {routeStatus === 'error' && (
              <View style={styles.errorCard}>
                <Text style={styles.errorCardTitle}>Route unavailable</Text>
                <Text style={styles.errorCardText}>{routeError}</Text>
                {/* Clear next step: the SAME attempt as before (same handler
                    and same origin/target — see App.js retryRoute). */}
                <GhostButton styles={styles} onPress={retryRoute} label="Try again" />
              </View>
            )}

            {routeStatus === 'success' && primary && !tripActive && (
              <View>
                {!panelExpanded ? (
                  <>
                    <Text style={styles.routesTitle}>
                      Routes returned: {candidates.length}
                      {candidates.length === 1 ? ' (only one route available)' : ''}
                    </Text>

                    <View style={styles.expandRow}>
                      <Text style={styles.summaryText} numberOfLines={1}>
                        {mode} • {preference} • {formatDistance(primary.distanceMeters, distUnit) || '—'} • {formatDuration(primary.durationSeconds) || '—'} (est.)
                      </Text>
                      <TouchableOpacity style={styles.expandTouch} onPress={() => setPanelExpanded(true)}>
                        <Text style={styles.expandText}>▾ Expand</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View>
                    {/* Visual drag-handle affordance at the very top of the
                        expanded card content: a thin rounded bar, purely
                        decorative (no gesture is implemented behind it) —
                        collapse is handled by the header control below. */}
                    <View style={styles.panelHandleHost} testID="panelHandleHost">
                      <View style={styles.panelHandle} testID="panelHandle" />
                    </View>

                    {/* PINNED HEADER, above everything and never scrolled:
                        it is a fixed sibling rendered OUTSIDE the scroll
                        area, so the routes title and the collapse control
                        stay reachable no matter how far the list scrolls. */}
                    <View style={styles.panelHeaderRow}>
                      <Text
                        style={[styles.routesTitle, styles.panelHeaderTitle]}
                        numberOfLines={2}
                      >
                        Routes returned: {candidates.length}
                        {candidates.length === 1 ? ' (only one route available)' : ''}
                      </Text>
                      {/* ONE collapse control, always reachable: it moved
                          from the scrolling-dependent footer into this
                          pinned header and dispatches the same
                          setPanelExpanded(false). */}
                      <TouchableOpacity
                        style={styles.panelCollapseTouch}
                        onPress={() => setPanelExpanded(false)}
                        testID="panelCollapseTouch"
                        accessibilityRole="button"
                        accessibilityLabel="Collapse routes panel"
                      >
                        <Text style={styles.panelCollapseText}>Collapse ▴</Text>
                      </TouchableOpacity>
                    </View>

                      {/* Scrollable middle with a DETERMINISTIC PIXEL BOUND:
                          panelScrollMax derives from the SAME dim.height
                          (and the SAME 58% card cap) as the card's inline
                          maxHeight above: max(120, round(h*0.58) − 190).
                          Subtracting the card's fixed chrome from the card
                          cap (not guessing a second percentage) guarantees
                          the scroll can never push past the card. The
                          inline pixel value — unlike a percentage maxHeight
                          on the auto-height parent — gives the ScrollView
                          a definite height cap so it can actually scroll
                          on device. nestedScrollEnabled keeps vertical
                          scrolling working inside the card's horizontal
                          chip scrollers on Android. Start Trip stays fixed
                          below, outside this ScrollView. */}
                    <ScrollView
                      style={[styles.panelScroll, { maxHeight: panelScrollMax }]}
                      contentContainerStyle={styles.panelScrollContent}
                      testID="routePanelScroll"
                      nestedScrollEnabled={true}
                    >
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
                              <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]} numberOfLines={1}>
                                Route {idx + 1}
                              </Text>
                              <Text style={styles.optionText} numberOfLines={1}>
                                {formatDistance(c.distanceMeters, distUnit) || '—'} • {formatDuration(c.durationSeconds) || '—'} (est.)
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    )}

                    <View style={styles.prefRow}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.prefRowContent}
                      >
                        <TouchableOpacity style={[styles.prefChip, preference === PREFERENCES.FASTEST && styles.prefChipActive]} onPress={() => applyPreference(PREFERENCES.FASTEST)}>
                          <Text style={[styles.prefChipText, preference === PREFERENCES.FASTEST && styles.prefChipTextActive]}>Fastest</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.prefChip, preference === PREFERENCES.SHORTEST && styles.prefChipActive]} onPress={() => applyPreference(PREFERENCES.SHORTEST)}>
                          <Text style={[styles.prefChipText, preference === PREFERENCES.SHORTEST && styles.prefChipTextActive]}>Shortest</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.prefChip, preference === PREFERENCES.CLEANEST && styles.prefChipActive]} onPress={() => applyPreference(PREFERENCES.CLEANEST)}>
                          <Text style={[styles.prefChipText, preference === PREFERENCES.CLEANEST && styles.prefChipTextActive]}>Cleanest</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.prefChip, preference === PREFERENCES.OPTIMAL && styles.prefChipActive]} onPress={() => applyPreference(PREFERENCES.OPTIMAL)}>
                          <Text style={[styles.prefChipText, preference === PREFERENCES.OPTIMAL && styles.prefChipTextActive]}>Optimal</Text>
                        </TouchableOpacity>
                        {/* Manual is a goal chip like the four auto options:
                            its press flows through applyPreference so the
                            picked goal is recorded too (selecting MANUAL
                            through the helper behaves exactly like the old
                            direct setPreference call — no candidate is
                            picked, the manual selection stays). Route-option
                            card presses below deliberately keep setPreference:
                            selecting a route is not a goal pick. */}
                        <TouchableOpacity style={[styles.prefChip, preference === PREFERENCES.MANUAL && styles.prefChipActive]} onPress={() => applyPreference(PREFERENCES.MANUAL)}>
                          <Text style={[styles.prefChipText, preference === PREFERENCES.MANUAL && styles.prefChipTextActive]}>Manual</Text>
                        </TouchableOpacity>
                      </ScrollView>
                    </View>

                    {/* Transparent-selection note: what the active preference
                        does, or why an ineligible one kept the manual pick
                        (appear-only block under the chips row). */}
                    {prefNoteState && prefNoteState.show ? (
                      <Text style={styles.prefNote}>{prefNoteState.text}</Text>
                    ) : null}

                    {/* Honest route-start caption (EXPANDED panel only,
                        never the collapsed branch): explains the dashed
                        link on the map. States where the route actually
                        begins (nearest walkable road), without claiming GPS
                        error or shaming the fix; the drift sentence appears
                        only when the device's reported accuracy is
                        comparable to the gap. formatDistance is the same
                        distUnit-aware formatter used for the stats. */}
                    {routeConnector ? (
                      <View>
                        <Text style={styles.prefNote} testID="routeConnectorNote">
                          Route starts about {formatDistance(routeConnector.gapM, distUnit) || '—'} away, at the nearest walkable road. The dashed link shows where you step onto it.
                        </Text>
                        {routeConnector.accuracyNote ? (
                          <Text style={styles.prefNote}>
                            {routeConnector.accuracyNote}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={styles.statsRow}>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Distance</Text>
                        <Text style={styles.statValue} numberOfLines={1}>{formatDistance(primary.distanceMeters, distUnit) || '—'}</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Time</Text>
                        <Text style={[styles.statValue, styles.statValueCompact]} numberOfLines={1}>
                          {formatDuration(primary.durationSeconds) || '—'} (est.)
                        </Text>
                      </View>
                    </View>

                    {primary.pm25_estimate && (
                      <PmEstimate styles={styles} estimate={primary.pm25_estimate} />
                    )}
                    </ScrollView>

                    {/* Fixed footer: Start Trip only — it is a sibling
                        OUTSIDE the ScrollView above, so motion in the list
                        never shifts it. The old footer Collapse ghost was
                        removed in favor of the single pinned-header control. */}
                    <PrimaryButton styles={styles} style={styles.buttonGapCard} onPress={startTrip} label="Start Trip" />
                  </View>
                )}
              </View>
            )}

            {tripActive && (
              <View style={styles.tripCard}>
                <Text style={styles.tripCardTitle}>Trip in Progress</Text>
                {lowAccuracyActive && (
                  <Text style={styles.gpsNotice} numberOfLines={2}>
                    GPS accuracy is low — distance may be unreliable
                  </Text>
                )}
                <Text style={styles.tripCardLabel}>Elapsed</Text>
                <Text style={styles.tripCardTimer}>{formatDurationLong(tripElapsed)}</Text>
                <Text style={styles.tripCardDist}>
                  Actual distance:{' '}
                  {lowAccuracyActive
                    ? `\u2248 ${formatDistance(tripDistance, distUnit) || '—'} (low GPS)`
                    : (formatDistance(tripDistance, distUnit) || '—')}
                </Text>
                {/* ADDITIVE honest caption (expanded card): same condition
                    and same copy as the compact card's note — the readout is
                    paused while GPS is unreliable. Independent of, and
                    additional to, the lowAccuracyActive warning above. */}
                {distancePaused === true && tripActive && (
                  <Text style={styles.distancePausedNote}>
                    Distance is paused while GPS signal is unreliable.
                  </Text>
                )}
                <PrimaryButton styles={styles} style={[styles.buttonBlue, styles.buttonGapCard]} onPress={finishTrip} label="Finish Trip" />
                <GhostButton styles={styles} onPress={() => setTripDetailsExpanded(false)} label="Details ▴" />
              </View>
            )}

            <PrimaryButton
              styles={styles}
              style={[styles.buttonGap, routeStatus === 'loading' && styles.buttonDisabled]}
              onPress={findRoute}
              disabled={routeStatus === 'loading'}
              label={routeStatus === 'loading' ? 'Finding…' : 'Find Routes'}
            />

            <Text style={styles.attributionText}>{ATTRIBUTION_TEXT}</Text>
          </>
        )}
      </View>

      {locationError && !locationBannerDismissed && (
        <View style={styles.locationBanner}>
          <Text style={styles.locationBannerText}>{locationError}</Text>
          <TouchableOpacity
            style={styles.locationBannerDismissBtn}
            onPress={() => setLocationBannerDismissed(true)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss location banner"
          >
            <Text style={styles.locationBannerDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
