import React from 'react';
import { Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ATTRIBUTION_TEXT, DEFAULT_PREFS, MODES, THEME_CHOICES } from '../constants';
import { ACCENTS, ACCENT_NAMES } from '../theme/palette';
import { ScreenHeader, PrimaryButton } from '../components/ui';

// Dashboard toggle rows: label + which prefs flag it drives, in the same
// order they gate sections on the Profile screen.
const DASHBOARD_ROWS = [
  { key: 'week', label: 'This week summary' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'streak', label: 'Trip streak' },
  { key: 'recent', label: 'Recent trips' },
];

export default function SettingsScreen({
  // theming
  styles,
  isDark,
  // state
  profile,
  trips,
  savedPlaces = [],
  themeMode,
  accentName,
  // user preferences (optional; defaults keep behavior identical when the
  // parent has not migrated the prop yet)
  prefs = DEFAULT_PREFS,
  // handlers
  applyTheme,
  applyAccent,
  applyPreferredMode,
  applyRememberRouteGoal,
  applyDashboardToggle,
  setDistanceUnit,
  confirmEraseAll,
  openSavedPlaces,
  setView,
}) {
  // Safe no-ops when the handlers are absent (legacy/direct renders).
  const onPreferredMode = typeof applyPreferredMode === 'function' ? applyPreferredMode : () => {};
  const onRememberRouteGoal =
    typeof applyRememberRouteGoal === 'function' ? applyRememberRouteGoal : () => {};
  const onDashboardToggle = typeof applyDashboardToggle === 'function' ? applyDashboardToggle : () => {};
  const currentUnit = profile && profile.distanceUnit === 'imperial' ? 'imperial' : 'metric';
  const dash = prefs.dashboard || DEFAULT_PREFS.dashboard;
  const savedTripsLabel = trips.length === 0 ? 'No trips saved' : `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'} saved`;
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
          title="Settings"
        />

        {/* 1 — APPEARANCE: theme mode + accent. State-driven, so every
            change re-renders all screens instantly; nothing needs a restart. */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>APPEARANCE</Text>
          <Text style={styles.settingsFieldLabel}>Theme mode</Text>
          <View style={styles.appearanceRow} accessibilityLabel="Theme">
            {THEME_CHOICES.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[styles.appearanceChip, themeMode === value && styles.appearanceChipActive]}
                onPress={() => applyTheme(value)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: themeMode === value }}
              >
                <Text
                  style={[styles.appearanceChipText, themeMode === value && styles.appearanceChipTextActive]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.settingsCaption}>System follows your device setting.</Text>

          <View style={styles.settingsGap}>
            <Text style={styles.settingsFieldLabel}>Accent</Text>
            <View style={styles.accentRow}>
              {ACCENT_NAMES.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.accentSwatchWrap, accentName === name && styles.accentSwatchWrapSelected]}
                  onPress={() => applyAccent(name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Accent color: ${ACCENTS[name].label}`}
                  accessibilityState={{ selected: accentName === name }}
                >
                  <View style={[styles.accentSwatch, { backgroundColor: ACCENTS[name].light.primary }]} />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.settingsCaption}>
              Applies instantly — picked accent is used across the app.
            </Text>
          </View>
        </View>

        {/* 2 — PREFERENCES: distance units (kept) + preferred travel mode.
            Units write the additive profile.distanceUnit field via the same
            saveProfile path used by every other edit; the mode choice writes
            the separate prefs key and only ever applies when the map starts
            idle (see App.js sync effect). */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <Text style={styles.settingsFieldLabel}>Distance units</Text>
          <View style={styles.appearanceRow} accessibilityLabel="Distance units">
            <TouchableOpacity
              style={[styles.appearanceChip, currentUnit === 'metric' && styles.appearanceChipActive]}
              onPress={() => setDistanceUnit('metric')}
              accessibilityRole="button"
              accessibilityLabel="Kilometres"
              accessibilityState={{ selected: currentUnit === 'metric' }}
            >
              <Text
                style={[styles.appearanceChipText, currentUnit === 'metric' && styles.appearanceChipTextActive]}
              >
                Kilometres
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.appearanceChip, currentUnit === 'imperial' && styles.appearanceChipActive]}
              onPress={() => setDistanceUnit('imperial')}
              accessibilityRole="button"
              accessibilityLabel="Miles"
              accessibilityState={{ selected: currentUnit === 'imperial' }}
            >
              <Text
                style={[styles.appearanceChipText, currentUnit === 'imperial' && styles.appearanceChipTextActive]}
              >
                Miles
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.settingsCaption}>
            Used for distances everywhere in the app.
          </Text>

          <View style={styles.settingsGap}>
            <Text style={styles.settingsFieldLabel}>Preferred travel mode</Text>
            <View style={styles.appearanceRow} accessibilityLabel="Preferred travel mode">
              <TouchableOpacity
                style={[styles.appearanceChip, prefs.preferredMode === MODES.WALKING && styles.appearanceChipActive]}
                onPress={() => onPreferredMode(MODES.WALKING)}
                accessibilityRole="button"
                accessibilityLabel="Preferred travel mode: Walking"
                accessibilityState={{ selected: prefs.preferredMode === MODES.WALKING }}
              >
                <Text
                  style={[
                    styles.appearanceChipText,
                    prefs.preferredMode === MODES.WALKING && styles.appearanceChipTextActive,
                  ]}
                >
                  Walking
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.appearanceChip, prefs.preferredMode === MODES.CYCLING && styles.appearanceChipActive]}
                onPress={() => onPreferredMode(MODES.CYCLING)}
                accessibilityRole="button"
                accessibilityLabel="Preferred travel mode: Cycling"
                accessibilityState={{ selected: prefs.preferredMode === MODES.CYCLING }}
              >
                <Text
                  style={[
                    styles.appearanceChipText,
                    prefs.preferredMode === MODES.CYCLING && styles.appearanceChipTextActive,
                  ]}
                >
                  Cycling
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.settingsCaption}>Used when the map screen starts.</Text>
          </View>
        </View>

        {/* 3 — ROUTING: remembered route goal. One persisted switch row,
            styled like the DASHBOARD rows (Views-only pill; the ROW is the
            touch target). Placed directly after the PREFERENCES card so the
            two map-behavior cards read as a pair. With the toggle off, every
            search starts unselected (today's behavior); with it on, the last
            chosen goal chip re-applies after each new search. The goal is
            recorded whenever a chip is pressed; the toggle only decides
            whether a recorded goal is reused. */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>ROUTING</Text>
          <TouchableOpacity
            style={styles.dashRow}
            onPress={() => onRememberRouteGoal(!(prefs.rememberRouteGoal === true))}
            accessibilityRole="switch"
            accessibilityLabel="Remember my route goal"
            accessibilityState={{ checked: prefs.rememberRouteGoal === true }}
          >
            <Text style={styles.dashToggleLabel}>Remember my route goal</Text>
            <View
              style={[
                styles.dashToggleTrack,
                prefs.rememberRouteGoal === true ? styles.dashToggleTrackOn : styles.dashToggleTrackOff,
              ]}
            >
              <View style={styles.dashToggleKnob} />
            </View>
          </TouchableOpacity>
          <Text style={styles.settingsCaption}>
            Applies your last chosen route goal again after each new search.
          </Text>
          {/* Honest boundary (consistent with the map screen): only the goal
              CHIPS are recorded — a route-card tap is a one-off selection. */}
          <Text style={styles.settingsCaption}>
            Picking a route option by hand is not remembered as your goal.
          </Text>
        </View>

        {/* 4 — SAVED PLACES: entry row into the persistent destination
            screen (own card so the tap target is full-width like Settings). */}
        <View style={styles.profileCard}>
          <TouchableOpacity
            style={styles.settingsEntry}
            onPress={openSavedPlaces}
            accessibilityRole="button"
            accessibilityLabel="Open saved places"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsEntryLabel}>Saved places</Text>
              <Text style={styles.settingsEntrySub}>
                {savedPlaces.length === 0
                  ? 'No places yet'
                  : `${savedPlaces.length} ${savedPlaces.length === 1 ? 'place' : 'places'} saved`}
              </Text>
            </View>
            <Text style={styles.settingsEntryChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* 5 — DASHBOARD: section visibility on the Profile screen. Four
            switch rows; the pill is Views-only while the ROW is the touch
            target. Instant, state-driven, persisted via the prefs key. */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>DASHBOARD</Text>
          {DASHBOARD_ROWS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={styles.dashRow}
              onPress={() => onDashboardToggle(key)}
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityState={{ checked: dash[key] === true }}
            >
              <Text style={styles.dashToggleLabel}>{label}</Text>
              <View style={[styles.dashToggleTrack, dash[key] === true ? styles.dashToggleTrackOn : styles.dashToggleTrackOff]}>
                <View style={styles.dashToggleKnob} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* 6 — DATA: honest counts + double-confirmed erase. Theme and
            accent keys survive on purpose (device appearance, not data);
            the prefs key (including the route-goal memory) is cleared like
            every other user key. */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>DATA</Text>
          <View style={styles.dataInfoRow}>
            <Text style={styles.dataInfoText}>{savedTripsLabel}</Text>
          </View>
          <PrimaryButton
            styles={styles}
            style={styles.deleteBtn}
            onPress={confirmEraseAll}
            accessibilityRole="button"
            accessibilityLabel="Erase all data"
            label="Erase all data"
          />
        </View>

        {/* 7 — ABOUT: honest scope + the exact same attribution line the
            map screen shows (one shared constant, never paraphrased). */}
        <View style={[styles.profileCard, styles.profileCardLast]}>
          <Text style={styles.sectionLabel}>ABOUT</Text>
          <Text style={styles.aboutAppName}>EcoRoute</Text>
          <Text style={styles.aboutPurpose}>
            Plan walking and cycling routes and keep a private record of your trips — everything is stored locally on this device.
          </Text>
          <Text style={styles.aboutNote}>
            Air exposure per trip is not recorded yet.
          </Text>
          <Text style={styles.aboutAttribution}>{ATTRIBUTION_TEXT}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
