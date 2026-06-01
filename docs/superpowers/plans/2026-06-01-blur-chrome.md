# Blur Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the killed `expo-glass-effect` Liquid-Glass chrome with `expo-blur` frosted chrome (Instagram-style floating-pill tab bar + chat bottom sheet), and remove the crashing beta dependency from the build.

**Architecture:** Pure decision/params in `src/design/glass.ts` (node-test importable) injected with a `blurOk` boolean from the RN boundary `src/lib/blurChrome.ts` (`isBlurSafe` = iOS && !reduce-transparency, plus the `BlurView` re-export). Chrome components render one `BlurView` + warm tint overlay on the glass path, or the existing opaque solid fallback. iOS-only blur; Android/reduce-transparency keep solid.

**Tech Stack:** React Native 0.81 + Expo SDK 54, TypeScript strict, `expo-blur`, `react-native-reanimated`, node:test (pure modules). Spec: `docs/superpowers/specs/2026-06-01-blur-chrome-design.md`.

**Verification reality:** Components have no unit harness (jest not wired) → verified by `tsc --noEmit` + `expo lint` + node:test (pure `glass.ts`). On-device frosted render + cold-start needs a new **EAS build (user runs; `eas build` deny-gated for the agent)** — NOT OTA (native dep change). Commands run from `apps/mobile`.

---

### Task 1: Add expo-blur dependency

**Files:**
- Modify: `apps/mobile/package.json` (+`expo-blur`)

- [ ] **Step 1: Install (SDK-pinned)**

Run: `npx expo install expo-blur`
Expected: adds `expo-blur` at the SDK-54-compatible version; lockfile updated.

- [ ] **Step 2: Verify tsc still green (no code uses it yet)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add expo-blur for frosted chrome"
```

---

### Task 2: Blur tokens

**Files:**
- Modify: `apps/mobile/src/design/tokens.ts` (`GLASS` object, currently lines ~134–139)

- [ ] **Step 1: Add two keys to the `GLASS` object**

Insert into `export const GLASS = { ... } as const;` (keep existing keys):

```ts
  blurIntensity: 50, // expo-blur BlurView intensity (0–100); tuned on device
  blurTint: 'light', // expo-blur BlurTint; warm chromeTint overlay layered on top
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0 (`as const` makes `blurTint` the literal `'light'`).

- [ ] **Step 3: Commit**

```bash
git add src/design/tokens.ts
git commit -m "feat(design): add GLASS blur intensity + tint tokens"
```

---

### Task 3: Blur boundary module

**Files:**
- Create: `apps/mobile/src/lib/blurChrome.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * blurChrome.ts — single RN boundary for expo-blur frosted chrome.
 *
 * Replaces glassEffect.ts (the killed expo-glass-effect beta gate). expo-blur
 * is a stable core Expo module — no weak-linked iOS-26 symbols, no kill switch,
 * no cold-start crash class (TF#8/#10, expo/expo#40911). Screens NEVER import
 * expo-blur directly; they consume the chrome components (GlassTabBar /
 * BottomSheetPrimitive) which consume this. The pure decision/params live in
 * src/design/glass.ts (node-test importable); this is the RN boundary.
 *
 * Blur renders on iOS only — expo-blur's Android path is experimental/weak, so
 * Android keeps the solid fallback. reduce-transparency forces the solid
 * fallback for accessibility.
 */
import { Platform } from 'react-native';

export { BlurView } from 'expo-blur';
export type { BlurTint } from 'expo-blur';

/** Blur is safe to render iff iOS and reduce-transparency is OFF. */
export function isBlurSafe(reduceTransparency: boolean): boolean {
  return Platform.OS === 'ios' && !reduceTransparency;
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: exit 0 (new file, not yet imported; `expo-blur` resolves from Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/lib/blurChrome.ts
git commit -m "feat(chrome): add blurChrome boundary (expo-blur, iOS-gated)"
```

---

### Task 4: Migrate pure module + both chrome components (atomic — coupled types)

> resolveTabBarChrome/resolveSheetChrome return shapes change, so both consumers
> must migrate in the same commit to keep tsc green. TDD the pure module first.

**Files:**
- Modify: `apps/mobile/src/design/glass.ts`
- Modify: `apps/mobile/src/design/glass.test.ts`
- Modify: `apps/mobile/src/features/chrome/GlassTabBar.tsx`
- Modify: `apps/mobile/src/components/BottomSheet/BottomSheetPrimitive.tsx`

- [ ] **Step 1: Rewrite glass.test.ts (failing) — assert blur shapes**

Keep existing `composeGlassTint` cases. Replace the `resolveTabBarChrome` /
`resolveSheetChrome` / `isSafeToRenderGlass` cases with:

```ts
import { resolveTabBarChrome, resolveSheetChrome, composeGlassTint } from './glass.js';
import { GLASS, ELEVATION, SHADOWS } from './tokens.js';

test('resolveTabBarChrome: blurOk=true → blur params + warm tintColor', () => {
  const c = resolveTabBarChrome(true);
  assert.equal(c.glass, true);
  if (c.glass) {
    assert.equal(c.blurIntensity, GLASS.blurIntensity);
    assert.equal(c.blurTint, GLASS.blurTint);
    assert.match(c.tintColor, /^#[0-9A-F]{8}$/);
  }
});

test('resolveTabBarChrome: blurOk=false → solid fill + floating shadow', () => {
  const c = resolveTabBarChrome(false);
  assert.equal(c.glass, false);
  if (!c.glass) {
    assert.equal(c.backgroundColor, GLASS.fallbackChromeBg);
    assert.deepEqual(c.shadow, ELEVATION.floating);
  }
});

test('resolveSheetChrome: blurOk=true → blur params + warm sheet tintColor', () => {
  const c = resolveSheetChrome(true);
  assert.equal(c.glass, true);
  if (c.glass) assert.equal(c.blurIntensity, GLASS.blurIntensity);
});

test('resolveSheetChrome: blurOk=false → solid fill + modal shadow', () => {
  const c = resolveSheetChrome(false);
  assert.equal(c.glass, false);
  if (!c.glass) assert.deepEqual(c.shadow, SHADOWS.modal);
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npm test 2>&1 | rg -i 'glass|not ok'`
Expected: glass cases FAIL (old shape returns `glassEffectStyle`, not `blurIntensity`).

- [ ] **Step 3: Rewrite glass.ts glass-path shapes**

Remove `shouldRenderGlass`, `isSafeToRenderGlass`, `resolveChromeSurface`,
`ChromeSurface`, and the `glassEffectStyle`/`isInteractive` fields. Keep
`composeGlassTint`. Replace the two resolvers:

```ts
import { GLASS, ELEVATION, SHADOWS } from './tokens';

export type ChromeBlurTint = 'light' | 'dark' | 'default';

// composeGlassTint(hex6, alpha): KEEP existing implementation verbatim.

export type TabBarChrome =
  | { readonly glass: true; readonly blurIntensity: number; readonly blurTint: ChromeBlurTint; readonly tintColor: string }
  | { readonly glass: false; readonly backgroundColor: string; readonly shadow: typeof ELEVATION.floating };

export function resolveTabBarChrome(blurOk: boolean): TabBarChrome {
  if (blurOk) {
    return {
      glass: true,
      blurIntensity: GLASS.blurIntensity,
      blurTint: GLASS.blurTint,
      tintColor: composeGlassTint(GLASS.chromeTint, GLASS.chromeTintAlpha),
    };
  }
  return { glass: false, backgroundColor: GLASS.fallbackChromeBg, shadow: ELEVATION.floating };
}

export type SheetChrome =
  | { readonly glass: true; readonly blurIntensity: number; readonly blurTint: ChromeBlurTint; readonly tintColor: string }
  | { readonly glass: false; readonly backgroundColor: string; readonly shadow: typeof SHADOWS.modal };

export function resolveSheetChrome(blurOk: boolean): SheetChrome {
  if (blurOk) {
    return {
      glass: true,
      blurIntensity: GLASS.blurIntensity,
      blurTint: GLASS.blurTint,
      tintColor: composeGlassTint(GLASS.sheetTint, GLASS.sheetTintAlpha),
    };
  }
  return { glass: false, backgroundColor: GLASS.fallbackChromeBg, shadow: SHADOWS.modal };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test 2>&1 | rg -i 'glass|not ok'`
Expected: glass cases PASS; the only `not ok` remain the 2 pre-existing schema-migration tests.

- [ ] **Step 5: Migrate GlassTabBar.tsx**

Imports — replace:
```ts
import { resolveTabBarChrome } from '@/src/design/glass';
import { BlurView, isBlurSafe } from '@lib/blurChrome';
```
(remove `isSafeToRenderGlass`, `getGlassEffect`, and the `GlassContainer`/`GlassView` usage.)

Replace the `glassMod`/`safeGlass`/`chrome` block (≈ lines 96–101) with:
```ts
const blurOk = isBlurSafe(reduceTransparency);
const chrome = resolveTabBarChrome(blurOk);
```

In the `tabs` map: remove the per-tab `if (chrome.glass) { GlassView … }` wrapper
(≈ lines 163–179) — always return plain `tabContent`. The glass decision moves to
the container below.

Replace the two return blocks (glass container + solid fallback, ≈ lines 182–212):
```tsx
if (chrome.glass) {
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom, left: BAR_MARGIN, right: BAR_MARGIN }]}>
      <View style={styles.blurPill}>
        <BlurView intensity={chrome.blurIntensity} tint={chrome.blurTint} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: chrome.tintColor }]} />
        <View style={styles.row}>{tabs}</View>
      </View>
    </View>
  );
}

// Mandatory solid fallback — explicit warm fill + floating shadow.
return (
  <View pointerEvents="box-none" style={[styles.wrap, { bottom, left: BAR_MARGIN, right: BAR_MARGIN }]}>
    <View style={[styles.solidBar, { backgroundColor: chrome.backgroundColor }, chrome.shadow]}>
      {tabs}
    </View>
  </View>
);
```

Add styles (and `import { ELEVATION } from '@design/tokens'` for the pill shadow);
remove `glassContainer`/`glassTab` styles:
```ts
blurPill: {
  borderRadius: RADIUS.pill,
  height: BAR_HEIGHT,
  overflow: 'hidden',
  ...ELEVATION.floating,
},
row: { flexDirection: 'row', height: BAR_HEIGHT },
```
(`solidBar`, `tab`, `label`, `wrap` styles stay.)

- [ ] **Step 6: Migrate BottomSheetPrimitive.tsx**

Imports — replace:
```ts
import { resolveSheetChrome } from '@design/glass';
import { BlurView, isBlurSafe } from '@lib/blurChrome';
```
(remove `isSafeToRenderGlass`, `getGlassEffect`.)

Replace the `glassMod`/`safeGlass`/`renderGlass`/`GlassView` block (≈ lines 140–149):
```ts
const wantGlass = glassSurface === true;
const blurOk = wantGlass && isBlurSafe(reduceTransparency);
const sheetChrome = wantGlass ? resolveSheetChrome(blurOk) : null;
const renderGlass = sheetChrome?.glass === true;
```

Replace the `<GlassView … />` material (≈ lines 328–336):
```tsx
{renderGlass && sheetChrome != null && sheetChrome.glass && (
  <>
    <BlurView pointerEvents="none" intensity={sheetChrome.blurIntensity} tint={sheetChrome.blurTint} style={StyleSheet.absoluteFill} />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: sheetChrome.tintColor }]} />
  </>
)}
```
(The dynamic `sheet` backgroundColor logic at ≈ 310–324 stays — fallback still
supplies the opaque fill; the glass path supplies the BlurView child.)

- [ ] **Step 7: Verify gate**

Run: `npx tsc --noEmit && npx expo lint && npm test 2>&1 | tail -5`
Expected: tsc 0, lint 0, tests = prior pass count + green glass cases; only the 2
pre-existing schema-migration tests fail.

- [ ] **Step 8: Commit**

```bash
git add src/design/glass.ts src/design/glass.test.ts src/features/chrome/GlassTabBar.tsx src/components/BottomSheet/BottomSheetPrimitive.tsx
git commit -m "feat(chrome): render tab bar + sheet with expo-blur, drop glass-effect usage"
```

---

### Task 5: Remove expo-glass-effect

**Files:**
- Delete: `apps/mobile/src/lib/glassEffect.ts`
- Modify: `apps/mobile/package.json` (−`expo-glass-effect`)
- Modify: `apps/mobile/app.json` (remove plugin entry if present)

- [ ] **Step 1: Confirm no remaining importers**

Run: `rg -n 'glassEffect|expo-glass-effect' src app`
Expected: no matches in `src`/`app` (only the dep line in package.json / app.json).

- [ ] **Step 2: Delete the module + check app config**

```bash
git rm src/lib/glassEffect.ts
rg -n 'expo-glass-effect' app.json package.json
```
Remove any `expo-glass-effect` entry from `app.json` `plugins` (if listed) and the
dependency line from `package.json`. Then:
```bash
npx expo install --check
```
Expected: no expo-glass-effect; deps consistent with SDK 54.

- [ ] **Step 3: Verify full gate**

Run: `npx tsc --noEmit && npx expo lint && npm test 2>&1 | tail -5`
Expected: tsc 0, lint 0, tests green (2 pre-existing migration fails only).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "build: remove expo-glass-effect (TF#10 cold-start crash suspect)"
```

---

## Post-implementation (user-run)

- `eas build --profile testflight` (deny-gated for the agent → user runs) → new TestFlight build.
- On-device verify: (1) frosted floating-pill tab bar over scrolled content on iOS 26; (2) solid fallback unchanged with reduce-transparency ON and on Android; (3) chat sheet frosted; (4) **cold start no longer crashes** (TF#10 gate — confirms expo-glass-effect was the cause).

---

## Self-Review

**Spec coverage:** deps swap (T1/T5) ✓; tab bar blur (T4 step 5) ✓; bottom sheet blur (T4 step 6) ✓; glassEffect.ts → blurChrome.ts (T3/T5) ✓; glass.ts blur params + tests (T4) ✓; tokens (T2) ✓; fallback preserved (T4 fallback blocks unchanged) ✓; chrome-only/tokens (no hardcoded hex; tintColor via composeGlassTint) ✓; new-build/not-OTA noted ✓; TF#10 verification (T5 + post) ✓.

**Placeholder scan:** no TBD/TODO; every code step has real code; blur intensity/tint are concrete starting values (tuned on device per spec). ✓

**Type consistency:** `resolveTabBarChrome(blurOk)`/`resolveSheetChrome(blurOk)` signatures match consumers (T4 steps 5/6); `ChromeBlurTint` ('light'|'dark'|'default') is assignable to expo-blur `BlurTint`; `blurIntensity`/`blurTint`/`tintColor` field names identical across glass.ts, tests, and both components; `isBlurSafe(reduceTransparency)` used consistently. ✓
