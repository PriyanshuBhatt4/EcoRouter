// Unit tests for the saved-places data model (constants.js) and the
// coordinates caption helper (lib/format.js).

import {
  SAVED_PLACES_KEY,
  SAVED_PLACES_MAX,
  PLACE_CATEGORIES,
  parseSavedPlaces,
  buildSavedPlace,
} from '../constants';
import { formatLatLng } from '../lib/format';

const validPlace = {
  id: 'p1',
  name: 'Office',
  category: 'work',
  latitude: 28.6,
  longitude: 77.2,
};

describe('saved places keys + categories', () => {
  test('storage key and cap constants', () => {
    expect(SAVED_PLACES_KEY).toBe('@EcoRoute/savedPlaces');
    expect(SAVED_PLACES_MAX).toBe(12);
  });

  test('PLACE_CATEGORIES exposes home/work/other ids and labels', () => {
    expect(PLACE_CATEGORIES.map((cat) => cat.id)).toEqual(['home', 'work', 'other']);
    expect(PLACE_CATEGORIES.map((cat) => cat.label)).toEqual(['Home', 'Work', 'Other']);
  });
});

describe('parseSavedPlaces', () => {
  test('null/empty/corrupt/array payloads yield an empty list', () => {
    expect(parseSavedPlaces(null)).toEqual([]);
    expect(parseSavedPlaces('')).toEqual([]);
    expect(parseSavedPlaces('not json')).toEqual([]);
    expect(parseSavedPlaces('{"name":"oops"}')).toEqual([]);
  });

  test('keeps valid entries in order with stored ids', () => {
    const raw = JSON.stringify([validPlace]);
    expect(parseSavedPlaces(raw)).toEqual([validPlace]);
  });

  test('drops invalid entries (non-object, empty name, non-string name, bad coords)', () => {
    const raw = JSON.stringify([
      'nope',
      null,
      { name: '   ', latitude: 0, longitude: 0 },
      { name: 42, latitude: 0, longitude: 0 },
      { name: 'Good', latitude: 0, longitude: 0 },
      { name: 'Too far north', latitude: 90.5, longitude: 0 },
      { name: 'Too far south', latitude: -90.1, longitude: 0 },
      { name: 'Too far east', latitude: 0, longitude: 180.1 },
      { name: 'NaN coords', latitude: '28', longitude: 77 },
      { name: 'Missing coords', latitude: 0 },
    ]);
    // 'Good' had no stored id, so one is synthesized for it.
    const parsed = parseSavedPlaces(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: 'Good', category: 'other', latitude: 0, longitude: 0 });
  });

  test('coerces unknown/missing categories to other, keeps known ones', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'A', category: 'gym', latitude: 1, longitude: 1 },
      { id: 'b', name: 'B', latitude: 2, longitude: 2 },
      { id: 'c', name: 'C', category: 'home', latitude: 3, longitude: 3 },
    ]);
    expect(parseSavedPlaces(raw).map((p) => p.category)).toEqual(['other', 'other', 'home']);
  });

  test('synthesizes an id for entries without one', () => {
    const raw = JSON.stringify([{ name: 'No id', latitude: 1, longitude: 1 }]);
    const list = parseSavedPlaces(raw);
    expect(typeof list[0].id).toBe('string');
    expect(list[0].id.length).toBeGreaterThan(0);
  });

  test('caps the list at SAVED_PLACES_MAX newest-kept order', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => ({
      id: `p${i}`,
      name: `Place ${i}`,
      latitude: i,
      longitude: 0,
    }));
    const list = parseSavedPlaces(JSON.stringify(thirteen));
    expect(list).toHaveLength(SAVED_PLACES_MAX);
    expect(list[0].id).toBe('p0');
    expect(list[11].id).toBe('p11');
  });

  // Duplicate stored ids (legacy/hand-edited payloads) would collide as React
  // list keys and tie rename/delete to BOTH rows: later duplicates get a
  // fresh synthesized id, exactly like id-less entries.
  test('duplicate stored ids are deduped — later duplicates get synthesized ids', () => {
    const raw = JSON.stringify([
      { id: 'dup', name: 'A', latitude: 1, longitude: 1 },
      { id: 'dup', name: 'B', latitude: 2, longitude: 2 },
      { id: 'dup', name: 'C', latitude: 3, longitude: 3 },
    ]);
    const list = parseSavedPlaces(raw);
    expect(list).toHaveLength(3);
    // First keeper keeps the stored id; every later duplicate is unique.
    expect(list[0].id).toBe('dup');
    expect(new Set(list.map((p) => p.id)).size).toBe(3);
  });

  test('boundary coordinates are valid (±90 / ±180 inclusive)', () => {
    const raw = JSON.stringify([
      { id: 'e1', name: 'North pole', latitude: 90, longitude: 180 },
      { id: 'e2', name: 'South west', latitude: -90, longitude: -180 },
    ]);
    expect(parseSavedPlaces(raw)).toHaveLength(2);
  });
});

describe('buildSavedPlace', () => {
  test('builds a record with a unique-style id and exact fields', () => {
    const place = buildSavedPlace({ name: ' Home ', category: 'home', latitude: 12.34, longitude: 56.78 });
    expect(place.name).toBe('Home');
    expect(place.category).toBe('home');
    expect(place.latitude).toBe(12.34);
    expect(place.longitude).toBe(56.78);
    expect(typeof place.id).toBe('string');
    expect(place.id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });

  test('rejects empty/whitespace/over-long names with the name field', () => {
    for (const bad of ['', '   ', 42, undefined]) {
      let err;
      try {
        buildSavedPlace({ name: bad, latitude: 0, longitude: 0 });
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ code: 'INVALID_PLACE', field: 'name' });
    }
    let tooLong;
    try {
      buildSavedPlace({ name: 'x'.repeat(61), latitude: 0, longitude: 0 });
    } catch (e) {
      tooLong = e;
    }
    expect(tooLong).toMatchObject({ code: 'INVALID_PLACE', field: 'name' });
  });

  test('rejects out-of-range / non-numeric coordinates', () => {
    let latErr;
    try {
      buildSavedPlace({ name: 'Place', latitude: 90.001, longitude: 0 });
    } catch (e) {
      latErr = e;
    }
    expect(latErr).toMatchObject({ code: 'INVALID_PLACE', field: 'latitude' });

    let lngErr;
    try {
      buildSavedPlace({ name: 'Place', latitude: 0, longitude: -180.001 });
    } catch (e) {
      lngErr = e;
    }
    expect(lngErr).toMatchObject({ code: 'INVALID_PLACE', field: 'longitude' });

    let numErr;
    try {
      buildSavedPlace({ name: 'Place', latitude: '28.6', longitude: NaN });
    } catch (e) {
      numErr = e;
    }
    expect(numErr.code).toBe('INVALID_PLACE');
    expect(['latitude', 'longitude']).toContain(numErr.field);
  });

  test('coerces unknown categories to other', () => {
    expect(buildSavedPlace({ name: 'P', category: 'gym', latitude: 0, longitude: 0 }).category).toBe('other');
    expect(buildSavedPlace({ name: 'P', latitude: 0, longitude: 0 }).category).toBe('other');
    expect(buildSavedPlace({ name: 'P', category: 'work', latitude: 0, longitude: 0 }).category).toBe('work');
  });

  test('two consecutive builds never share an id', () => {
    const a = buildSavedPlace({ name: 'A', latitude: 1, longitude: 1 });
    const b = buildSavedPlace({ name: 'B', latitude: 2, longitude: 2 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('formatLatLng', () => {
  test('formats to 4 decimals matching the backend name fallback', () => {
    expect(formatLatLng(28.6, 77.2)).toBe('28.6000, 77.2000');
    expect(formatLatLng(28.6, 77.2)).toBe(`${28.6.toFixed(4)}, ${77.2.toFixed(4)}`);
    expect(formatLatLng(-0.00001, 179.99999)).toBe('-0.0000, 180.0000');
  });

  test('returns null for non-finite input', () => {
    expect(formatLatLng(NaN, 77.2)).toBeNull();
    expect(formatLatLng(28.6, '77')).toBeNull();
    expect(formatLatLng(undefined, undefined)).toBeNull();
  });
});
