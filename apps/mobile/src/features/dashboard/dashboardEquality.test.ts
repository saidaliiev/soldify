/**
 * Unit tests for dashboardEquality — value-equality gates that keep the
 * dashboard hooks from emitting a fresh reference on a no-op focus re-query.
 *
 * Pattern: node:test + tsx (01-LEARNINGS Pattern 11).
 * Run via: npx tsx --test src/features/dashboard/dashboardEquality.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { breakdownEqual, sliceEqual, numberArrayEqual } from './dashboardEquality.js';
import type { CategoryBreakdown, CategorySlice } from './types.js';

function makeSlice(overrides: Partial<CategorySlice> = {}): CategorySlice {
  return {
    categoryId: 1,
    slug: 'coffee',
    nameEn: 'Coffee',
    nameUk: 'Кава',
    color: '#2B3A52',
    emoji: '☕',
    amountCents: 2200,
    percentage: 1,
    ...overrides,
  };
}

function makeBreakdown(overrides: Partial<CategoryBreakdown> = {}): CategoryBreakdown {
  return {
    top: [makeSlice()],
    other: null,
    totalExpenseCents: 2200,
    ...overrides,
  };
}

// ---- numberArrayEqual ------------------------------------------------------

test('numberArrayEqual: same reference is equal', () => {
  const a = [1, 2, 3];
  assert.equal(numberArrayEqual(a, a), true);
});

test('numberArrayEqual: equal contents, different reference', () => {
  assert.equal(numberArrayEqual([0, 0, 7], [0, 0, 7]), true);
});

test('numberArrayEqual: differing element', () => {
  assert.equal(numberArrayEqual([1, 2, 3], [1, 2, 4]), false);
});

test('numberArrayEqual: differing length', () => {
  assert.equal(numberArrayEqual([1, 2], [1, 2, 3]), false);
});

// ---- sliceEqual ------------------------------------------------------------

test('sliceEqual: both null', () => {
  assert.equal(sliceEqual(null, null), true);
});

test('sliceEqual: one null', () => {
  assert.equal(sliceEqual(makeSlice(), null), false);
});

test('sliceEqual: identical values, different reference', () => {
  assert.equal(sliceEqual(makeSlice(), makeSlice()), true);
});

test('sliceEqual: differing percentage (would change the arc) is not equal', () => {
  assert.equal(sliceEqual(makeSlice(), makeSlice({ percentage: 0.5 })), false);
});

test('sliceEqual: differing color is not equal', () => {
  assert.equal(sliceEqual(makeSlice(), makeSlice({ color: '#000000' })), false);
});

// ---- breakdownEqual --------------------------------------------------------

test('breakdownEqual: same reference', () => {
  const b = makeBreakdown();
  assert.equal(breakdownEqual(b, b), true);
});

test('breakdownEqual: structurally identical, fresh references (the focus re-query case)', () => {
  assert.equal(breakdownEqual(makeBreakdown(), makeBreakdown()), true);
});

test('breakdownEqual: differing total', () => {
  assert.equal(
    breakdownEqual(makeBreakdown(), makeBreakdown({ totalExpenseCents: 9999 })),
    false,
  );
});

test('breakdownEqual: differing top length', () => {
  assert.equal(
    breakdownEqual(
      makeBreakdown(),
      makeBreakdown({ top: [makeSlice(), makeSlice({ categoryId: 2, slug: 'rent' })] }),
    ),
    false,
  );
});

test('breakdownEqual: differing slice inside top', () => {
  assert.equal(
    breakdownEqual(makeBreakdown(), makeBreakdown({ top: [makeSlice({ amountCents: 1 })] })),
    false,
  );
});

test('breakdownEqual: differing other (null vs slice)', () => {
  assert.equal(
    breakdownEqual(makeBreakdown(), makeBreakdown({ other: makeSlice({ categoryId: 99 }) })),
    false,
  );
});
