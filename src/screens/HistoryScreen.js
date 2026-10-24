import React from 'react';
import { Text, View, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Share } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { formatDistance, formatDurationLong, formatTripDate } from '../lib/format';
import { paceLabel } from '../lib/stats';
import { ScreenHeader, ModePill, StatTile, EmptyState, PrimaryButton, GhostButton } from '../components/ui';

// Compose the honest, factual share text for one stored trip record. Only
// fields the record actually carries are included — nothing is invented:
// - title: the stored note title, or the plain 'Trip' fallback;
// - date: the same formatTripDate rendering the detail card shows (the
//   honest 'Date not available' fallback for a corrupt stored date);
// - mode: capitalized like the mode pill;
// - distance / time: only when the stored numbers are usable
//   (formatDistance returns null and formatDurationLong shows a dash for
//   missing values, so those are omitted instead);
// - pace/speed: only when paceLabel can honestly derive one (walking /
//   cycling with usable distance + duration), labeled the same way the
//   detail caption labels it.
// Share-text caps for the share sheet: a very long note title (unedited user
// input) would flood the preview text, so both the title part and the
// assembled message are sliced to 120 characters.
const SHARE_TEXT_MAX = 120;
const capShareText = (text) => (text && text.length > SHARE_TEXT_MAX ? text.slice(0, SHARE_TEXT_MAX) : text);

function buildTripShareMessage(trip, distUnit) {
  const parts = [];
  const title = trip && typeof trip.title === 'string' ? trip.title.trim() : '';
  parts.push(capShareText(title !== '' ? title : 'Trip'));
  parts.push(formatTripDate(trip ? trip.date : undefined));
  const mode = trip && typeof trip.mode === 'string' && trip.mode !== '' ? trip.mode : 'Other';
  parts.push(`Mode: ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  const distance = trip ? formatDistance(trip.actualDistanceM, distUnit) : null;
  if (distance) parts.push(`Distance: ${distance}`);
  if (trip && Number.isFinite(trip.durationSec)) parts.push(`Time: ${formatDurationLong(trip.durationSec)}`);
  const pace = trip ? paceLabel(trip, distUnit) : null;
  if (pace) {
    parts.push(`${trip.mode === 'cycling' ? 'Avg speed' : 'Avg pace'}: ${pace}`);
  }
  return capShareText(parts.join('\n'));
}

export default function HistoryScreen({
  // theming
  styles,
  t,
  isDark,
  // state
  trips,
  tripsLoaded,
  detailTripId,
  draftTripId,
  draftTitle,
  setDraftTitle,
  draftDescription,
  setDraftDescription,
  distUnit,
  // handlers
  openTripDetail,
  closeDetail,
  confirmDeleteTrip,
  saveTripNotes,
  openReplay,
  setView,
}) {
  // The open detail screen: queried by id from `trips` state every render,
  // so it reflects edits and disappears when the trip is deleted.
  const detailTrip = detailTripId ? trips.find((tr) => tr && tr.id === detailTripId) : null;
  // Derived pace/speed for the detail card (null when the record has no
  // usable distance/duration or is not a walking/cycling mode).
  const detailPace = detailTrip ? paceLabel(detailTrip, distUnit) : null;

  // Share the open trip via the OS share sheet (React Native's built-in
  // Share API — no new dependency). Non-destructive and forgettable: no copy
  // is added or edited, nothing is persisted, no upload happens from the
  // app itself. The user dismissing the sheet resolves (or rejects) without
  // an action to take, so BOTH outcomes are silently ignored — never an
  // Alert about a cancel.
  const shareDetailTrip = async () => {
    if (!detailTrip) return;
    const title =
      typeof detailTrip.title === 'string' && detailTrip.title.trim() !== ''
        ? detailTrip.title
        : 'Trip';
    try {
      await Share.share({
        message: buildTripShareMessage(detailTrip, distUnit),
        // Same cap as the message's title line: a stored (old/legacy) title
        // longer than the notes input's 80-char maxLength must flood neither
        // part of the share sheet.
        title: capShareText(title),
      });
    } catch {}
  };

  if (detailTrip) {
    return (
      <View style={styles.container}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
          <ScreenHeader
            styles={styles}
            onBackPress={closeDetail}
            backAccessibilityRole="button"
            backAccessibilityLabel="Back to trip history"
            backText="‹ Back"
            title="Trip"
          />

          <View style={styles.profileCard}>
            {detailTrip.title ? (
              // Optional title (added from NOTES below). Old records
              // without it simply show the date-primary layout.
              <Text style={styles.historyTripTitle} numberOfLines={1}>
                {detailTrip.title}
              </Text>
            ) : null}
            <Text style={styles.tripRowDate}>{formatTripDate(detailTrip.date)}</Text>
            {/* Mode pill, tinted per mode; unknown modes stay neutral. */}
            <ModePill styles={styles} mode={detailTrip.mode} />
            <View style={[styles.statTileRow, styles.detailStatsGap]}>
              <StatTile
                styles={styles}
                value={formatDistance(detailTrip.actualDistanceM, distUnit) || '—'}
                label="Distance"
              />
              <StatTile styles={styles} value={formatDurationLong(detailTrip.durationSec)} label="Time" />
            </View>
            {/* Derived pace/speed caption: omitted entirely when the record
                has no usable distance/duration or is not walking/cycling —
                no fabricated figures. Honors the user's distance unit. */}
            {detailPace && (
              <Text style={styles.detailCaption}>
                {`${detailTrip.mode === 'cycling' ? 'Avg speed' : 'Avg pace'} — ${detailPace}`}
              </Text>
            )}
            {/* Honest scope note: route addresses are NOT stored per trip. */}
            <Text style={styles.detailCaption}>
              Origin and destination addresses are not saved with trips.
            </Text>

            {/* Journey Replay entry: navigates to the replay view for this
                trip. Whether a path exists is decided there (the side-car is
                read on demand), so an old-format record gets the honest
                "Replay unavailable" explanation instead of a fake path. */}
            <PrimaryButton
              styles={styles}
              style={styles.historyCtaGap}
              onPress={() => (typeof openReplay === 'function' ? openReplay(detailTrip.id) : undefined)}
              accessibilityRole="button"
              accessibilityLabel="Replay this trip"
              label="Replay"
            />
            {/* Compact secondary Share action: the OS share sheet with the
                factual summary above (token-styled ghost button, 44+
                touch target, clearly non-destructive next to the Delete
                row further down). */}
            <GhostButton
              styles={styles}
              onPress={shareDetailTrip}
              accessibilityRole="button"
              accessibilityLabel="Share this trip"
              label="Share"
            />
          </View>

          {/* Air honesty: matches the Profile Air-tile exactly — no invented data. */}
          <View style={styles.profileCard}>
            <Text style={styles.sectionLabel}>AIR EXPOSURE (EST.)</Text>
            <Text style={styles.detailSubline}>Not available yet</Text>
            <Text style={styles.detailCaption}>
              Saved trips don&apos;t record air data.
            </Text>
          </View>

          {/* Notes: drafted locally, persisted on blur and on leaving. */}
          <View style={styles.profileCard}>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <View style={styles.profileFields}>
              <View>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.profileInput}
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  onBlur={() => saveTripNotes(draftTripId)}
                  placeholder="Add a title"
                  placeholderTextColor={t.textTertiary}
                  maxLength={80}
                  returnKeyType="done"
                />
              </View>
              <View>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.profileInput, styles.detailInputMultiline]}
                  value={draftDescription}
                  onChangeText={setDraftDescription}
                  onBlur={() => saveTripNotes(draftTripId)}
                  placeholder="Add a description…"
                  placeholderTextColor={t.textTertiary}
                  maxLength={500}
                  multiline={true}
                  textAlignVertical="top"
                />
              </View>
            </View>
          </View>

          {/* Deletion from the detail view: same confirm-then-delete flow. */}
          <PrimaryButton
            styles={styles}
            style={styles.deleteBtn}
            onPress={() => confirmDeleteTrip(detailTrip.id)}
            accessibilityRole="button"
            accessibilityLabel="Delete this trip"
            label="Delete trip"
          />
        </ScrollView>
      </View>
    );
  }

  // Trip History list: all saved trips, newest first.
  const sortedTrips = trips
    .slice()
    .sort((a, b) => {
      const da = a && a.date ? Date.parse(a.date) : NaN;
      const db = b && b.date ? Date.parse(b.date) : NaN;
      return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
    });
  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
        <ScreenHeader
          styles={styles}
          onBackPress={() => setView('profile')}
          backAccessibilityRole="button"
          backAccessibilityLabel="Back to Profile"
          backText="‹ Back"
          title="History"
        />

        {!tripsLoaded ? (
          // Storage read still in flight on cold start.
          <View style={styles.profileCard}>
            <View style={styles.historyLoadingRow}>
              <ActivityIndicator size="small" color={t.primary} />
            </View>
          </View>
        ) : trips.length === 0 ? (
          // Honest empty state: no trips stored, no fake stats shown.
          <View style={styles.profileCard}>
            <EmptyState
              styles={styles}
              title="No trips saved yet."
              hint="Completed trips will show up here automatically."
            />
            <PrimaryButton styles={styles} style={styles.historyCtaGap} onPress={() => setView('map')} label="Plan a route" />
          </View>
        ) : (
          <View style={styles.profileCard}>
            <Text style={styles.historyCountCaption}>
              {`${trips.length} ${trips.length === 1 ? 'trip' : 'trips'} saved`}
            </Text>
            <View style={styles.historyDivider} />
            {sortedTrips.map((tr) => (
              <View key={tr.id} style={styles.tripRow}>
                <TouchableOpacity
                  style={styles.historyRowMain}
                  onPress={() => openTripDetail(tr.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Open trip details"
                >
                  <View style={styles.tripRowLeft}>
                    {/* Optional title line; absent/null titles are skipped. */}
                    {typeof tr.title === 'string' && tr.title !== '' && (
                      <Text style={styles.historyTripTitle} numberOfLines={1}>
                        {tr.title}
                      </Text>
                    )}
                    <Text style={styles.tripRowDate} numberOfLines={1}>
                      {formatTripDate(tr.date)}
                    </Text>
                    {/* Mode pill, tinted per mode; unknown modes stay neutral. */}
                    <ModePill styles={styles} mode={tr.mode} />
                  </View>
                  <View style={styles.tripRowRight}>
                    <Text style={styles.tripRowDist} numberOfLines={1}>{formatDistance(tr.actualDistanceM, distUnit) || '—'}</Text>
                    <Text style={styles.tripRowDur} numberOfLines={1}>{formatDurationLong(tr.durationSec)}</Text>
                  </View>
                </TouchableOpacity>
                {/* Small secondary Replay text action; the destructive
                    Delete stays last. Resolution (replay vs the honest
                    unavailable card) happens inside the replay view, which
                    reads the side-car trail storage on demand. */}
                <TouchableOpacity
                  style={styles.historyRowDelete}
                  onPress={() => (typeof openReplay === 'function' ? openReplay(tr.id) : undefined)}
                  accessibilityRole="button"
                  accessibilityLabel="Replay this trip"
                >
                  <Text style={styles.historyRowActionText}>Replay</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.historyRowDelete}
                  onPress={() => confirmDeleteTrip(tr.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this trip"
                >
                  <Text style={styles.historyRowDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
