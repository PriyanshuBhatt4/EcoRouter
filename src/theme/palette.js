// Theme data: base palettes, accent overlays, streak heat colors, dark map
// style, and the (theme, accent) palette resolver.

// ---------------------------------------------------------------------------
// Design system tokens — UI-only, referenced consistently across screens.
// Two full palettes (light / dark) share the same token NAMES so the single
// stylesheet factory in theme/styles.js stays one template for both themes.
// ---------------------------------------------------------------------------
export const PALETTE = {
  light: {
    brand: '#10B981',        // primary CTA / selected route fill
    brandDeep: '#065F46',    // text on green-tinted surfaces
    brandTint: '#D1FAE5',
    brandTintSoft: '#ECFDF5',
    accent: '#2563EB',       // blue accent (fills, pins)
    accentDeep: '#1E40AF',   // text on blue-tinted surfaces
    accentText: '#2563EB',   // blue used as text/link color
    accentTint: '#DBEAFE',
    accentCard: '#EFF6FF',   // active-trip card tint
    error: '#B91C1C',
    errorTint: '#FEF2F2',
    amber: '#F59E0B',        // destination pin
    amberTint: '#FEF3C7',
    amberText: '#92400E',    // text on amber-tinted surfaces
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    page: '#F3F4F6',         // nested-screen background
    tile: '#F9FAFB',         // inset tiles
    border: '#E5E7EB',
    white: '#FFFFFF',        // card / surface background
    onBrand: '#FFFFFF',      // text on brand-colored fills
    inputBg: '#FAFAFA',
    pillBg: '#F3F4F6',
    pillText: '#374151',
    pillWalkingBg: '#ECFDF5',
    pillWalkingText: '#065F46',
    pillCyclingBg: '#DBEAFE',
    pillCyclingText: '#1E40AF',
  },
  dark: {
    brand: '#10B981',        // CTA fill unchanged; white text still reads on it
    brandDeep: '#34D399',    // brighter green text on dark green tints
    brandTint: '#065F46',
    brandTintSoft: '#064E3B',
    accent: '#3B82F6',
    accentDeep: '#93C5FD',
    accentText: '#93C5FD',
    accentTint: '#1E3A8A',
    accentCard: '#1E3A8A',
    error: '#FCA5A5',
    errorTint: '#7F1D1D',
    amber: '#F59E0B',
    amberTint: '#78350F',
    amberText: '#FCD34D',
    textPrimary: '#F9FAFB',
    textSecondary: '#9CA3AF',
    textTertiary: '#6B7280', // tertiary captions only — never primary copy
    page: '#0B1220',
    tile: '#111827',
    border: '#374151',
    white: '#1F2937',        // card / surface background (dark equivalent)
    onBrand: '#FFFFFF',
    inputBg: '#111827',
    pillBg: '#374151',
    pillText: '#D1D5DB',
    pillWalkingBg: '#064E3B',
    pillWalkingText: '#6EE7B7',
    pillCyclingBg: '#1E3A8A',
    pillCyclingText: '#93C5FD',
  },
};

// ---------------------------------------------------------------------------
// Accent themes — settings. Every accent overrides ONLY the primary/CTA role
// of the base palette; token NAMES are identical across accents, so the
// single stylesheet factory keeps working unchanged for all of them.
// Roles:
//   primary          CTA fill (Start Trip / Find Routes / selected option border)
//   primaryOnTint    readable text on a primary-filled control (white)
//   primarySoft      tinted background/border — light mode value
//   primarySoftDark  dark-mode equivalent of primarySoft (same role)
//   primarySoftAlt   the really-soft selected option-card background (light);
//                    its dark-mode pair is primarySoftAltDark. Kept as a
//                    separate level so the green default is pixel-identical.
//   primaryText      accent used as TEXT/graphic on plain surfaces
//   primaryTextOnSoft readable text on a primarySoft tint (was brandDeep-style)
// The 'green' accent below carries the EXACT current palette values, so it is
// a guaranteed zero-regression default.
// Semantic green uses are deliberately NOT routed through accents: mode pills
// (walking green / cycling blue), the selected-route polyline, streak-ring
// heat colors and the "good air" PM card keep their own colors.
// ---------------------------------------------------------------------------
export const ACCENTS = {
  green: {
    label: 'Green',
    light: {
      primary: '#10B981', primaryOnTint: '#FFFFFF', primarySoft: '#D1FAE5',
      primarySoftAlt: '#ECFDF5', primaryText: '#10B981', primaryTextOnSoft: '#065F46',
    },
    dark: {
      primary: '#10B981', primaryOnTint: '#FFFFFF', primarySoftDark: '#065F46',
      primarySoftAltDark: '#064E3B', primaryText: '#34D399', primaryTextOnSoft: '#34D399',
    },
  },
  blue: {
    label: 'Blue',
    light: {
      primary: '#2563EB', primaryOnTint: '#FFFFFF', primarySoft: '#DBEAFE',
      primarySoftAlt: '#EFF6FF', primaryText: '#2563EB', primaryTextOnSoft: '#1E40AF',
    },
    dark: {
      primary: '#60A5FA', primaryOnTint: '#0B1220', primarySoftDark: '#1E3A8A',
      primarySoftAltDark: '#172554', primaryText: '#93C5FD', primaryTextOnSoft: '#93C5FD',
    },
  },
  orange: {
    label: 'Orange',
    light: {
      primary: '#EA580C', primaryOnTint: '#FFFFFF', primarySoft: '#FFEDD5',
      primarySoftAlt: '#FFF7ED', primaryText: '#EA580C', primaryTextOnSoft: '#9A3412',
    },
    dark: {
      primary: '#FB923C', primaryOnTint: '#0B1220', primarySoftDark: '#7C2D12',
      primarySoftAltDark: '#431407', primaryText: '#FDBA74', primaryTextOnSoft: '#FDBA74',
    },
  },
  violet: {
    label: 'Violet',
    light: {
      primary: '#7C3AED', primaryOnTint: '#FFFFFF', primarySoft: '#EDE9FE',
      primarySoftAlt: '#F5F3FF', primaryText: '#7C3AED', primaryTextOnSoft: '#5B21B6',
    },
    dark: {
      primary: '#A78BFA', primaryOnTint: '#0B1220', primarySoftDark: '#4C1D95',
      primarySoftAltDark: '#2E1065', primaryText: '#C4B5FD', primaryTextOnSoft: '#C4B5FD',
    },
  },
  rose: {
    label: 'Rose',
    light: {
      primary: '#DB2777', primaryOnTint: '#FFFFFF', primarySoft: '#FCE7F3',
      primarySoftAlt: '#FDF2F8', primaryText: '#DB2777', primaryTextOnSoft: '#9D174D',
    },
    dark: {
      primary: '#F472B6', primaryOnTint: '#0B1220', primarySoftDark: '#831843',
      primarySoftAltDark: '#500724', primaryText: '#F9A8D4', primaryTextOnSoft: '#F9A8D4',
    },
  },
  teal: {
    label: 'Teal',
    light: {
      primary: '#0D9488', primaryOnTint: '#FFFFFF', primarySoft: '#CCFBF1',
      primarySoftAlt: '#F0FDFA', primaryText: '#0D9488', primaryTextOnSoft: '#115E59',
    },
    dark: {
      primary: '#2DD4BF', primaryOnTint: '#0B1220', primarySoftDark: '#134E4A',
      primarySoftAltDark: '#042F2E', primaryText: '#5EEAD4', primaryTextOnSoft: '#5EEAD4',
    },
  },
  coral: {
    label: 'Coral',
    light: {
      primary: '#E25D4E', primaryOnTint: '#FFFFFF', primarySoft: '#FCE3DC',
      primarySoftAlt: '#FEF2EF', primaryText: '#E25D4E', primaryTextOnSoft: '#9D3225',
    },
    dark: {
      primary: '#F4836E', primaryOnTint: '#0B1220', primarySoftDark: '#6E2517',
      primarySoftAltDark: '#40130A', primaryText: '#F9AB95', primaryTextOnSoft: '#F9AB95',
    },
  },
};

// Settings swatch order; each swatch is filled with the accent's LIGHT
// primary so tiles read identically in both device themes. Teal follows the
// existing hue spread (a cooler counterpart to the green default), coral
// sits last as the warmest option; neither is the default accent.
export const ACCENT_NAMES = ['green', 'blue', 'orange', 'violet', 'rose', 'teal', 'coral'];

// Dark "night mode" map style for the Google Maps provider (Android / Expo
// Go default). PLATFORM LIMIT: iOS Apple Maps has no custom-styling API, so
// on iOS the map keeps its default look while the app chrome goes dark —
// that is a platform constraint, not a partial implementation. Roads and
// labels stay readable; only terrain/transit clutter is muted.
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#17263C' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7E8AA0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0B1220' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#111827' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#111827' }] },
  { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1C2A3E' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#5A6472' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1E3329' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3F5E4D' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2A2F3A' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212A37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#81A0B8' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#38414E' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#445062' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#9FB2C8' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1C2A3E' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#243447' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#5A6472' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263C' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7E8AA0' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#37485E' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8FA3BF' }] },
];

// Streak-grid heat colors per theme (level -> square fill; hollowBorder for
// days with no recorded history). Theme-color map so the grid renders
// consistently in both palettes.
export const RING_COLORS = {
  light: { 0: '#E5E7EB', 1: '#A7F3D0', 2: '#6EE7B7', 3: '#10B981', hollowBorder: '#D1D5DB' },
  dark: { 0: '#1F2937', 1: '#065F46', 2: '#059669', 3: '#34D399', hollowBorder: '#374151' },
};

// Resolves the effective palette for one (theme, accent) pair: the base
// light/dark palette with ONLY the primary-role tokens overlaid by the picked
// accent. Unknown mode/accent names fall back to light/green so a corrupt or
// legacy stored value can never break theming.
//
// Dark-mode accent entries store their soft tints under the *Dark suffix
// names (primarySoftDark / primarySoftAltDark), but every consumer reads the
// canonical token names t.primarySoft / t.primarySoftAlt in BOTH themes —
// so the dark merge renames them onto the canonical names here. Without
// this mapping, dark mode would lose the avatar fill and the selected
// route-card tint (undefined tokens). Light mode is untouched.
// The green accent's dark values (#065F46 / #064E3B) equal the original
// PALETTE.dark brandTint / brandTintSoft, so the default accent stays
// pixel-identical in dark mode.
export function makePalette(modeName, accentName) {
  const base = PALETTE[modeName] || PALETTE.light;
  const accent = ACCENTS[accentName] || ACCENTS.green;
  if (modeName === 'dark') {
    const { primarySoftDark, primarySoftAltDark, ...rest } = accent.dark;
    return {
      ...base,
      ...rest,
      primarySoft: primarySoftDark,
      primarySoftAlt: primarySoftAltDark,
    };
  }
  return { ...base, ...accent.light };
}
