# Build #12 — Device UAT Checklist

> One physical-iPhone pass that clears the entire device-verification backlog.
> Build #12 carries: **blur chrome** (native) + **C1 forecast scrubber** + **3 octagon fixes** +
> **fingerprint runtimeVersion** + all batched **redesign Waves 1–6**.
> Run after `eas build --profile testflight` → install via TestFlight. ~15 min.
>
> Mark each: ✅ pass · ❌ fail (note what you saw) · ⏭️ n/a.
> If any ❌, screen-record it (the octagon/blur bugs only show on real GPU, not emulator).

---

## 0. Cold start (regression gate — do FIRST)

Was the TF#8 / TF#10 cold-launch crash. Build #12 drops `expo-glass-effect` entirely.

- [ ] Force-quit app, cold launch from springboard — **no crash, no white/boot-error screen**
- [ ] Biometric (FaceID) gate appears on cold start (if enabled in Settings)
- [ ] Dashboard renders within ~2s after unlock
- [ ] Repeat cold launch ×2 more (crash was intermittent) — survives all 3

❌ looks like: instant crash-to-springboard, RootErrorBoundary screen, or hang on splash.

---

## 1. Blur chrome (LIVE TF#11 regression — primary reason for #12)

TF#11 showed `Unimplemented component: ExpoBlurView` (OTA shipped blur JS into a binary with no
native module). #12 has the native module + fingerprint policy so this can't recur.

- [ ] Tab bar renders as **frosted blur** — NO red `Unimplemented component: ExpoBlurView` box
- [ ] Tab bar tint reads warm/neutral (not cold grey), content scrolls visibly behind it
- [ ] Open Chat → bottom sheet chrome is blurred, content behind it shows through
- [ ] Tap each tab — no flicker / no fallback-to-solid flash on transition

❌ looks like: red error box where tab bar should be, or a flat opaque bar with no blur.

---

## 2. C1 — What-if forecast scrubber (the differentiator)

Jar Detail screen, hero component. Deterministic projection — drag the handle, watch completion
date + curve recompute live.

- [ ] Open a jar with an active savings goal → **scrubber is the hero** (top, above fold)
- [ ] Handle shows a **seeded default position on first paint** (NOT stuck at far-left until touched)
- [ ] Drag handle right → curve + "complete by" date + number recompute **following the finger** (crisp, no spring-lag)
- [ ] Drag feels **60fps** — no jank, no stutter on the curve redraw
- [ ] **Haptic tick** fires when the projected week changes (not every pixel)
- [ ] Numbers quantize to **whole € / week** steps (no jittery decimals)
- [ ] Negative / zero-balance jar → curve degrades gracefully (treats as 0 start, no NaN, no crash)
- [ ] Settings → enable Reduce Motion → reopen jar → curve appears **without** the draw-on animation, drag still works

❌ looks like: handle pinned left until first touch, laggy spring chasing the finger, no haptic, decimals flickering, curve disappears.

---

## 3. Octagon fixes ×3 (Skia faceting — native addCircle/addArc)

Donut/ring rendered via SVG-arc string faceted into an octagon on real GPU (Skia 2.2.12). Fixed to
native `addCircle`/`addArc`. **Only visible on device** — emulator + thumbnails hid it.

Use a month with **multiple categories** and a jar at a **partial %** (not 0%, not 100%) so arcs show.

- [ ] **Dashboard donut** — outer ring is a **smooth circle**, no flat octagon edges, centered
- [ ] **Jar ring** (Jars list + Jar Detail) — progress arc is a **smooth curve**, no faceting, centered in its box
- [ ] **Chat mini-donut** — ask the AI something that returns a category-breakdown chart → donut in the bubble is **smooth + centered** (not off-center, not octagon)
- [ ] All three at small AND large sizes (mini jar row vs featured jar hero) stay smooth

❌ looks like: visible straight edges / polygon on what should be a circle, or ring clipped / pushed off-center.

---

## 4. Redesign Waves 1–6 (batched — first real device look)

These shipped code-complete weeks ago, never device-verified. Quick visual sanity per surface.

- [ ] **Dashboard (W2)** — hero number count-up on load, donut arc draws in, editorial spacing reads premium
- [ ] **Transactions / Activity (W3)** — rows enter cleanly, date headers + hairlines, icon badges, no layout jump
- [ ] **Chat (W4)** — bubbles enter staggered, mini-charts render, input row + send button correct
- [ ] **Categories + Jars (W5)** — icon-badge rows, color picker ring, featured jar hero ring
- [ ] **Onboarding + Settings (W6)** — Welcome hero, page dots, Settings grouped cards + toggles
- [ ] Palette reads **Slate & Sand** (warm neutral) everywhere — no AI-slop blue/purple/lavender leak

❌ looks like: raw i18n keys (`jars.forecast.x`), wrong typeface, banned hex, broken spacing.

---

## Outcome

- All ✅ → build #12 verified → milestone close + production submit candidate.
- Any ❌ → screen-record, drop the clip path here, Claude triages (most are OTA-able JS fixes; only
  blur/native needs another build).

| Section | Result | Notes |
|---|---|---|
| 0. Cold start | | |
| 1. Blur chrome | | |
| 2. C1 scrubber | | |
| 3. Octagon ×3 | | |
| 4. Redesign W1–6 | | |
