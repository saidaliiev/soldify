# Jar Forecast Scrubber — Design Spec

> Date: 2026-06-01 · Status: APPROVED (user delegated remaining decisions via /goal; spine B+A confirmed interactively)
> Feature codename: **C1** — soldify's signature portfolio differentiator.
> Source: deep-research synthesis 2026-06-01 ([[soldify-differentiator-research-2026-06-01]]).

## Problem / Goal

soldify's UI is competent but converges on the standard 2024-25 PFM pattern (donut + ranked rows) — not distinctive. Research concluded that what makes a **design-engineer / full-stack** portfolio piece "must-hire" is **one deeply-crafted, recordable interaction** (physics, exquisite easing, sub-perceptual timing, in real code) plus a **deterministic** (not LLM-guessed) money concept, with the core action made the **hero** of its screen.

**This feature:** a tactile "what-if" forecast scrubber on the Jar Detail screen. The user drags a handle to set a **weekly contribution (€/week)**; a Skia balance-over-time **curve** climbs toward a dashed **target line**, and the point where it crosses = the **projected completion date**. Scrubbing the rate re-derives the curve and **slides the completion date** along the axis in real time, spring-eased, on the UI thread. Math is **deterministic** (pure integer-cents projection, no LLM).

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| Lever | what the handle controls | **Weekly contribution €** (`weeklyCents`). Round-up rule = informational baseline floor, not the lever. |
| Outcome | what we project | **Completion date** of this jar's goal. |
| Hero visual | how we show it | **Skia climbing curve → dashed target line**, crossing point = date marker. Curve is the **hero of Jar Detail** (replaces the large JarRing hero). |
| Placement | where it lives | `app/jars/[id].tsx`. JarRing stays in the Jars **list** (`app/(tabs)/jars.tsx`) as compact status. |
| Persistence | does scrub save? | **No (v1).** Exploration-only "what-if". A "Set as plan" persistence CTA is explicitly **out of scope / v2**. |

## Architecture (isolation — each unit one purpose, pure where possible)

```
src/features/jars/
  jarForecast.ts          ← PURE math (no React/Reanimated/Skia). The deterministic core.
  jarForecast.test.ts     ← node:test + assert (TDD; mirrors jarRingGeometry.test.ts).
  JarForecastCurve.tsx    ← Skia presentational: draws target line + curve + crossing marker from points.
  JarForecastScrubber.tsx ← gesture + state owner: drag handle → weeklyCents → derives projection → renders curve + hero date label + slider.
app/jars/[id].tsx         ← integrates <JarForecastScrubber> as the screen hero.
src/design/motion.ts      ← + forecast motion presets (additive, pure).
src/i18n/locales/{en,uk}/jars.json ← + forecast.* strings.
```

### Data flow
`getJar(id)` + `jarBalanceCents(id)` (existing, synchronous op-sqlite) → `JarForecastScrubber` holds `weeklyCents` as a Reanimated shared value (seeded from `sliderRangeForJar(...).defaultCents`) → on drag, a derived worklet/JS bridge recomputes `forecastCurvePoints(...)` + `projectJarCompletion(...)` → `JarForecastCurve` re-renders the Skia path; the hero date label cross-fades; the crossing marker springs to its new x.

## Deterministic math — `jarForecast.ts` (pure, integer cents)

```
HORIZON_WEEKS = 104   // 2 years; beyond → "2+ years"

projectJarCompletion({ balanceCents, targetCents, weeklyCents, nowMs }):
  guard non-finite / negatives → 'stalled'
  if balanceCents >= targetCents      → { status:'complete',       weeks:0,    completionMs: nowMs }
  if weeklyCents <= 0                 → { status:'stalled',        weeks:null, completionMs:null }
  weeks = ceil((targetCents - balanceCents) / weeklyCents)
  if weeks > HORIZON_WEEKS            → { status:'beyond-horizon', weeks,      completionMs:null }
  else                                → { status:'on-track',       weeks,      completionMs: nowMs + weeks*7*86400000 }

forecastCurvePoints({ balanceCents, targetCents, weeklyCents, nowMs, horizonWeeks }) → {
  points: ReadonlyArray<{ x:number; y:number }>   // x,y normalized 0..1 over [now..horizon] × [0..target]
  crossingX: number | null                        // x (0..1) where balance first reaches target; null if never within horizon
}
  - balance(week) = min(targetCents, balanceCents + weeklyCents*week), week = 0..N
  - N = min(weeksToTarget, horizonWeeks) with a small tail so the target line is visible past the crossing
  - monotonic non-decreasing, clamped at target, normalized; guards for weeklyCents<=0 (flat line) and non-finite.

sliderRangeForJar({ balanceCents, targetCents }) → { minCents:0, maxCents, defaultCents }
  remaining = max(0, targetCents - balanceCents)
  maxCents  = clamp(remaining, 50_00, 1000_00)         // full-drag completes in ~1 week, sane bounds
  defaultCents = clamp(round(remaining / 12), 5_00, maxCents)  // ~3-month default plan
```

Edge cases enumerated & tested: complete, stalled (rate 0), on-track, beyond-horizon, boundary (exactly target), non-finite/negative inputs, target ≤ 0.

## Interaction & motion (the signature "wow" beat)

- Drag the handle → `weeklyCents` updates; **light haptic on each step** (only if `expo-haptics` is in deps — verify at build; otherwise omit, no hard dependency added).
- Curve morphs to the new slope; the **crossing marker + date label spring** to the new x (Reanimated `withSpring`, governed via `useMotion`/`useMotionSnap` — NO ad-hoc literals).
- New presets in `motion.ts`: `forecastCurveMorph` (curve interpolation) + `forecastMarkerSpring` (marker/label settle). Reduce-motion (`useReduceMotion`) → instant, per existing boundary.
- 60fps on the UI thread (gesture + shared value drive Skia; mirrors DonutChart/JarRing animated-path approach).

## Design tokens & a11y (project rules are enforced)

- Colors (tokens only, no hex in components): curve = `COLORS.sage` (savings semantics); target line = `COLORS.textMuted` dashed; handle = `COLORS.accent`; surfaces/spacing/radius/shadows from tokens.
- Typography (`TYPE.*`): projected date = display/hero preset (Oswald per rules — hero numbers/large titles); "€X/нед" + captions = Manrope UI preset. No typeface mixing.
- a11y (mandatory): slider = `accessibilityRole="adjustable"` + `accessibilityValue` (now €X/wk) + `accessibilityActions` increment/decrement + label; curve wrapped in a `View` with an `accessibilityLabel` summarizing "Goal X, projected Mar 12 at €50/week". Min 44×44 tap target on the handle.
- RN primitives + `StyleSheet.create()` only; no banned values; no glass on this content surface.

## Testing strategy

- `jarForecast.test.ts` (node:test): every math branch + edge case above; curve monotonicity/clamp/normalization/crossingX. Target: deterministic, no device needed.
- Component layer: `tsc --noEmit` exit 0 + `expo lint` exit 0 (project gate; no RN component test harness — documented in STATE.md).
- Device UAT (deferred, batched into next EAS build): drag feel, haptics, 60fps, reduce-motion.

## Out of scope (YAGNI)

- Persisting the scrubbed rate / "Set as plan" (v2).
- Multi-jar or aggregate forecasting.
- LLM involvement (deterministic by design — the whole point).
- Income/irregular-contribution modeling beyond a flat weekly rate (v1 keeps the lever single + legible).

## File inventory (create / modify)

- CREATE `src/features/jars/jarForecast.ts`, `jarForecast.test.ts`, `JarForecastCurve.tsx`, `JarForecastScrubber.tsx`
- MODIFY `app/jars/[id].tsx` (hero integration), `src/design/motion.ts` (+2 presets), `src/i18n/locales/en/jars.json` + `src/i18n/locales/uk/jars.json` (+forecast strings)
