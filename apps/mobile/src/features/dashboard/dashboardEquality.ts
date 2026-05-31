/**
 * SOLDI dashboard — structural equality for focus-stable state.
 *
 * Pure: no React, no Skia, no DOM — node:test compatible (mirrors donutArcs.ts /
 * dashboardMotion.ts).
 *
 * Why this exists: `useMonthData` / `useDigestData` re-query on every tab focus
 * (`useFocusEffect`) and `getCategoryBreakdown` returns a FRESH object/array each
 * call. Passing that new reference into `setState` makes the donut's
 * `useMemo([breakdown.top, breakdown.other])` recompute → a new `angles` ref →
 * the arc-draw `useEffect([angles])` replays the 700ms sweep on every return to
 * the dashboard, flooding the JS thread (tap-lag) and keeping the ring from
 * settling to its true circle geometry (it reads as a polygon / open ring).
 *
 * Gating the setState behind a value-equality check lets the hook keep the
 * PREVIOUS reference when the data is unchanged, so React bails out of the
 * re-render and the donut never re-animates on a no-op focus.
 */

import type { CategoryBreakdown, CategorySlice } from './types';

/** Element-wise equality for two readonly number arrays. Pure. */
export function numberArrayEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Value equality for a category slice. Compares every field that affects the
 * donut geometry (percentage → angle), the swatch (color/emoji), the label
 * (names), and the amount. `null === null` is true; one-null is false.
 */
export function sliceEqual(a: CategorySlice | null, b: CategorySlice | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return (
    a.categoryId === b.categoryId &&
    a.slug === b.slug &&
    a.color === b.color &&
    a.emoji === b.emoji &&
    a.amountCents === b.amountCents &&
    a.percentage === b.percentage &&
    a.nameEn === b.nameEn &&
    a.nameUk === b.nameUk
  );
}

/**
 * Value equality for a category breakdown. Two breakdowns are equal when the
 * total, the ordered `top` slices, and the `other` slice all match by value —
 * i.e. nothing the donut renders has changed. Order matters (top is sorted).
 */
export function breakdownEqual(a: CategoryBreakdown, b: CategoryBreakdown): boolean {
  if (a === b) return true;
  if (a.totalExpenseCents !== b.totalExpenseCents) return false;
  if (a.top.length !== b.top.length) return false;
  for (let i = 0; i < a.top.length; i++) {
    if (!sliceEqual(a.top[i]!, b.top[i]!)) return false;
  }
  return sliceEqual(a.other, b.other);
}
