import React from 'react';
import { Text, View, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Image } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { StatusBar } from 'expo-status-bar';
import { formatDistance, formatDuration, formatDurationLong, formatPmUnits } from '../lib/format';
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

      <View style={[styles.bottomCard, tripActive && !tripDetailsExpanded && styles.bottomCardCompact]}>
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
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={t.primary} />
                <Text style={styles.loadingText}>Finding routes…</Text>
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
                <Text style={styles.routesTitle}>
                  Routes returned: {candidates.length}
                  {candidates.length === 1 ? ' (only one route available)' : ''}
                </Text>

                {!panelExpanded ? (
                  <View style={styles.expandRow}>
                    <Text style={styles.summaryText} numberOfLines={1}>
                      {mode} • {preference} • {formatDistance(primary.distanceMeters, distUnit) || '—'} • {formatDuration(primary.durationSeconds) || '—'} (est.)
                    </Text>
                    <TouchableOpacity style={styles.expandTouch} onPress={() => setPanelExpanded(true)}>
                      <Text style={styles.expandText}>▾ Expand</Text>
                    </TouchableOpacity>
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

                    <PrimaryButton styles={styles} style={styles.buttonGapCard} onPress={startTrip} label="Start Trip" />
                    <GhostButton styles={styles} onPress={() => setPanelExpanded(false)} label="Collapse" />
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
