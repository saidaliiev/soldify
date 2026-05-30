/**
 * glassEffect.ts — runtime gate for expo-glass-effect (iOS 26+ Liquid Glass).
 *
 * Why: `expo-glass-effect@0.1.10` is a 0.1.x BETA library. Its native bindings
 * weak-link iOS 26 symbols; calling `isGlassEffectAPIAvailable()` /
 * `isLiquidGlassAvailable()` on a device whose iOS does not actually expose
 * those symbols can produce EXC_BAD_ACCESS in the Hermes microtask checkpoint
 * (build #8 / TF crash 2026-05-23, expo/expo#40911).
 *
 * This module is the SINGLE iOS-26-gated entry point. Callers must NEVER
 * `import 'expo-glass-effect'` directly — they consume `getGlassEffect()`,
 * which returns null on Android and on pre-iOS-26 iOS, so the native module
 * is never touched on a device that cannot safely speak its API.
 *
 * The lazy `require()` keeps the JS module out of the dependency graph at
 * module-load time, so even importing this file on a pre-iOS-26 device does
 * NOT pull expo-glass-effect's native binding into memory.
 */

import { Platform } from 'react-native';
import type { ComponentType } from 'react';

type GlassViewProps = {
  readonly glassEffectStyle?: 'regular' | 'clear';
  readonly tintColor?: string;
  readonly isInteractive?: boolean;
  readonly pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  readonly style?: unknown;
  readonly children?: React.ReactNode;
};
type GlassContainerProps = {
  readonly spacing?: number;
  readonly style?: unknown;
  readonly children?: React.ReactNode;
};

export type GlassEffectModule = {
  readonly GlassView: ComponentType<GlassViewProps>;
  readonly GlassContainer: ComponentType<GlassContainerProps>;
  readonly isGlassEffectAPIAvailable: () => boolean;
  readonly isLiquidGlassAvailable: () => boolean;
};

function parseIOSMajor(version: number | string): number {
  const major = Number.parseInt(String(version).split('.')[0] ?? '0', 10);
  return Number.isFinite(major) ? major : 0;
}

// iOS 26 is the first OS to ship the Liquid Glass / GlassEffect API. Pre-26
// devices (and Android) must never touch expo-glass-effect's native binding.
export const IS_LIQUID_GLASS_OS: boolean =
  Platform.OS === 'ios' && parseIOSMajor(Platform.Version) >= 26;

let cached: GlassEffectModule | null | undefined;

/**
 * Returns the expo-glass-effect module ONLY on iOS 26+. Returns null on
 * Android, pre-iOS-26 iOS, or if the require itself fails for any reason.
 * Callers MUST treat null as "render the solid fallback path".
 */
// DIAGNOSTIC (build #11): hard kill-switch for expo-glass-effect. The TF#10
// cold-start SIGABRT (uncaught NSException) implicates this 0.1.x BETA native
// binding on iOS 26 — the gate below only ever protected PRE-26 devices, so on
// the iOS 26.4.2 crash device glass WAS loaded. Forcing the solid fallback on
// ALL devices tests (and, if confirmed, fixes) that hypothesis. Flip to false
// to re-enable glass once the beta is proven safe on-device.
const GLASS_KILL_SWITCH = true;

export function getGlassEffect(): GlassEffectModule | null {
  if (cached !== undefined) return cached;
  if (GLASS_KILL_SWITCH || !IS_LIQUID_GLASS_OS) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-glass-effect') as GlassEffectModule;
    cached = mod;
    return mod;
  } catch {
    cached = null;
    return null;
  }
}
