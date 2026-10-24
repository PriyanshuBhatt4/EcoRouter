// Saved Places screen: list + add flow for persistent destination records.
// All state lives in App.js; this screen holds only ephemeral input drafts
// (search text, pending name/category, coordinate strings, inline edit row).

import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PLACE_CATEGORIES } from '../constants';
import { formatLatLng } from '../lib/format';
import { ScreenHeader, PrimaryButton, GhostButton, EmptyState } from '../components/ui';

// Category pill tint helpers — same shape as ModePill's walking/cycling
// tints (home blue-ish, work green-ish, other neutral) via theme tokens.
function categoryPillStyle(styles, category) {
  return [
    styles.savedCategoryPill,
    category === 'home' && styles.savedCategoryPillHome,
    category === 'work' && styles.savedCategoryPillWork,
  ];
}
function categoryPillText(styles, category) {
  return [
    styles.savedCategoryPillText,
    category === 'home' && styles.savedCategoryPillTextHome,
    category === 'work' && styles.savedCategoryPillTextWork,
  ];
}
function categoryLabel(category) {
  const match = PLACE_CATEGORIES.find((cat) => cat.id === category);
  return match ? match.label : 'Other';
}

export default function SavedPlacesScreen({
  // theming
  styles,
  t,
  isDark,
  // state (owned by App.js)
  savedPlaces,
  pendingPlace,
  savedAddStatus,
  savedAddError,
  savedCoordError,
  // handlers
  addPlaceFromSearch,
  addPlaceFromCurrentLocation,
  addPlaceFromCoordinates,
  openMapPicker,
  submitPendingPlace,
  cancelPendingPlace,
  updateSavedPlace,
  confirmDeleteSavedPlace,
  routeToSavedPlace,
  setView,
}) {
  const [searchText, setSearchText] = useState('');
  const [coordsVisible, setCoordsVisible] = useState(false);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  // Edit-confirm card drafts (synced from each fresh pendingPlace below so a
  // prefilled name/category still renders inside editable inputs).
  const [pendingName, setPendingName] = useState('');
  const [pendingCategory, setPendingCategory] = useState('other');
  // Inline row-edit drafts (one row at a time).
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('other');
  const [rowError, setRowError] = useState(null);

  useEffect(() => {
    if (pendingPlace) {
      setPendingName(typeof pendingPlace.name === 'string' ? pendingPlace.name : '');
      setPendingCategory(PLACE_CATEGORIES.some((cat) => cat.id === pendingPlace.category) ? pendingPlace.category : 'other');
    }
  }, [pendingPlace]);

  const busy = savedAddStatus !== 'idle';

  // Save the inline row edit; a failed validation (empty/over-long name)
  // surfaces under the row instead of closing the editor.
  const saveRowEdit = async () => {
    setRowError(null);
    const res = await updateSavedPlace(editingId, { name: editName, category: editCategory });
    if (res && res.ok === false) {
      setRowError('Name must be 1-60 characters.');
      return;
    }
    setEditingId(null);
  };

  return (
    <View style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView style={styles.profileScreen} contentContainerStyle={styles.profileContent}>
        <ScreenHeader
          styles={styles}
          onBackPress={() => setView('settings')}
          backAccessibilityRole="button"
          backAccessibilityLabel="Back to Settings"
          backText="‹ Back"
          title="Saved places"
        />

        {/* ADD A PLACE: inline search + the three other quick methods. */}
        <View style={styles.profileCard}>
          <Text style={styles.sectionLabel}>ADD A PLACE</Text>
          <View style={styles.savedSearchRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={[styles.profileInput, styles.savedSearchInput]}
                value={searchText}
                onChangeText={setSearchText}
                placeholder='Try "India Gate"'
                placeholderTextColor={t.textTertiary}
                maxLength={200}
                returnKeyType="search"
                onSubmitEditing={() => addPlaceFromSearch(searchText)}
              />
            </View>
            <TouchableOpacity
              style={[styles.savedInlineBtn, busy && styles.buttonDisabled]}
              onPress={() => addPlaceFromSearch(searchText)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Search place to save"
            >
              <Text style={styles.savedInlineBtnText}>
                {savedAddStatus === 'searching' ? 'Searching…' : 'Search'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.settingsCaption}>
            Search finds the place online and prefills its label — you name it before saving.
          </Text>

          {coordsVisible && (
            <View style={styles.savedCoordBlock}>
              <View style={styles.savedCoordRow}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.profileInput}
                    value={latText}
                    onChangeText={setLatText}
                    placeholder="Latitude (e.g., 28.6)"
                    placeholderTextColor={t.textTertiary}
                    keyboardType="numeric"
                    maxLength={24}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.profileInput}
                    value={lngText}
                    onChangeText={setLngText}
                    placeholder="Longitude (e.g., 77.2)"
                    placeholderTextColor={t.textTertiary}
                    keyboardType="numeric"
                    maxLength={24}
                  />
                </View>
              </View>
              {savedCoordError && savedCoordError.latitude && (
                <Text style={styles.savedFieldError}>{savedCoordError.latitude}</Text>
              )}
              {savedCoordError && savedCoordError.longitude && (
                <Text style={styles.savedFieldError}>{savedCoordError.longitude}</Text>
              )}
              <TouchableOpacity
                style={[styles.savedInlineBtn, styles.savedInlineGap]}
                onPress={() => addPlaceFromCoordinates(latText, lngText)}
                accessibilityRole="button"
                accessibilityLabel="Use these coordinates"
              >
                <Text style={styles.savedInlineBtnText}>Use these coordinates</Text>
              </TouchableOpacity>
            </View>
          )}

          {savedAddStatus === 'locating' && (
            <Text style={styles.settingsCaption}>Getting your current location…</Text>
          )}
          {savedAddError && (
            <View style={styles.errorCard}>
              <Text style={styles.errorCardText}>{savedAddError}</Text>
              {/* Retry re-search: only alongside a typeable query (the input
                  still holds it), reusing the SAME search handler + input.
                  Toasted errors from the location/picker flows keep the
                  message-only card so the retry never runs the wrong flow. */}
              {searchText.trim() !== '' && (
                <GhostButton
                  styles={styles}
                  onPress={() => addPlaceFromSearch(searchText)}
                  accessibilityRole="button"
                  accessibilityLabel="Retry place search"
                  label="Try again"
                />
              )}
            </View>
          )}

          <View style={[styles.savedChipRow, styles.savedChipRowGap]}>
            <TouchableOpacity
              style={styles.recentChip}
              onPress={() => setCoordsVisible((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel="Add from coordinates"
            >
              <Text style={styles.recentChipText}>Coordinates</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.recentChip, busy && styles.buttonDisabled]}
              onPress={addPlaceFromCurrentLocation}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Add from current location"
            >
              <Text style={styles.recentChipText}>My location</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.recentChip}
              onPress={openMapPicker}
              accessibilityRole="button"
              accessibilityLabel="Pick on map"
            >
              <Text style={styles.recentChipText}>Pick on map</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Edit-confirm card: the not-yet-saved place (from any add method).
            Name is editable, category chips switch, caption shows the exact
            coordinates that will be stored. Sits above the list so it stays
            visible on first saves. */}
        {pendingPlace && (
          <View style={styles.profileCard}>
            <Text style={styles.sectionLabel}>NAME THIS PLACE</Text>
            <TextInput
              style={styles.profileInput}
              value={pendingName}
              onChangeText={setPendingName}
              placeholder="e.g., Office gate"
              placeholderTextColor={t.textTertiary}
              maxLength={60}
              returnKeyType="done"
            />
            <Text style={styles.settingsCaption}>
              Coordinates: {formatLatLng(pendingPlace.latitude, pendingPlace.longitude) || '—'}
            </Text>
            <View style={styles.appearanceRow} accessibilityLabel="Place category">
              {PLACE_CATEGORIES.map(({ id, label }) => (
                <TouchableOpacity
                  key={id}
                  style={[styles.appearanceChip, pendingCategory === id && styles.appearanceChipActive]}
                  onPress={() => setPendingCategory(id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Category: ${label}`}
                  accessibilityState={{ selected: pendingCategory === id }}
                >
                  <Text
                    style={[styles.appearanceChipText, pendingCategory === id && styles.appearanceChipTextActive]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <PrimaryButton
              styles={styles}
              style={[styles.buttonGapCard, !pendingName.trim() && styles.buttonDisabled]}
              onPress={() => submitPendingPlace({ name: pendingName, category: pendingCategory })}
              disabled={!pendingName.trim()}
              accessibilityRole="button"
              accessibilityLabel="Save place"
              label="Save place"
            />
            <GhostButton styles={styles} onPress={cancelPendingPlace} label="Cancel" />
          </View>
        )}

        {/* Saved list: name, category pill, coordinates caption and the
            row actions. Honest empty state when nothing is stored. */}
        {savedPlaces.length === 0 && !pendingPlace ? (
          <View style={styles.profileCard}>
            <EmptyState
              styles={styles}
              title="No saved places yet."
              hint="Add one with search, coordinates, your location or by picking on the map."
            />
          </View>
        ) : (
          savedPlaces.length > 0 && (
            <View style={[styles.profileCard, styles.savedListCard]}>
              <Text style={styles.historyCountCaption}>
                {savedPlaces.length === 1 ? '1 place saved' : `${savedPlaces.length} places saved`}
              </Text>
              <View style={styles.historyDivider} />
              {savedPlaces.map((place) => (
                <View key={place.id} style={styles.tripRow}>
                  {editingId === place.id ? (
                    <View style={styles.savedEditBlock}>
                      <TextInput
                        style={styles.profileInput}
                        value={editName}
                        onChangeText={setEditName}
                        placeholder="Place name"
                        placeholderTextColor={t.textTertiary}
                        maxLength={60}
                        returnKeyType="done"
                      />
                      <View style={styles.appearanceRow} accessibilityLabel="Place category">
                        {PLACE_CATEGORIES.map(({ id, label }) => (
                          <TouchableOpacity
                            key={id}
                            style={[styles.appearanceChip, editCategory === id && styles.appearanceChipActive]}
                            onPress={() => setEditCategory(id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Category: ${label}`}
                            accessibilityState={{ selected: editCategory === id }}
                          >
                            <Text
                              style={[styles.appearanceChipText, editCategory === id && styles.appearanceChipTextActive]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {rowError && <Text style={styles.savedFieldError}>{rowError}</Text>}
                      <TouchableOpacity
                        style={styles.historyRowDelete}
                        onPress={saveRowEdit}
                        accessibilityRole="button"
                        accessibilityLabel="Save changes"
                      >
                        <Text style={styles.savedActionText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.historyRowDelete}
                        onPress={() => { setEditingId(null); setRowError(null); }}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel edit"
                      >
                        <Text style={styles.savedActionText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={styles.tripRowLeft}>
                        <Text style={styles.savedPlaceName} numberOfLines={1}>
                          {place.name}
                        </Text>
                        <View style={categoryPillStyle(styles, place.category)}>
                          <Text style={categoryPillText(styles, place.category)}>
                            {categoryLabel(place.category)}
                          </Text>
                        </View>
                        <Text style={styles.savedPlaceCoords} numberOfLines={1}>
                          {formatLatLng(place.latitude, place.longitude) || '—'}
                        </Text>
                      </View>
                      <View style={styles.savedActionsCol}>
                        <TouchableOpacity
                          style={styles.historyRowDelete}
                          onPress={() => routeToSavedPlace(place)}
                          accessibilityRole="button"
                          accessibilityLabel={`Set destination to saved place: ${place.name}`}
                        >
                          <Text style={styles.savedActionText}>Use as destination</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.historyRowDelete}
                          onPress={() => {
                            setEditingId(place.id);
                            setEditName(place.name);
                            setEditCategory(
                              PLACE_CATEGORIES.some((cat) => cat.id === place.category) ? place.category : 'other'
                            );
                            setRowError(null);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Edit saved place"
                        >
                          <Text style={styles.savedActionText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.historyRowDelete}
                          onPress={() => confirmDeleteSavedPlace(place.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Delete saved place"
                        >
                          <Text style={styles.historyRowDeleteText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              ))}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}
