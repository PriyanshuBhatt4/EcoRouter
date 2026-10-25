// Stylesheet factory: one template that builds a full StyleSheet for any
// (theme, accent) palette resolved via theme/palette.js.

import { StyleSheet } from 'react-native';
import { makePalette } from './palette';

// One soft shadow for cards, one stronger shadow for floating overlays
// (search field, bottom card, banner). Intentionally theme-independent:
// pure black shadows read as neutral elevation glow on both palettes.
const shadowCard = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
};
const shadowOverlay = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.14,
  shadowRadius: 10,
  elevation: 6,
};

// Single stylesheet factory for both themes.
export function makeStyles(t) {
  return StyleSheet.create({
    container: { flex: 1 },

    // Loading screen
    messageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: t.page },
    messageTitle: { marginTop: 16, fontSize: 16, fontWeight: '600', color: t.textPrimary, textAlign: 'center' },
    messageText: { marginTop: 4, fontSize: 14, color: t.textSecondary, textAlign: 'center', lineHeight: 20 },

    // Map fills its single-screen flex container.
    map: { flex: 1, backgroundColor: t.border },

    // Floating top bar: search field + profile avatar button
    topBar: {
      position: 'absolute',
      top: 54,
      width: '92%',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    searchBox: {
      flex: 1,
      backgroundColor: t.white,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 12,
      ...shadowOverlay,
    },
    // Keyboard: app.json uses Expo's default resize mode — the whole window
    // shrinks, so the absolute bottom card sits above the keyboard.
    searchInput: {
      fontSize: 15,
      color: t.textPrimary,
      padding: 0,
    },
    profileBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: t.white,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      ...shadowOverlay,
    },
    // Profile photo cutout inside the top-bar chip: same 46px circle so the
    // chip never changes shape between photo / initial states.
    profileBtnImage: { width: 46, height: 46, borderRadius: 23 },
    profileBtnText: { fontSize: 16, fontWeight: '700', color: t.primaryText },

    // Recent destination chips (map screen): compact pills floating directly
    // under the search row, above the bottom card. Only rendered when recents
    // exist AND the route status is idle; token-driven so both themes work.
    recentChipRow: {
      position: 'absolute',
      top: 108,
      width: '92%',
      alignSelf: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      zIndex: 12,
    },
    recentChip: {
      backgroundColor: t.white,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 44,
      maxWidth: 150,
      justifyContent: 'center',
      ...shadowCard,
    },
    recentChipText: { fontSize: 12, fontWeight: '600', color: t.textPrimary, flexShrink: 1 },
    recentChipClear: {
      backgroundColor: t.page,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 44,
      justifyContent: 'center',
      ...shadowCard,
    },
    // Saved-place chips on the map reuse the recentChip* styles; they render
    // in their own row directly under the recents row, so this offset keeps
    // the two rows from overlapping (chip minHeight 44 + gap).
    savedChipRowOffset: { top: 160 },

    // Saved Places screen tokens (same card/section/input family as Profile).
    savedSearchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    savedSearchInput: { paddingVertical: 12 },
    savedInlineBtn: {
      backgroundColor: t.primary,
      borderRadius: 12,
      paddingHorizontal: 14,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    savedInlineGap: { marginTop: 8, alignSelf: 'flex-start' },
    savedInlineBtnText: { color: t.primaryOnTint, fontSize: 14, fontWeight: 'bold' },
    savedCoordBlock: { marginTop: 10 },
    savedCoordRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    savedFieldError: { fontSize: 12, color: t.error, marginTop: 4 },
    savedChipRow: { flexDirection: 'row', flexWrap: 'wrap' },
    savedChipRowGap: { gap: 8, marginTop: 12 },
    // Category pill on each saved-place row (home blue-ish / work green-ish /
    // other neutral) — mirrors the tripModePill family's token pattern.
    savedCategoryPill: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
      backgroundColor: t.pillBg,
      marginTop: 5,
    },
    savedCategoryPillHome: { backgroundColor: t.accentTint },
    savedCategoryPillWork: { backgroundColor: t.brandTint },
    savedCategoryPillText: { fontSize: 11, fontWeight: '600', color: t.pillText },
    savedCategoryPillTextHome: { color: t.accentDeep },
    savedCategoryPillTextWork: { color: t.brandDeep },
    savedPlaceName: { fontSize: 13, color: t.textPrimary, fontWeight: '700' },
    savedPlaceCoords: { fontSize: 11, color: t.textTertiary, marginTop: 3, lineHeight: 15 },
    savedActionsCol: { alignItems: 'flex-end' },
    savedActionText: { fontSize: 13, fontWeight: '600', color: t.accentText },
    savedEditBlock: { flex: 1, marginRight: 8 },
    savedListCard: { marginBottom: 0 },
    // Map picker: short note above the Use/Cancel buttons inside the card.
    // Caption size rule: tertiary 11 / lineHeight 15 (content-bearing hint
    // keeps its secondary color token for contrast).
    pickerNote: { fontSize: 11, color: t.textSecondary, lineHeight: 15, marginBottom: 8 },

    // Recenter pill, right edge above the bottom card
    recenterBtn: {
      position: 'absolute',
      right: 16,
      top: '30%',
      backgroundColor: t.white,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      ...shadowCard,
    },
    recenterText: { fontSize: 12, fontWeight: '600', color: t.textPrimary },

    // Location error banner — rendered last + zIndex so it sits above the top bar
    locationBanner: {
      position: 'absolute',
      top: 8,
      width: '90%',
      alignSelf: 'center',
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.errorTint,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      ...shadowOverlay,
    },
    locationBannerText: { flex: 1, fontSize: 12, color: t.error, marginRight: 8 },
    // Touch-target host for the dismiss text (>= 44 logical px).
    locationBannerDismissBtn: { minHeight: 44, justifyContent: 'center' },
    locationBannerDismiss: { fontSize: 12, color: t.accentText, fontWeight: 'bold' },

    // Bottom card
    bottomCard: {
      position: 'absolute',
      bottom: 24,
      width: '92%',
      alignSelf: 'center',
      backgroundColor: t.white,
      borderRadius: 20,
      padding: 16,
      maxHeight: '58%',
      ...shadowOverlay,
    },
    // Collapsed active-trip variant: tighter padding so the interactive row
    // stays ~64-72px; the attribution line folds in underneath it.
    bottomCardCompact: { padding: 12 },
    // Route-results panel (expanded): scroll area shrinks under the fixed
    // Start Trip footer inside the maxHeight-capped card. The ScrollView's
    // real pixel cap comes from MapScreen (useWindowDimensions-derived
    // inline maxHeight); these flex settings keep it shrinkable-but-grown,
    // so hugging short content still works while tall content is clipped
    // into the scroller instead of pushing the footer off-screen.
    panelScroll: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
    panelScrollContent: { paddingBottom: 8 },
    // Drag-handle affordance at the top of the expanded card: purely visual
    // (no gesture implemented behind it). Centered thin rounded bar.
    panelHandleHost: { alignItems: 'center', marginBottom: 6 },
    panelHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.border },
    // Pinned header row of the expanded panel: routes title (left, wraps to
    // 2 lines max) + always-reachable collapse control (right). Rendered
    // above the scroll area so it never scrolls away. Logical start/end
    // padding and gap keep it RTL-safe.
    panelHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    // Header title wrapper: lets the existing routesTitle text shrink so the
    // header control keeps its full touch target on narrow screens.
    panelHeaderTitle: { flexShrink: 1 },
    // Header collapse control host: >= 44 logical px touch target. Uses the
    // same accent-text token family as the expand/ghost controls.
    panelCollapseTouch: { minHeight: 44, justifyContent: 'center', paddingStart: 8 },
    panelCollapseText: { fontSize: 13, fontWeight: '600', color: t.accentText },
    sectionLabel: { fontSize: 12, color: t.textSecondary, letterSpacing: 0.5, marginBottom: 12 },
    modeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    modeBtn: {
      flex: 1,
      backgroundColor: t.page,
      borderRadius: 12,
      paddingVertical: 12,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeBtnActive: { backgroundColor: t.accentTint },
    modeText: { fontSize: 14, color: t.textPrimary },
    modeTextActive: { fontWeight: '600', color: t.accentDeep },

    idleState: { marginTop: 8 },
    idleTitle: { fontSize: 16, fontWeight: '600', color: t.textPrimary },
    idleHint: { fontSize: 12, color: t.textSecondary, marginTop: 4, lineHeight: 16 },

    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
    loadingText: { fontSize: 14, color: t.textSecondary },
    loadingCaption: { fontSize: 12, color: t.textTertiary, lineHeight: 16, marginTop: 4 },

    errorCard: {
      backgroundColor: t.errorTint,
      borderRadius: 12,
      padding: 12,
      marginTop: 8,
    },
    errorCardTitle: { fontSize: 14, fontWeight: '600', color: t.error, marginBottom: 2 },
    errorCardText: { fontSize: 13, color: t.error, lineHeight: 18 },

    routesTitle: { fontSize: 15, fontWeight: '600', color: t.textPrimary },
    optionsScroll: { marginBottom: 8 },
    optionCard: {
      backgroundColor: t.page,
      borderWidth: 2,
      borderColor: 'transparent',
      padding: 12,
      borderRadius: 12,
      marginRight: 8,
    },
    optionCardSelected: { backgroundColor: t.primarySoftAlt, borderColor: t.primary },
    optionTitle: { fontSize: 14, fontWeight: '600', color: t.textPrimary },
    optionTitleSelected: { color: t.primaryTextOnSoft },
    optionText: { fontSize: 12, color: t.textSecondary, marginTop: 2 },

    prefRow: { marginBottom: 4 },
    prefRowContent: { paddingVertical: 2 },
    prefChip: {
      backgroundColor: t.page,
      paddingVertical: 10,
      paddingHorizontal: 14,
      minHeight: 44,
      borderRadius: 999,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    prefChipActive: { backgroundColor: t.accentTint },
    prefChipText: { fontSize: 13, color: t.textPrimary },
    prefChipTextActive: { fontWeight: '600', color: t.accentDeep },

    // Transparent-selection note under the preference chips row. Appear-only:
    // the chips row itself never shifts because the note is its own block
    // below it. One-line caption (11 / 15, content-bearing → secondary token).
    prefNote: { fontSize: 11, color: t.textSecondary, lineHeight: 15, marginTop: 6 },

    statsRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 12 },
    statBox: {
      flex: 1,
      backgroundColor: t.tile,
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
    },
    statLabel: { fontSize: 11, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 15 },
    statValue: { fontSize: 18, fontWeight: 'bold', color: t.textPrimary, marginTop: 2 },
    statValueCompact: { fontSize: 16 },

    pmCard: { borderRadius: 12, padding: 12 },
    pmCardOk: { backgroundColor: t.brandTintSoft },
    pmCardWarn: { backgroundColor: t.amberTint },
    pmTitle: { fontSize: 12, fontWeight: '600', color: t.textPrimary },
    pmTitleOk: { color: t.brandDeep },
    pmValue: { fontSize: 13, fontWeight: '600', color: t.brandDeep, marginTop: 2 },
    pmValueMuted: { fontSize: 13, color: t.textSecondary, marginTop: 2 },
    pmNote: { fontSize: 11, color: t.textSecondary, marginTop: 4, lineHeight: 15 },
    // PM card meta caption + backend caveat: ONE caption family (11 / 15) so
    // both lines read as a unit under the value. The meta line is
    // content-bearing (source + read time), so it keeps the secondary token
    // for contrast; the caveat is verbatim backend copy, italicized to sit
    // visually between meta and the neutral pmNote.
    pmMeta: { fontSize: 11, color: t.textSecondary, marginTop: 4, lineHeight: 15 },
    pmCaveat: { fontSize: 11, color: t.textSecondary, marginTop: 2, lineHeight: 15, fontStyle: 'italic' },

    tripCard: { backgroundColor: t.accentCard, borderRadius: 12, padding: 12 },
    tripCardTitle: { fontSize: 15, fontWeight: '600', color: t.accentDeep },
    tripCardLabel: { fontSize: 11, color: t.accentDeep, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, lineHeight: 15 },
    tripCardTimer: { fontSize: 26, fontWeight: 'bold', color: t.accentDeep, lineHeight: 32 },
    tripCardDist: { fontSize: 13, color: t.accentDeep, marginTop: 4 },
    // Low-GPS notice shown inside the active-trip card: amber block from the
    // amber accent family (amberTint bg + amberText).
    gpsNotice: {
      color: t.amberText,
      backgroundColor: t.amberTint,
      borderRadius: 10,
      padding: 8,
      fontSize: 12,
      marginTop: 6,
    },
    // ADDITIVE distance-pause caption (active trip cards): mirrors the caption
    // family used inside the cards (11 / 15 line height), accent tint like the
    // trip line it annotates. Plain text note — no background block: it says
    // the distance readout is paused while GPS is unreliable, softer than the
    // amber gpsNotice block which keeps its own independent rendering.
    distancePausedNote: {
      fontSize: 11,
      color: t.accentDeep,
      lineHeight: 15,
      marginTop: 4,
    },

    // Collapsed active-trip card: one modest row (mode pill + live stats +
    // Details/Finish buttons) so the map stays mostly visible.
    compactTripCard: { backgroundColor: t.accentCard, borderRadius: 12, padding: 12 },
    compactRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    compactPill: { marginTop: 0 },
    compactStats: { flex: 1, minWidth: 48, flexShrink: 1 },
    compactDist: { fontSize: 14, fontWeight: '600', color: t.textPrimary, lineHeight: 18 },
    compactElapsed: { fontSize: 11, color: t.textSecondary, marginTop: 2, lineHeight: 15 },
    compactBtn: {
      minHeight: 44,
      borderRadius: 12,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactBtnPrimary: { backgroundColor: t.primary, paddingHorizontal: 14 },
    compactBtnGhost: { backgroundColor: t.page },
    compactPrimaryText: { color: t.primaryOnTint, fontSize: 14, fontWeight: 'bold' },
    compactGhostText: { fontSize: 13, fontWeight: '600', color: t.accentText },
    compactAttribution: { fontSize: 10, color: t.textTertiary, marginTop: 8, textAlign: 'center', lineHeight: 13 },

    button: {
      backgroundColor: t.primary,
      borderRadius: 14,
      paddingVertical: 14,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadowCard,
    },
    buttonGap: { marginTop: 16 },
    buttonGapCard: { marginTop: 12 },
    buttonDisabled: { opacity: 0.5 },
    buttonBlue: { backgroundColor: t.accent },
    buttonText: { color: t.primaryOnTint, fontSize: 16, fontWeight: 'bold' },

    ghostBtn: {
      backgroundColor: t.page,
      borderRadius: 12,
      paddingVertical: 10,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    ghostBtnText: { fontSize: 13, fontWeight: '600', color: t.accentText },

    expandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    // Touch-target host for the '▾ Expand' text pressable (>= 44).
    expandTouch: { minHeight: 44, justifyContent: 'center' },
    summaryText: { flex: 1, fontSize: 12, color: t.textSecondary },
    expandText: { fontSize: 13, fontWeight: '600', color: t.accentText, paddingVertical: 8, paddingLeft: 8 },

    attributionText: { fontSize: 10, color: t.textTertiary, marginTop: 12, textAlign: 'center', lineHeight: 14 },

    // Profile screen
    profileScreen: { flex: 1, backgroundColor: t.page },
    profileContent: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 32 },
    profileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    backPill: {
      backgroundColor: t.white,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backPillText: { fontSize: 15, fontWeight: '600', color: t.textPrimary },
    profileTitle: { fontSize: 22, fontWeight: '700', color: t.textPrimary },
    profileCard: {
      backgroundColor: t.white,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      ...shadowCard,
    },
    profileCardLast: { marginBottom: 0 },
    profileHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { fontSize: 20, fontWeight: '700', color: t.primaryTextOnSoft },
    // Photo cutout: same 48x48 circle as the initial avatar so the hero block
    // never changes shape when a photo is set.
    avatarImage: { width: 48, height: 48, borderRadius: 24 },
    profileHeroMeta: { flex: 1 },
    profileDisplayName: { fontSize: 16, fontWeight: '600', color: t.textPrimary },
    profileDisplayNameEmpty: { color: t.textSecondary },
    profileHeroNote: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
    photoHint: { fontSize: 11, color: t.textTertiary, marginTop: 3, lineHeight: 15 },
    // Ghost chip shown only while a photo is set — strips it from the profile.
    removePhotoChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.tile,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 44,
    },
    removePhotoChipText: { fontSize: 11, fontWeight: '600', color: t.error },
    // Micro-hint under the empty weight field.
    weightHint: { fontSize: 11, color: t.textTertiary, marginTop: 6, lineHeight: 15 },
    profileFields: { gap: 12 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: t.textPrimary, marginBottom: 6 },
    profileInput: {
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: t.textPrimary,
    },
    // Appearance segmented control (Light / Dark / System).
    appearanceRow: { flexDirection: 'row', flexWrap: 'wrap' },
    appearanceChip: {
      backgroundColor: t.page,
      paddingVertical: 10,
      paddingHorizontal: 16,
      minHeight: 44,
      borderRadius: 999,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    appearanceChipActive: { backgroundColor: t.accentTint },
    appearanceChipText: { fontSize: 13, color: t.textPrimary },
    appearanceChipTextActive: { fontWeight: '600', color: t.accentDeep },
    // Lifetime stat tiles: four across on wide screens, wrapping to a 2x2 grid
    // on narrow ones (min-width tolerance via flexBasis/flexGrow).
    statTileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statTile: {
      flexBasis: '47%',
      flexGrow: 1,
      backgroundColor: t.tile,
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
    },
    statTileValue: { fontSize: 18, fontWeight: 'bold', color: t.textPrimary },
    statTileLabel: { fontSize: 11, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, lineHeight: 15 },
    // Caption size rule: tertiary 11 with lineHeight 15 (keeping its token).
    statCaption: { fontSize: 11, color: t.textTertiary, lineHeight: 15, marginTop: 10 },
    // Trip-streak panel tiles + activity heatmap. Fixed-px geometry, mirrored
    // as numeric constants in ProfileScreen.js (this file is a factory and
    // cannot export numbers): CELL 13 + GAP 3 = PITCH 16, so 7 rows are
    // 112px; ~53 week columns × 16 + 34px weekday column ≈ 880px wide —
    // horizontal scroll by design, never shrink-to-fit.
    streakTileRow: { flexDirection: 'row', gap: 8 },
    streakTile: {
      flex: 1,
      backgroundColor: t.tile,
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
    },
    streakTileValue: { fontSize: 16, fontWeight: 'bold', color: t.textPrimary },
    streakTileLabel: { fontSize: 11, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, lineHeight: 15 },
    streakSubline: { fontSize: 11, color: t.textSecondary, marginTop: 10, lineHeight: 15 },
    streakGridScroll: { marginTop: 12 },
    streakMonthsRow: { flexDirection: 'row', marginBottom: 4 },
    streakMonthLabel: { fontSize: 10, color: t.textTertiary, lineHeight: 14 },
    streakGrid: { flexDirection: 'row' },
    streakWeekdayCol: { justifyContent: 'flex-start' },
    streakWeekdayLabel: { fontSize: 9, color: t.textTertiary, textAlign: 'right', height: 13, lineHeight: 13, marginBottom: 3 },
    streakMonthBlock: { flexDirection: 'row' },
    streakCol: { marginRight: 3 },
    streakCell: { width: 13, height: 13, borderRadius: 3, marginBottom: 3 },
    streakCellVoid: { width: 13, height: 13, borderRadius: 3, marginBottom: 3 },
    streakLegendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10 },
    streakLegendEntry: { flexDirection: 'row', alignItems: 'center' },
    streakLegendText: { fontSize: 11, color: t.textTertiary, marginRight: 8, lineHeight: 15 },
    streakLegendCell: { width: 10, height: 10, borderRadius: 3, marginRight: 4 },
    tripsHeaderCaption: { fontSize: 11, color: t.textTertiary },
    tripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.tile,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    tripRowLeft: { flex: 1, marginRight: 8 },
    tripRowDate: { fontSize: 13, color: t.textPrimary, fontWeight: '600' },
    // Mode pill on each trip history row (rounded right-side chip). Neutral
    // colors for unknown modes; walking green-ish and cycling blue-ish tints.
    tripModePill: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
      backgroundColor: t.pillBg,
      marginTop: 5,
    },
    tripModePillWalking: { backgroundColor: t.pillWalkingBg },
    tripModePillCycling: { backgroundColor: t.pillCyclingBg },
    tripModePillText: { fontSize: 11, fontWeight: '600', color: t.pillText },
    tripModePillTextWalking: { color: t.pillWalkingText },
    tripModePillTextCycling: { color: t.pillCyclingText },
    tripRowRight: { alignItems: 'flex-end' },
    tripRowDist: { fontSize: 14, fontWeight: '600', color: t.textPrimary },
    tripRowDur: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
    profileEmpty: { alignItems: 'center', paddingVertical: 24 },
    profileEmptyTitle: { fontSize: 14, fontWeight: '600', color: t.textPrimary },
    profileEmptyHint: { fontSize: 12, color: t.textSecondary, marginTop: 4 },

    // Trip History screen
    // Tappable 'RECENT TRIPS' header row on Profile: same texts, wider hit
    // area, with a chevron affordance after the existing caption.
    tripsHeaderTouch: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tripsHeaderRight: { flexDirection: 'row', alignItems: 'center' },
    tripsHeaderChevron: { fontSize: 15, lineHeight: 18, color: t.accentText, marginLeft: 8 },
    historyCountCaption: { fontSize: 12, color: t.textSecondary, marginBottom: 10 },
    // Thin divider between the count caption and the trip list.
    historyDivider: { height: 1, backgroundColor: t.border, marginBottom: 16 },
    historyTripTitle: { fontSize: 14, fontWeight: '700', color: t.textPrimary },
    // History list row: the existing profile trip-row look, with the row body
    // pressable (opens the detail screen) and a trailing Delete text button.
    historyRowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginRight: 4,
    },
    historyRowDelete: {
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 10,
    },
    historyRowDeleteText: { fontSize: 13, fontWeight: '600', color: t.error },
    historyLoadingRow: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
    historyCtaGap: { marginTop: 12 },

    // Trip detail screen
    detailStatsGap: { marginTop: 12 },
    detailSubline: { fontSize: 13, fontWeight: '600', color: t.textSecondary, marginTop: 12 },
    detailCaption: { fontSize: 11, color: t.textTertiary, marginTop: 4, lineHeight: 15 },
    detailInputMultiline: { minHeight: 80, textAlignVertical: 'top' },
    deleteBtn: { backgroundColor: t.error, marginTop: 24 },

    // Journey Replay screen (recorded-trail replay; side-car storage).
    // Full-path Polyline sits behind the bright traveled one, so colors here
    // are token-driven only: the muted base line uses the soft primary tint,
    // the progressive line uses the accent primary.
    replayMap: { height: 280, borderRadius: 16, overflow: 'hidden', marginBottom: 8 },
    // Caption directly above the map: the ONLY path drawn here is the one the
    // user actually walked (no planned-route preview).
    replayCaption: { fontSize: 11, color: t.textSecondary, marginTop: 2, lineHeight: 15 },
    replayControlsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
    replayControlBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.primarySoft,
    },
    replayControlText: { fontSize: 15, fontWeight: '700', color: t.primaryTextOnSoft },
    // Slim scrubber track (~6) with a fill whose width is a percentage of the
    // measured (onLayout) track width. Tappable/draggable via responder.
    replayScrubber: {
      marginTop: 18,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.border,
      overflow: 'hidden',
    },
    replayScrubberFill: { height: 6, borderBottomLeftRadius: 3, borderTopLeftRadius: 3, backgroundColor: t.primary },
    // Moving marker + start/finish endpoint dots (children of MapView.Marker).
    replayMarkerDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: t.primary,
      borderWidth: 2,
      borderColor: t.onBrand,
    },
    replayEndpointDot: { width: 10, height: 10, borderRadius: 5 },
    // History list row: the small secondary 'Replay' text action (before the
    // destructive Delete); the detail screen uses the filled PrimaryButton.
    historyRowActionText: { fontSize: 13, fontWeight: '600', color: t.accentText },

    // Settings screen entry row (on Profile): full-width tappable card row
    // with a trailing chevron affordance.
    settingsEntryCard: { paddingVertical: 4, marginBottom: 12 },
    settingsEntry: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    settingsEntryLabel: { fontSize: 15, fontWeight: '600', color: t.textPrimary },
    settingsEntryChevron: { fontSize: 18, lineHeight: 22, color: t.textSecondary },

    // Settings sections: shared sub-heading above chips/rows inside a card.
    settingsFieldLabel: { fontSize: 13, fontWeight: '600', color: t.textPrimary, marginBottom: 8 },
    settingsGap: { marginTop: 16 },
    settingsCaption: { fontSize: 11, color: t.textTertiary, marginTop: 8, lineHeight: 15 },

    // Accent swatch row: 24px filled circles; the selected tile gets a 2px
    // ring (transparent when unselected). Ring uses the text token so it
    // reads in both themes; use a "flat" prop when the swatch tint is subtle.
    accentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    // Touch targets: the 24px swatch sits inside a 44px wrap so the tap area
    // meets the app-wide minimum; the selection ring stays on the wrap.
    accentSwatchWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    accentSwatchWrapSelected: { borderColor: t.textPrimary },
    accentSwatch: { width: 24, height: 24, borderRadius: 12 },

    // DATA section: honest saved-trips info row.
    dataInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dataInfoText: { fontSize: 14, color: t.textPrimary },

    // ABOUT card content.
    aboutAppName: { fontSize: 16, fontWeight: '700', color: t.textPrimary },
    aboutPurpose: { fontSize: 13, color: t.textSecondary, marginTop: 4, lineHeight: 18 },
    aboutAttribution: { fontSize: 10, color: t.textTertiary, marginTop: 10, textAlign: 'center', lineHeight: 14 },
    aboutNote: { fontSize: 11, color: t.textTertiary, marginTop: 6, lineHeight: 15 },

    // Achievements card rows: 20px circle (filled = earned, hollow = locked),
    // label + caption column, thin progress bar under locked rows.
    badgeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
    badgeDot: { width: 20, height: 20, borderRadius: 10, marginTop: 1 },
    badgeDotEarned: { backgroundColor: t.primary },
    badgeDotLocked: { borderWidth: 1.5, borderColor: t.border },
    badgeTextCol: { flex: 1 },
    badgeTitle: { fontSize: 13, fontWeight: '600', color: t.textPrimary },
    badgeCaption: { fontSize: 11, color: t.textSecondary, marginTop: 1, lineHeight: 15 },
    badgeProgressTrack: {
      height: 4,
      backgroundColor: t.border,
      borderRadius: 2,
      marginTop: 6,
      overflow: 'hidden',
    },
    badgeProgressFill: { height: 4, backgroundColor: t.primary },
    badgeEmpty: { paddingVertical: 4 },
    badgeEmptyText: { fontSize: 12, color: t.textSecondary },

    // "This week" summary row under the Lifetime Totals tiles.
    weekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
      weekRowText: { flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 18 },
    weekRowCaption: { fontSize: 11, color: t.textTertiary, marginLeft: 8, lineHeight: 15 },

    // ---------------------------------------------------------------------------
    // Settings → PREFERENCES: preferred travel mode chips reuse the
    // appearanceChip family. DASHBOARD: four on/off switch rows — the pill
    // toggle is built from Views only; the ROW is the touch target (>= 48
    // tall), checked = accent-filled track + knob pushed to the right edge.
    // ---------------------------------------------------------------------------
    dashRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dashToggleLabel: { flex: 1, fontSize: 14, color: t.textPrimary, marginRight: 8 },
    dashToggleTrack: { width: 44, height: 26, borderRadius: 13, padding: 2 },
    dashToggleTrackOff: { backgroundColor: t.border, justifyContent: 'flex-start' },
    dashToggleTrackOn: { backgroundColor: t.accent, justifyContent: 'flex-end' },
    dashToggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.onBrand },

    // Caption reused by the Saved-places entry sub-line (was referenced but
    // never defined — an ad-hoc dangling style).
    settingsEntrySub: { fontSize: 11, color: t.textTertiary, marginTop: 2, lineHeight: 15 },
  });
}

// Lazy per-(theme, accent) stylesheet cache: switching either preference just
// swaps a prebuilt sheet. Green/light and green/dark keep building the exact
// same sheets the old fixed SHEETS object produced.
const SHEET_CACHE = new Map();
export function getSheet(modeName, accentName) {
  const key = `${modeName}-${accentName}`;
  let sheet = SHEET_CACHE.get(key);
  if (!sheet) {
    sheet = makeStyles(makePalette(modeName, accentName));
    SHEET_CACHE.set(key, sheet);
  }
  return sheet;
}
