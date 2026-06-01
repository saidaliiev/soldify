/**
 * SOLDI motion vocabulary — single source of motion truth (spec §2.1).
 *
 * Pure: NO react-native-reanimated import (node-test importable, like
 * contrast.ts). Later-wave components map these presets onto Reanimated
 * worklets; they MUST NOT invent ad-hoc durations/easings (CLAUDE.md rule).
 *
 * `easing` is a NAMED token resolved to a Reanimated Easing fn at the call
 * site (Wave 1 helper). reduce-motion: call degradeForReducedMotion() when
 * AccessibilityInfo.isReduceMotionEnabled() is true.
 */

export type EasingToken = 'outCubic' | 'inOutCubic' | 'spring' | 'linear';

export type MotionPreset = {
  readonly durationMs: number;
  readonly easing: EasingToken;
};

export type ReducedMotionPreset = {
  readonly durationMs: 0;
  readonly easing: 'linear';
  readonly reduced: true;
};

export const MOTION = {
  /** Hero total counts 0 → value on mount (MonthlyTotalHero). */
  heroCountUp: { durationMs: 720, easing: 'outCubic' }, // Task 10: +120ms longer settle reads "expensive" (decelerates, not snaps); still <1s
  /** Donut arcs draw in on first mount (DonutChart). */
  arcDraw: { durationMs: 760, easing: 'outCubic' }, // Task 10: +60ms — staggered entrance subdivides this window per slice; keeps each sub-sweep unrushed
  /** Donut arcs morph between months (closes deferred D-05). */
  arcInterpolate: { durationMs: 450, easing: 'inOutCubic' }, // Task 10: unchanged — morph already tuned, stagger does not touch interpolate path
  /** Scroll-driven FAB hide/reveal (ChatLaunchFAB). */
  fabReveal: { durationMs: 220, easing: 'outCubic' },
  /** Shared-element carry on month-swipe (hero number + donut). */
  sharedMonth: { durationMs: 340, easing: 'inOutCubic' }, // Task 10: -40ms snappier — gesture-driven carry should feel crisp/responsive, not laggy
  /** Subtle one-shot row settle on the initial transaction-list paint (Wave 3 TransactionRow; recycle-safe via useRowEnter). */
  listRowEnter: { durationMs: 260, easing: 'outCubic' },
  /** Subtle chat bubble / element enter (Wave 4; replaces the scattered ad-hoc chat withTiming literals). */
  chatBubbleEnter: { durationMs: 280, easing: 'outCubic' },
  /** Snappy press-scale feedback (Wave 4; replaces ad-hoc ~50ms press literals — fabReveal is too slow for a tap). */
  pressFeedback: { durationMs: 90, easing: 'outCubic' },
  /** Forecast viz fade + rise in on Jar Detail mount (C1 what-if scrubber). */
  forecastDraw: { durationMs: 620, easing: 'outCubic' },
  /** Bottom-sheet open (spring; Wave 5 governance — consumed by BottomSheetPrimitive). */
  sheetOpen: { durationMs: 420, easing: 'spring' },
  /** Bottom-sheet programmatic close (timing; matches W4 chat-sheet close feel). */
  sheetClose: { durationMs: 220, easing: 'outCubic' },
  /** Bottom-sheet pan-down dismiss close (timing; slightly snappier than programmatic close). */
  sheetGestureClose: { durationMs: 200, easing: 'outCubic' },
  /** Bottom-sheet snap-back after partial pan-down (spring; same governed damping as sheetOpen). */
  sheetSnapBack: { durationMs: 380, easing: 'spring' },
} as const satisfies Record<string, MotionPreset>;

export type MotionName = keyof typeof MOTION;

/**
 * Governed damping for the duration-based `'spring'` resolution (Wave 4).
 * Slightly underdamped (<1) → a soft settle with minimal overshoot for the
 * chat sheet. The reanimated boundary maps `'spring'` presets to
 * withSpring({ duration, dampingRatio: SHEET_DAMPING_RATIO }) — no
 * damping/stiffness literals in components. Pure constant, node-safe.
 */
export const SHEET_DAMPING_RATIO = 0.82;

/**
 * Collapse a preset to an instant, linear, opacity-only form for users with
 * reduce-motion enabled. Pure — returns a new object, never mutates input.
 */
export function degradeForReducedMotion(_preset: MotionPreset): ReducedMotionPreset {
  return { durationMs: 0, easing: 'linear', reduced: true };
}

/**
 * Resolve a named motion preset for the current accessibility state. Single
 * decision point: full preset when motion is allowed, the instant/linear
 * reduced preset (duration 0) when reduce-motion is enabled. Pure — delegates
 * to degradeForReducedMotion, never mutates MOTION. The reanimated boundary
 * (useMotion.ts) calls this with AccessibilityInfo.isReduceMotionEnabled().
 */
export function selectMotionPreset(
  name: MotionName,
  reduceMotionEnabled: boolean,
): MotionPreset | ReducedMotionPreset {
  return reduceMotionEnabled ? degradeForReducedMotion(MOTION[name]) : MOTION[name];
}
