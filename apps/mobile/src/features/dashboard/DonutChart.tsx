/**
 * DonutChart — Skia arc breakdown of the month's expenses (UI-SPEC §DonutChart).
 *
 * Visual:
 *   200×200pt canvas, 10pt stroke, 2pt slice gap, round caps.
 *   Center label: monthly total by default; morphs to category name + amount
 *   + percentage on slice tap (D-04, 200ms opacity + translateY).
 *
 * Animation on month change (D-05 — CLOSED, redesign Wave 2): arc slices are
 * interpolated in ANGLE space keyed by stable categoryId (dashboardMotion.
 * interpolateSliceAngles) and rebuilt to Skia paths per frame. First mount
 * sweeps every slice in (MOTION.arcDraw 700ms); each month change morphs
 * matched slices and grows/collapses enter/exit slices (MOTION.arcInterpolate
 * 450ms). reduce-motion → final arcs immediately. Hit-testing uses the
 * settled target angles, not the mid-animation geometry.
 *
 * Hit-testing: each canvas tap location is converted to polar angle relative
 * to canvas center; the corresponding slice id is resolved from the cached
 * angle list.
 *
 * Performance budget (D-27, QUAL-06): donut first frame < 100ms on populated
 * DB. We log `console.time('donut-first-frame')` / `console.timeEnd` only
 * inside __DEV__ (T-02-01-03 — no PII; informational only).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING } from '@design/tokens';
import { TYPE } from '@design/typography';
import { formatMoney } from '@lib/money';
import { localizedCategoryName } from '@data/categoriesRepo';
import { markFirstFrame } from '@lib/perf';
import { computeSliceAngles, arcsFromSliceAngles, type SliceAngle } from './donutArcs';
import { interpolateSliceAngles, staggeredProgress } from './dashboardMotion';
import { useMotion } from '@design/useMotion';
import type { CategoryBreakdown, CategorySlice } from './types';

const CANVAS_SIZE = 200;
// Sprint E1 follow-up — donut weight. 10pt looked thin against the new larger
// hero band; +40% (→14pt) gives the ring enough presence to anchor the page.
const STROKE_WIDTH = 14;
const GAP_DEG = 2;
// Task 10 Step 1 — mount stagger overlap. 0=fully sequential (too mechanical
// the other way), 1=simultaneous (the pre-Task-10 behavior). 0.55 keeps slices
// clearly leading one another while overlapping enough to read as one fluid
// sweep, not a discrete march. Mount-draw only; month-change stays global.
const STAGGER_OVERLAP = 0.55;
// Stroke centerline radius. The ring is STROKE_WIDTH wide and centered on this
// radius, so its outer edge sits at RADIUS + STROKE_WIDTH/2. With round caps +
// antialiasing that outer edge must stay INSIDE the 200×200 canvas or Skia clips
// it against the canvas bounds — the ring then reads as "not a full circle"
// (the STROKE_WIDTH 10→14 bump in Sprint E1 pushed the old formula's edge to
// exactly CANVAS_SIZE/2=100, i.e. flush with the boundary). STROKE_PAD keeps a
// margin so the outer edge lands at CANVAS_SIZE/2 - STROKE_PAD.
const STROKE_PAD = 3;
const RADIUS = CANVAS_SIZE / 2 - STROKE_WIDTH / 2 - STROKE_PAD;
// donutArcs centers its geometry at (radius, radius), i.e. a 2·radius bounding
// box — but the Canvas is CANVAS_SIZE square (200), so drawing raw left the ring
// centered at (90,90): its top/left outer edge fell at 90−97=−7 and got clipped
// by the canvas bounds, so the ring read as flat-topped / dented ("не круг",
// smoke-test 2026-06-01). Translate the arcs by this offset to recenter on the
// true canvas center (100,100), which also matches handleTap's (CANVAS_SIZE/2)
// hit-test origin so slice taps land on the slice actually drawn.
const DONUT_CENTER_OFFSET = CANVAS_SIZE / 2 - RADIUS;

type Props = {
  readonly breakdown: CategoryBreakdown;
  readonly monthDirection?: number;
  readonly locale?: string;
  readonly currency?: string;
};

export function DonutChart({
  breakdown,
  monthDirection = 0,
  locale = 'en-IE',
  currency = 'EUR',
}: Props): React.JSX.Element {
  // WR-07: t() for the "Total" center label so it updates on language switch
  const { t } = useTranslation();
  const totalCents = breakdown.totalExpenseCents;
  const [selectedId, setSelectedId] = useState<number | 'other' | null>(null);
  const firstFrameLogged = useRef(false);

  // ---- Arc geometry (settled target) --------------------------------------

  const angles = useMemo(
    () => computeSliceAngles(breakdown.top, breakdown.other, GAP_DEG),
    [breakdown.top, breakdown.other]
  );

  // ---- D-05: angle-space interpolation (closes deferred D-05) --------------
  // First mount: prev=[] ⇒ every slice sweeps in (MOTION.arcDraw). Each later
  // breakdown change: prev=last settled angles ⇒ matched morph + enter/exit
  // (MOTION.arcInterpolate). One mechanism, two presets. reduce-motion →
  // progress jumps to 1 (final arcs, no tween) via useMotion's instant path.
  const { withMotion } = useMotion();
  const progress = useSharedValue(0);
  const prevAnglesRef = useRef<readonly SliceAngle[]>([]);
  const lastAnglesRef = useRef<readonly SliceAngle[]>(angles);
  const mountedRef = useRef(false);
  const [tQuantized, setTQuantized] = useState(0);

  // Month/breakdown change detected during render: capture the OLD angles as
  // the morph "from", and reset progress synchronously BEFORE paint so the
  // first painted frame is the previous geometry (t=0), never a snap to new.
  if (lastAnglesRef.current !== angles) {
    prevAnglesRef.current = lastAnglesRef.current;
    lastAnglesRef.current = angles;
    setTQuantized(0);
  }

  useEffect(() => {
    const preset = mountedRef.current ? 'arcInterpolate' : 'arcDraw';
    mountedRef.current = true;
    progress.value = 0;
    progress.value = withMotion(1, preset);
    setSelectedId(null);
  }, [angles, progress, withMotion]);

  // Quantize progress to 2 decimals before crossing to JS so duplicate frames
  // skip setState; ≤7 Skia paths rebuilt per changed frame (bounded; perf
  // budget verified Wave 6 per spec R3 — post-mount, cold-start unaffected).
  useAnimatedReaction(
    () => Math.round(progress.value * 100) / 100,
    (q, prev) => {
      if (q !== prev) runOnJS(setTQuantized)(q);
    },
    [],
  );

  // Mount arc-draw is exactly the prev=[] case (file docstring: "prev=[] ⇒
  // every slice enters ⇒ the same code is the mount arc-draw"). Only there do
  // we stagger per slice; every later breakdown change keeps the GLOBAL
  // interpolate path (matched morph + enter/exit) untouched — month-change
  // must NOT stagger. reduce-motion: withMotion snaps progress→1 instantly so
  // tQuantized=1 ⇒ staggeredProgress(1,…)=1 for every slice ⇒ final arcs (no
  // tween), identical to the global path's t=1 — instant branch unaffected.
  const isMountDraw = prevAnglesRef.current.length === 0;

  const skPaths = useMemo(() => {
    if (isMountDraw) {
      const n = angles.length;
      // Each slice sweeps in on its own staggered sub-window of tQuantized.
      // interpolateSliceAngles(prev=[], angles, tSlice) grows slice i from its
      // leading edge — the established "entering" semantics, now per-slice.
      return angles.flatMap((slice, i) => {
        const tSlice = staggeredProgress(tQuantized, i, n, STAGGER_OVERLAP);
        return arcsFromSliceAngles(
          interpolateSliceAngles([], [slice], tSlice),
          RADIUS,
        ).map((a) => ({
          skPath: Skia.Path.MakeFromSVGString(a.path),
          color: a.color,
          categoryId: a.categoryId,
        }));
      });
    }
    // Month-change: GLOBAL interpolation, unchanged from Task 6.
    const interpolated = interpolateSliceAngles(
      prevAnglesRef.current,
      angles,
      tQuantized,
    );
    return arcsFromSliceAngles(interpolated, RADIUS).map((a) => ({
      skPath: Skia.Path.MakeFromSVGString(a.path),
      color: a.color,
      categoryId: a.categoryId,
    }));
  }, [angles, tQuantized, isMountDraw]);

  // Redesign Wave 2 — MOTION.sharedMonth: on month swipe the donut carries
  // with the hero (synced direction-aware translateX + opacity entrance) so
  // they read as one element moving. ±16pt per Checkpoint B. reduce-motion
  // handled by withMotion's instant path (matches the arc-draw above).
  const carryX = useSharedValue(0);
  const carryOpacity = useSharedValue(1);
  useEffect(() => {
    if (monthDirection === 0) return;
    carryX.value = monthDirection > 0 ? 16 : -16;
    carryOpacity.value = 0;
    carryX.value = withMotion(0, 'sharedMonth');
    carryOpacity.value = withMotion(1, 'sharedMonth');
  }, [breakdown, monthDirection, carryX, carryOpacity, withMotion]);

  const carryStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: carryX.value }],
    opacity: carryOpacity.value,
  }));

  // Stop any in-flight arc-draw / carry tween when the chart unmounts so a
  // half-finished sweep can't keep firing runOnJS(setTQuantized) into a
  // dead component (JS-thread hygiene; pairs with the referential-stability
  // fix in useMonthData that stops spurious re-animation on tab focus).
  useEffect(
    () => () => {
      cancelAnimation(progress);
      cancelAnimation(carryX);
      cancelAnimation(carryOpacity);
    },
    [progress, carryX, carryOpacity],
  );

  // ---- QUAL-06: Skia first-frame mark (perf.ts) ----------------------------
  // Fires once on the first render pass where the chart has data to paint.
  // markFirstFrame() is idempotent — safe across React re-renders (ref guard
  // kept for clarity, but perf.ts guards internally as well).
  // T-05-12: markFirstFrame() logs only the numeric ms — no financial data.

  if (!firstFrameLogged.current) {
    firstFrameLogged.current = true;
    // Defer one frame so the mark fires after the Skia canvas has committed,
    // not before it — gives a more accurate first-paint measurement.
    setTimeout(() => {
      markFirstFrame();
    }, 0);
  }

  // ---- D-04: tap hit-testing on the canvas ---------------------------------

  const handleTap = (x: number, y: number) => {
    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);

    // Outside the ring (with generous hit slop on both sides of the 10pt stroke)?
    if (r < RADIUS - 20 || r > RADIUS + 20) {
      setSelectedId(null);
      return;
    }

    // Compute angle in 0..360, with 0 = top, clockwise (matches donutArcs).
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;

    for (const a of angles) {
      if (deg >= a.startDeg && deg <= a.endDeg) {
        setSelectedId(a.categoryId);
        return;
      }
    }
    // Tap landed inside a gap or outside any slice — reset.
    setSelectedId(null);
  };

  // ---- Center labels -------------------------------------------------------

  const selectedSlice = useMemo<CategorySlice | null>(() => {
    if (selectedId == null) return null;
    if (selectedId === 'other') return breakdown.other;
    return breakdown.top.find((s) => s.categoryId === selectedId) ?? null;
  }, [selectedId, breakdown]);

  // Sprint E1 follow-up: the centre amount duplicates the hero band's
  // €67,695.98 (rounded to €67,696 inside the ring). Two near-identical
  // numbers on the same screen create cognitive noise. When data exists we
  // now render the LARGEST category + its share — information the hero
  // doesn't carry. The "Total €<amount>" form stays only for the truly empty
  // / no-top-category fallback so the ring never appears blank.
  const topSlice: CategorySlice | null = breakdown.top[0] ?? null;
  const topPercentLabel = topSlice
    ? `${Math.round(topSlice.percentage * 100)}%`
    : null;

  // Empty-month / no-top fallback only — hero handles the populated case.
  const totalFormatted = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Math.abs(totalCents) / 100),
    [totalCents, currency, locale],
  );

  const a11yLabel = (() => {
    const top = breakdown.top[0];
    if (top == null) return t('dashboard.donut_a11y_empty');
    const topPercent = Math.round(top.percentage * 100);
    const topAmount = formatMoney({ amountCents: top.amountCents, currency }, locale);
    return t('dashboard.donut_a11y_with_data', {
      category: localizedCategoryName(top, locale),
      amount: topAmount,
      percent: topPercent,
    });
  })();

  return (
    <Animated.View style={[styles.container, carryStyle]} accessibilityRole="image" accessibilityLabel={a11yLabel}>
      {/* D-09 / QUAL-01: Canvas + child Paths are decorative — hidden from VoiceOver.
          The outer View summarises the chart content via accessibilityLabel above. */}
      <Animated.View
        style={styles.canvasWrap}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Pressable
          onPress={(e) => handleTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          style={styles.pressable}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Canvas style={styles.canvas}>
            <Group transform={[{ translateX: DONUT_CENTER_OFFSET }, { translateY: DONUT_CENTER_OFFSET }]}>
              {skPaths.map((entry, idx) =>
                entry.skPath == null ? null : (
                  <Path
                    key={`${String(entry.categoryId)}-${idx}`}
                    path={entry.skPath}
                    color={entry.color}
                    style="stroke"
                    strokeWidth={STROKE_WIDTH}
                    strokeCap="round"
                  />
                )
              )}
            </Group>
          </Canvas>
        </Pressable>
      </Animated.View>

      <View
        style={styles.centerOverlay}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selectedSlice == null ? (
          topSlice != null && topPercentLabel != null ? (
            <>
              <Text style={styles.totalLabel} allowFontScaling>
                {t('dashboard.donut_top_label')}
              </Text>
              <Text
                style={styles.sliceName}
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {localizedCategoryName(topSlice, locale)}
              </Text>
              <Text style={styles.slicePercent} allowFontScaling>
                {topPercentLabel}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.totalLabel} allowFontScaling>
                {t('dashboard.donut_total_label')}
              </Text>
              <Text
                style={styles.totalAmount}
                allowFontScaling
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {totalFormatted}
              </Text>
            </>
          )
        ) : (
          <>
            <Text style={styles.sliceName} numberOfLines={1} ellipsizeMode="tail" allowFontScaling>
              {localizedCategoryName(selectedSlice, locale)}
            </Text>
            <Text style={styles.sliceAmount} allowFontScaling>
              {formatMoney({ amountCents: selectedSlice.amountCents, currency }, locale)}
            </Text>
            <Text style={styles.slicePercent} allowFontScaling>
              {`${Math.round(selectedSlice.percentage * 100)}%`}
            </Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    alignSelf: 'center',
    marginVertical: SPACING.md,
  },
  canvasWrap: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  },
  pressable: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  },
  canvas: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  totalLabel: {
    ...TYPE.heroLabel,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
  },
  totalAmount: {
    ...TYPE.displayL,
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  sliceName: {
    ...TYPE.displayM,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  sliceAmount: {
    ...TYPE.displayM,
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  slicePercent: {
    ...TYPE.uiLabel,
    color: COLORS.textSecondary,
  },
});
