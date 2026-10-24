// Map picker screen: full-screen map for choosing a saved-place spot by
// tapping. Coordinate-only by design — no reverse geocoding exists in the
// backend, so the place name stays user-provided on the Saved screen.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_REGION } from '../constants';
import { DARK_MAP_STYLE } from '../theme/palette';
import { PrimaryButton, GhostButton } from '../components/ui';

export default function MapPickerScreen({
  // theming
  styles,
  t,
  isDark,
  // current plan position (undefined → DEFAULT_REGION)
  initialRegion,
  // handlers: onPick({ latitude, longitude }) commits the spot to the
  // Saved screen's edit-confirm card; onClose discards and goes back.
  onPick,
  onClose,
}) {
  const [picked, setPicked] = useState(null);

  // Center-by-tap: the map reports the tapped coordinate; a single marker
  // always reflects the latest pick (not cumulative markers).
  const handleMapPress = (event) => {
    const coord = event && event.nativeEvent && event.nativeEvent.coordinate;
    if (
      !coord ||
      typeof coord.latitude !== 'number' || !Number.isFinite(coord.latitude) ||
      typeof coord.longitude !== 'number' || !Number.isFinite(coord.longitude)
    ) {
      return;
    }
    setPicked({ latitude: coord.latitude, longitude: coord.longitude });
  };

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <MapView
        style={styles.map}
        initialRegion={initialRegion || DEFAULT_REGION}
        showsUserLocation={true}
        customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
        onPress={handleMapPress}
      >
        {picked && <Marker coordinate={picked} pinColor={t.amber} />}
      </MapView>

      <View style={styles.bottomCard}>
        <Text style={styles.pickerNote} accessibilityLabel="Choose a map location">
          Tap the map to choose a spot — coordinates only; no street addresses are stored.
        </Text>
        <PrimaryButton
          styles={styles}
          style={!picked && styles.buttonDisabled}
          onPress={() => onPick && picked && onPick(picked)}
          disabled={!picked}
          accessibilityRole="button"
          accessibilityLabel="Use this location"
          label="Use this location"
        />
        <GhostButton
          styles={styles}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel map pick"
          label="Cancel"
        />
      </View>
    </View>
  );
}
