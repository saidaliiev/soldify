/**
 * Unit tests for donutArcs — pure arc math used by DonutChart.tsx.
 *
 * Pattern: node:test + tsx (01-LEARNINGS Pattern 11).
 * Run via: npx tsx --test src/features/dashboard/donutArcs.test.ts
 *
 * Tests assert the *shape* of the output (slice count, total swept angle,
 * Other-slice color, no NaN, deterministic ordering). They do NOT assert
 * exact path string contents — Skia consumes those, and the format is an
 * implementation detail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { arcsFromSliceAngles, buildDonutArcs, computeSliceAngles } from './donutArcs.js';
import type { CategorySlice } from './types.js';

const COLOR_TEST = '#9C5B41';
const COLOR_OTHER_MUTED = '#6E695F'; // tokens.COLORS.textMuted — duplicated here as test fixture only

function makeSlice(
  id: number,
  amountCents: number,
  total: number,
  color: string = COLOR_TEST
): CategorySlice {
  return {
    categoryId: id,
    slug: `cat-${id}`,
    nameEn: `Category ${id}`,
    nameUk: `Категорія ${id}`,
    color,
    // 2026-05-26 emoji-category refactor — CategorySlice now carries an
    // emoji glyph. Fixture uses the misc 📌 pin since these synthetic rows
    // never round-trip through dashboardRepo.
    emoji: '📌',
    amountCents,
    percentage: amountCents / total,
  };
}

// ---------------------------------------------------------------------------
// buildDonutArcs: empty input
// ---------------------------------------------------------------------------

test('buildDonutArcs: empty slices returns empty array', () => {
  const result = buildDonutArcs([], null, 100, 10, 2);
  assert.deepStrictEqual(result, []);
});

// ---------------------------------------------------------------------------
// buildDonutArcs: 3 slices [50%, 30%, 20%]
// ---------------------------------------------------------------------------

test('buildDonutArcs: 3 slices — returns 3 arc paths', () => {
  const total = 1000;
  const slices: CategorySlice[] = [
    makeSlice(1, 500, total),
    makeSlice(2, 300, total),
    makeSlice(3, 200, total),
  ];
  const result = buildDonutArcs(slices, null, 100, 10, 2);
  assert.strictEqual(result.length, 3);
  for (const a of result) {
    assert.ok(typeof a.path === 'string' && a.path.length > 0, 'arc has non-empty path');
    assert.ok(!a.path.includes('NaN'), 'no NaN in path');
    assert.strictEqual(a.color, COLOR_TEST);
  }
});

// ---------------------------------------------------------------------------
// computeSliceAngles: total swept angle = 360 − gaps
// ---------------------------------------------------------------------------

test('computeSliceAngles: 3 slices [50%, 30%, 20%], gapDeg=2 → total swept = 354°', () => {
  const total = 1000;
  const slices: CategorySlice[] = [
    makeSlice(1, 500, total),
    makeSlice(2, 300, total),
    makeSlice(3, 200, total),
  ];
  const angles = computeSliceAngles(slices, null, 2);
  const sumSwept = angles.reduce((acc, a) => acc + (a.endDeg - a.startDeg), 0);
  // 360 − 3 × 2 = 354
  assert.ok(Math.abs(sumSwept - 354) < 0.001, `expected 354, got ${sumSwept}`);
});

// ---------------------------------------------------------------------------
// buildDonutArcs: with Other slice
// ---------------------------------------------------------------------------

test('buildDonutArcs: 5 top slices + Other — returns 6 arcs, Other color is muted', () => {
  const total = 100;
  const slices: CategorySlice[] = [
    makeSlice(1, 40, total),
    makeSlice(2, 20, total),
    makeSlice(3, 15, total),
    makeSlice(4, 10, total),
    makeSlice(5, 8, total),
  ];
  const other: CategorySlice = {
    categoryId: -1,
    slug: 'other',
    nameEn: 'Other',
    nameUk: 'Інше',
    color: COLOR_OTHER_MUTED,
    emoji: '📌',
    amountCents: 7,
    percentage: 7 / total,
  };
  const result = buildDonutArcs(slices, other, 100, 10, 2);
  assert.strictEqual(result.length, 6);
  const otherArc = result[result.length - 1];
  assert.ok(otherArc, 'other arc present');
  assert.strictEqual(otherArc.categoryId, 'other');
  assert.strictEqual(otherArc.color, COLOR_OTHER_MUTED);
});

// ---------------------------------------------------------------------------
// buildDonutArcs: single slice 100%
// ---------------------------------------------------------------------------

test('buildDonutArcs: single 100% slice — one full CLOSED ring (no gap notch)', () => {
  const slices: CategorySlice[] = [makeSlice(1, 1000, 1000)];
  const result = buildDonutArcs(slices, null, 100, 10, 2);
  assert.strictEqual(result.length, 1);
  const arc = result[0];
  assert.ok(arc, 'arc[0] present');
  assert.ok(!arc.path.includes('NaN'), 'no NaN');

  // A lone slice spans the whole ring — the inter-slice gap must NOT be cut
  // (it would render as an open notch at 12 o'clock). Full 360° sweep.
  const angles = computeSliceAngles(slices, null, 2);
  const sweep = angles[0]!.endDeg - angles[0]!.startDeg;
  assert.ok(Math.abs(sweep - 360) < 0.001, `expected 360, got ${sweep}`);
  // Closed circle is emitted as two semicircle arcs — a single 'A' whose
  // endpoints coincide draws nothing in SVG/Skia.
  const arcCmds = (arc.path.match(/A/g) ?? []).length;
  assert.strictEqual(arcCmds, 2, 'full ring uses two semicircle arcs');
});

// ---------------------------------------------------------------------------
// buildDonutArcs: ordering is preserved (caller supplies sorted slices)
// ---------------------------------------------------------------------------

test('buildDonutArcs: preserves input order in output', () => {
  const total = 100;
  const slices: CategorySlice[] = [
    makeSlice(7, 50, total),
    makeSlice(3, 30, total),
    makeSlice(11, 20, total),
  ];
  const result = buildDonutArcs(slices, null, 100, 10, 2);
  assert.deepStrictEqual(
    result.map((a) => a.categoryId),
    [7, 3, 11]
  );
});

// ---------------------------------------------------------------------------
// arcsFromSliceAngles: extracted arc-path generation (DRY for Wave 2 motion)
// ---------------------------------------------------------------------------

test('arcsFromSliceAngles: maps angle list to one arc per slice, color+id preserved', () => {
  const slices: CategorySlice[] = [
    makeSlice(1, 600, 1000, '#AAAAAA'),
    makeSlice(2, 400, 1000, '#BBBBBB'),
  ];
  const angles = computeSliceAngles(slices, null, 2);
  const arcs = arcsFromSliceAngles(angles, 95);
  assert.strictEqual(arcs.length, 2);
  assert.strictEqual(arcs[0]!.color, '#AAAAAA');
  assert.strictEqual(arcs[0]!.categoryId, 1);
  assert.ok(arcs[0]!.path.startsWith('M '));
});

test('arcsFromSliceAngles: empty angle list → empty arcs', () => {
  assert.deepStrictEqual([...arcsFromSliceAngles([], 95)], []);
});

test('buildDonutArcs: output unchanged after arcsFromSliceAngles extraction (no regression)', () => {
  const slices: CategorySlice[] = [
    makeSlice(1, 700, 1000, '#AAAAAA'),
    makeSlice(2, 300, 1000, '#BBBBBB'),
  ];
  const direct = buildDonutArcs(slices, null, 95, 10, 2);
  const viaAngles = arcsFromSliceAngles(computeSliceAngles(slices, null, 2), 95);
  assert.deepStrictEqual([...direct], [...viaAngles]);
});
