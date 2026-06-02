# Build #12 — Device-Loop Triage Kit

> Companion to `BUILD-12-DEVICE-UAT.md`. When a UAT section comes back ❌, find it
> here → root-cause hypothesis → fix location → **OTA-able vs needs-rebuild**.
> Goal: every JS-only ❌ ships as an OTA in one command; only native/env ❌ costs a build.
>
> **The OTA fix-loop (JS-only fixes):**
> ```bash
> cd apps/mobile
> # …apply fix, verify gates…
> npx tsc --noEmit && npm test && npx expo lint    # all must pass
> git commit -am "fix: <thing>" && git push
> eas update --branch testflight --message "fix: <thing>"   # classifier-gated; say "publish"
> ```
> Then on iPhone: **relaunch the app ×2** (1st pulls the OTA, 2nd applies it), re-test.
> OTA only applies if the build's fingerprint runtimeVersion matches — it will, no native change.

---

## Cross-cutting: what #12 CANNOT show (known gaps, not bugs)

- **AI chat + AI auto-categorize are inert** — Supabase/Anthropic backend was never provisioned
  (no project_id in `supabase/config.toml`, no `EXPO_PUBLIC_SUPABASE_*` in `eas.json`/EAS env,
  edge functions undeployed). `isSupabaseConfigured()` → false → graceful "AI unavailable".
  - **UAT §3 chat mini-donut = UNVERIFIABLE in #12** (needs the AI to return a breakdown chart).
  - **UAT §4 Chat = shows the unavailable/empty state**, not a real conversation.
  - This is a **scope decision**, not a fix — see the AI-backend fork (tracked separately).
- Everything else (cold-start, blur, C1 scrubber, dashboard/jar donut octagon, redesign) is
  fully local and IS verifiable in #12.

---

## §0 Cold start (regression gate)

| ❌ Symptom | Root-cause hypothesis | Fix location | OTA? |
|---|---|---|---|
| Instant crash-to-springboard | Boot path audited CLEAN (TF#10 Supabase-import throw already fixed, glass removed). If it still crashes → **read the `BootTraceScreen`** — it names the last milestone reached. | depends on milestone (see below) | depends |
| `BootTraceScreen` shows `migrations:start` | op-sqlite native fault opening/migrating DB | `src/lib/db/index.ts` runMigrations | likely **rebuild** (native) |
| Reaches dashboard then crashes | render-time throw in a provider/screen | Sentry now has DSN in #12 → check Sentry (`o4511168991133696`) for the JS frame | usually **OTA** |
| White / boot-error screen | `RootErrorBoundary` caught a render throw → its verbose dump shows the error | the named component | usually **OTA** |

**If §0 passes ×3:** the TF#8/#10 crash class is confirmed dead → biggest risk retired → strip the
build-#11 diagnostic instrumentation (every file tagged `DIAGNOSTIC (build #11)`) in a follow-up.

## §1 Blur chrome

| ❌ Symptom | Root-cause | Fix location | OTA? |
|---|---|---|---|
| Red `Unimplemented component: ExpoBlurView` box | native expo-blur missing from binary (the TF#11 regression) | should be fixed by #12 (native module + fingerprint policy). If it recurs → build didn't bundle expo-blur native | **rebuild** |
| Flat opaque bar, no blur | `isBlurSafe` false — Reduce Transparency ON in iOS Settings, or iOS gate | check device Settings → Accessibility → Reduce Transparency. Tune `src/design/glass.ts` alpha/intensity | **OTA** |
| Tint too cold / too strong | GLASS intensity/tint tokens | `src/design/tokens.ts` GLASS block | **OTA** |

## §2 C1 forecast scrubber

| ❌ Symptom | Root-cause | Fix location | OTA? |
|---|---|---|---|
| Handle pinned far-left until touched | was the stale-key + first-paint-flash bug — **FIXED this session** (a48bfbf: key=jarId+balance, opacity-gate). If still present → verify a48bfbf is in the build | `JarDetailScreen.tsx` / `JarForecastScrubber.tsx` | **OTA** |
| Lever feels dead across ~80% of travel **on a nearly-funded jar** | KNOWN deferred HIGH (small-remaining jars: €50 floor on slider max dwarfs the responsive band) | `jarForecast.ts` `sliderRangeForJar` — make maxCents adaptive to remaining | **OTA** (fix staged, apply if device-feel confirms it matters) |
| Laggy spring chasing the finger | not expected — curve tracks finger directly by design | if seen, it's a Reanimated thread issue | OTA |
| No haptic on week change | simulator has no Taptic Engine; on a real iPhone it should fire | `JarForecastScrubber.tsx:131-137` | OTA |
| Decimals flicker in the number | should quantize to €1 steps already | `STEP_CENTS` quantization | OTA |

## §3 Octagon ×3 (Skia)

| ❌ Symptom | Root-cause | Fix location | OTA? |
|---|---|---|---|
| Dashboard donut / jar ring **still octagon** | the native-`addCircle`/`addArc` hypothesis is WRONG → real cause (Skia 2.2.12 antialiasing? stroke join?) needs debug | `DonutChart.tsx` / `JarRing.tsx` — geometry verified centered by review, so it's a render-flag issue | **OTA** (once root-caused) |
| Ring off-center / clipped | review verified centering math sound; if off → canvas size vs draw origin mismatch | the component's canvas dims | OTA |
| Chat mini-donut | **can't test — AI backend inert** (see cross-cutting). Geometry is identical to the verified dashboard donut, so dashboard ✅ implies chat ✅ | — | — |

## §4 Redesign Waves 1–6

| ❌ Symptom | Root-cause | Fix location | OTA? |
|---|---|---|---|
| Raw i18n keys (`jars.forecast.x`) | missing translation key | `src/lib/i18n/locales/*` | **OTA** |
| Wrong typeface | wrong TYPE.* preset | the component's style | **OTA** |
| Banned hex / AI-slop color leak | hardcoded color | grep the component vs `tokens.ts` | **OTA** |
| Broken spacing / layout jump | SPACING token or flex issue | the component's StyleSheet | **OTA** |

---

## Severity routing

- **Native/env ❌** (blur module missing, DB native fault, Supabase env) → batch into the NEXT build, don't OTA.
- **JS ❌** (everything else above) → OTA immediately, relaunch ×2, re-test. Most ❌ land here.
- **Cold-start crash** → highest priority, read BootTraceScreen first, may force a rebuild.
