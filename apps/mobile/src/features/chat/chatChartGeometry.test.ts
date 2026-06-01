/**
 * chatChartGeometry.test.ts — tests for pure geometry functions.
 *
 * Pattern: node:test + tsx (matches project test pattern).
 * Run via: npx tsx --test src/features/chat/chatChartGeometry.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparklinePath, donutArcs, barLayout } from './chatChartGeometry';

// ---------------------------------------------------------------------------
// sparklinePath
// ---------------------------------------------------------------------------

test('sparklinePath: produces M...L path for 3 values', () => {
  const path = sparklinePath([0, 1, 0], 100, 50);
  assert.ok(path.startsWith('M '), 'Should start with M');
  assert.ok(path.includes('L '), 'Should include L');
  // Three points → M + 2 L commands = starts with M and has exactly 2 L
  const lCount = (path.match(/L /g) ?? []).length;
  assert.strictEqual(lCount, 2);
});

test('sparklinePath: handles flat data (all same value)', () => {
  const path = sparklinePath([5, 5, 5], 100, 50);
  assert.ok(path.length > 0, 'Should produce a path even for flat data');
});

test('sparklinePath: returns empty string for < 2 values', () => {
  assert.strictEqual(sparklinePath([5], 100, 50), '');
  assert.strictEqual(sparklinePath([], 100, 50), '');
});

test('sparklinePath: respects zero width/height guard', () => {
  assert.strictEqual(sparklinePath([1, 2, 3], 0, 50), '');
  assert.strictEqual(sparklinePath([1, 2, 3], 100, 0), '');
});

// ---------------------------------------------------------------------------
// donutArcs
// ---------------------------------------------------------------------------

test('donutArcs: returns correct number of arcs', () => {
  const slices = [
    { label: 'groceries', value: 100, color: 'accent' },
    { label: 'dining', value: 50, color: 'sage' },
    { label: 'transport', value: 30, color: 'textMuted' },
  ];
  const arcs = donutArcs(slices);
  assert.strictEqual(arcs.length, 3);
});

test("donutArcs: first slice starts at 12 o'clock (-90°), sweeps proportionally", () => {
  const slices = [
    { label: 'groceries', value: 100, color: 'accent' },
    { label: 'dining', value: 50, color: 'sage' },
  ];
  const arcs = donutArcs(slices);
  assert.strictEqual(arcs[0]!.startDeg, -90, "first arc starts at 12 o'clock");
  for (const arc of arcs) {
    assert.ok(Number.isFinite(arc.startDeg), 'startDeg finite');
    assert.ok(arc.sweepDeg > 0 && Number.isFinite(arc.sweepDeg), 'sweepDeg positive + finite');
  }
  // Larger value → wider sweep (proportional).
  assert.ok(arcs[0]!.sweepDeg > arcs[1]!.sweepDeg, 'bigger value sweeps wider');
});

test('donutArcs: sweeps fill 360° minus the inter-slice gaps', () => {
  const slices = [
    { label: 'a', value: 1, color: 'accent' },
    { label: 'b', value: 1, color: 'sage' },
    { label: 'c', value: 1, color: 'textMuted' },
  ];
  const arcs = donutArcs(slices);
  const totalSweep = arcs.reduce((s, a) => s + a.sweepDeg, 0);
  // 3 slices → 3 × 2° gaps; arcs fill the remaining 354°.
  assert.ok(Math.abs(totalSweep - (360 - 2 * 3)) < 1e-9, 'sweeps fill 360 minus gaps');
});

test('donutArcs: returns empty for empty slices', () => {
  assert.deepStrictEqual(donutArcs([]), []);
});

// ---------------------------------------------------------------------------
// barLayout
// ---------------------------------------------------------------------------

test('barLayout: returns correct number of bars', () => {
  const bars = [
    { label: 'A', value: 100 },
    { label: 'B', value: 80 },
    { label: 'C', value: 60 },
  ];
  const layout = barLayout(bars, 300, 100);
  assert.strictEqual(layout.length, 3);
});

test('barLayout: tallest bar has height equal to innerH', () => {
  const bars = [
    { label: 'A', value: 100 },
    { label: 'B', value: 50 },
  ];
  const layout = barLayout(bars, 200, 100, 20);
  const innerH = 100 - 20;
  assert.strictEqual(layout[0]!.h, innerH);
});

test('barLayout: returns empty for empty bars', () => {
  assert.deepStrictEqual(barLayout([], 200, 100), []);
});
