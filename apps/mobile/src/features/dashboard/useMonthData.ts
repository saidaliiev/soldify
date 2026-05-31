/**
 * useMonthData(monthKey) — synchronous DB read for the dashboard.
 *
 * Returns the monthly expense total + category breakdown for the given
 * month. Re-queries on tab focus (Phase 1 `useFocusEffect` pattern) and
 * on monthKey change. All queries are synchronous via op-sqlite executeSync,
 * so first frame is bounded only by query cost (D-27 budget < 100ms on
 * populated DB).
 *
 * Security note: never logs transaction details. Errors are surfaced as a
 * boolean + null state — no SQL, no values, no PII leaks.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  getCategoryBreakdown,
  getMonthlyExpenseTotal,
} from '@data/dashboardRepo';
import { breakdownEqual } from './dashboardEquality';
import type { CategoryBreakdown, MonthKey } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonthData = {
  readonly totalCents: number;
  readonly breakdown: CategoryBreakdown;
  readonly isLoading: boolean;
  readonly error: boolean;
  readonly refresh: () => void;
};

const EMPTY_BREAKDOWN: CategoryBreakdown = { top: [], other: null, totalExpenseCents: 0 };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMonthData(monthKey: MonthKey): MonthData {
  const [totalCents, setTotalCents] = useState<number>(0);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown>(EMPTY_BREAKDOWN);
  const [error, setError] = useState<boolean>(false);

  const load = useCallback(() => {
    try {
      const total = getMonthlyExpenseTotal(monthKey.year, monthKey.month);
      const br = getCategoryBreakdown(monthKey.year, monthKey.month);
      setTotalCents(total);
      // Keep the previous reference when the data is unchanged so the donut's
      // angle useMemo stays stable and the arc-draw does NOT replay on every
      // tab focus (getCategoryBreakdown returns a fresh object each call). A
      // no-op focus then bails out of the re-render entirely. Primitives
      // (totalCents/error) already short-circuit via React's Object.is.
      setBreakdown((prev) => (breakdownEqual(prev, br) ? prev : br));
      setError(false);
    } catch {
      // Never expose error details (T-02-01-03 — no PII / SQL fragments).
      setTotalCents(0);
      setBreakdown(EMPTY_BREAKDOWN);
      setError(true);
    }
  }, [monthKey.year, monthKey.month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return {
    totalCents,
    breakdown,
    isLoading: false,
    error,
    refresh: load,
  };
}
