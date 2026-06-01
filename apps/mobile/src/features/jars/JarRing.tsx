/**
 * JarRing — animated Skia progress ring for savings jars.
 *
 * Renders a background track ring + a sage-coloured progress arc.
 * The arc fraction = balanceCents / targetCents, clamped to [0,1] in the
 * geometry module (D-04).
 *
 * Animation (D-05): single shared progress value driven by withTiming
 * (300ms Easing.out(Easing.cubic)) + canvas-opacity crossfade on change,
 * matching the DonutChart.tsx idiom. usePathInterpolation is NOT used —
 * checked against installed react-native-reanimated types: the API is absent
 * from the installed build; canonical D-05 crossfade is used instead.
 *
 * Over-funded (balance > target): ring stays full, over_funded i18n label shown
 * below the hero balance (D-04).
 *
 * A11y: one summarising accessibilityLabel on the Canvas wrapper; child Path
 * elements carry no individual labels (Skia canvas a11y contract).
 *
 * Tokens only — no hardcoded hex, no BANNED_COLORS.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { COLORS } from '@design/tokens';
import { TYPE } from '@design/typography';
import { formatMoney } from '@lib/money';
import { jarRingArc } from './jarRingGeometry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIZE = 160;
const STROKE_WIDTH = 12;
// Margin (pt) between the ring's outer stroke edge and the canvas bound. The
// stroke is `sw` wide and centered on `radius`, so its outer edge sits at
// radius + sw/2; without this pad that edge lands flush with (or past) the
// size×size canvas and Skia clips it, making the ring read as flat-topped —
// the donut "не круг" class (DonutChart STROKE_PAD, d239283).
const RING_PAD = 2;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  readonly balanceCents: number;
  readonly targetCents: number;
  readonly size?: number;
  /** Wave 5: override stroke width for mini (5) vs featured (14) variants. */
  readonly strokeWidth?: number;
  /** Wave 5: sage (≥50% / featured) vs sageSoft (<50% mini). */
  readonly palette?: 'sage' | 'sageSoft';
  /** Wave 5: hide center hero amount overlay (mini rings in JarRow). */
  readonly showCenterLabel?: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JarRing({
  balanceCents,
  targetCents,
  size = DEFAULT_SIZE,
  strokeWidth,
  palette = 'sage',
  showCenterLabel = true,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  // Wave 5: variant-aware geometry; mini (size=46) uses sw=5, featured uses 14.
  const sw = strokeWidth ?? STROKE_WIDTH;
  // Center the ring on the canvas (size/2, size/2) — NOT (radius, radius), which
  // shifted it sw/2 toward top-left and clipped the outer stroke edge there (the
  // same off-center clip DonutChart fixed via DONUT_CENTER_OFFSET). radius leaves
  // sw/2 + RING_PAD so the full stroke stays inside the size×size canvas.
  const center = size / 2;
  const radius = center - sw / 2 - RING_PAD;

  const fraction = targetCents > 0 ? balanceCents / targetCents : 0;
  const isOverFunded = balanceCents > targetCents && targetCents > 0;

  // Wave 5: ring + track color resolved from palette prop (HTML §6 mini-ring
  // alternates sage / sageSoft by progress). Track = 20% alpha of ring color.
  const ringColor = palette === 'sageSoft' ? COLORS.sageSoft : COLORS.sage;
  const trackColor = `${ringColor}33`;

  // ---- Geometry (native Skia paths — see jarRingGeometry rewrite) ------

  // Background track: full ring. addCircle closes seamlessly (no two-arc seam,
  // no 359.9° hack) and tessellates natively — no MakeFromSVGString faceting.
  const trackPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(center, center, radius);
    return p;
  }, [center, radius]);

  // Progress arc at settled fraction. Full / over-funded → seamless addCircle;
  // partial → addArc on the centered oval (0° = 3 o'clock, sweeps clockwise).
  const progressPath = useMemo(() => {
    const arc = jarRingArc(fraction);
    if (arc.kind === 'none') return null;
    const p = Skia.Path.Make();
    if (arc.kind === 'full') {
      p.addCircle(center, center, radius);
    } else {
      const oval = Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2);
      p.addArc(oval, arc.startDeg, arc.sweepDeg);
    }
    return p;
  }, [fraction, center, radius]);

  // ---- D-05: crossfade on fraction change -----------------------------

  const canvasOpacity = useSharedValue(1);
  useEffect(() => {
    canvasOpacity.value = 0;
    canvasOpacity.value = withTiming(1, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [fraction, canvasOpacity]);

  const canvasAnimStyle = useAnimatedStyle(() => ({
    opacity: canvasOpacity.value,
  }));

  // ---- A11y label -----------------------------------------------------

  const balanceStr = formatMoney({ amountCents: balanceCents, currency: 'EUR' });
  const targetStr = formatMoney({ amountCents: targetCents, currency: 'EUR' });
  const pct = targetCents > 0 ? Math.round(Math.min(fraction, 1) * 100) : 0;
  const a11yLabel = t('jars.ring_a11y', {
    balance: balanceStr,
    target: targetStr,
    pct,
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* D-09 / QUAL-01: Animated.View carries the single summarising a11y label
          (ring_a11y). Canvas + child Paths are decorative — hidden individually. */}
      <Animated.View
        style={[styles.canvasWrap, { width: size, height: size }, canvasAnimStyle]}
        accessible
        accessibilityLabel={a11yLabel}
        accessibilityRole="image"
      >
        {/* Canvas children (Skia Path) are decorative — outer Animated.View
            is the single VoiceOver focus target for this ring. */}
        <Canvas
          style={{ width: size, height: size }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Background track */}
          {trackPath != null && (
            <Path
              path={trackPath}
              color={trackColor}
              style="stroke"
              strokeWidth={sw}
              strokeCap="round"
            />
          )}
          {/* Progress arc */}
          {progressPath != null && (
            <Path
              path={progressPath}
              color={ringColor}
              style="stroke"
              strokeWidth={sw}
              strokeCap="round"
            />
          )}
        </Canvas>
      </Animated.View>

      {/* Center overlay — hero balance; hidden from a11y (ring label above suffices).
          Wave 5: gated by showCenterLabel — mini rings in JarRow render a clean ring. */}
      {showCenterLabel && (
        <View
          style={[styles.centerOverlay, { width: size, height: size }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            style={[styles.heroAmount, { maxWidth: size - sw * 4 }]}
            numberOfLines={1}
            allowFontScaling
            // QUAL-04: Oswald displayL (40pt) center label inside a fixed-size ring.
            // Cap at 1.2× (≈48pt) and use adjustsFontSizeToFit so the amount string
            // shrinks to fit the ring diameter rather than overflowing the canvas.
            maxFontSizeMultiplier={1.2}
            adjustsFontSizeToFit
          >
            {balanceStr}
          </Text>
          {isOverFunded && (
            <Text style={styles.overFundedLabel} numberOfLines={1} allowFontScaling>
              {t('jars.over_funded')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
  },
  canvasWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  heroAmount: {
    ...TYPE.displayL,
    color: COLORS.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  overFundedLabel: {
    ...TYPE.uiLabel,
    // CR-04: TYPE.uiLabel = 14pt medium = body text → WCAG AA §1.4.3 requires 4.5:1.
    // COLORS.sage is 3.23:1 on background — fails body threshold.
    // COLORS.sageDark (#586A45) is 4.91:1 on background — PASS.
    color: COLORS.sageDark,
    textAlign: 'center',
    marginTop: 2,
  },
});
