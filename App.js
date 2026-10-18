import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const ERROR_MESSAGES = {
  NO_GEOCODING_RESULT: 'No location found for that destination. Try a more specific name.',
  NO_ROUTE_FOUND: 'No route found between your location and that destination.',
  UPSTREAM_TIMEOUT: 'The mapping service timed out. Please try again.',
  UPSTREAM_ERROR: 'The mapping service is currently unavailable. Please try again later.',
  INVALID_REQUEST: 'Invalid request. Check your destination and try again.',
  NETWORK: 'Could not reach the backend server. Check that it is running and your device is on the same network.',
};

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export default function App() {
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [destination, setDestination] = useState('');
  const [routeStatus, setRouteStatus] = useState('idle');
  const [routeError, setRouteError] = useState(null);
  const [routeData, setRouteData] = useState(null);

  useEffect(() => {
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
    if (!location || routeStatus === 'loading') return;

    if (!query) {
      setRouteData(null);
      setRouteStatus('error');
      setRouteError('Enter a destination first.');
      return;
    }

    if (!API_BASE_URL) {
      setRouteData(null);
      setRouteStatus('error');
      setRouteError('Backend address is not configured. Set EXPO_PUBLIC_API_BASE_URL in .env or .env.local and restart Expo.');
      return;
    }

    setRouteData(null);
    setRouteError(null);
    setRouteStatus('loading');

    try {
      const response = await fetch(`${API_BASE_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
          destination: query,
          mode: 'driving',
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
        setRouteError(ERROR_MESSAGES[code] || message || 'Route request failed.');
        return;
      }

      const coordinates = data && data.route && data.route.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length === 0) {
        setRouteStatus('error');
        setRouteError('The server returned an empty route.');
        return;
      }

      const mapCoordinates = coordinates.map(([longitude, latitude]) => ({
        latitude,
        longitude,
      }));

      setRouteData({
        coordinates: mapCoordinates,
        distanceMeters: data.route.distance_m,
        durationSeconds: data.route.duration_s,
      });
      setRouteStatus('success');
    } catch {
      setRouteStatus('error');
      setRouteError(ERROR_MESSAGES.NETWORK);
    }
  };

  if (locationError) {
    return (
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>{locationError}</Text>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.messageContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.messageText}>Finding your location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={location}
        showsUserLocation={true}
      >
        {routeData && routeData.coordinates.length > 0 && (
          <Polyline
            coordinates={routeData.coordinates}
            strokeColor="#10B981"
            strokeWidth={5}
          />
        )}
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

      <View style={styles.bottomCard}>
        {routeStatus === 'idle' && (
          <Text style={styles.cardSubtitle}>Enter a destination to see distance and travel time.</Text>
        )}

        {routeStatus === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#10B981" />
            <Text style={styles.cardSubtitle}>Finding your route...</Text>
          </View>
        )}

        {routeStatus === 'error' && (
          <View>
            <Text style={styles.cardTitle}>Route unavailable</Text>
            <Text style={styles.errorText}>{routeError}</Text>
          </View>
        )}

        {routeStatus === 'success' && routeData && (
          <View>
            <Text style={styles.cardTitle}>Route found</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Distance</Text>
                <Text style={styles.statValue}>{formatDistance(routeData.distanceMeters) || '—'}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Time</Text>
                <Text style={styles.statValue}>{formatDuration(routeData.durationSeconds) || '—'}</Text>
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, routeStatus === 'loading' && styles.buttonDisabled]}
          onPress={findRoute}
          disabled={routeStatus === 'loading'}
        >
          <Text style={styles.buttonText}>
            {routeStatus === 'loading' ? 'Finding...' : 'Find Route'}
          </Text>
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
  input: { fontSize: 16, color: '#333' },
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
  },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: '#111', marginBottom: 8 },
  cardSubtitle: { fontSize: 14, color: '#666' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  errorText: { fontSize: 14, color: '#B91C1C', lineHeight: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statBox: { alignItems: 'center' },
  statLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});
