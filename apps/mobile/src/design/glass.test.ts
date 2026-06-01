/**
 * glass.ts decision + style resolver. node:test + tsx. blurOk injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeGlassTint, resolveTabBarChrome, resolveSheetChrome } from './glass.js';
import { GLASS, ELEVATION, SHADOWS } from './tokens.js';

test('composeGlassTint: #RRGGBB + alpha → #RRGGBBAA (uppercase, 2-digit)', () => {
  assert.strictEqual(composeGlassTint('#F7F5F0', 0.62), '#F7F5F09E');
  assert.strictEqual(composeGlassTint('#F7F5F0', 1), '#F7F5F0FF');
  assert.strictEqual(composeGlassTint('#F7F5F0', 0), '#F7F5F000');
  assert.strictEqual(composeGlassTint('#f7f5f0', 1), '#F7F5F0FF');
});

test('composeGlassTint: clamps alpha to [0,1]', () => {
  assert.strictEqual(composeGlassTint('#F7F5F0', 1.5), '#F7F5F0FF');
  assert.strictEqual(composeGlassTint('#F7F5F0', -0.2), '#F7F5F000');
});

test('composeGlassTint: rejects non-#RRGGBB input', () => {
  assert.throws(() => composeGlassTint('FAF5F0', 0.5), /#RRGGBB/);
  assert.throws(() => composeGlassTint('#FFF', 0.5), /#RRGGBB/);
  assert.throws(() => composeGlassTint('#F7F5F0FF', 0.5), /#RRGGBB/);
});

test('resolveTabBarChrome: blurOk=true → blur params + warm tintColor, glass=true', () => {
  const c = resolveTabBarChrome(true);
  assert.strictEqual(c.glass, true);
  if (c.glass) {
    assert.strictEqual(c.blurIntensity, GLASS.blurIntensity);
    assert.strictEqual(c.blurTint, GLASS.blurTint);
    assert.strictEqual(c.tintColor, composeGlassTint(GLASS.chromeTint, GLASS.chromeTintAlpha));
  }
});

test('resolveTabBarChrome: blurOk=false → solid bg + floating shadow, glass=false', () => {
  const c = resolveTabBarChrome(false);
  assert.strictEqual(c.glass, false);
  if (!c.glass) {
    assert.strictEqual(c.backgroundColor, GLASS.fallbackChromeBg);
    assert.deepStrictEqual(c.shadow, ELEVATION.floating);
  }
});

test('resolveTabBarChrome: discriminated union — no cross-branch field leak', () => {
  const g = resolveTabBarChrome(true);
  const f = resolveTabBarChrome(false);
  // Runtime shape guard: ensures literals leak no cross-branch fields (TS covers compile-time).
  assert.strictEqual('backgroundColor' in g, false);
  assert.strictEqual('tintColor' in f, false);
});

test('resolveSheetChrome: blurOk=true → blur params + warm sheet tintColor, glass=true (Wave 4)', () => {
  const c = resolveSheetChrome(true);
  assert.strictEqual(c.glass, true);
  if (c.glass) {
    assert.strictEqual(c.blurIntensity, GLASS.blurIntensity);
    assert.strictEqual(c.blurTint, GLASS.blurTint);
    assert.strictEqual(c.tintColor, composeGlassTint(GLASS.sheetTint, GLASS.sheetTintAlpha));
  }
});

test('resolveSheetChrome: blurOk=false → opaque solid + modal shadow, glass=false (Wave 4)', () => {
  const c = resolveSheetChrome(false);
  assert.strictEqual(c.glass, false);
  if (!c.glass) {
    assert.strictEqual(c.backgroundColor, GLASS.fallbackChromeBg);
    // Sheet is modal-class — NOT the detached tab-bar pill (ELEVATION.floating).
    assert.deepStrictEqual(c.shadow, SHADOWS.modal);
    assert.notDeepStrictEqual(c.shadow, ELEVATION.floating);
  }
});

test('resolveSheetChrome: discriminated union — no cross-branch field leak (Wave 4)', () => {
  const g = resolveSheetChrome(true);
  const f = resolveSheetChrome(false);
  assert.strictEqual('backgroundColor' in g, false);
  assert.strictEqual('tintColor' in f, false);
});
