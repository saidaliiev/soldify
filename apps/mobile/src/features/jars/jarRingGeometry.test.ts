/**
 * Unit tests for jarRingGeometry — pure arc spec for the native Skia jar ring.
 *
 * Pattern: node:test + tsx (project Pattern 11).
 * Run via: npx tsx --test src/features/jars/jarRingGeometry.test.ts
 *
 * Covers D-04 invariants: fraction clamping, 12 o'clock (-90°) start angle,
 * proportional sweep, and the none/full/arc spec consumed by JarRing's
 * addCircle/addArc renderer (replaces the old MakeFromSVGString string output —
 * Skia 2.2.x faceted 'A' arcs into an octagon, d239283).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jarRingArc, JAR_RING_START_DEG } from './jarRingGeometry.js';

// ---------------------------------------------------------------------------
// Partial arc — kind, start angle, proportional sweep
// ---------------------------------------------------------------------------

test('jarRingArc: 0.5 → partial arc, 12 o\'clock start, 180° sweep', () => {
  const arc = jarRingArc(0.5);
  assert.equal(arc.kind, 'arc');
  assert.ok(arc.kind === 'arc');
  assert.equal(arc.startDeg, JAR_RING_START_DEG, 'starts at 12 o\'clock (-90°)');
  assert.equal(arc.startDeg, -90, '-90° is 12 o\'clock in Skia degrees');
  assert.equal(arc.sweepDeg, 180, '0.5 → 180°');
});

test('jarRingArc: sweep is proportional to fraction', () => {
  const quarter = jarRingArc(0.25);
  const threeQuarter = jarRingArc(0.75);
  assert.ok(quarter.kind === 'arc' && threeQuarter.kind === 'arc');
  assert.equal(quarter.sweepDeg, 90, '0.25 → 90°');
  assert.equal(threeQuarter.sweepDeg, 270, '0.75 → 270°');
});

test('jarRingArc: sweep is always a finite number (no NaN reaches the renderer)', () => {
  for (const f of [0.1, 0.5, 0.9, 0.999]) {
    const arc = jarRingArc(f);
    assert.ok(arc.kind === 'arc');
    assert.ok(Number.isFinite(arc.sweepDeg), `sweep finite for ${f}`);
  }
});

// ---------------------------------------------------------------------------
// fraction = 0 → none (track-only, no progress arc)
// ---------------------------------------------------------------------------

test('jarRingArc: 0 → none (caller renders track only)', () => {
  assert.equal(jarRingArc(0).kind, 'none');
});

// ---------------------------------------------------------------------------
// fraction ≥ 1 → full ring (addCircle)
// ---------------------------------------------------------------------------

test('jarRingArc: 1 → full ring', () => {
  assert.equal(jarRingArc(1).kind, 'full');
});

test('jarRingArc: 1.5 over-funded is clamped to full (D-04)', () => {
  assert.equal(jarRingArc(1.5).kind, 'full');
  // Over-funded and exactly-funded must be indistinguishable to the renderer.
  assert.deepEqual(jarRingArc(1.5), jarRingArc(1));
});

// ---------------------------------------------------------------------------
// Defensive: out-of-range / non-finite fractions never produce a NaN arc
// ---------------------------------------------------------------------------

test('jarRingArc: negative fraction → none', () => {
  assert.equal(jarRingArc(-0.3).kind, 'none');
});

test('jarRingArc: NaN / Infinity → none (non-finite guard, never a NaN sweep)', () => {
  // The non-finite guard runs first, so ±Infinity and NaN all short-circuit to
  // 'none' rather than reaching the clamp/sweep math.
  assert.equal(jarRingArc(Number.NaN).kind, 'none');
  assert.equal(jarRingArc(Number.POSITIVE_INFINITY).kind, 'none');
  assert.equal(jarRingArc(Number.NEGATIVE_INFINITY).kind, 'none');
});
