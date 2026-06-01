/**
 * Unit tests for jarForecast — pure deterministic projection for the
 * "what-if" Jar Forecast Scrubber (C1 differentiator).
 *
 * Pattern: node:test + tsx (project Pattern 11; mirrors jarRingGeometry.test.ts).
 * Run via: npx tsx --test src/features/jars/jarForecast.test.ts
 *
 * Covers: completion projection (complete / stalled / on-track / beyond-horizon /
 * boundary / non-finite), normalized curve points (monotonic, clamped, crossingX),
 * and the slider range derivation. All integer cents — no float drift.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectJarCompletion,
  forecastCurvePoints,
  sliderRangeForJar,
  HORIZON_WEEKS,
  WEEK_MS,
} from './jarForecast.js';

// ---------------------------------------------------------------------------
// projectJarCompletion
// ---------------------------------------------------------------------------

test('projectJarCompletion: on-track, exact division → integer weeks + date', () => {
  // remaining 800_00, €100_00/wk → 8 weeks.
  const p = projectJarCompletion({ balanceCents: 200_00, targetCents: 1000_00, weeklyCents: 100_00, nowMs: 0 });
  assert.equal(p.status, 'on-track');
  assert.equal(p.weeks, 8);
  assert.equal(p.completionMs, 8 * WEEK_MS);
});

test('projectJarCompletion: non-divisible remainder rounds up (ceil)', () => {
  // remaining 100_00, €30_00/wk → ceil(3.33) = 4 weeks.
  const p = projectJarCompletion({ balanceCents: 0, targetCents: 100_00, weeklyCents: 30_00, nowMs: 0 });
  assert.equal(p.status, 'on-track');
  assert.equal(p.weeks, 4);
  assert.equal(p.completionMs, 4 * WEEK_MS);
});

test('projectJarCompletion: balance >= target → complete (weeks 0, date now)', () => {
  const now = 1_700_000_000_000;
  const p = projectJarCompletion({ balanceCents: 1000_00, targetCents: 1000_00, weeklyCents: 50_00, nowMs: now });
  assert.equal(p.status, 'complete');
  assert.equal(p.weeks, 0);
  assert.equal(p.completionMs, now);
});

test('projectJarCompletion: over-funded → complete', () => {
  const p = projectJarCompletion({ balanceCents: 1500_00, targetCents: 1000_00, weeklyCents: 50_00, nowMs: 0 });
  assert.equal(p.status, 'complete');
});

test('projectJarCompletion: weekly 0 → stalled (no date)', () => {
  const p = projectJarCompletion({ balanceCents: 200_00, targetCents: 1000_00, weeklyCents: 0, nowMs: 0 });
  assert.equal(p.status, 'stalled');
  assert.equal(p.weeks, null);
  assert.equal(p.completionMs, null);
});

test('projectJarCompletion: negative weekly → stalled', () => {
  const p = projectJarCompletion({ balanceCents: 200_00, targetCents: 1000_00, weeklyCents: -10_00, nowMs: 0 });
  assert.equal(p.status, 'stalled');
});

test('projectJarCompletion: tiny rate beyond horizon → beyond-horizon (weeks known, no date)', () => {
  // remaining 1000_00, €1_00/wk → 1000 weeks > 104.
  const p = projectJarCompletion({ balanceCents: 0, targetCents: 1000_00, weeklyCents: 1_00, nowMs: 0 });
  assert.equal(p.status, 'beyond-horizon');
  assert.equal(p.weeks, 1000);
  assert.equal(p.completionMs, null);
  assert.ok(p.weeks > HORIZON_WEEKS);
});

test('projectJarCompletion: non-finite inputs → stalled (never NaN date)', () => {
  assert.equal(projectJarCompletion({ balanceCents: Number.NaN, targetCents: 1000_00, weeklyCents: 50_00, nowMs: 0 }).status, 'stalled');
  assert.equal(projectJarCompletion({ balanceCents: 0, targetCents: 1000_00, weeklyCents: Number.POSITIVE_INFINITY, nowMs: 0 }).status, 'stalled');
});

// ---------------------------------------------------------------------------
// forecastCurvePoints — normalized 0..1, monotonic, crossing
// ---------------------------------------------------------------------------

function assertNormalized(points: readonly { x: number; y: number }[]): void {
  for (const pt of points) {
    assert.ok(pt.x >= 0 && pt.x <= 1, `x in [0,1]: ${pt.x}`);
    assert.ok(pt.y >= 0 && pt.y <= 1, `y in [0,1]: ${pt.y}`);
  }
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i]!.x >= points[i - 1]!.x, 'x non-decreasing');
    assert.ok(points[i]!.y >= points[i - 1]!.y - 1e-9, 'y non-decreasing');
  }
}

test('forecastCurvePoints: on-track → climb to target, crossingX in (0,1)', () => {
  const c = forecastCurvePoints({ balanceCents: 200_00, targetCents: 1000_00, weeklyCents: 100_00 });
  assert.ok(c.crossingX !== null);
  assert.ok((c.crossingX as number) > 0 && (c.crossingX as number) < 1);
  assertNormalized(c.points);
  // first point = current balance fraction (0.2); the crossing point reaches y=1.
  assert.ok(Math.abs(c.points[0]!.y - 0.2) < 1e-9, 'starts at balance/target');
  const reached = c.points.find((p) => Math.abs(p.y - 1) < 1e-9);
  assert.ok(reached, 'curve reaches the target line');
  assert.ok(Math.abs((reached as { x: number }).x - (c.crossingX as number)) < 1e-9, 'crossing point x === crossingX');
});

test('forecastCurvePoints: stalled (weekly 0) → flat line at balance fraction, no crossing', () => {
  const c = forecastCurvePoints({ balanceCents: 300_00, targetCents: 1000_00, weeklyCents: 0 });
  assert.equal(c.crossingX, null);
  assertNormalized(c.points);
  for (const pt of c.points) assert.ok(Math.abs(pt.y - 0.3) < 1e-9, 'flat at 0.3');
});

test('forecastCurvePoints: beyond-horizon → climbs but never reaches target in view', () => {
  const c = forecastCurvePoints({ balanceCents: 0, targetCents: 1000_00, weeklyCents: 1_00 });
  assert.equal(c.crossingX, null);
  assertNormalized(c.points);
  const last = c.points[c.points.length - 1]!;
  assert.ok(last.y < 1, 'does not reach target within horizon');
  assert.ok(last.y > c.points[0]!.y, 'still climbs');
});

test('forecastCurvePoints: complete → full line at top', () => {
  const c = forecastCurvePoints({ balanceCents: 1000_00, targetCents: 1000_00, weeklyCents: 50_00 });
  assertNormalized(c.points);
  for (const pt of c.points) assert.ok(Math.abs(pt.y - 1) < 1e-9, 'flat at target');
});

test('forecastCurvePoints: degenerate target <= 0 → safe full line, no throw', () => {
  const c = forecastCurvePoints({ balanceCents: 0, targetCents: 0, weeklyCents: 50_00 });
  assertNormalized(c.points);
});

// ---------------------------------------------------------------------------
// sliderRangeForJar
// ---------------------------------------------------------------------------

test('sliderRangeForJar: normal remaining → max = remaining, ~3-month default', () => {
  // remaining 800_00 → max clamp(80000, 5000, 100000) = 80000; default round(80000/12)=6667.
  const r = sliderRangeForJar({ balanceCents: 200_00, targetCents: 1000_00 });
  assert.equal(r.minCents, 0);
  assert.equal(r.maxCents, 800_00);
  assert.equal(r.defaultCents, Math.round(800_00 / 12));
  assert.ok(r.defaultCents <= r.maxCents && r.defaultCents >= 5_00);
});

test('sliderRangeForJar: tiny remaining → max floored at €50, default floored at €5', () => {
  // remaining 10_00 → max clamp(1000,5000,100000)=5000; default clamp(round(83),500,5000)=500.
  const r = sliderRangeForJar({ balanceCents: 990_00, targetCents: 1000_00 });
  assert.equal(r.maxCents, 50_00);
  assert.equal(r.defaultCents, 5_00);
});

test('sliderRangeForJar: huge remaining → max capped at €1000', () => {
  // remaining 5000_00 → max clamp(500000,5000,100000)=100000.
  const r = sliderRangeForJar({ balanceCents: 0, targetCents: 5000_00 });
  assert.equal(r.maxCents, 1000_00);
  assert.ok(r.defaultCents <= r.maxCents);
});

test('sliderRangeForJar: complete jar → still returns sane non-zero range', () => {
  const r = sliderRangeForJar({ balanceCents: 1000_00, targetCents: 1000_00 });
  assert.equal(r.minCents, 0);
  assert.ok(r.maxCents >= 50_00);
  assert.ok(r.defaultCents >= 5_00);
});

test('sliderRangeForJar: non-finite input → safe floored range, no throw', () => {
  // The Number.isFinite guard treats NaN remaining as 0 → floored bounds.
  const r = sliderRangeForJar({ balanceCents: Number.NaN, targetCents: 1000_00 });
  assert.equal(r.minCents, 0);
  assert.equal(r.maxCents, 50_00);
  assert.equal(r.defaultCents, 5_00);
});

// ---------------------------------------------------------------------------
// Curve boundary: fast plan hits the MIN_WINDOW_WEEKS floor
// ---------------------------------------------------------------------------

test('forecastCurvePoints: fast plan (weekly == remaining) → 1-week climb inside the window', () => {
  // remaining 50_00, €50_00/wk → 1 week; window floors at MIN_WINDOW so the
  // crossing stays inside the canvas with a readable tail (not pinned to 1.0).
  const c = forecastCurvePoints({ balanceCents: 0, targetCents: 50_00, weeklyCents: 50_00 });
  assert.ok(c.crossingX !== null);
  assert.ok((c.crossingX as number) > 0 && (c.crossingX as number) < 1, 'crossing inside, not at the edge');
  assertNormalized(c.points);
  assert.ok(c.points.some((p) => Math.abs(p.y - 1) < 1e-9), 'reaches the target line');
  assert.equal(
    projectJarCompletion({ balanceCents: 0, targetCents: 50_00, weeklyCents: 50_00, nowMs: 0 }).weeks,
    1,
    'projection agrees it is a 1-week plan',
  );
});
