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
