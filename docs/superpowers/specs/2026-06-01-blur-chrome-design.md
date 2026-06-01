# Blur chrome — Instagram-style frosted tab bar (expo-blur) — 2026-06-01

> Design spec. Replaces the killed `expo-glass-effect` Liquid-Glass chrome with
> `expo-blur` frosted chrome. Brainstormed + approved 2026-06-01 (floating-pill
> layout, safe path). Next step after user approval: `writing-plans`.

## Problem

The app's system chrome (floating tab bar + chat bottom sheet) was built on
`expo-glass-effect@~0.1.10` — a 0.1.x **beta** native binding. It is the prime
suspect for the **TF#10 cold-start SIGABRT** (uncaught ObjC NSException, iOS
26.4.2). The current mitigation is a hard `GLASS_KILL_SWITCH = true` in
`src/lib/glassEffect.ts:67`, which forces the solid fallback on **all** devices.
So today both chrome surfaces render the opaque solid fallback — no glass at
all — and the crash suspect still ships inside the binary. The user wants the
Instagram-style frosted/translucent tab bar look.

## Goal

Frosted, translucent ("glass") **floating-pill** tab bar that reads like
Instagram's, using a **stable** library, with the mandatory premium solid
fallback intact — and as a consequence, remove the crashing beta dependency
from the build entirely.

## Approach

Use `expo-blur` (`BlurView`) — a core, battle-tested Expo module — for the
frosted material, and **remove `expo-glass-effect`** from the project. IG's own
bar is a native blur, so `BlurView` is the faithful, safe way to the look. This
sidesteps the kill-switched beta binding and removes it from the binary, which
(if `expo-glass-effect` was the TF#10 cause, as the "glass-off cold-start is OK"
evidence indicates) also closes the TF#10 crash gate.

Rejected alternatives (brainstorm): (A) re-enable native `expo-glass-effect` —
likely re-introduces the boot crash, and a boot crash cannot be rolled back via
OTA; (C) polish the solid bar only — safe but not "glass", not what was asked.

## Scope

**In scope**
- Add `expo-blur`; remove `expo-glass-effect`.
- `GlassTabBar.tsx`: glass path → `BlurView` frosted floating pill + warm tint
  overlay. Layout unchanged (floating pill, `RADIUS.pill`, `BAR_MARGIN` inset).
- `BottomSheetPrimitive.tsx`: glass path → `BlurView` behind sheet content.
  **Included only because removing `expo-glass-effect` requires it** — this
  component also calls `getGlassEffect()`. (Descope lever: see Open Decisions.)
- Replace `src/lib/glassEffect.ts` (expo-glass-effect gate + kill switch) with a
  blur boundary: a thin module exposing the `BlurView` reference + a
  blur-availability check. Single-boundary hygiene retained (screens never
  import `expo-blur` directly — they consume the chrome components).
- `glass.ts`: `resolveTabBarChrome` / `resolveSheetChrome` return blur params
  (`intensity`, `tint`, warm `tintColor`) on the glass path; solid fallback
  unchanged. Update `glass.test.ts`.
- Blur params as tokens in `tokens.ts` (`GLASS.blurIntensity`, `GLASS.blurTint`).

**Out of scope**
- Tap-sticking / JS-thread perf (tracked separately; needs on-device profiling).
- Donut octagon (fixed `d239283`, OTA-live, render-pending).
- Chat keyboard-open "visual garbage" layout (separate item).
- Jars icon tweak (separate item).
- Edge-to-edge bar layout (rejected — floating pill kept).
- Android blur quality tuning beyond the documented `experimentalBlurMethod`
  default; Android keeps the solid fallback by default (iOS-first portfolio app).

## Components & files

| File | Change |
|---|---|
| `apps/mobile/package.json` | `+expo-blur` (via `expo install`), `−expo-glass-effect` |
| `src/lib/glassEffect.ts` | Delete; replaced by `src/lib/blurChrome.ts` (blur reference + `isBlurSafe()`: `iOS && !reduceTransparency`) |
| `src/design/glass.ts` | Glass-path branches return blur params instead of `glassEffectStyle`/`isInteractive`; fallback path unchanged. `composeGlassTint` kept (warm overlay) |
| `src/design/glass.test.ts` | Update assertions to the blur param shape |
| `src/design/tokens.ts` | Add `GLASS.blurIntensity`, `GLASS.blurTint`; keep `GLASS.chromeTint`/`chromeTintAlpha`/`fallbackChromeBg` |
| `src/features/chrome/GlassTabBar.tsx` | Render `BlurView` (frosted) + tint overlay on glass path; solid fallback unchanged; layout unchanged |
| `src/components/BottomSheet/BottomSheetPrimitive.tsx` | Render `BlurView` behind content on glass path; solid fallback unchanged |

## Data flow

1. Chrome component reads the RN boundary: `isBlurSafe()` (`Platform.OS === 'ios'
   && !AccessibilityInfo reduce-transparency`).
2. Pure `glass.ts` decides: blur path (params) vs solid fallback.
3. Component renders `BlurView` (frosted material) with a warm tint overlay
   (`composeGlassTint(GLASS.chromeTint, GLASS.chromeTintAlpha)`) for SOLDI
   identity, OR the existing opaque solid fill + `ELEVATION.floating` shadow.

## Fallback (mandatory, unchanged contract)

Android, reduce-transparency, or non-iOS → opaque warm solid fill +
`ELEVATION.floating` (tab bar) / `SHADOWS.modal` (sheet). Never an empty or
transparent bar. This is the path that ships today; it is preserved verbatim.

## Design tokens & blur params

- `tint`: light/neutral frosted (IG-like). Candidate `GLASS.blurTint = 'light'`
  (iOS), tuned on device.
- `intensity`: `GLASS.blurIntensity ≈ 50` (0–100), tuned on device.
- Warm identity overlay: existing `GLASS.chromeTint` @ `chromeTintAlpha` layered
  over the blur so SOLDI stays warm, not iOS-default cold.
- Chrome-only (CLAUDE.md): blur on tab bar + sheet **chrome** ONLY, never on
  content surfaces (lists, cards, chat bubbles). No hardcoded hex — tokens only.

## Testing / verification

- `glass.test.ts` updated; `node:test` suite green for the pure module.
- Gate: `tsc --noEmit` 0, `expo lint` 0.
- **Native dep change → NOT OTA-safe. Requires a new EAS build (user runs;
  `eas build` is deny-gated for the agent) → TestFlight.**
- On-device: verify frosted bar over scrolled content on iOS 26; verify solid
  fallback unaffected (reduce-transparency ON; Android); verify **cold start no
  longer crashes** (TF#10 gate) now that `expo-glass-effect` is absent.

## Risks

- **Android blur**: `expo-blur` Android path is weaker/experimental → Android
  intentionally keeps the solid fallback (acceptable; iOS-first app).
- **New build required**: no OTA; depends on the user running `eas build` +
  shipping a TestFlight build. EAS build quota applies (batch other native
  changes if any).
- **TF#10 attribution unconfirmed**: removing `expo-glass-effect` *should* close
  the crash gate if glass was the cause; if the new build still cold-crashes,
  the NSException root cause lies elsewhere and needs the Sentry reason-string /
  build dSYM (tracked in memory `tf10-crash-investigation`).

## Open decisions (for spec review)

1. **Bottom sheet**: convert it to blur now (full dep removal, recommended), or
   keep `expo-glass-effect` dormant and convert only the tab bar (smaller diff,
   but crash suspect stays in the binary and TF#10 gate stays open)?
2. **Blur tint/intensity** final values — tune on device after first build.
