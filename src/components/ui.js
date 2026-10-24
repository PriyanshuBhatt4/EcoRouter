// Small presentational pieces reused across 2+ screens. Purely visual: they
// receive the themed stylesheet + tokens via props and hold no state.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MODES } from '../constants';

// Mode pill chip tinted per mode; unknown modes stay neutral. The pill is
// rendered as-is unless you pass extra style rules via `style` (e.g. the
// compact trip card adds styles.compactPill).
export function ModePill({ styles, mode, style }) {
  return (
    <View
      style={[
        styles.tripModePill,
        mode === MODES.WALKING && styles.tripModePillWalking,
        mode === MODES.CYCLING && styles.tripModePillCycling,
        style,
      ]}
    >
      <Text
        style={[
          styles.tripModePillText,
          mode === MODES.WALKING && styles.tripModePillTextWalking,
          mode === MODES.CYCLING && styles.tripModePillTextCycling,
        ]}
      >
        {String(mode || '').charAt(0).toUpperCase() + String(mode || '').slice(1) || 'Other'}
      </Text>
    </View>
  );
}

// Standard nested-screen back pill ("‹ Map" / "‹ Back") + screen title row.
// The back pill's accessibility role/label are optional so callers that never
// had them (e.g. the Profile header) render the exact same Touchable props.
export function ScreenHeader({ styles, onBackPress, backAccessibilityRole, backAccessibilityLabel, backText, title }) {
  return (
    <View style={styles.profileHeader}>
      <TouchableOpacity
        style={styles.backPill}
        onPress={onBackPress}
        accessibilityRole={backAccessibilityRole}
        accessibilityLabel={backAccessibilityLabel}
      >
        <Text style={styles.backPillText}>{backText}</Text>
      </TouchableOpacity>
      <Text style={styles.profileTitle}>{title}</Text>
    </View>
  );
}

// Primary CTA button (filled, accent-colored) with its bold label.
// Accessibility props are opt-in: only screens whose original markup had
// them pass them, so rendered props stay exactly as before the refactor.
export function PrimaryButton({ styles, style, onPress, disabled, label, accessibilityRole, accessibilityLabel }) {
  return (
    <TouchableOpacity
      style={style ? [styles.button, style] : styles.button}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Secondary "ghost" text button under the primary CTA.
export function GhostButton({ styles, onPress, label, accessibilityRole, accessibilityLabel }) {
  return (
    <TouchableOpacity
      style={styles.ghostBtn}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Empty-state block (title + hint) inside a card.
export function EmptyState({ styles, title, hint }) {
  return (
    <View style={styles.profileEmpty}>
      <Text style={styles.profileEmptyTitle}>{title}</Text>
      <Text style={styles.profileEmptyHint}>{hint}</Text>
    </View>
  );
}

// Inset stat tile with an auto-shrinking value + uppercase label.
export function StatTile({ styles, value, label }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}
