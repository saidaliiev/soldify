/**
 * useDigestData — synchronous DB read for the DigestCard.
 *
 * Pulls the last-7-days daily totals + current/previous month aggregates,
 * runs them through pure `digestMath` to derive:
 *   - yesterdayCents      (positive integer)
 *   - last7Days           (7-entry readonly number[])
 *   - phraseKey           (one of four `dashboard.digest_*` i18n keys)
 *   - deltaCents          (absolute cents, for the {{delta}} interpolation)
 *
 * Read happens inside `useFocusEffect` via op-sqlite executeSync so the first
 * frame is bounded only by query cost (Phase 1 Pattern + 02-01 useMonthData
 * convention).
 *
 * Security note: never logs transaction details (CLAUDE.md security rule).
 * Errors surface as a `string | null` to keep the digest card silent rather
 * than crashing the dashboard.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  getDailyExpenseTotals,
  getMonthlyExpenseTotal,
} from '@data/dashboardRepo';
import {
  buildLast7DaysSeries,
  computeMonthOverMonthDelta,
  computeYesterdayExpenseCents,
  selectDigestPhraseKey,
  type DigestPhraseKey,
} from './digestMath';
import { addMonths } from './monthMath';
import { numberArrayEqual } from './dashboardEquality';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DigestData = {
  readonly yesterdayCents: number;
  readonly last7Days: readonly number[];
  readonly phraseKey: DigestPhraseKey;
  readonly deltaCents: number;
  readonly isLoading: boolean;
  readonly error: string | null;
};

const EMPTY_SERIES: readonly number[] = [0, 0, 0, 0, 0, 0, 0] as const;

const EMPTY_DATA: DigestData = {
  yesterdayCents: 0,
  last7Days: EMPTY_SERIES,
  phraseKey: 'dashboard.digest_first_month',
  deltaCents: 0,
  isLoading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDigestData(): DigestData {
  const [data, setData] = useState<DigestData>(EMPTY_DATA);

  const load = useCallback((): void => {
    try {
      const today = new Date();

      // Sparkline window: yesterday-back-7 .. today (exclusive upper).
      // We pass `today+1day` as the exclusive upper to safely include any
      // edge timestamps near the day boundary; the math layer filters out
      // today's row from the 7-day series, but the yesterday lookup needs it
      // available.
      const lower = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - 7
      ));
      const upper = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 1
      ));
      const totals = getDailyExpenseTotals(lower.toISOString(), upper.toISOString());

      const yesterdayCents = computeYesterdayExpenseCents(today, totals);
      const last7Days = buildLast7DaysSeries(today, totals);

      // MoM compare — current month vs previous month daily-average.
      const currYear = today.getUTCFullYear();
      const currMonth = today.getUTCMonth() + 1; // 1-based
      const prev = addMonths({ year: currYear, month: currMonth }, -1);

      const currentTotal = getMonthlyExpenseTotal(currYear, currMonth);
      const prevTotal = getMonthlyExpenseTotal(prev.year, prev.month);

      const daysElapsedInCurrent = today.getUTCDate();
      // Days in the previous month via the JS Date trick: day 0 of next month
      // = last day of previous month. Use Date.UTC for DST-safety.
      const daysInPrev = new Date(Date.UTC(currYear, currMonth - 1, 0)).getUTCDate();

      const mom = computeMonthOverMonthDelta(currentTotal, prevTotal, daysElapsedInCurrent, daysInPrev);
      const phraseKey = selectDigestPhraseKey(mom.mode);

      const next: DigestData = {
        yesterdayCents,
        last7Days,
        phraseKey,
        deltaCents: Math.abs(mom.deltaCents),
        isLoading: false,
        error: null,
      };
      // Keep the previous reference when nothing changed so a no-op focus
      // re-query does not re-render the DigestCard (matches useMonthData).
      setData((prev) =>
        prev.yesterdayCents === next.yesterdayCents &&
        prev.deltaCents === next.deltaCents &&
        prev.phraseKey === next.phraseKey &&
        prev.isLoading === next.isLoading &&
        prev.error === next.error &&
        numberArrayEqual(prev.last7Days, next.last7Days)
          ? prev
          : next,
      );
    } catch {
      // Defensive: surface as silent error string; never crash the dashboard.
      setData((prev) => ({ ...prev, error: 'digest_unavailable', isLoading: false }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return data;
}
