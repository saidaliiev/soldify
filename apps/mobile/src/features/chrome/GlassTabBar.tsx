/**
 * SOLDI frosted-blur floating tab bar (redesign Wave 1; blur migration
 * 2026-06-01).
 *
 * The DECISION + style lives in the pure, node-tested src/design/glass.ts; the
 * blur primitive comes via the src/lib/blurChrome.ts boundary. Screens never
 * import expo-blur — they get this bar via app/(tabs)/_layout.tsx's `tabBar`
 * prop. This component only:
 *   1. reads reduce-transparency at the RN boundary (isBlurSafe),
 *   2. asks glass.ts what to render,
 *   3. renders a BlurView frosted pill (glass) OR a solid View (fallback).
 *
 * Fallback is mandatory and equally premium (spec §2.2): Android + reduce-
 * transparency render an explicit solid warm fill + ELEVATION.floating — never
 * an empty bar. Tab switching is instant (spec — no tab-switch motion preset).
 *
 * Replaced expo-glass-effect (0.1.x beta — TF#8/#10 cold-start crash suspect,
 * expo/expo#40911) with stable expo-blur.
 *
 * Accessibility: each tab is role="tab" with selected state + i18n label; tap
 * target ≥ 44pt (spec R5). reduce-transparency forces the solid path via
 * AccessibilityInfo.isReduceTransparencyEnabled().
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, ELEVATION, RADIUS, SPACING } from '@design/tokens';
import { TYPE } from '@design/typography';
import { resolveTabBarChrome } from '@/src/design/glass';
import { BlurView, isBlurSafe } from '@lib/blurChrome';
import {
  DashboardIcon,
  TransactionsIcon,
  JarsIcon,
  ChatIcon,
} from '@/src/design/icons/tabs';

const MIN_TAP = 44; // spec R5 — minimum tap target (pt)
// Exposed so screen ScrollViews can clear the floating tab bar (Sprint E2).
// Total bottom clearance a content list needs = TAB_BAR_HEIGHT +
// TAB_BAR_FLOATING_MARGIN + safe-area insets.bottom.
export const TAB_BAR_HEIGHT = 56;
export const TAB_BAR_FLOATING_MARGIN = SPACING.md;
const BAR_HEIGHT = TAB_BAR_HEIGHT;
const BAR_MARGIN = TAB_BAR_FLOATING_MARGIN; // floating inset from screen edges

type IconCmp = (props: { color: string; size?: number }) => React.ReactNode;

// route name (expo-router) → tab icon. Only registered routes render —
// allow-list filter in the component below uses this map as the source
// of truth. To add a new tab: register here AND in app/(tabs)/_layout.tsx.
// HTML design (docs/design/soldify-screens.html §2): four tabs in this
// order — Overview / Activity / Jars / Chat.
const ICONS: Record<string, IconCmp> = {
  index: DashboardIcon,
  transactions: TransactionsIcon,
  jars: JarsIcon,
  chat: ChatIcon,
};

export function GlassTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  // reduce-transparency: glass may still report available under a11y limits.
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
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
  // Android + reduce-transparency fall back to the solid bar. expo-blur is
  // stable — none of the iOS-26 weak-link crash class the old expo-glass-effect
  // beta carried (TF#8/#10, expo/expo#40911).
  const blurOk = isBlurSafe(reduceTransparency);
  const chrome = resolveTabBarChrome(blurOk);

  const bottom = Math.max(insets.bottom, BAR_MARGIN);

  const tabs = state.routes
    .filter((route) => {
      // Allow-list by registered icon. expo-router v6 does NOT propagate
      // Tabs.Screen `href: null` into descriptor.options, so the previous
      // deny-list (`opts.href !== null`) silently let any unregistered
      // route through as a leaked 5th tab. Routes shipped to the bar must
      // appear in ICONS; anything else is junk and is dropped at render.
      if (!descriptors[route.key]) return false;
      return route.name in ICONS;
    })
    .map((route) => {
      // Non-null: routes reaching here are guaranteed present in descriptors
      // (expo-router populates descriptors for every route in state.routes).
      const { options } = descriptors[route.key]!;
      const routeIndex = state.routes.findIndex((r) => r.key === route.key);
      const focused = state.index === routeIndex;
      const color = focused ? COLORS.accent : COLORS.textMuted; // icon = accent indicator (I-01)
      const labelColor = focused ? COLORS.textPrimary : COLORS.textMuted; // label AA body (I-01)
      // tabBarLabel function overload intentionally unsupported (all SOLDI tabs use string title)
      const label =
        typeof options.tabBarLabel === 'string'
          ? options.tabBarLabel
          : (options.title ?? route.name);
      const Icon = ICONS[route.name];

      const onPress = () => {
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (!focused && !event.defaultPrevented) {
          navigation.navigate(route.name);
        }
      };

      const tabContent = (
        <Pressable
          key={route.key}
          onPress={onPress}
          accessibilityRole="tab"
          accessibilityState={{ selected: focused }}
          accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
          style={styles.tab}
        >
          {Icon ? <Icon color={color} size={24} /> : null}
          {/* maxFontSizeMultiplier=1.0: fixed pill height — label overflow would break
              bar geometry. Deliberate a11y tradeoff; icon + AA contrast carry low-vision. */}
          <Text
            maxFontSizeMultiplier={1.0}
            numberOfLines={1}
            style={[styles.label, { color: labelColor }]}
          >
            {label}
          </Text>
        </Pressable>
      );

      // One BlurView backs the whole pill (below) — tabs render plain on top,
      // matching Instagram's single frosted surface (not per-icon glass).
      return tabContent;
    });

  if (chrome.glass) {
    return (
      <View
        pointerEvents="box-none"
        style={[styles.wrap, { bottom, left: BAR_MARGIN, right: BAR_MARGIN }]}
      >
        {/* Outer = shadow (no overflow); inner = clip. iOS overflow:'hidden'
            sets masksToBounds, which clips the floating drop shadow — so the
            shadow and the rounded clip must live on separate views. */}
        <View style={styles.blurPillShadow}>
          <View style={styles.blurPillClip}>
            <BlurView
              intensity={chrome.blurIntensity}
              tint={chrome.blurTint}
              style={StyleSheet.absoluteFill}
            />
            {/* Low-alpha warm wash over the (cool, iOS-default) blur — keeps
                SOLDI identity without washing out the frost. */}
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: chrome.tintColor }]}
            />
            <View style={styles.row}>{tabs}</View>
          </View>
        </View>
      </View>
    );
  }

  // Mandatory solid fallback — explicit warm fill + floating shadow.
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom, left: BAR_MARGIN, right: BAR_MARGIN }]}
    >
      <View
        style={[
          styles.solidBar,
          { backgroundColor: chrome.backgroundColor },
          chrome.shadow,
        ]}
      >
        {tabs}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
  },
  blurPillShadow: {
    borderRadius: RADIUS.pill,
    ...ELEVATION.floating,
  },
  blurPillClip: {
    borderRadius: RADIUS.pill,
    height: BAR_HEIGHT,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
  },
  solidBar: {
    flexDirection: 'row',
    borderRadius: RADIUS.pill,
    height: BAR_HEIGHT,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    minHeight: MIN_TAP,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    ...TYPE.uiLabel,
  },
});
