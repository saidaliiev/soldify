/**
 * BottomSheetPrimitive — shared bottom-sheet wrapper consumed by 02-03 +
 * 02-04. Mirrors a subset of the @gorhom/bottom-sheet API surface
 * (`open()` / `close()` / `snapPoints`) so a future migration is a drop-in.
 *
 * Implementation: RN <Modal> + reanimated v4 + gesture-handler v2 pan.
 * Chosen over @gorhom/bottom-sheet for Phase 2 because gorhom requires a
 * native rebuild (autolinking) that breaks Expo Go device verification.
 * Pattern reuses the Wave 1 MonthSwiper gesture (worklet onUpdate/onEnd,
 * runOnJS for JS-side state).
 *
 * Design contract (UI-SPEC §"CategoryEditorBottomSheet"):
 *   - 60% snap point default (single-snap; no full-screen expand)
 *   - COLORS.surface background, RADIUS.xl top corners
 *   - 4×36pt drag indicator (textMuted @ 40%)
 *   - Pan-down-to-close gesture
 *   - accessibilityViewIsModal on inner view
 *
 * A11y contract (D-09 / QUAL-03):
 *   - On open: moves VoiceOver/TalkBack focus to the sheet header ref via
 *     AccessibilityInfo.setAccessibilityFocus(findNodeHandle(headerRef)).
 *   - On close: returns focus to the caller-supplied returnFocusRef (optional;
 *     if absent or ref resolves null, no-op — focus never trapped in a dead end
 *     because the Modal closes and the OS returns focus naturally).
 *   - accessibilityViewIsModal on the sheet container prevents background
 *     content from being reachable by VoiceOver swipe.
 *
 * Wave 4: SANCTIONED expo-glass-effect boundary (2nd, after GlassTabbar;
 * approved at the W4 checkpoint). OPT-IN only via the `glassSurface` prop —
 * default path is byte-identical solid COLORS.surface, so the 3 other
 * consumers (Recategorize / JarCreate / CategoryEditor — W5 scope) are
 * untouched. When opted in: native availability + reduce-transparency are
 * read at this boundary, the pure glass.ts resolveSheetChrome decides, glass
 * is an absolute-fill GlassView BEHIND content (transform stays on the plain
 * Animated.View — no animated native view), fallback = solid + SHADOWS.modal
 * (mandatory, never transparent). Open/close motion is intentionally NOT
 * governed here (W4 checkpoint #2: shared-primitive-motion is deferred debt).
 */

import React from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS, RADIUS, SPACING } from '@design/tokens';
import { resolveSheetChrome } from '@design/glass';
import { MOTION, SHEET_DAMPING_RATIO } from '@design/motion';
import { useReduceMotion } from '@design/useMotion';
import { BlurView, isBlurSafe } from '@lib/blurChrome';

// WR-03: SCREEN_HEIGHT was computed once at module load via Dimensions.get().
// On orientation change or iPad Split View, the cached value goes stale causing
// the sheet to animate to the wrong snap position. Moved inside component as
// useWindowDimensions() which is reactive. See restingHeight derivation below.
// Scrim alpha. Was '90' (0.56): textPrimary is warm near-black (#221F1B), not
// black, and the app bg is light cream — at 0.56 the background list stayed
// visibly legible through the dim (looked like the sheet was transparent).
// 'D9' = 0.85 gives a proper opaque scrim while keeping the warm-brown tint
// (not a harsh pure-black overlay).
const BACKDROP_ALPHA = 'D9'; // 0.85
const HANDLE_MUTED_SUFFIX = '66'; // 40% alpha 8-bit hex

export type BottomSheetPrimitiveRef = {
  readonly open: () => void;
  readonly close: () => void;
};

type Props = {
  /** Tuple like ['60%']; first entry is the resting snap height (% of screen). */
  readonly snapPoints: readonly [string, ...string[]];
  /** Notifies opened/closed; 0 = closed, 1 = at first snap point. */
  readonly onChange?: (index: number) => void;
  readonly accessibilityLabel?: string;
  /**
   * D-09 / QUAL-03: optional ref to the element that triggered the sheet open.
   * When the sheet closes, VoiceOver/TalkBack focus returns to this ref so users
   * are never left in a dead end. If absent or the node handle is null, the
   * RN Modal teardown naturally returns OS focus — still not a dead end.
   */
  readonly returnFocusRef?: React.RefObject<React.ElementRef<typeof View> | null>;
  /**
   * Wave 4 OPT-IN: render the sheet surface as warm Liquid Glass (only
   * ChatBottomSheet passes this). Omitted/false → byte-identical solid
   * COLORS.surface (W5 sheets unaffected). Glass gated by native
   * availability + reduce-transparency with a mandatory solid fallback.
   */
  readonly glassSurface?: boolean;
  readonly children?: React.ReactNode;
};

function parsePercent(s: string): number {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (m == null) return 0.6;
  return Number(m[1]) / 100;
}

export const BottomSheetPrimitive = React.forwardRef<BottomSheetPrimitiveRef, Props>(
  function BottomSheetPrimitive(
    { snapPoints, onChange, accessibilityLabel, returnFocusRef, glassSurface, children },
    ref,
  ) {
    const [visible, setVisible] = React.useState(false);

    // Glass boundary (Wave 4, opt-in). reduce-transparency may still report
    // glass available under a11y limits → force the solid fallback. Mirrors
    // the GlassTabBar (Wave 1) native-availability pattern exactly.
    const [reduceTransparency, setReduceTransparency] = React.useState(false);
    React.useEffect(() => {
      let mounted = true;
      AccessibilityInfo.isReduceTransparencyEnabled().then((v) => {
        if (mounted) setReduceTransparency(v);
      });
      const sub = AccessibilityInfo.addEventListener(
        'reduceTransparencyChanged',
        (v) => setReduceTransparency(v),
      );
      return () => {
        mounted = false;
        sub.remove();
      };
    }, []);

    // Blur boundary: frosted BlurView on iOS with reduce-transparency OFF;
    // Android + reduce-transparency fall back to the solid sheet fill. Mirrors
    // GlassTabBar. expo-blur is stable — none of the iOS-26 weak-link crash
    // class the old expo-glass-effect beta carried (expo/expo#40911).
    const wantGlass = glassSurface === true;
    const blurOk = wantGlass && isBlurSafe(reduceTransparency);
    const sheetChrome = wantGlass ? resolveSheetChrome(blurOk) : null;
    const renderGlass = sheetChrome?.glass === true;
    // WR-03: use reactive screen height — stale module-load value caused
    // wrong snap position after orientation change or iPad Split View.
    const { height: screenHeight } = useWindowDimensions();
    const restingHeight = screenHeight * parsePercent(snapPoints[0]);

    // W5 T2: governed sheet motion. Configs resolve JS-side from MOTION
    // presets; the inline withSpring/withTiming calls below (worklet + JS)
    // read these plain serializable fields instead of literal numbers. Single
    // governed SHEET_DAMPING_RATIO for both spring sites — spec §Anti
    // "no visual diff at T2" honored (open/snap-back both soft-settle).
    const reduceMotion = useReduceMotion();
    const sheetMotion = React.useMemo(
      () => ({
        open:         { duration: MOTION.sheetOpen.durationMs,         dampingRatio: SHEET_DAMPING_RATIO },
        close:        { duration: MOTION.sheetClose.durationMs },
        gestureClose: { duration: MOTION.sheetGestureClose.durationMs },
        snapBack:     { duration: MOTION.sheetSnapBack.durationMs,     dampingRatio: SHEET_DAMPING_RATIO },
      }),
      [],
    );
    // translateY: 0 = fully visible, restingHeight = fully hidden
    const translateY = useSharedValue(restingHeight);

    // D-09 / QUAL-03: ref to the header View so we can move VoiceOver focus
    // into the sheet on open (AccessibilityInfo.setAccessibilityFocus).
    const headerRef = React.useRef<View>(null);

    const notifyChange = React.useCallback(
      (index: number) => {
        onChange?.(index);
      },
      [onChange],
    );

    // Move VoiceOver/TalkBack focus to the sheet header on open.
    const moveFocusToSheet = React.useCallback(() => {
      const tag = findNodeHandle(headerRef.current);
      if (tag != null) {
        AccessibilityInfo.setAccessibilityFocus(tag);
      }
    }, []);

    // Return focus to the caller's trigger element on close.
    const returnFocusToTrigger = React.useCallback(() => {
      if (returnFocusRef?.current != null) {
        const tag = findNodeHandle(returnFocusRef.current);
        if (tag != null) {
          AccessibilityInfo.setAccessibilityFocus(tag);
        }
      }
      // If no returnFocusRef, the Modal teardown returns OS focus naturally —
      // not a dead end (D-09 limitation documented in SUMMARY).
    }, [returnFocusRef]);

    const finishClose = React.useCallback(() => {
      setVisible(false);
      notifyChange(0);
      returnFocusToTrigger();
    }, [notifyChange, returnFocusToTrigger]);

    const openSheet = React.useCallback(() => {
      setVisible(true);
      translateY.value = restingHeight;
      if (reduceMotion) {
        translateY.value = 0;
        notifyChange(1);
        moveFocusToSheet();
        return;
      }
      translateY.value = withSpring(
        0,
        { duration: sheetMotion.open.duration, dampingRatio: sheetMotion.open.dampingRatio },
        (finished) => {
          if (finished === true) {
            runOnJS(notifyChange)(1);
            runOnJS(moveFocusToSheet)();
          }
        },
      );
    }, [translateY, restingHeight, notifyChange, moveFocusToSheet, reduceMotion, sheetMotion]);

    const closeSheet = React.useCallback(() => {
      if (reduceMotion) {
        translateY.value = restingHeight;
        finishClose();
        return;
      }
      translateY.value = withTiming(
        restingHeight,
        { duration: sheetMotion.close.duration, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished === true) {
            runOnJS(finishClose)();
          }
        },
      );
    }, [translateY, restingHeight, finishClose, reduceMotion, sheetMotion]);

    React.useImperativeHandle(ref, () => ({ open: openSheet, close: closeSheet }), [
      openSheet,
      closeSheet,
    ]);

    const pan = Gesture.Pan()
      .activeOffsetY([8, 9999])
      .onUpdate((e) => {
        if (e.translationY > 0) {
          translateY.value = e.translationY;
        }
      })
      .onEnd((e) => {
        if (e.translationY > 80) {
          if (reduceMotion) {
            translateY.value = restingHeight;
            runOnJS(finishClose)();
            return;
          }
          translateY.value = withTiming(
            restingHeight,
            { duration: sheetMotion.gestureClose.duration, easing: Easing.out(Easing.cubic) },
            (finished) => {
              if (finished === true) {
                runOnJS(finishClose)();
              }
            },
          );
        } else {
          if (reduceMotion) {
            translateY.value = 0;
            return;
          }
          translateY.value = withSpring(0, {
            duration: sheetMotion.snapBack.duration,
            dampingRatio: sheetMotion.snapBack.dampingRatio,
          });
        }
      });

    const sheetStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: translateY.value }],
    }));

    return (
      <Modal
        transparent
        visible={visible}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.root}>
          <Pressable
            style={styles.backdrop}
            onPress={closeSheet}
            accessibilityLabel="Close"
            accessibilityRole="button"
          />
          <GestureDetector gesture={pan}>
            <Animated.View
              accessibilityViewIsModal
              style={[
                styles.sheet,
                // Default + glass-fallback supply an opaque fill; the glass
                // path supplies the material via the GlassView child below.
                !wantGlass
                  ? { backgroundColor: COLORS.surface }
                  : sheetChrome != null && !sheetChrome.glass
                    ? { backgroundColor: sheetChrome.backgroundColor }
                    : null,
                wantGlass && sheetChrome != null && !sheetChrome.glass
                  ? sheetChrome.shadow
                  : null,
                { height: restingHeight },
                sheetStyle,
              ]}
            >
              {/* Wave 4: warm-glass material behind content (opt-in, gated).
                  pointerEvents none → pan/scroll reach the children. */}
              {renderGlass && sheetChrome != null && sheetChrome.glass && (
                <>
                  <BlurView
                    pointerEvents="none"
                    intensity={sheetChrome.blurIntensity}
                    tint={sheetChrome.blurTint}
                    style={StyleSheet.absoluteFill}
                  />
                  {/* Warm wash over the blur — keeps SOLDI identity (chrome only). */}
                  <View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { backgroundColor: sheetChrome.tintColor }]}
                  />
                </>
              )}
              {/* D-09 / QUAL-03: headerRef is the VoiceOver focus landing target on open */}
              <View
                ref={headerRef}
                style={styles.handleZone}
                accessible
                accessibilityLabel={accessibilityLabel ?? 'Bottom sheet'}
                accessibilityRole="header"
              >
                <View style={styles.handle} />
              </View>
              <View style={styles.body}>{children}</View>
            </Animated.View>
          </GestureDetector>
        </View>
      </Modal>
    );
  },
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `${COLORS.textPrimary}${BACKDROP_ALPHA}`,
  },
  sheet: {
    // backgroundColor is supplied dynamically: default + glass-fallback →
    // opaque (COLORS.surface / chrome bg); glass path → GlassView child.
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  handleZone: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: `${COLORS.textMuted}${HANDLE_MUTED_SUFFIX}`,
  },
  body: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.lg,
  },
});
