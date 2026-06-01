# SOLDI (soldify) — Gotchas (env & tooling traps)

> Durable traps and the fix, in-repo so a fresh session greps them instead of rediscovering.
> Harvested from machine-local claude-mem + `.planning`. Each entry: **what breaks → why → fix → status**.

## Android emulator dev-client (WSL2 → Windows)

### Use `--lan`, NOT `adb reverse`  `[RULE, verified 2026-05-27]`
- **Breaks:** `adb reverse tcp:8081 tcp:8081` through the WSL→Windows `ADB_SERVER_SOCKET` bridge tunnels the emulator port to the **Windows host**:8081, NOT the **WSL2 host** where Metro runs. TCP connects then closes → dev-client reports `java.io.IOException: unexpected end of stream` / `EOFException: \n not found`.
- **Working path:**
  ```bash
  cd apps/mobile && npx expo start --dev-client --lan
  WSL_IP=$(hostname -I | awk '{print $1}')          # e.g. 172.24.26.23
  adb shell ping -c 2 "$WSL_IP"                       # ~100ms through Windows NAT
  /home/iskan/platform-tools/win-emu-up.sh soldify
  ENCODED=$(printf 'http://%s:8081' "$WSL_IP" | jq -rR @uri)
  adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
    -d "exp+soldi://expo-development-client/?url=${ENCODED}"
  ```
- **Scheme is `soldi`** (per `apps/mobile/app.json`), NOT `soldify`.
- `--tunnel` is NOT needed — emulator and WSL2 share the same Windows host; `--lan` suffices.

### ⚠️ dev-client silently runs the EMBEDDED bundle when Metro TCP is unreachable  `[2026-06-01, blocked octagon verify]`
- **Breaks:** deep-linking the dev-client (`exp+soldi://…?url=http://<WSL_IP>:8081`) opened the app, but Metro served **zero bundle requests** — the app ran its **APK-embedded bundle (stale, pre-fix code)** as an offline fallback. `pm clear app.soldi.mobile` (wipes JS cache → forces fetch) did NOT help: app still ran embedded code (showed first-run onboarding but old rendering). Net: you can be looking at OLD code and not know it. ALWAYS confirm a fresh bundle in the Metro log (`Android Bundled …ms`) before trusting an on-device render.
- **Root cause:** emulator (a *Windows* process) → WSL2 Metro on `TCP:8081` is blocked even though `adb shell ping <WSL_IP>` succeeds (~216ms) and `curl http://<WSL_IP>:8081/status` works *from WSL*. ICMP path ≠ TCP path. The adb bridge (`win-emu-up.sh`) only wires the **control plane** (adb 5037), NOT the Metro **data plane** (8081). So `--lan` is necessary but NOT sufficient on this box.
- **Fix (untried, needs Windows admin):** either a `netsh interface portproxy add v4tov4 listenport=8081 listenaddress=0.0.0.0 connectport=8081 connectaddress=<WSL_IP>` on Windows then `adb reverse tcp:8081 tcp:8081` + deep-link `localhost:8081`; OR a Windows Firewall inbound allow rule for TCP 8081 to the WSL vEthernet, then the direct `<WSL_IP>:8081` path works. Confirm via Metro log showing a real bundle.
- **Faster alternative:** verify on the physical iPhone via EAS Update OTA (real iOS target, zero WSL networking).

### `ADB_SERVER_SOCKET` host = default-route gateway  `[verified 2026-05-27]`
- **Breaks:** using the resolv.conf nameserver IP → `cannot connect to daemon: Connection refused` even though Windows shows the server listening on `0.0.0.0:5037`.
- **Fix:** derive from the default route, NOT DNS:
  ```bash
  ip route | awk '/default/{print $3}'   # RIGHT  → 172.24.16.1 (Windows host)
  # WRONG: awk '/^nameserver/{print $2}' /etc/resolv.conf  → 10.255.255.254
  ```
- The Windows side must run `adb -a -P 5037 nodaemon server` (all interfaces) so the WSL2 NAT gateway can reach it. `win-emu-up.sh` and `mobile-mcp-wsl.sh` already do this; bypassing them gives the localhost-only auto-spawned server → WSL sees no devices.

### mobile-mcp `list_crashes` quirk
- Through the WSL→Windows bridge `mobile_list_crashes` errors with `device not found: emulator-5554`. Fall back to:
  ```bash
  adb -s emulator-5554 logcat -d | grep -iE "(FATAL|ANR|AndroidRuntime.*soldi|hermes.*fatal)"
  ```

## CI / verification

### jest harness never set up → CI `npm test` is broken  `[P1, pre-existing]`
- `apps/mobile` has `.test.ts` files (Phase 1/2/3) but NO `jest`/`jest-expo` devDep, no `jest.config.*`, no `test` script. CI `ci.yml` step `npm test` fails `Missing script: test` independent of any feature work.
- **Do NOT claim "tests pass."** Verification rests on `npx tsc --noEmit` (exit 0) + `npx expo lint` (exit 0) only. A dedicated jest-harness task is deferred (user, 2026-05-15).

### expo-dev-client version must match SDK 54  `[2026-05-23, root cause of TF#7 build fail]`
- **Breaks:** `expo-dev-client ^56.x` (wrong major) pulls `expo-updates-interface@56` etc., collides with `expo-updates@29`'s nested copy → CocoaPods `Unable to find a specification for EXUpdatesInterface`.
- **Fix:** pin `expo-dev-client → ~6.0.21` for SDK 54. Keep a single lockfile (`bun.lock`) — dual lockfiles (`+package-lock.json`) violate the bun-only policy and confuse EAS package-manager inference. Run `expo-doctor` (must be 18/18).

## iOS native

### iOS-26 Liquid Glass crash gate  `[2026-05-24, fix ff48ab2]`
- **Breaks:** `expo-glass-effect@0.1.x` (beta) weak-links iOS-26-only symbols. Pre-iOS-26 iPhones calling `isGlassEffectAPIAvailable()` / `isLiquidGlassAvailable()` in `GlassTabBar` or `BottomSheetPrimitive` crash (EXC_BAD_ACCESS) BEFORE the guard can evaluate. Surfaced as TF#8 cold-start crash on testers' iOS 17/18 devices.
- **Fix:** `src/lib/glassEffect.ts` lazy-requires `expo-glass-effect` ONLY when `Platform.OS==='ios' && parseIOSMajor(Platform.Version)>=26`, returns null otherwise. `GlassTabBar` + `BottomSheetPrimitive` read through `getGlassEffect()` and force the solid fallback when null — pre-iOS-26 + Android never touch the native binding.
- **Status:** commit `ff48ab2` was NOT YET PUSHED as of 2026-05-24 (direct-to-main was classifier-denied, awaiting user OK). Verify it landed before treating the crash as fixed.

### Sentry token is write-only (can't read crashes)  `[2026-05-24]`
- The `sntrys_` auth token (org `lumina-fo`, DE region) is project-write only — no `event:read`. `/api/0/organizations/lumina-fo/projects/` returns HTTP 403. Crash triage works from device logs + hypotheses, not Sentry queries, until the token is upgraded with `event:read`.

## Skia rendering

### Never draw a circle/arc via `MakeFromSVGString` — it facets into a polygon  `[RULE, fix d239283 (donut) + 656f6ee (jar), 2026-06-01]`
- **Breaks:** `@shopify/react-native-skia` 2.2.x flattens an SVG `A` (elliptical-arc) command fed to `Skia.Path.MakeFromSVGString` into a **coarse faceted polygon**. A full ring renders as an octagon, a partial arc as a chord-y polyline. Device-confirmed on the DonutChart full ring (Coffee 100%, smoke-test 2026-06-01) and the same pattern existed in `JarRing`.
- **Fix:** build curves with the **native path API** — `Skia.Path.Make()` then `addCircle(cx,cy,r)` for full rings (seamless, no 359.9° two-arc seam hack) and `addArc(oval, startDeg, sweepDeg)` for partial arcs. These tessellate natively and stay smooth. Keep the pure angle math in a `*Geometry.ts`/`*Arcs.ts` module (emit angle/sweep, not an SVG string); build the Skia path in the component.
- **Angle convention:** the geometry modules use 0° = 12 o'clock, clockwise; Skia `addArc` uses 0° = 3 o'clock, clockwise (y-down) → **Skia startAngle = geomDeg − 90** (12 o'clock = −90°).
- **Also watch off-center clip:** these rings center geometry at `(radius,radius)` on a `size×size` canvas, shifting the ring `sw/2` toward top-left so the outer stroke edge clips ("не круг" flat-top). Center on `(size/2,size/2)` with `radius = size/2 − sw/2 − PAD`. Donut: `DONUT_CENTER_OFFSET`+`STROKE_PAD`; jar: `RING_PAD`.
- **Faceting only bites CURVES.** Polylines (`Sparkline`, chat `MiniSparkline`) and native rects (chat `MiniBar` `addRRect`) are unaffected. **Audited + fixed:** dashboard donut (`d239283`), jar ring (`656f6ee`), chat `MiniDonut` (`4415dab`). Remaining unaudited: `dashboard/donutArcs.ts` dead `arcPath`? (DonutChart no longer calls it — likely dead). Static icon SVG paths (`design/icons/**`) are fine.
- **Status:** all three fixes pushed origin/main + **OTA-published to `testflight` branch 2026-06-01** (update group `9540ac84`, commit `d7197ad`, runtime 1.0.0 iOS). RENDER still PENDING device confirmation (relaunch build #11 to pull the update). NOTE: agent OTA `eas update` is classifier-gated — needs explicit user "publish/deploy", not "do you recommend?".

## OTA / EAS Update

### `runtimeVersion.policy: "appVersion"` lets JS-only OTA cross a native boundary → `Unimplemented component`  `[RULE, fix 2026-06-01]`
- **Breaks:** with `policy: "appVersion"`, the OTA runtimeVersion is just `app.json` `version` (`"1.0.0"`). The blur-chrome migration **added the `expo-blur` native module** but kept version `1.0.0`, so OTA group `9540ac84` (carrying expo-blur **JS**) was deemed "compatible" with TF#11 — a binary built **before** the native module existed. The JS called into a missing native view → **`Unimplemented component: ExpoBlurView`** rendered live on the tab bar. The appVersion policy is blind to the native layer; any native dep add/remove without a manual version bump silently ships a broken OTA.
- **Fix:** `app.json` → `runtimeVersion: { "policy": "fingerprint" }`. `@expo/fingerprint` hashes the **whole native project** (native module dirs incl. `node_modules/expo-blur/ios`, config plugins, eas.json) at both build- and update-publish time. A native change ⇒ different hash ⇒ the OTA targets a runtimeVersion that old binaries don't have ⇒ it is **never served** across the native boundary. Verified: `npx expo-updates fingerprint:generate --platform ios` lists `expo-blur/ios` as a source and `expo-glass-effect` is absent; build-#12 fingerprint = `710fcde4…`. Works for CNG/managed (no committed `ios/android`).
- **Consequence (expected, not a bug):** after the switch, builds ≤ #11 (runtime `1.0.0`) **stop receiving OTA updates** — their runtime no longer matches any published update. That is the point; #12+ (fingerprint runtime) is the new OTA lineage. Republish any pending JS fix against the #12 fingerprint.
- **Status:** policy changed in `app.json`, config validates (`expo config`), fingerprint computes. Takes effect on the next build (#12). `eas.json` `appVersionSource: "remote"` is unaffected (it governs build number, not runtimeVersion).

### Run every `eas` command from `apps/mobile`, never repo root  `[RULE, 2026-06-01]`
- **Breaks:** the Expo app + `eas.json` + `app.json` live in `apps/mobile` (monorepo). Running `eas build` from repo root → eas-cli finds no `eas.json`, **silently generates a bare default** (`./eas.json` with only `development`/`preview`/`production`, no `testflight`, no env, no channels) and stages it. Symptom: `Missing build profile in eas.json: "testflight". Available profiles: ["development","preview","production"]` + a stray staged `eas.json` at the repo root.
- **Fix:** always `cd apps/mobile && eas build --profile testflight`. If a stray root `eas.json` already appeared: `git restore --staged eas.json && rm eas.json` (it is the generic auto-gen, never the real config — the real one keeps 4 profiles + `testflight` channel + Sentry DSN env).
