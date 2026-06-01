/**
 * SOLDI design tokens.
 *
 * Source of truth for color, gradient, typography, spacing, and radius.
 * Banned values are enforced via ESLint rule (see eslint.config.js) — never
 * introduce fintech blue, AI-slop purple/lavender, neon green, or emoji as UI
 * icons. Editorial warm palette only.
 */

export const COLORS = {
  // Surfaces — Cold Minimal: cool near-white shell, pure-white cards.
  background: '#F4F5F7', // cool near-white — app shell
  surface: '#FFFFFF', // card surface
  white: '#FFFFFF',

  // Text — graphite ramp.
  textPrimary: '#1C2024', // graphite — primary text (~14.7:1 on background)
  textSecondary: '#3F4550', // ~9:1 on background
  // Cold Minimal + WCAG gate: textMuted #5C6270 = 5.47:1 on background
  // (#F4F5F7), 6.11:1 on surface (#FFFFFF). PASS body 4.5:1 with headroom.
  // contrast.ts auditTokenPairs asserts ≥4.5.
  textMuted: '#5C6270',

  // Accents — slate-blue family.
  // Cold Minimal + WCAG gate: accent #34506E = 7.4:1 on background,
  // 8.0:1 on surface — text-safe (body + large). Donut primary, selected
  // states, CTA, FAB.
  accent: '#34506E', // primary CTA, selected states, donut, FAB
  accentSoft: '#4A678A', // donut ramp / gradient pair (decorative + large; white-on 5.8:1)
  accentDeep: '#26405C', // pressed state, shadow tint (text-safe)

  // Sage — success, savings, "money in" (cooled to sit beside slate).
  // Cold Minimal + WCAG gate: sage #4A6B5A = 5.31:1 on background — text-safe,
  // but reserve for positive amounts/graphics. sageDark is the deepest positive.
  sage: '#4A6B5A',
  sageDark: '#3F5E4D', // deeper positive — 6.45:1 on #F4F5F7 (WCAG AA body 4.5:1 ✓)
  sageSoft: '#8AA295',
  sageDeep: '#33493B',

  // States
  error: '#8A4B45', // muted warm red, never bright (white label 6.62:1 — large)
  errorSubtle: '#8A4B451A', // error @ 10% — banner backgrounds, never text
  success: '#4A6B5A', // sage-derived (5.31:1 on background)

  // Hairline / subtle border — textMuted @ 20% for surface separators and
  // ghost-pill borders. Cool slate hairline.
  borderSubtle: '#5C627033',

  // Semantic aliases (keep in sync with accent/success above)
  income: '#4A6B5A',
  expense: '#26405C', // Cold Minimal: text-safe deep slate (accentDeep)
} as const;

export const GRADIENTS = {
  primary: ['#4A678A', '#34506E'] as const, // CTA, FAB, send button — white text 5.8:1
  warm: ['#FBFBFC', '#F4F5F7'] as const, // header band (cohesive top region — cool, key name kept)
  hero: ['#F4F5F7', '#E9ECF1'] as const, // subtle full-bleed hero background (cool)
  sage: ['#6E8A78', '#4A6B5A'] as const, // positive decorative sweep
  dark: ['#1E2127', '#262A31', '#222630'] as const, // dark surfaces (dark-mode theme = future milestone; cool graphite)
} as const;

export const FONTS = {
  display: {
    family: 'Oswald',
    weights: { light: '300', medium: '500', bold: '700' },
  },
  editorial: {
    family: 'EBGaramond',
    weights: { regular: '400', italic: '400i', semibold: '600' },
  },
  ui: {
    family: 'Manrope',
    weights: { medium: '500', semibold: '600', bold: '700' },
  },
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Shadow presets. Keep opacity low (<= 0.06) to preserve the warm editorial
 * feel — no harsh shadows, no glassmorphism.
 */
export const SHADOWS = {
  card: {
    shadowColor: COLORS.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2, // Android
  },
  modal: {
    shadowColor: COLORS.textPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 6,
  },
} as const;

/**
 * Elevation scale. `card`/`modal` mirror SHADOWS; `floating` is the detached
 * glass tab bar (Wave 1). Opacity kept <= 0.12 to preserve editorial warmth.
 */
export const ELEVATION = {
  floating: {
    shadowColor: COLORS.textPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 12, // Android — above modal (6)
  },
} as const;

/**
 * Cool Liquid Glass tint layer. Used by glass.ts: `*Tint` is overlaid on the
 * native GlassView (cool wash) and IS the fill on the non-glass fallback.
 * Values are cool near-white — Cold Minimal chrome, never warm cream.
 */
export const GLASS = {
  chromeTint: '#FFFFFF', // == surface; tab bar / nav wash
  sheetTint: '#F4F5F7', // == background; bottom-sheet wash
  chromeTintAlpha: 0.15, // warm wash alpha layered OVER the BlurView — low so it doesn't wash out the frost (was 0.62, an expo-glass-effect material-tint value; review 2026-06-01)
  sheetTintAlpha: 0.2, // warm wash alpha OVER the sheet BlurView — low, keep translucency (was 0.55; review 2026-06-01)
  fallbackChromeBg: '#FFFFFF', // solid fill when blur unavailable / reduce-transparency (== surface)
  blurIntensity: 50, // expo-blur BlurView intensity (0–100); tuned on device
  blurTint: 'light', // expo-blur BlurTint; warm chromeTint overlay layered on top
} as const;

/**
 * Banned values. Importing this list in tests prevents drift.
 */
export const BANNED_COLORS = [
  '#667EEA', // AI-slop blue
  '#8B7AB8', // AI-slop purple
  '#E8E0FF', // AI-slop lavender
  '#10B981', // bright tailwind green
  '#1A73E8', // Google fintech blue
  '#2563EB', // Stripe-ish fintech blue
] as const;

export type ColorToken = keyof typeof COLORS;
export type GradientToken = keyof typeof GRADIENTS;
export type SpacingToken = keyof typeof SPACING;
export type RadiusToken = keyof typeof RADIUS;
export type ElevationToken = keyof typeof ELEVATION;
export type GlassToken = keyof typeof GLASS;
