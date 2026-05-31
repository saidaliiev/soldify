# Smoke-test findings — 2026-05-31

> Source: on-device screen recording (`ScreenRecording_05-31-2026 1-31-24 a.m._1.mp4`,
> real iPhone, iOS, 5G, 2m16s). Frames re-extractable via
> `ffmpeg -ss <sec> -i <video> -frames:v 1 out.png`.
> Analysis = read-only (this chat). Handoff for GSD executor → `/gsd:plan-phase` or `/gsd:audit-fix`.

## Flow exercised (stable, no crash)
Overview (May €22 / June empty) → month nav → Activity (filters + Tesco·Coffee) →
Transaction edit → Jars + New Jar create → Chat (Soldi). Cold start OK — TF#10 crash fix holds.

## Findings (prioritized)

### P0 — AI fully dead in build (chat + categorize)
- **Repro:** Chat → send "Test" → red bubble. Frames t=131, t=133.
- **User-visible text:**
  `[supabase] EXPO_PUBLIC_SUPABASE_URL is not set. Add it to .env / EAS build env
  (Supabase Dashboard → Project Settings → API → Project URL).`
  then `• AI is unavailable. Tap to retry.`
- **Root cause (confirmed):** `apps/mobile/eas.json` — NO build profile
  (development/preview/testflight/production) sets `EXPO_PUBLIC_SUPABASE_URL` or
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `env`. Throw at `src/lib/supabase.ts:66-71`.
  Kills both `src/services/aiQuery.ts:85` (chat) and `src/services/aiCategorize.ts:115` (auto-category).
  Works in local dev via `.env`, dead in every EAS build.
- **Fix (split):**
  - *Code:* add the two `EXPO_PUBLIC_SUPABASE_*` keys to `preview`/`testflight`/`production` env in `eas.json`.
  - *Human (DEFERRED — "потом"):* supply URL + anon value (anon key is public-by-design, safe to embed —
    `EXPO_PUBLIC_*` is bundled into JS anyway). AND confirm the Supabase Edge Function is deployed with
    `ANTHROPIC_API_KEY` in project secrets — else chat fails one layer deeper after the env fix.

### P1 — raw developer error string leaked to chat UI
- The `[supabase] … Supabase Dashboard → Project Settings → API` text is a raw `Error.message`
  from `src/lib/supabase.ts:68-69`, rendered verbatim in the chat error bubble.
- **Fix:** catch in the chat consumer (`aiQuery` call site / chat screen) must map any failure to the
  clean `AI is unavailable. Tap to retry.` only — never surface `Error.message`. Internal-config leak + unfriendly.

### P1 — donut ring not whole ("circle не целостный")
- **Repro:** Overview "LARGEST" donut. Frames t=9, t=13 (full-res crop confirms).
- **Symptom:** ring is **open at the top** — flat horizontal gap/notch at 12 o'clock; arc endpoints have
  butt caps that don't close. With one category (Coffee = 100% of €22) the ring should be a closed circle.
- **NOT** the old edge-clip bug (commit `4629363` STROKE_PAD — that's fixed and holds). This is arc
  **sweep/line-cap**: sweepAngle < 360° or start/end seam with `StrokeCap.Butt`.
- **Fix direction:** when single category = 100%, draw a full `Circle` (Skia) instead of an arc; OR
  guarantee 360° sweep with `StrokeCap.Round`/closed path. Check the Skia donut component
  (largest-expense ring on Overview).

### P1 — touch-sticking / dead taps (user-reported, perf)
- **User report:** "когда я нажимал несколько раз обратного эффекта никакого — после 3-4 нажатий только
  открывалось." Taps don't register; nav opens only after 3–4 presses.
- Cross-ref known issue: touch-lag (claude-mem S1080). Not directly visible in recording (iOS screen-record
  hides touch points) — needs **on-device profiling**.
- **Investigation leads:** Skia donut canvas re-rendering blocking JS thread on Overview; reanimated/
  worklets jank; gesture-handler / FlashList swallowing taps; JS thread blocked during month recompute.
  Tools: Hermes sampling profiler, RN perf monitor, isolate by temporarily removing the Skia donut.

### P1 — back-title leaks router group `(tabs)`
- **Repro:** Transaction edit screen, top-left back button reads `‹ (tabs)`. Frame t=37.
- expo-router group segment leaking as back title. **Fix:** set explicit `headerBackTitle` / title on the
  Transaction route (chevron-only or "Overview").

### P2 — Activity list bottom-anchored
- **Repro:** Activity tab, single Tesco transaction floats at screen bottom with large empty gap under the
  All/Income/Expenses chips. Frame t=30. **Fix:** top-align list under filter chips.

## Ruled OUT (do not chase)
- Dark grid panels / floating gray+black circles = iOS **AssistiveTouch** (user's accessibility tool), not app.
- "Mau 2026" / date "2020-…" = contact-sheet blur. Real values correct: **"May 2026"**, **"2026-05-16"**.
- Donut **edge-clip** (`4629363`) and **chat-button-behind-tabbar** (`f82ec6b`) — both fixed, hold.

## Owner split
| Finding | Code (executor) | Human (deferred) |
|---|---|---|
| P0 AI env | wire `eas.json` keys | supply URL+anon, Edge Fn `ANTHROPIC_API_KEY` |
| P1 error leak | catch→friendly | — |
| P1 donut open ring | Skia arc/cap fix | — |
| P1 touch-sticking | profile + fix | device retest |
| P1 `(tabs)` back-title | route headerBackTitle | — |
| P2 Activity align | layout | — |
