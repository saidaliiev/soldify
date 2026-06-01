/**
 * SOLDI jar ring geometry — Phase 4 plan 04-02 (native-render rewrite 2026-06-01).
 *
 * Pure module: no React, no Skia, no side effects. node:test compatible.
 *
 * Emits an ARC SPEC (start angle + sweep, in Skia degrees) consumed by
 * JarRing.tsx, which builds the path with the NATIVE Skia API (addCircle /
 * addArc) — NOT Skia.Path.MakeFromSVGString.
 *
 * Why the rewrite: the previous jarRingArcPath returned an SVG 'A'
 * elliptical-arc command for MakeFromSVGString. Skia 2.2.x flattens 'A'
 * commands into a coarse faceted polygon, so the full track ring rendered as
 * an octagon — the same bug fixed for DonutChart in d239283 (smoke-test
 * 2026-06-01). addCircle/addArc tessellate natively and stay smooth.
 *
 * Conventions (matching donutArcs.ts):
 * - 12 o'clock (top) start, sweeps clockwise.
 * - Skia addArc uses 0° = 3 o'clock, clockwise (y-down) → 12 o'clock = -90°.
 * - Fraction clamped to [0, 1] — over-funded jars show a full ring (D-04).
 */

// ---------------------------------------------------------------------------
// jarRingArc
// ---------------------------------------------------------------------------

/** Progress-arc start angle in Skia degrees (0° = 3 o'clock). 12 o'clock = -90°. */
export const JAR_RING_START_DEG = -90;

/**
 * Arc spec for the jar progress ring.
 * - `none`: no progress (fraction ≤ 0 / non-finite) — caller renders track only.
 * - `full`: complete or over-funded ring (fraction ≥ 1) — caller uses addCircle.
 * - `arc`:  partial progress — caller uses addArc(oval, startDeg, sweepDeg).
 */
export type JarRingArc =
  | { readonly kind: 'none' }
  | { readonly kind: 'full' }
  | { readonly kind: 'arc'; readonly startDeg: number; readonly sweepDeg: number };

/**
 * Maps a progress fraction to a native-render arc spec.
 *
 * @param fraction balanceCents / targetCents. Clamped to [0, 1] (D-04).
 * @returns        'none' | 'full' | partial arc (startDeg / sweepDeg in degrees).
 *
 * @remarks
 * Radius is intentionally NOT a parameter: native addCircle/addArc take the
 * radius at render time, so the angle math is geometry-independent and the
 * featured / mini ring variants share one spec.
 */
export function jarRingArc(fraction: number): JarRingArc {
  // Defensive: targetCents===0 path already guards in the component, but a
  // non-finite fraction must never reach the renderer as a NaN sweep.
  if (!Number.isFinite(fraction)) return { kind: 'none' };

  // D-04: clamp over-funded fraction to 1 (full ring).
  const clamped = Math.min(1, Math.max(0, fraction));

  if (clamped <= 0) return { kind: 'none' };
  if (clamped >= 1) return { kind: 'full' };

  return { kind: 'arc', startDeg: JAR_RING_START_DEG, sweepDeg: clamped * 360 };
}
