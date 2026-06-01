/**
 * SOLDI jar forecast — pure deterministic projection for the "what-if" Jar
 * Forecast Scrubber (C1 differentiator, spec 2026-06-01-jar-forecast-scrubber-design.md).
 *
 * Pure module: no React, no Skia, no Reanimated, no side effects. node:test
 * compatible. The whole point of the feature is that the math is DETERMINISTIC
 * (integer cents, no LLM) — this file is that math.
 *
 * Three responsibilities:
 * - projectJarCompletion: balance + target + weekly rate → completion date.
 * - forecastCurvePoints:  the same projection as a normalized 0..1 polyline for
 *                         the Skia curve, plus the x where it crosses the target.
 * - sliderRangeForJar:    deterministic, sparse-data-safe slider bounds + default.
 *
 * Conventions:
 * - All money in integer cents. All time in epoch ms.
 * - Non-finite / out-of-range inputs degrade safely (mirrors jarRingGeometry's
 *   guard) — a NaN must never reach the renderer as a date or a curve coordinate.
 */

/** Forecast horizon: projections beyond 2 years read as "2+ years", not a date. */
export const HORIZON_WEEKS = 104;

/** Milliseconds in one week. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Slider lower bound is always 0 €/wk (a stalled plan is a valid thing to see). */
const MIN_SLIDER_MAX_CENTS = 50_00; // never let the max collapse below €50/wk
const MAX_SLIDER_MAX_CENTS = 1000_00; // cap the lever at €1000/wk
const MIN_DEFAULT_CENTS = 5_00; // default plan never below €5/wk
const MIN_WINDOW_WEEKS = 4; // smallest x-axis window so fast plans still draw a line

// ---------------------------------------------------------------------------
// projectJarCompletion
// ---------------------------------------------------------------------------

/**
 * Projection outcome.
 * - `complete`:       balance already at/over target — weeks 0, date = now.
 * - `stalled`:        rate ≤ 0 (or non-finite input) — no date.
 * - `beyond-horizon`: reachable but past HORIZON_WEEKS — weeks known, no date.
 * - `on-track`:       reachable within horizon — weeks + completion date.
 */
export type JarProjection =
  | { readonly status: 'complete'; readonly weeks: 0; readonly completionMs: number }
  | { readonly status: 'stalled'; readonly weeks: null; readonly completionMs: null }
  | { readonly status: 'beyond-horizon'; readonly weeks: number; readonly completionMs: null }
  | { readonly status: 'on-track'; readonly weeks: number; readonly completionMs: number };

const STALLED: JarProjection = { status: 'stalled', weeks: null, completionMs: null };

/**
 * Projects when a jar reaches its target at a flat weekly contribution rate.
 *
 * @returns a discriminated projection; never throws, never returns a NaN date.
 */
export function projectJarCompletion(input: {
  readonly balanceCents: number;
  readonly targetCents: number;
  readonly weeklyCents: number;
  readonly nowMs: number;
}): JarProjection {
  const { balanceCents, targetCents, weeklyCents, nowMs } = input;

  // Non-finite guard first — a NaN must never become a date.
  if (![balanceCents, targetCents, weeklyCents, nowMs].every((n) => Number.isFinite(n))) {
    return STALLED;
  }
  if (balanceCents >= targetCents) {
    return { status: 'complete', weeks: 0, completionMs: nowMs };
  }
  if (weeklyCents <= 0) {
    return STALLED;
  }

  const remainingCents = targetCents - balanceCents;
  const weeks = Math.ceil(remainingCents / weeklyCents);

  if (weeks > HORIZON_WEEKS) {
    return { status: 'beyond-horizon', weeks, completionMs: null };
  }
  return { status: 'on-track', weeks, completionMs: nowMs + weeks * WEEK_MS };
}

// ---------------------------------------------------------------------------
// forecastCurvePoints
// ---------------------------------------------------------------------------

/** A normalized curve coordinate: x,y both in [0, 1]. */
export type ForecastPoint = { readonly x: number; readonly y: number };

/**
 * The projection as a drawable curve.
 * - `points`:    polyline in normalized space (x = time over the window,
 *                y = balance over target). Monotonic non-decreasing.
 * - `crossingX`: x where balance first reaches the target line (the completion
 *                date marker), or null when it never reaches it in view.
 */
export type ForecastCurve = {
  readonly points: readonly ForecastPoint[];
  readonly crossingX: number | null;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Builds the normalized balance-over-time curve and the target-crossing point.
 *
 * The accumulation is linear (flat weekly rate), so the curve is a straight
 * climb to the target line, then flat. x is normalized over a window sized to
 * frame the crossing with a small tail; y is normalized over the target.
 */
export function forecastCurvePoints(input: {
  readonly balanceCents: number;
  readonly targetCents: number;
  readonly weeklyCents: number;
  readonly horizonWeeks?: number;
}): ForecastCurve {
  const { balanceCents, targetCents, weeklyCents } = input;
  const horizonWeeks = input.horizonWeeks ?? HORIZON_WEEKS;

  // Degenerate / non-finite → safe full line at the top (already "done").
  if (
    ![balanceCents, targetCents, weeklyCents].every((n) => Number.isFinite(n)) ||
    targetCents <= 0
  ) {
    return { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }], crossingX: 0 };
  }

  const y0 = clamp01(balanceCents / targetCents);

  if (balanceCents >= targetCents) {
    return { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }], crossingX: 0 };
  }
  if (weeklyCents <= 0) {
    // Stalled: flat line at the current fraction, no crossing.
    return { points: [{ x: 0, y: y0 }, { x: 1, y: y0 }], crossingX: null };
  }

  const remainingCents = targetCents - balanceCents;
  const weeksToTarget = Math.ceil(remainingCents / weeklyCents);

  if (weeksToTarget > horizonWeeks) {
    // Reachable, but not within the viewable horizon — climbs without crossing.
    const yEnd = clamp01((balanceCents + weeklyCents * horizonWeeks) / targetCents);
    return { points: [{ x: 0, y: y0 }, { x: 1, y: yEnd }], crossingX: null };
  }

  // On-track: frame the crossing with a ~20% tail so the target line reads.
  const tailWeeks = Math.max(1, Math.ceil(weeksToTarget * 0.2));
  const windowWeeks = Math.min(horizonWeeks, Math.max(weeksToTarget + tailWeeks, MIN_WINDOW_WEEKS));
  const crossingX = weeksToTarget / windowWeeks;
  return { points: [{ x: 0, y: y0 }, { x: crossingX, y: 1 }, { x: 1, y: 1 }], crossingX };
}

// ---------------------------------------------------------------------------
// sliderRangeForJar
// ---------------------------------------------------------------------------

/** Deterministic slider bounds + seed value for a jar's weekly-contribution lever. */
export type SliderRange = {
  readonly minCents: 0;
  readonly maxCents: number;
  readonly defaultCents: number;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Derives the scrubber's range from the jar alone — no transaction history
 * needed (sparse-data safe). Full drag completes in ~1 week (bounded €50–€1000),
 * default seeds a ~3-month plan (floored at €5/wk).
 */
export function sliderRangeForJar(input: {
  readonly balanceCents: number;
  readonly targetCents: number;
}): SliderRange {
  const { balanceCents, targetCents } = input;
  const remainingCents =
    Number.isFinite(balanceCents) && Number.isFinite(targetCents)
      ? Math.max(0, targetCents - balanceCents)
      : 0;

  const maxCents = clamp(remainingCents, MIN_SLIDER_MAX_CENTS, MAX_SLIDER_MAX_CENTS);
  const defaultCents = clamp(Math.round(remainingCents / 12), MIN_DEFAULT_CENTS, maxCents);

  return { minCents: 0, maxCents, defaultCents };
}
