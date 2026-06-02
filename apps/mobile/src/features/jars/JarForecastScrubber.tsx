/**
 * JarForecastScrubber — the "what-if" interaction (C1, spec
 * 2026-06-01-jar-forecast-scrubber-design.md). Drag the handle to set a weekly
 * contribution; the Skia curve + the projected completion date recompute live
 * from deterministic math (jarForecast.ts — no LLM). Exploration-only: the
 * scrubbed rate is NOT persisted to the jar (v1 scope).
 *
 * Gesture mirrors MonthSwiper: Gesture.Pan + GestureDetector, worklet onUpdate,
 * runOnJS once per quantized step (€1) so the JS thread sees bounded updates.
 * `activeOffsetX` lets vertical scroll fall through to the parent ScrollView.
 * Travel width is a shared value (read on the UI thread by the gesture worklet
 * AND the handle/fill animated styles) so the handle shows the seeded default
 * position on first layout — not only after the first drag.
 *
 * Motion note (deliberate deviation from spec §Interaction): during an active
 * drag the curve + marker track the finger DIRECTLY (the path re-derives per
 * frame — that IS the morph), rather than easing toward each new value with a
 * spring. A spring between finger and curve reads as lag on a slider; direct
 * tracking is the crisper, more "crafted" feel. The only governed animation is
 * the one-shot mount draw-in (MOTION.forecastDraw) owned by JarForecastCurve.
 *
 * A11y: the track is the single `adjustable` element with the weekly amount +
 * outcome as its value (plus numeric now/min/max) and increment/decrement
 * actions. The curve is decorative. Tokens only — no hardcoded hex.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING, RADIUS } from '@design/tokens';
import { TYPE } from '@design/typography';
import { formatMoney } from '@lib/money';
import { JarForecastCurve } from './JarForecastCurve';
import {
  projectJarCompletion,
  forecastCurvePoints,
  sliderRangeForJar,
  type JarProjection,
} from './jarForecast';

type Props = {
  readonly balanceCents: number;
  readonly targetCents: number;
  readonly locale?: string;
};

const HANDLE = 28; // visual handle diameter; tap target padded to 44 via the track height
const TRACK_HEIGHT = 44;
const STEP_CENTS = 100; // €1 lever quantization
const ACTIVE_OFFSET = 12; // px of horizontal travel before the slider claims the touch

export function JarForecastScrubber({
  balanceCents,
  targetCents,
  locale = 'en-IE',
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const range = useMemo(
    () => sliderRangeForJar({ balanceCents, targetCents }),
    [balanceCents, targetCents],
  );
  const span = Math.max(1, range.maxCents - range.minCents);
  const fractionOf = useCallback(
    (c: number): number => Math.min(1, Math.max(0, (c - range.minCents) / span)),
    [range.minCents, span],
  );

  const [weeklyCents, setWeeklyCents] = useState(range.defaultCents);
  const nowMs = useRef(Date.now()).current;

  const projection = useMemo<JarProjection>(
    () => projectJarCompletion({ balanceCents, targetCents, weeklyCents, nowMs }),
    [balanceCents, targetCents, weeklyCents, nowMs],
  );
  const curve = useMemo(
    () => forecastCurvePoints({ balanceCents, targetCents, weeklyCents }),
    [balanceCents, targetCents, weeklyCents],
  );

  // ---- slider gesture -----------------------------------------------------
  // travelW is a SHARED value: the gesture worklet and the handle/fill animated
  // styles all read it on the UI thread, so the handle paints at the seeded
  // default position on first layout (not stale at 0 until the first drag).
  const travelW = useSharedValue(0);
  const progress = useSharedValue(fractionOf(range.defaultCents)); // 0..1
  const startProgress = useSharedValue(0);
  const lastSent = useSharedValue(range.defaultCents);

  const commitWeekly = useCallback((c: number): void => setWeeklyCents(c), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Let a vertical drag fall through to the parent ScrollView; only claim
        // the touch once movement is clearly horizontal (mirrors MonthSwiper).
        .activeOffsetX([-ACTIVE_OFFSET, ACTIVE_OFFSET])
        .failOffsetY([-ACTIVE_OFFSET, ACTIVE_OFFSET])
        .onBegin(() => {
          'worklet';
          startProgress.value = progress.value;
        })
        .onUpdate((e) => {
          'worklet';
          if (travelW.value <= 0) return;
          const p = Math.min(1, Math.max(0, startProgress.value + e.translationX / travelW.value));
          progress.value = p;
          const raw = range.minCents + p * span;
          const q = Math.round(raw / STEP_CENTS) * STEP_CENTS;
          if (q !== lastSent.value) {
            lastSent.value = q;
            runOnJS(commitWeekly)(q);
          }
        }),
    [range.minCents, span, progress, startProgress, lastSent, travelW, commitWeekly],
  );

  // travelW is 0 until onLayout fires, so the seeded position can't be painted
  // on the very first frame. Gate opacity on a measured track so the handle/fill
  // appear already at the seeded default (one invisible frame) instead of
  // flashing at the far-left edge and jumping right once layout lands.
  const handleStyle = useAnimatedStyle(() => ({
    opacity: travelW.value > 0 ? 1 : 0,
    transform: [{ translateX: progress.value * travelW.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: travelW.value > 0 ? 1 : 0,
    width: progress.value * travelW.value + HANDLE / 2,
  }));

  // ---- light haptic when the projected week changes (bounded, meaningful) --
  const prevWeeks = useRef<number | null>(null);
  useEffect(() => {
    if (prevWeeks.current !== null && prevWeeks.current !== projection.weeks) {
      // Rejects on devices without a Taptic Engine (simulator) — keep inert.
      void Haptics.selectionAsync().catch(() => {});
    }
    prevWeeks.current = projection.weeks;
  }, [projection.weeks]);

  // ---- VoiceOver increment / decrement ------------------------------------
  const stepBy = useCallback(
    (dir: 1 | -1): void => {
      const notch = Math.max(STEP_CENTS, Math.round(span / 20));
      const next = Math.min(range.maxCents, Math.max(range.minCents, weeklyCents + dir * notch));
      const q = Math.round(next / STEP_CENTS) * STEP_CENTS;
      setWeeklyCents(q);
      progress.value = fractionOf(q);
      // Keep the drag-dedupe baseline in sync so the next drag can't drop a step.
      lastSent.value = q;
    },
    [span, range.maxCents, range.minCents, weeklyCents, progress, lastSent, fractionOf],
  );

  // ---- labels -------------------------------------------------------------
  const perWeekLabel = t('jars.forecast.per_week', {
    amount: formatMoney({ amountCents: weeklyCents, currency: 'EUR' }, locale),
  });
  const savedOfLabel = t('jars.forecast.saved_of', {
    balance: formatMoney({ amountCents: balanceCents, currency: 'EUR' }, locale),
    target: formatMoney({ amountCents: targetCents, currency: 'EUR' }, locale),
  });
  const outcome = ((): string => {
    switch (projection.status) {
      case 'complete':
        return t('jars.forecast.complete');
      case 'stalled':
        return t('jars.forecast.stalled');
      case 'beyond-horizon':
        return t('jars.forecast.beyond');
      case 'on-track': {
        const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
          new Date(projection.completionMs),
        );
        return t('jars.forecast.done_by', { date });
      }
      default: {
        // Exhaustiveness guard — a new JarProjection status becomes a compile error.
        const _exhaustive: never = projection;
        return _exhaustive;
      }
    }
  })();

  return (
    <View style={styles.container}>
      <Text style={styles.context} allowFontScaling>
        {savedOfLabel}
      </Text>
      <Text style={styles.hero} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} allowFontScaling>
        {outcome}
      </Text>

      <JarForecastCurve points={curve.points} crossingX={curve.crossingX} />

      <Text style={styles.perWeek} allowFontScaling>
        {perWeekLabel}
      </Text>

      <GestureDetector gesture={pan}>
        <View
          style={styles.track}
          onLayout={(e: LayoutChangeEvent) => {
            travelW.value = Math.max(0, Math.floor(e.nativeEvent.layout.width - HANDLE));
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('jars.forecast.a11y_label')}
          accessibilityValue={{
            now: weeklyCents,
            min: range.minCents,
            max: range.maxCents,
            text: `${perWeekLabel}. ${outcome}`,
          }}
          accessibilityActions={[
            { name: 'increment', label: t('jars.forecast.a11y_increase') },
            { name: 'decrement', label: t('jars.forecast.a11y_decrease') },
          ]}
          onAccessibilityAction={(ev) => {
            if (ev.nativeEvent.actionName === 'increment') stepBy(1);
            else if (ev.nativeEvent.actionName === 'decrement') stepBy(-1);
          }}
        >
          <View style={styles.trackBase} />
          <Animated.View style={[styles.trackFill, fillStyle]} />
          <Animated.View style={[styles.handle, handleStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: SPACING.lg,
  },
  context: {
    ...TYPE.uiLabel,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  hero: {
    ...TYPE.displayL,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  perWeek: {
    ...TYPE.uiBody,
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: SPACING.sm,
  },
  track: {
    height: TRACK_HEIGHT,
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  trackBase: {
    position: 'absolute',
    left: HANDLE / 2,
    right: HANDLE / 2,
    height: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: `${COLORS.textMuted}33`,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent,
  },
  handle: {
    position: 'absolute',
    left: 0,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: COLORS.accent,
    borderWidth: 3,
    borderColor: COLORS.white,
  },
});
