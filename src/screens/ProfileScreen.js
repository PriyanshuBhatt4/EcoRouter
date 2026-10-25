import React from 'react';
import { Text, View, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { formatDistance, formatDurationLong, formatTripDate } from '../lib/format';
import { lifetimeStats, streakCalendar, streakCalendarHeatmap, computeBadges, weekSummary } from '../lib/stats';
import { DEFAULT_PREFS } from '../constants';
import { RING_COLORS } from '../theme/palette';
import { computeMonthLabelPlan, computeContentWidth, WEEKDAY_COL_WIDTH, WEEKDAY_GUTTER, LABEL_ROW_HEIGHT } from '../lib/heatmapLayout';
import { ScreenHeader, ModePill, StatTile, GhostButton, EmptyState } from '../components/ui';

// Streak-heatmap geometry. The numeric pairs (CELL 13 / GAP 3 / PITCH 16 /
// weekday col 34 / gutter 4) live in src/lib/heatmapLayout.js, which is
// imported above — that pure module is the single source of truth; the
// corresponding style tokens stay in theme/styles.js (streakCell etc.).
// The CLEARANCE skip rule for month labels also lives there
// (MONTH_LABEL_MIN_CLEARANCE_PX), so shorter month groups can no longer hand
// labels a 16–32px box that visually merges 'Oct'/'Nov'.
//
// The grid is horizontally scrollable BY DESIGN and never shrinks to fit:
// theme/styles.js keeps every tile at its true 13×13 px and the surrounding
// ScrollView simply CLIPS beyond the viewport (with a visible horizontal
// scroll indicator for discoverability) — no tile shrink-to-fit anywhere.
// Both the label row and the grid carry the SAME explicit pixel width from
// computeContentWidth(heat, true), so the two rows can never truncate
// independently at the ScrollView's content edge.

// Row labels for the 7 fixed weekday rows (index 0 = Sunday .. 6 = Saturday,
// matching streakCalendarHeatmap's slot layout).
const STREAK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Legend is fully static and deterministic — all swatches render always (no
// live-data gating, no fabricated state). Level labels match stats.js
// levelForCount semantics (1 / 2 / 3+); the hollow swatch is the honesty
// rule's "no recorded history" representation.
const STREAK_LEGEND = [
  { level: 0, label: 'No activity' },
  { level: 1, label: '1 trip' },
  { level: 2, label: '2 trips' },
  { level: 3, label: '3+ trips' },
];

export default function ProfileScreen({
  // theming
  styles,
  t,
  isDark,
  // state
  trips,
  profile,
  // user preferences: dashboard section visibility (optional; defaults keep
  // every section visible so renders without the prop are unchanged)
  prefs = DEFAULT_PREFS,
  distUnit,
  // handlers
  saveProfile,
  changeProfilePhoto,
  removeProfilePhoto,
  openHistory,
  setView,
}) {
  const dash = prefs.dashboard || DEFAULT_PREFS.dashboard;
  const stats = lifetimeStats(trips, profile);
  const badges = computeBadges(trips);
  const week = weekSummary(trips);

  const hasName = Boolean(profile.name && profile.name.trim());
  const avatarChar = hasName ? profile.name.trim().charAt(0).toUpperCase() : '·';
  // Streak panel data: purely derived from the loaded trips state — no
  // seeding, no fabricated activity. `ring` feeds the streak tiles; the
  // heatmap reuses streakCalendar internally, so grid and tiles can never
  // disagree.
  const ring = streakCalendar(trips);
  const ringColors = isDark ? RING_COLORS.dark : RING_COLORS.light;
  const heatmap = streakCalendarHeatmap(trips);
  // Heatmap layout plan: label x positions (with the deterministic
  // clearance skip rule) and the shared explicit content width for BOTH the
  // month label row and the grid assembly — derived from the same heatmap
  // value, so the two rows can never truncate independently.
  const monthLabelPlan = computeMonthLabelPlan(heatmap);
  const heatmapContentWidth = computeContentWidth(heatmap, true);

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
        <ScreenHeader styles={styles} onBackPress={() => setView('map')} backText="‹ Map" title="Profile" />

        <View style={styles.profileCard}>
          <View style={styles.profileHeroRow}>
            <TouchableOpacity
              style={styles.avatar}
              onPress={changeProfilePhoto}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
            >
              {profile.photo ? (
                // If the stored data URI/uri is invalid the Image simply
                // renders blank — the photo is only ever set after a
                // successful pick, so the default avatar otherwise stands.
                <Image source={{ uri: profile.photo }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{avatarChar}</Text>
              )}
            </TouchableOpacity>
            <View style={styles.profileHeroMeta}>
              <Text
                style={[styles.profileDisplayName, !hasName && styles.profileDisplayNameEmpty]}
                numberOfLines={1}
              >
                {hasName ? profile.name : 'Set your name'}
              </Text>
              <Text style={styles.profileHeroNote}>Local profile — stored on this device</Text>
              <Text style={styles.photoHint}>Tap photo to change</Text>
            </View>
          </View>
          {Boolean(profile.photo) && (
            <TouchableOpacity
              style={styles.removePhotoChip}
              onPress={removeProfilePhoto}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
            >
              <Text style={styles.removePhotoChipText}>Remove photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Appearance controls (theme mode + accent) moved into the
            Settings screen below; Profile keeps the user's own details. */}

        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>YOUR DETAILS</Text>
          <View style={styles.profileFields}>
            <View>
              <Text style={styles.fieldLabel}>Display name</Text>
              <TextInput
                style={styles.profileInput}
                value={profile.name}
                onChangeText={(t2) => saveProfile({ ...profile, name: t2 })}
                placeholder="Your name"
                placeholderTextColor={t.textTertiary}
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Body weight (kg, optional)</Text>
              <TextInput
                style={styles.profileInput}
                value={profile.weightKg}
                onChangeText={(t2) => saveProfile({ ...profile, weightKg: t2 })}
                placeholder="e.g., 70"
                placeholderTextColor={t.textTertiary}
                keyboardType="numeric"
              />
              {String(profile.weightKg ?? '').trim() === '' && (
                // Honest scope note: weight only feeds the calorie estimate.
                <Text style={styles.weightHint}>Used for calorie estimates only.</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>LIFETIME TOTALS</Text>
          <View style={styles.statTileRow}>
            <StatTile
              styles={styles}
              value={formatDistance(stats.distanceM, distUnit) || '—'}
              label="Distance"
            />
            <StatTile styles={styles} value={formatDurationLong(stats.timeSec)} label="Time" />
            <StatTile
              styles={styles}
              value={stats.kcal !== null ? `${Math.round(stats.kcal)} kcal` : 'Add weight'}
              label="Calories (est.)"
            />
            <StatTile
              styles={styles}
              value={stats.exposureUgM3 !== null ? `${stats.exposureUgM3} \u00B5g/m\u00B3` : 'Not available'}
              label="Air (est.)"
            />
          </View>
          {stats.kcal !== null ? (
            // Calories caption — only with a computed kcal figure.
            <Text style={styles.statCaption}>
              Rough estimate from trip mode + your weight (walking 3.5 / cycling 7.0 MET).
            </Text>
          ) : (
            <Text style={styles.statCaption}>
              Add your weight in details above for a calorie estimate.
            </Text>
          )}
          {/* Air (est.) caption — what the figure actually is: the average
              of the PLANNED routes' modelled PM2.5 the user had selected at
              each trip start, never a measured exposure. Trips captured
              before this field existed carry no plannedPm25 and are simply
              excluded from the average (excludes rather than invents). */}
          <Text style={styles.statCaption}>
            Average modelled PM2.5 (µg/m³) of the planned routes selected at trip start — not measured exposure. Trips captured before this figure existed are excluded.
          </Text>
          {/* "This week" summary: gated by the dashboard.week preference. */}
          {dash.week === true && (
            <View style={styles.weekRow}>
              <Text style={styles.weekRowText}>
                {week.tripCount === 0
                  ? 'This week: 0 trips · —'
                  : `This week: ${week.tripCount} ${week.tripCount === 1 ? 'trip' : 'trips'} · ${formatDistance(week.distanceM, distUnit) || '—'}`}
              </Text>
              <Text style={styles.weekRowCaption}>LAST 7 DAYS</Text>
            </View>
          )}
        </View>

        {dash.streak === true && (
          <View style={styles.profileCard}>
            <Text style={styles.sectionLabel}>TRIP STREAK</Text>
          <View style={styles.streakTileRow}>
            <View style={styles.streakTile}>
              <Text style={styles.streakTileValue} numberOfLines={1}>
                {ring.currentStreak} days
              </Text>
              <Text style={styles.streakTileLabel}>Current streak</Text>
            </View>
            <View style={styles.streakTile}>
              <Text style={styles.streakTileValue} numberOfLines={1}>
                {ring.longestStreak} days
              </Text>
              <Text style={styles.streakTileLabel}>Longest streak</Text>
            </View>
          </View>
          {ring.firstTripDate === null && (
            // Brand-new user: honest empty state, no fabricated activity.
            <Text style={styles.streakSubline}>Complete trips to start building your streak.</Text>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            style={styles.streakGridScroll}
            // Explicit pixel content width (same plan as below) — the scroll
            // viewport clips the yearly layout by design; no shrink-to-fit.
            contentContainerStyle={{ width: heatmapContentWidth }}
          >
            <View>
              {/* Month labels: absolutely positioned at the planned x (with
                  the shared clearance skip rule), inside ONE row that carries
                  the full explicit content width. Labels can no longer run
                  together: every onset is ≥ MONTH_LABEL_MIN_CLEARANCE_PX from
                  the last rendered one, and any skipped month is skipped
                  identically on every render because the plan is pure. */}
              <View
                style={[
                  styles.streakMonthsRow,
                  { width: heatmapContentWidth, height: LABEL_ROW_HEIGHT },
                ]}
              >
                {monthLabelPlan.labels.map(({ label, x }) => (
                  <Text
                    key={`month-${label}-${x}`}
                    style={[styles.streakMonthLabel, { position: 'absolute', left: x }]}
                  >
                    {label}
                  </Text>
                ))}
              </View>
              <View style={[styles.streakGrid, { width: heatmapContentWidth }]}>
                {/* Weekday label column: 7 rows sharing the exact cell pitch
                    (height 13 + marginBottom 3 in the tokens). */}
                <View
                  style={[
                    styles.streakWeekdayCol,
                    { width: WEEKDAY_COL_WIDTH, marginRight: WEEKDAY_GUTTER },
                  ]}
                >
                  {STREAK_WEEKDAYS.map((label) => (
                    <Text key={label} style={styles.streakWeekdayLabel}>
                      {label}
                    </Text>
                  ))}
                </View>
                {/* Month-group blocks: one week column per column, row 0 =
                    Sunday .. row 6 = Saturday, oldest → newest left to right. */}
                {heatmap.months.map((m) => (
                  <View key={`block-${m.startKey}`} style={styles.streakMonthBlock}>
                    {m.weeks.map((week) => {
                      const firstReal = week.find((c) => c !== null);
                      return (
                        <View key={`week-${firstReal.key}`} style={styles.streakCol}>
                          {week.map((cell, ri) =>
                            cell ? (
                              <View
                                key={cell.key}
                                style={[
                                  styles.streakCell,
                                  cell.inHistory
                                    ? { backgroundColor: ringColors[cell.level] }
                                    : { backgroundColor: 'transparent', borderWidth: 1, borderColor: ringColors.hollowBorder },
                                ]}
                              />
                            ) : (
                              // Pre-window / future slots: plain placeholder
                              // only — never a colored "inactive" tile.
                              <View key={`void-${firstReal.key}-${ri}`} style={styles.streakCellVoid} />
                            )
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
          <View style={styles.streakLegendRow}>
            {STREAK_LEGEND.map((entry) => (
              <View key={entry.label} style={styles.streakLegendEntry}>
                <View style={[styles.streakLegendCell, { backgroundColor: ringColors[entry.level] }]} />
                <Text style={styles.streakLegendText}>{entry.label}</Text>
              </View>
            ))}
            <View style={styles.streakLegendEntry}>
              <View
                style={[
                  styles.streakLegendCell,
                  { backgroundColor: 'transparent', borderWidth: 1, borderColor: ringColors.hollowBorder },
                ]}
              />
              <Text style={styles.streakLegendText}>Before first trip</Text>
            </View>
          </View>
          </View>
        )}

        {/* Achievements: derived purely from saved trips, nothing
            fabricated. Circular filled dot = earned; hollow = still locked,
            with a thin progress bar (accent-colored fill) underneath.
            Visibility gated by the dashboard.achievements preference. */}
        {dash.achievements === true && (
          <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
          {badges.length === 0 || trips.length === 0 ? (
            <View style={styles.badgeEmpty}>
              <Text style={styles.badgeEmptyText}>
                No badges yet — complete a trip to get started.
              </Text>
            </View>
          ) : (
            badges.map((b) => (
              <View key={b.id} style={styles.badgeRow}>
                <View style={[styles.badgeDot, b.earned ? styles.badgeDotEarned : styles.badgeDotLocked]} />
                <View style={styles.badgeTextCol}>
                  <Text style={styles.badgeTitle}>{b.label}</Text>
                  <Text style={styles.badgeCaption} numberOfLines={1}>
                    {b.description}
                  </Text>
                  {!b.earned && (
                    <View style={styles.badgeProgressTrack}>
                      <View
                        style={[
                          styles.badgeProgressFill,
                          {
                            width: `${Math.round(Math.min(b.current / b.target, 1) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
          <Text style={styles.settingsCaption}>
            Progress comes from your saved trips only.
          </Text>
          </View>
        )}

        {/* Settings entry: full-width tappable card row. */}
        <View style={[styles.profileCard, styles.settingsEntryCard]}>
          <TouchableOpacity
            style={styles.settingsEntry}
            onPress={() => setView('settings')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text style={styles.settingsEntryLabel}>Settings</Text>
            <Text style={styles.settingsEntryChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {dash.recent === true ? (
          <View style={[styles.profileCard, styles.profileCardLast]}>
            <TouchableOpacity
              style={styles.tripsHeaderTouch}
              onPress={openHistory}
              accessibilityRole="button"
              accessibilityLabel="View all trip history"
            >
              <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>RECENT TRIPS</Text>
              <View style={styles.tripsHeaderRight}>
                <Text style={styles.tripsHeaderCaption}>Last 10 trips on this device</Text>
                <Text style={styles.tripsHeaderChevron}>›</Text>
              </View>
            </TouchableOpacity>
            {trips.slice(0, 10).map((tr) => (
              <View key={tr.id} style={styles.tripRow}>
                <View style={styles.tripRowLeft}>
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
              </View>
            ))}
            {trips.length > 0 && (
              // Jumps to the full Trip History list (all saved trips).
              <GhostButton
                styles={styles}
                onPress={openHistory}
                accessibilityRole="button"
                accessibilityLabel="View all trip history"
                label="View all history"
              />
            )}
            {trips.length === 0 && <EmptyState styles={styles} title="No completed trips yet." hint="Finish a tracked trip to see it here." />}
          </View>
        ) : (
          // dashboard.recent = OFF: the RECENT TRIPS block is hidden, but
          // navigation to the full history list always stays reachable via
          // this small standalone row card at the same spot.
          <View style={[styles.profileCard, styles.profileCardLast]}>
            <TouchableOpacity
              style={styles.settingsEntry}
              onPress={openHistory}
              accessibilityRole="button"
              accessibilityLabel="View all trip history"
            >
              <Text style={styles.settingsEntryLabel}>View all history</Text>
              <Text style={styles.settingsEntryChevron}>›</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
