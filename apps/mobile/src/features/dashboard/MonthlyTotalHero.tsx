/**
 * MonthlyTotalHero — hero band centerpiece (label · split number · subline).
 *
 * Per HTML canon §2 (Dashboard money-shot):
 *   heroLabel (uppercase tracked, accentDeep)  →  "Spent in May"
 *   number    (Oswald displayXL, accentDeep)   →  "€2,418" + ".60" (accent, smaller)
 *   subline   (heroSubline, textMuted)         →  "€312 less than April"  (D4)
 *
 * The mantissa renders in `accentDeep`; the cents fraction renders in `accent`
 * at ~half the size, matching the canon's two-tone treatment. We format with
 * Intl.NumberFormat#format and split off the trailing two-digit fraction by hand
 * (formatToParts is undefined on iOS Hermes — see splitCurrency).
 *
 * Motion: Wave 2 heroCountUp on the integer cents value (600ms outCubic),
 * sharedMonth carry on month change. reduce-motion respected via withMotion.
 *
 * a11y: the full final amount is the accessibilityLabel (not the mid-count
 * value); cents Text is accessible={false} so screen readers read the joined
 * label once.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING } from '@design/tokens';
import { TYPE } from '@design/typography';
import { useMotion } from '@design/useMotion';
import { formatMoney } from '@lib/money';
import { quantizeCents } from './dashboardMotion';
import { formatMonthLabel } from './monthMath';
import type { MonthKey } from './types';

type Props = {
  readonly totalCents: number;
  readonly monthKey: MonthKey;
  readonly monthDirection?: number;
  readonly subline?: string | null;
  readonly locale?: string;
  readonly currency?: string;
};

type SplitParts = {
  readonly mantissa: string; // currency symbol + integer + group seps (no fraction)
  readonly fraction: string; // decimal separator + fraction digits, "" if none
};

function splitCurrency(amountMajor: number, currency: string, locale: string): SplitParts {
  // iOS Hermes does NOT implement Intl.NumberFormat#formatToParts (its Intl is
  // backed by Apple Foundation, not full ICU) — calling it returns undefined and
  // crashed TF#10 at cold start ("undefined is not a function" → RCTFatal →
  // NSException → SIGABRT). Android Hermes and Expo Go DO have it, which is why
  // this only ever surfaced in a production iOS binary. Use .format() (present on
  // every engine — see formatMoney) and split the trailing fraction by hand.
  const full = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMajor);
  // minimumFractionDigits:2 guarantees exactly two fraction digits at the end,
  // preceded by the locale decimal separator (. or ,). Capture an optional
  // trailing currency symbol/space so locales that place the symbol last are
  // tolerated (it is dropped from the split, matching the previous behaviour).
  const m = full.match(/^(.*?)([.,])(\d{2})(\D*)$/);
  if (m) {
    const head = m[1] ?? '';
    const sep = m[2] ?? '';
    const frac = m[3] ?? '';
    return { mantissa: head, fraction: `${sep}${frac}` };
  }
  // No parseable fraction (unexpected) — show the whole string, no two-tone split.
  return { mantissa: full, fraction: '' };
}

export function MonthlyTotalHero({
  totalCents,
  monthKey,
  monthDirection = 0,
  subline,
  locale = 'en-IE',
  currency = 'EUR',
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { withMotion, reduceMotion } = useMotion();

  const monthLabel = formatMonthLabel(monthKey, locale);
  const labelText = t('dashboard.hero_spent_in_label', { month: monthLabel });
  const spokenTotal = t('dashboard.total_spent_in', { month: monthLabel });

  // ---------- count-up animation (preserve Wave 2 motion) ----------
  const animatedCents = useSharedValue(0);
  const prevCentsRef = useRef(0);
  const [displayCents, setDisplayCents] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      animatedCents.value = totalCents;
      prevCentsRef.current = totalCents;
      setDisplayCents(totalCents);
      return;
    }
    animatedCents.value = prevCentsRef.current;
    animatedCents.value = withMotion(totalCents, 'heroCountUp');
    prevCentsRef.current = totalCents;
  }, [totalCents, animatedCents, withMotion, reduceMotion]);

  // ---------- sharedMonth carry on month change ----------
  const carryX = useSharedValue(0);
  const carryOpacity = useSharedValue(1);
  useEffect(() => {
    if (monthDirection === 0) return;
    carryX.value = monthDirection > 0 ? 16 : -16;
    carryOpacity.value = 0;
    carryX.value = withMotion(0, 'sharedMonth');
    carryOpacity.value = withMotion(1, 'sharedMonth');
  }, [monthKey, monthDirection, carryX, carryOpacity, withMotion]);

  const carryStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: carryX.value }],
    opacity: carryOpacity.value,
  }));

  const applyCents = useCallback(
    (raw: number) => {
      setDisplayCents((prev) => {
        const next = quantizeCents(raw, totalCents);
        return next === prev ? prev : next;
      });
    },
    [totalCents],
  );
  useAnimatedReaction(
    () => animatedCents.value,
    (raw, prev) => {
      if (raw !== prev) runOnJS(applyCents)(raw);
    },
    [applyCents],
  );

  const split = useMemo(
    () => splitCurrency(Math.abs(displayCents) / 100, currency, locale),
    [displayCents, currency, locale],
  );
  const finalFormatted = formatMoney({ amountCents: totalCents, currency }, locale);

  return (
    <Animated.View style={[styles.container, carryStyle]}>
      <Text
        style={styles.label}
        accessibilityRole="text"
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
      >
        {labelText}
      </Text>
      <View
        style={styles.amountRow}
        accessibilityRole="text"
        accessibilityLabel={`${spokenTotal}: ${finalFormatted}`}
      >
        <Animated.Text
          style={styles.mantissa}
          allowFontScaling
          maxFontSizeMultiplier={1.3}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {split.mantissa}
        </Animated.Text>
        {split.fraction.length > 0 && (
          <Animated.Text
            style={styles.fraction}
            allowFontScaling
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            accessible={false}
          >
            {split.fraction}
          </Animated.Text>
        )}
      </View>
      {subline != null && subline.length > 0 && (
        <Text
          style={styles.subline}
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          numberOfLines={2}
        >
          {subline}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: SPACING.sm,
  },
  label: {
    ...TYPE.heroLabel,
    color: COLORS.accentDeep,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs + 2,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  mantissa: {
    ...TYPE.displayXL,
    color: COLORS.accentDeep,
    fontVariant: ['tabular-nums'],
  },
  fraction: {
    ...TYPE.displayXL,
    fontSize: 30,
    lineHeight: 38,
    color: COLORS.accent,
    fontVariant: ['tabular-nums'],
    marginLeft: 2,
    marginBottom: 6,
  },
  subline: {
    ...TYPE.heroSubline,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
  },
});
