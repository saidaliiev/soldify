# Touch-lag diagnosis — 2026-05-31

> Method: systematic-debugging Phase 1–2 (root-cause investigation, STATIC code evidence only — no
> runtime profiler has run yet). Hypotheses below are evidence-backed but UNCONFIRMED until the device
> probes in §Profiling plan produce numbers. Companion to `.planning/smoke-test-2026-05-31.md`.

## Symptom
On a physical iPhone, taps often don't register — user taps 3–4 times before a tab/button finally
responds. Month-SWIPE feels fine; TAPS stick.

## Mechanism (why swipes survive but taps stick)
In React Native, `react-native-gesture-handler` pans run on the **UI thread** and survive JS jank.
But `Pressable` / tab-bar / `onPress` handlers and React-Navigation tab presses execute on the
**JS thread**. When the JS thread is saturated, the swipe stays smooth while a tab tap is deferred or
dropped → the user taps repeatedly until the JS thread frees and one tap lands. The GlassTabBar tabs
are `Pressable`s (JS `onPress` → navigate), so every tab tap is JS-thread-bound.

## Root cause — JS-thread contention during interaction (ranked for the tiny smoke-test DB)

### H1 — Donut animation JS flood  (PRIMARY on a small DB — DB-size-independent)
`src/features/dashboard/DonutChart.tsx`
- `useAnimatedReaction(() => Math.round(progress.value*100)/100, … runOnJS(setTQuantized)(q))` — quantized
  to 2 decimals ⇒ up to ~100 `runOnJS` hops per animation, each → React `setState` → `useMemo` rebuild of
  N Skia paths via `Skia.Path.MakeFromSVGString` (DonutChart.tsx:125–171).
- Durations: `arcDraw` 760ms on mount, `arcInterpolate` 450ms per month-change (`src/design/motion.ts`).
- **Re-animation on every dashboard focus:** `useMonthData` refetches via `useFocusEffect` and
  `getCategoryBreakdown` returns a NEW object/array each call ⇒ `angles` `useMemo` gets a new reference ⇒
  the donut's `useEffect([angles,…])` replays the mount draw every time the tab regains focus, even when
  the data is unchanged (`src/features/dashboard/useMonthData.ts:46–59`, `DonutChart.tsx:88–120`).
- Net: tab-hopping back to Overview replays the 760ms `runOnJS`→setState→Skia-rebuild storm → JS thread
  saturated → tab taps defer. Independent of DB size, so it matches the ~1-row smoke-test.

### H2 — Synchronous `db.executeSync` queries  (COMPOUNDS; PRIMARY on a populated DB)
- `src/data/dashboardRepo.ts` `getMonthlyExpenseTotal` + `getCategoryBreakdown` use `db.executeSync(...)`
  → block the JS thread.
- Fired per focus/swipe: 2× in `useMonthData.load()` + 3× in `useDigestData` (getDailyExpenseTotals +
  2× getMonthlyExpenseTotal) = **5 sync queries on the JS thread**, overlapping the H1 animation window.
- Trivial on 1 row (smoke-test) → not the dominant factor THERE, but on the 5000-tx PROJECT target these
  dominate. perf-audit-2026-05-26 P1-1 independently flagged the double-query.

### Ruled out as primary
- **MonthSwiper gesture** (`src/features/dashboard/MonthSwiper.tsx:86–105`): single `Gesture.Pan()`,
  `activeOffsetX([-12,12])`, `runOnJS(applyDelta)` once per release, scoped to the month label — clean.
- **Tab bar + FAB overlays**: `GlassTabBar` and `ChatLaunchFAB` wrappers both use `pointerEvents="box-none"`
  — they don't swallow taps. **Secondary watch:** the FAB is 56×56 at bottom-right; verify its hit box
  doesn't clip the chat tab's corner on the floating bar.

## Profiling plan (device — run these to CONFIRM before any fix)

**Cheapest, most decisive first:**
1. **Reduce-Motion toggle (no code).** iOS Settings → Accessibility → Motion → Reduce Motion = ON. This makes
   `withMotion` snap `progress` to 1 instantly (no animation, no `runOnJS` flood). Re-run the smoke-test and
   tab-hop. **If the tap-lag disappears → H1 (donut flood) is confirmed as the/a dominant cause.** If lag
   persists → look to H2 / queries / something else.
2. **Tiny-DB vs populated-DB.** Repeat with a 5000-tx seed. If lag is far worse populated → H2 (sync queries)
   confirmed as the scaling contributor.
3. **Tab-hop stress.** Leave Overview → return → immediately tap a tab, ×10. If each return re-animates and
   the immediate tap sticks → confirms the focus re-animation path in H1.

**Instrumented numbers:**
4. **RN Perf Monitor** (Dev Menu → Show Perf Monitor): watch **JS FPS** during mount / month-swipe / tab-tap.
   JS FPS cratering to single digits while a tap sticks = JS-thread-block confirmed.
5. **Hermes sampling profiler** (React Native DevTools / Dev Menu → Sampling Profiler): capture during a
   month-swipe + tab-tap; look for hot frames in `MakeFromSVGString`, `setTQuantized`, `executeSync`.
6. **React DevTools Profiler:** DonutChart re-render count per swipe/focus + `getMonthlyExpenseTotal` call
   count per swipe (perf-audit probe #5 — expect the double-query).
7. **`__DEV__` timing probes** (proposed instrumentation): `console.time`/`timeEnd` around the 5 `executeSync`
   call sites and a tap-latency probe (timestamp on tab `onPressIn` vs handler execution). Durations only,
   no tx data, `__DEV__`-gated → safe under the no-PII-in-logs rule.

## Fix candidates (DO NOT implement until a probe confirms which contributor dominates)
- **H1 donut flood:**
  - Stop spurious re-animation on focus — gate the `useEffect` re-run on an actual data change (compare
    breakdown by value/key, not object reference) so returning to the tab doesn't replay the draw.
  - Reduce `runOnJS` frequency — quantize to ~0.05 (≈20 steps) or throttle the reaction.
  - Best (higher effort): drive the Skia arcs directly from the reanimated shared value (Skia↔reanimated
    interop) so per-frame geometry never round-trips to JS via `runOnJS`/`setState` at all.
  - `cancelAnimation(progress)` on unmount (perf-audit P2-4).
- **H2 sync queries:** move to async `db.execute` + await, or wrap in TanStack Query keyed by
  `[year,month]` (cache + dedupe the double-query, perf-audit P1-1); or defer via
  `InteractionManager.runAfterInteractions` until the animation settles.

## Status
Phase 1–2 complete (root cause investigated, pattern = "sync/heavy work on the JS thread during
interaction"). Phase 3 (confirm) is BLOCKED on device probes above — start with the Reduce-Motion toggle.
No fix applied yet (Iron Law: no fix without a confirmed root cause; here, without a runtime number).
