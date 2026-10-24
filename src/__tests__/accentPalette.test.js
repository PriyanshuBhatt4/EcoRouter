// Accent palette coverage for the two ADDITIVE accents (teal, coral) and the
// (theme, accent) resolver contract they must honor — same rules every other
// accent follows, so the single stylesheet factory keeps working unchanged.

import { ACCENTS, ACCENT_NAMES, makePalette } from '../theme/palette';
import { getSheet } from '../theme/styles';

const LIGHT_TOKENS = [
  'primary',
  'primaryOnTint',
  'primarySoft',
  'primarySoftAlt',
  'primaryText',
  'primaryTextOnSoft',
];
const DARK_TOKENS = [
  'primary',
  'primaryOnTint',
  'primarySoftDark',
  'primarySoftAltDark',
  'primaryText',
  'primaryTextOnSoft',
];

describe('ACCENTS registry', () => {
  test('ACCENT_NAMES keeps the swatch order with teal and coral added after rose', () => {
    expect(ACCENT_NAMES).toEqual(['green', 'blue', 'orange', 'violet', 'rose', 'teal', 'coral']);
    // Every registry entry is addressable by a listed name (and vice versa).
    for (const name of ACCENT_NAMES) {
      expect(ACCENTS[name]).toBeTruthy();
      expect(typeof ACCENTS[name].label).toBe('string');
    }
    expect(Object.keys(ACCENTS)).toEqual(ACCENT_NAMES);
  });

  test('teal + coral carry the full token set for both palettes (like every accent)', () => {
    for (const name of ['teal', 'coral']) {
      const entry = ACCENTS[name];
      expect(Object.keys(entry.light)).toEqual(LIGHT_TOKENS);
      expect(Object.keys(entry.dark)).toEqual(DARK_TOKENS);
    }
  });

  test('the two new accents are not the default and their role colors do not collide', () => {
    expect(Object.keys(ACCENTS)).not.toContain('default');
    // primaryOnTint is deliberately SHARED across accents (white on light /
    // #0B1220 on dark, matching blue/orange/violet/rose) — a constant, not a
    // role color; it is excluded from the uniqueness check.
    const roleColorIfAny = (entry) => {
      const skip = new Set(['primaryOnTint']);
      return [
        ...Object.entries(entry.light),
        ...Object.entries(entry.dark),
      ]
        .filter(([token]) => !skip.has(token))
        .map(([, value]) => value);
    };
    const existing = new Set(
      ['green', 'blue', 'orange', 'violet', 'rose'].flatMap((name) => roleColorIfAny(ACCENTS[name]))
    );
    for (const value of roleColorIfAny(ACCENTS.teal)) {
      expect(existing.has(value)).toBe(false);
    }
    for (const value of roleColorIfAny(ACCENTS.coral)) {
      expect(existing.has(value)).toBe(false);
    }
  });
});

describe('makePalette resolver for the new accents', () => {
  test('dark mode maps the *Dark soft-tint names onto the canonical token names', () => {
    const darkTeal = makePalette('dark', 'teal');
    expect(darkTeal.primarySoft).toBe('#134E4A');
    expect(darkTeal.primarySoftAlt).toBe('#042F2E');
    expect(darkTeal.primary).toBe('#2DD4BF');
    expect(darkTeal.primaryOnTint).toBe('#0B1220');
    const darkCoral = makePalette('dark', 'coral');
    expect(darkCoral.primarySoft).toBe('#6E2517');
    expect(darkCoral.primarySoftAlt).toBe('#40130A');
    expect(darkCoral.primaryText).toBe('#F9AB95');
  });

  test('light mode overlays the accent tokens onto the base palette', () => {
    const lightTeal = makePalette('light', 'teal');
    expect(lightTeal.primary).toBe('#0D9488');
    expect(lightTeal.primarySoft).toBe('#CCFBF1');
    expect(lightTeal.primarySoftAlt).toBe('#F0FDFA');
    expect(lightTeal.textPrimary).toBe('#111827'); // base tokens untouched
    const lightCoral = makePalette('light', 'coral');
    expect(lightCoral.primary).toBe('#E25D4E');
    expect(lightCoral.primarySoft).toBe('#FCE3DC');
    expect(lightCoral.primarySoftAlt).toBe('#FEF2EF');
  });
});

describe('lazy sheet cache with the new accents', () => {
  test('getSheet lazily builds and caches one sheet per (theme, accent) key', () => {
    const tealLight = getSheet('light', 'teal');
    expect(getSheet('light', 'teal')).toBe(tealLight); // cached
    expect(getSheet('light', 'teal')).not.toBe(getSheet('dark', 'teal')); // keyed by mode
    expect(getSheet('light', 'teal')).not.toBe(getSheet('light', 'coral')); // keyed by accent
    expect(getSheet('light', 'green')).not.toBe(getSheet('light', 'teal'));
  });
});
