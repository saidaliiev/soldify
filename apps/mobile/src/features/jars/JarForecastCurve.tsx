/**
 * JarForecastCurve — Skia balance-over-time projection curve for the Jar
 * Forecast Scrubber (C1, spec 2026-06-01-jar-forecast-scrubber-design.md).
 *
 * Presentational: takes a normalized 0..1 polyline + the target-crossing x and
 * draws an area-filled climb to a dashed target line, with a marker at the
 * projected completion point.
 *
 * Native Skia path API (Skia.Path.Make + moveTo/lineTo) — same idiom as
 * Sparkline. No MakeFromSVGString (Skia 2.2.x facets 'A' arcs into a polygon,
 * d239283). Self-measures width via onLayout (Sparkline pattern); fixed height.
 *
 * Mount fade + rise via the governed MOTION.forecastDraw preset (useMotion),
 * reduce-motion aware. Decorative for a11y — the scrubber's slider carries the
 * semantic label, so the canvas is hidden from VoiceOver.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet } from 'react-native';
import { Canvas, Path, Circle, Skia, DashPathEffect } from '@shopify/react-native-skia';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { COLORS } from '@design/tokens';
import { useMotion } from '@design/useMotion';
import type { ForecastPoint } from './jarForecast';

type Props = {
  readonly points: readonly ForecastPoint[];
  readonly crossingX: number | null;
  readonly height?: number;
};

const DEFAULT_HEIGHT = 168;
const V_PAD = 14; // breathing room so the stroke / marker never clip at the edge
const STROKE_WIDTH = 3;
const TARGET_STROKE = 1.5;
const MARKER_R = 5;

export function JarForecastCurve({
  points,
  crossingX,
  height = DEFAULT_HEIGHT,
}: Props): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const { withMotion } = useMotion();
  const enter = useSharedValue(0);
  const entered = useRef(false);

  useEffect(() => {
    // One-shot mount draw-in. Guard so a withMotion identity change (e.g. a
    // reduce-motion toggle) can't replay the 620ms fade mid-interaction.
    if (entered.current) return;
    entered.current = true;
    enter.value = withMotion(1, 'forecastDraw');
  }, [enter, withMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  const onLayout = (e: LayoutChangeEvent): void => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };

  // Build the climb stroke + the area fill underneath it. y=1 (target) maps to
  // the top padding line; y=0 maps to the bottom.
  const { strokePath, fillPath } = useMemo(() => {
    const stroke = Skia.Path.Make();
    const fill = Skia.Path.Make();
    if (width <= 0 || points.length === 0) return { strokePath: stroke, fillPath: fill };

    const top = V_PAD;
    const bottom = height - V_PAD;
    const px = (x: number): number => x * width;
    const py = (y: number): number => bottom - y * (bottom - top);

    stroke.moveTo(px(points[0]!.x), py(points[0]!.y));
    for (let i = 1; i < points.length; i++) stroke.lineTo(px(points[i]!.x), py(points[i]!.y));

    fill.moveTo(px(points[0]!.x), bottom);
    for (const p of points) fill.lineTo(px(p.x), py(p.y));
    fill.lineTo(px(points[points.length - 1]!.x), bottom);
    fill.close();

    return { strokePath: stroke, fillPath: fill };
  }, [points, width, height]);

  const targetPath = useMemo(() => {
    const p = Skia.Path.Make();
    if (width > 0) {
      p.moveTo(0, V_PAD);
      p.lineTo(width, V_PAD);
    }
    return p;
  }, [width]);

  const markerX = crossingX != null && width > 0 ? crossingX * width : null;

  return (
    <Animated.View
      style={[styles.container, { height }, animStyle]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 && (
        <Canvas style={{ width, height }}>
          {/* Dashed target line. */}
          <Path path={targetPath} color={COLORS.textMuted} style="stroke" strokeWidth={TARGET_STROKE}>
            <DashPathEffect intervals={[5, 4]} />
          </Path>
          {/* Area fill under the climb (sage at low alpha — token-derived). */}
          <Path path={fillPath} color={`${COLORS.sage}1F`} style="fill" />
          {/* The climb itself. */}
          <Path
            path={strokePath}
            color={COLORS.sage}
            style="stroke"
            strokeWidth={STROKE_WIDTH}
            strokeCap="round"
            strokeJoin="round"
          />
          {/* Completion-date marker where the climb meets the target line. */}
          {markerX != null && <Circle cx={markerX} cy={V_PAD} r={MARKER_R} color={COLORS.accent} />}
        </Canvas>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
