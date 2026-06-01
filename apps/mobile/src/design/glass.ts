/**
 * SOLDI frosted-blur chrome — decision + style layer.
 *
 * Pure: NO expo-blur import (native; node-test importable). The RN boundary
 * (src/lib/blurChrome.ts) computes `blurOk` (iOS && !reduce-transparency) and
 * passes the boolean here. Chrome components consume the resolved params and
 * render expo-blur's BlurView; screens never import expo-blur directly
 * (CLAUDE.md — blur is system CHROME only, never content surfaces).
 *
 * History: this layer was built on expo-glass-effect (iOS-26 Liquid Glass), a
 * 0.1.x beta whose native binding was the prime suspect for the TF#8/#10
 * cold-start crash (expo/expo#40911). Replaced by stable expo-blur 2026-06-01.
 *
 * Fallback is NOT optional: when blur is unavailable the chrome is a warm SOLID
 * editorial fill (never an empty/transparent bar).
 */

import { GLASS, ELEVATION, SHADOWS } from './tokens';

/** expo-blur BlurTint subset used for SOLDI chrome (assignable to BlurTint). */
export type ChromeBlurTint = 'light' | 'dark' | 'default';

/**
 * Compose a `#RRGGBB` token + alpha (0–1) into an 8-digit `#RRGGBBAA` string.
 * The warm-tint overlay layered over the blur is a single color value, so the
 * tint alpha (GLASS.chromeTintAlpha / sheetTintAlpha) is encoded into the color.
 * Alpha is clamped to [0,1]. Throws on malformed input (fail fast — a bad tint
 * would silently break the chrome material).
 */
export function composeGlassTint(hex6: string, alpha: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex6)) {
    throw new Error(`composeGlassTint: expected #RRGGBB, got "${hex6}"`);
  }
  const clamped = Math.min(1, Math.max(0, alpha));
  const aa = Math.round(clamped * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `${hex6.toUpperCase()}${aa}`;
}

export type TabBarChrome =
  | {
      readonly glass: true;
      /** BlurView.intensity (0–100) */
      readonly blurIntensity: number;
      /** BlurView.tint */
      readonly blurTint: ChromeBlurTint;
      /** warm wash overlaid on the blur — alpha baked in (#RRGGBBAA) */
      readonly tintColor: string;
    }
  | {
      readonly glass: false;
      /** opaque solid editorial fill (mandatory non-blur fallback) */
      readonly backgroundColor: string;
      /** ELEVATION.floating — detached pill shadow on the fallback bar */
      readonly shadow: typeof ELEVATION.floating;
    };

/**
 * Resolve the FINAL RN-ready tab-bar chrome style. `blurOk` is the result of
 * blurChrome.isBlurSafe() (iOS && !reduce-transparency), injected from the RN
 * boundary. Blur path: frosted BlurView params + warm tint overlay. Fallback
 * path: solid warm fill + floating shadow (NEVER an empty/transparent bar — the
 * fallback is the only path that ships today and is preserved).
 */
export function resolveTabBarChrome(blurOk: boolean): TabBarChrome {
  if (blurOk) {
    return {
      glass: true,
      blurIntensity: GLASS.blurIntensity,
      blurTint: GLASS.blurTint,
      tintColor: composeGlassTint(GLASS.chromeTint, GLASS.chromeTintAlpha),
    };
  }
  return {
    glass: false,
    backgroundColor: GLASS.fallbackChromeBg,
    shadow: ELEVATION.floating,
  };
}

export type SheetChrome =
  | {
      readonly glass: true;
      readonly blurIntensity: number;
      readonly blurTint: ChromeBlurTint;
      readonly tintColor: string;
    }
  | {
      readonly glass: false;
      readonly backgroundColor: string;
      /** SHADOWS.modal — a bottom sheet is modal-class, not the floating pill */
      readonly shadow: typeof SHADOWS.modal;
    };

/**
 * Resolve the FINAL RN-ready bottom-sheet chrome (Wave 4: ChatBottomSheet).
 * Mirrors resolveTabBarChrome with sheet tokens + a modal-class shadow. Blur
 * path: frosted BlurView params + warm sheet tint overlay. Fallback: opaque
 * solid warm fill (GLASS.fallbackChromeBg) + SHADOWS.modal (a sheet is
 * modal-class, NOT the detached tab-bar pill, so it does NOT use
 * ELEVATION.floating). Blur is sheet CHROME only — never bubbles/content.
 */
export function resolveSheetChrome(blurOk: boolean): SheetChrome {
  if (blurOk) {
    return {
      glass: true,
      blurIntensity: GLASS.blurIntensity,
      blurTint: GLASS.blurTint,
      tintColor: composeGlassTint(GLASS.sheetTint, GLASS.sheetTintAlpha),
    };
  }
  return {
    glass: false,
    backgroundColor: GLASS.fallbackChromeBg,
    shadow: SHADOWS.modal,
  };
}
