/**
 * ChatMiniChart — Skia sparkline + donut + bar in assistant bubbles.
 *
 * Token-name color resolver: maps 'accent'|'sage'|'accentSoft'|'textMuted'
 * to actual COLORS values. Unknown token names fall back to textMuted
 * (T-03-03-04 UI-side defense in depth).
 *
 * Entrance (Wave 4): governed fade-in via MOTION.chatBubbleEnter. The prior
 * doc-comment claimed a withDelay(300, withTiming 600ms) entrance that was
 * never actually implemented in code — replaced with the governed,
 * reduce-motion-aware boundary form (spec §3 "ChatMiniChart motion").
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';

import { COLORS, SPACING } from '@design/tokens';
import { TYPE } from '@design/typography';
import { useMotion } from '@design/useMotion';
import { sparklinePath, donutArcs, barLayout } from './chatChartGeometry';
import type { ChartPayload } from '@services/aiQuery';

// ---------------------------------------------------------------------------
// Token-name color resolver (T-03-03-04 + T-03-03-05)
// ---------------------------------------------------------------------------

const CHART_COLOR_RESOLVER: Record<string, string> = {
  accent: COLORS.accent,
  sage: COLORS.sage,
  accentSoft: COLORS.accentSoft,
  textMuted: COLORS.textMuted,
};

function resolveColor(token: string): string {
  return CHART_COLOR_RESOLVER[token] ?? COLORS.textMuted;
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

const SPARK_W = 240;
const SPARK_H = 48;
const SPARK_STROKE = 1.5;

function MiniSparkline({ values, color }: { values: number[]; color: string }): React.JSX.Element {
  const pathD = React.useMemo(() => sparklinePath(values, SPARK_W, SPARK_H), [values]);
  const skPath = React.useMemo(
    () => (pathD ? Skia.Path.MakeFromSVGString(pathD) : null),
    [pathD],
  );

  if (!skPath) return <View style={{ height: SPARK_H }} />;

  return (
    <Canvas style={{ width: SPARK_W, height: SPARK_H }}>
      <Path
        path={skPath}
        color={resolveColor(color)}
        style="stroke"
        strokeWidth={SPARK_STROKE}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

const DONUT_SIZE = 96;
const DONUT_RADIUS = 36;
const DONUT_STROKE = 8;

function MiniDonut({
  slices,
}: {
  slices: { label: string; value: number; color: string }[];
}): React.JSX.Element {
  const arcs = React.useMemo(() => donutArcs(slices), [slices]);
  // Top 2 slices for labels
  const top2 = [...slices].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 2);

  // Native addArc on a canvas-centered oval — NOT MakeFromSVGString, which
  // facets SVG 'A' arcs into a polygon (octagon bug, d239283 / 656f6ee).
  // Centered on DONUT_SIZE/2: the old geometry centered at (radius+stroke/2),
  // sitting the ring top-left with empty space bottom-right.
  const center = DONUT_SIZE / 2;
  const oval = React.useMemo(
    () =>
      Skia.XYWHRect(
        center - DONUT_RADIUS,
        center - DONUT_RADIUS,
        DONUT_RADIUS * 2,
        DONUT_RADIUS * 2,
      ),
    [center],
  );

  return (
    <View style={styles.donutWrap}>
      <Canvas style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        {arcs.map((arc, i) => {
          const p = Skia.Path.Make();
          p.addArc(oval, arc.startDeg, arc.sweepDeg);
          return (
            <Path
              key={i}
              path={p}
              color={resolveColor(arc.color)}
              style="stroke"
              strokeWidth={DONUT_STROKE}
              strokeCap="butt"
            />
          );
        })}
      </Canvas>
      {top2.length > 0 && (
        <View style={styles.donutLabels}>
          {top2.map((sl, i) => (
            <View key={i} style={styles.donutLabelRow}>
              <View style={[styles.donutDot, { backgroundColor: resolveColor(sl.color) }]} />
              <Text style={styles.donutLabelText} numberOfLines={1}>
                {sl.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

const BAR_W = 240;
const BAR_H = 72;
const BAR_V_PAD = 20;

function MiniBar({ bars }: { bars: { label: string; value: number }[] }): React.JSX.Element {
  const layout = React.useMemo(() => barLayout(bars, BAR_W, BAR_H, BAR_V_PAD), [bars]);

  return (
    <View>
      <Canvas style={{ width: BAR_W, height: BAR_H }}>
        {layout.map((b, i) => {
          const rect = Skia.Path.Make();
          const r = 3; // RADIUS.sm equivalent for bar tops
          rect.addRRect(
            { rect: { x: b.x, y: b.y, width: b.w, height: b.h }, rx: r, ry: r },
          );
          return <Path key={i} path={rect} color={COLORS.accent} style="fill" />;
        })}
      </Canvas>
      <View style={[styles.barLabels, { width: BAR_W }]}>
        {layout.map((b, i) => (
          <Text
            key={i}
            style={[styles.barLabel, { width: b.w, left: b.x }]}
            numberOfLines={1}
          >
            {b.label.length > 8 ? b.label.slice(0, 7) + '…' : b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ChatMiniChart (public)
// ---------------------------------------------------------------------------

type Props = {
  readonly chart: ChartPayload;
};

export function ChatMiniChart({ chart }: Props): React.JSX.Element {
  const { withMotion } = useMotion();
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    opacity.value = withMotion(1, 'chatBubbleEnter');
  }, [opacity, withMotion]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.container, animStyle]} accessible={false}>
      {chart.kind === 'sparkline' && (
        <MiniSparkline values={chart.values} color="accent" />
      )}
      {chart.kind === 'donut' && <MiniDonut slices={chart.slices} />}
      {chart.kind === 'bar' && <MiniBar bars={chart.bars} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.md,
    alignItems: 'flex-start',
  },
  donutWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  donutLabels: {
    gap: 4,
  },
  donutLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  donutDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  donutLabelText: {
    ...TYPE.uiLabel,
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  barLabels: {
    position: 'relative',
    height: BAR_V_PAD,
  },
  barLabel: {
    ...TYPE.uiLabel,
    position: 'absolute',
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
