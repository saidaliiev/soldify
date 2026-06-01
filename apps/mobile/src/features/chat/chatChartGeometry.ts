/**
 * chatChartGeometry.ts — pure geometry functions for ChatMiniChart.
 *
 * All functions are pure (no side effects, no imports from RN/Skia).
 * Extracted from the component for testability (node:test + tsx).
 *
 * Coordinate system: (0,0) = top-left of the canvas.
 */

// ---------------------------------------------------------------------------
// sparklinePath — SVG path d-string for a line sparkline
// ---------------------------------------------------------------------------

/**
 * Builds an SVG path d-string that traces the data as a polyline.
 *
 * @param values  Array of numeric values (min 2).
 * @param w       Canvas width in points.
 * @param h       Canvas height in points.
 * @param vPad    Vertical padding so the stroke doesn't clip (default 4).
 * @returns       SVG path d-string: 'M x0,y0 L x1,y1 ...'
 */
export function sparklinePath(values: readonly number[], w: number, h: number, vPad = 4): string {
  if (values.length < 2 || w <= 0 || h <= 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerH = h - vPad * 2;

  const normalize = (v: number): number =>
    range === 0 ? h / 2 : vPad + (1 - (v - min) / range) * innerH;

  const stepX = w / (values.length - 1);

  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = normalize(v);
      return i === 0 ? `M ${x.toFixed(1)},${y.toFixed(1)}` : `L ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// donutArcs — arc geometry for the donut chart
// ---------------------------------------------------------------------------

export type DonutArc = {
  startDeg: number; // Skia degrees: 0° = 3 o'clock, clockwise (y-down); 12 o'clock = -90°
  sweepDeg: number; // arc sweep in degrees (clockwise positive)
  color: string;    // token name (resolved by the component's color resolver)
  label: string;
  value: number;
};

/**
 * Computes donut slice arcs as native-render angle specs.
 *
 * Emits Skia addArc angles (startDeg / sweepDeg), NOT an SVG 'A' path string:
 * Skia 2.2.x facets SVG 'A' arcs into a polygon (the donut/jar octagon bug,
 * d239283 / 656f6ee). The component builds each path with addArc on a centered
 * oval. The donut is drawn with 2° gaps between slices.
 *
 * Angle convention: 0° = 3 o'clock, clockwise (y-down); 12 o'clock = -90°.
 * Radius/stroke are a render concern (the component owns the oval), so they are
 * NOT parameters here — the angle math is geometry-independent.
 *
 * @param slices  Array of { label, value, color } (color = token name).
 * @returns       Array of { startDeg, sweepDeg, color, label, value }, in input order.
 */
export function donutArcs(
  slices: readonly { label: string; value: number; color: string }[],
): DonutArc[] {
  if (slices.length === 0) return [];

  const total = slices.reduce((s, sl) => s + Math.abs(sl.value), 0);
  if (total === 0) return [];

  const GAP_DEG = 2;
  const usable = 360 - GAP_DEG * slices.length; // degrees available for arcs

  let currentDeg = -90; // start at 12 o'clock

  return slices.map((sl) => {
    const proportion = Math.abs(sl.value) / total;
    const sweepDeg = proportion * usable;
    const startDeg = currentDeg;
    currentDeg = startDeg + sweepDeg + GAP_DEG;

    return {
      startDeg,
      sweepDeg,
      color: sl.color,
      label: sl.label,
      value: sl.value,
    };
  });
}

// ---------------------------------------------------------------------------
// barLayout — bar chart geometry
// ---------------------------------------------------------------------------

export type BarRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: number;
};

/**
 * Computes bar rectangles for a vertical bar chart.
 *
 * @param bars   Array of { label, value }.
 * @param w      Canvas width.
 * @param h      Canvas height.
 * @param vPad   Bottom padding for labels (default 20).
 * @param hGap   Gap between bars as fraction of bar width (default 0.2).
 * @returns      Array of { x, y, w, h, label, value }.
 */
export function barLayout(
  bars: readonly { label: string; value: number }[],
  w: number,
  h: number,
  vPad = 20,
  hGap = 0.2,
): BarRect[] {
  if (bars.length === 0 || w <= 0 || h <= 0) return [];

  const maxVal = Math.max(...bars.map((b) => Math.abs(b.value)));
  if (maxVal === 0) return [];

  const innerH = h - vPad;
  const barW = (w / bars.length) * (1 - hGap);
  const gapW = (w / bars.length) * hGap;

  return bars.map((bar, i) => {
    const barH = (Math.abs(bar.value) / maxVal) * innerH;
    const x = i * (barW + gapW) + gapW / 2;
    const y = innerH - barH;
    return { x, y, w: barW, h: barH, label: bar.label, value: bar.value };
  });
}
