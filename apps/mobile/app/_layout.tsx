import {
  Oswald_300Light,
  Oswald_500Medium,
  Oswald_700Bold,
  useFonts as useOswald,
} from '@expo-google-fonts/oswald';
import {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
  EBGaramond_600SemiBold,
  useFonts as useGaramond,
} from '@expo-google-fonts/eb-garamond';
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts as useManrope,
} from '@expo-google-fonts/manrope';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import * as LocalAuthentication from 'expo-local-authentication';

// Side-effect import: registers foreground notification handler at module load
// (must run before any notification can fire — T-05-07 / notificationHandler.ts)
import '@/src/features/notifications/notificationHandler';
import { scheduleDailyDigest } from '@/src/features/notifications/digestNotification';

import { COLORS } from '@design/tokens';
import { queryClient } from '@api/queryClient';
import { getDB, runMigrations } from '@lib/db';
import { initI18n, i18n } from '@lib/i18n';
import { markColdStart, markAppReady } from '@lib/perf';
import { initObservability } from '@lib/observability';
import { useOnboardingStore } from '@stores/onboarding';
import { RecategorizeBottomSheet } from '@/src/features/transactions/RecategorizeBottomSheet';
import { PropagationToast } from '@/src/features/transactions/PropagationToast';
import { ChatBottomSheet } from '@/src/features/chat/ChatBottomSheet';
// Sentry.wrap (below) needs the namespace; init itself is owned solely by
// initObservability() (lib/observability.ts) — privacy-filtered (beforeBreadcrumb
// drops financial fields), DSN from EXPO_PUBLIC_SENTRY_DSN, no sendDefaultPii.
// The sentry-wizard-injected Sentry.init({ sendDefaultPii: true }) was removed:
// it duplicated init and over-collected PII against CLAUDE.md fintech privacy.
import * as Sentry from '@sentry/react-native';
import { RootErrorBoundary } from '@/src/components/RootErrorBoundary';
import { setBootError } from '@lib/bootError';

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignored
});

// QUAL-05: Cold-start instrumentation — module-load mark (origin timestamp).
// perf.ts captures Date.now() at import time; markColdStart() is the auditable
// call-site confirming the mark is intentional (grep target in SUMMARY).
markColdStart();

// T-05-16/17: Crash monitoring init — no-ops gracefully when EXPO_PUBLIC_SENTRY_DSN
// is absent (P0 #7); idempotent; must run before the render gate so perf.ts
// measurements can enrich into Sentry once keys are provided. Return value
// gates Sentry.wrap so the SDK never emits "wrap before init" on DSN-less builds.
const _sentryActive = initObservability();

// DIAGNOSTIC (build #11): the TF#10 cold-start crash is not captured by Sentry
// (early-boot crash-loop) and cannot be symbolicated on this Windows/WSL setup
// (no Mac/atos/llvm). Intercept fatal JS errors so RootErrorBoundary can render
// the exact message+stack on-device instead of the process aborting silently.
// Chains to the default handler as NON-fatal so the app survives to draw the
// overlay. Remove once the crash root cause is found. Stores message/stack only.
{
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((e: Error, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (h: (e: Error, isFatal?: boolean) => void) => void;
    };
  };
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
    try {
      setBootError({
        message: error?.message ?? String(error),
        stack: error?.stack,
        source: isFatal ? 'fatal' : 'error',
      });
    } catch {
      // never let the diagnostic handler itself throw
    }
    prev?.(error, false);
  });
}

// D-01: 5-minute background threshold — a code constant, not a user setting.
const RESUME_LOCK_MS = 5 * 60 * 1000;

/**
 * Prompts biometric / device passcode authentication.
 * D-01: disableDeviceFallback=false → OS passcode offered on biometric failure.
 * No app-level retry cap — iOS biometric lockout handles excessive failures.
 * Returns true on success, false on any failure or throw.
 * Never logs failure detail (CLAUDE.md security rule / T-05-01).
 */
async function authenticateDevice(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Soldify',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false, // D-01: OS passcode fallback, no app retry cap
    });
    return result.success;
  } catch {
    // Never log biometric failure details (CLAUDE.md security rule)
    return false;
  }
}

function RootLayout() {
  // D-07: read persisted language for root key-bump remount.
  // When LanguageToggle calls setLanguage, this selector re-fires → language
  // changes → key on I18nextProvider changes → full subtree remount.
  // This retranslates module-scope t(), Intl.DateTimeFormat date headers, and
  // FlashList sticky headers that don't update via useTranslation() alone.
  const language = useOnboardingStore((s) => s.language) ?? 'en';
  const biometricEnabled = useOnboardingStore((s) => s.biometricEnabled);
  const digestEnabled = useOnboardingStore((s) => s.digestEnabled);

  // T-05-01: biometricPassed gates the render — null returned until auth succeeds.
  // Initialised to true when biometric is disabled (no gate needed).
  const [biometricPassed, setBiometricPassed] = useState(!biometricEnabled);

  const [oswaldLoaded] = useOswald({
    Oswald: Oswald_500Medium,
    Oswald_300Light,
    Oswald_500Medium,
    Oswald_700Bold,
  });

  const [garamondLoaded] = useGaramond({
    EBGaramond: EBGaramond_400Regular,
    EBGaramond_400Regular,
    EBGaramond_400Regular_Italic,
    EBGaramond_600SemiBold,
  });

  const [manropeLoaded] = useManrope({
    Manrope: Manrope_500Medium,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  const fontsLoaded = oswaldLoaded && garamondLoaded && manropeLoaded;

  const [i18nReady, setI18nReady] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {
        // ignored
      });
    }
  }, [fontsLoaded]);

  useEffect(() => {
    void (async () => {
      await initI18n();
      setI18nReady(true);

      try {
        runMigrations(getDB());
        setDbReady(true);
      } catch (err) {
        // CR-03: do NOT set dbReady=true on migration failure.
        // runMigrations wraps each migration in BEGIN/ROLLBACK so a crash
        // mid-migration leaves PRAGMA user_version unchanged — the migration
        // retries on next launch. Unblocking the UI with a partially-migrated
        // schema (e.g. missing jars/jar_contributions tables) causes crashes
        // that are harder to diagnose than a blank screen.
        // Log only error.name — never SQL fragments, values, or token bytes (T-01-01-02).
        const migrationErrName = err instanceof Error ? err.name : 'UnknownError';
        console.error('migration failed — DB not ready:', migrationErrName);
        // dbReady stays false → app renders null (splash stays visible).
        // On next cold start the migration retries from the last committed version.
      }
    })();
  }, []);

  // T-05-01: Cold-start biometric gate — runs once after db/i18n/fonts are ready.
  // If biometricEnabled is false, biometricPassed was initialised true → no-op.
  // If true, authenticate and re-attempt on failure until success (never render
  // partial UI on failed auth — T-05-01 ASVS L1 auth-on-open).
  useEffect(() => {
    if (!biometricEnabled) {
      setBiometricPassed(true);
      return;
    }
    if (!fontsLoaded || !i18nReady || !dbReady) return;

    let cancelled = false;
    void (async () => {
      // Re-attempt on failure — never render partial UI on failed auth (T-05-01).
      // iOS handles lockout after excessive failures.
      while (true) {
        const passed = await authenticateDevice();
        if (cancelled) return;
        if (passed) {
          setBiometricPassed(true);
          return;
        }
        // Failed auth (e.g. cancelled by user) — loop re-prompts immediately.
        // No failure logging (CLAUDE.md security rule).
      }
    })();
    return () => { cancelled = true; };
  }, [biometricEnabled, fontsLoaded, i18nReady, dbReady]);

  // D-01: AppState resume gate — re-locks after > 5 minutes backgrounded.
  // 05-02 extension: on every 'active' transition while digestEnabled, re-schedule
  // the 09:00 digest with a freshly computed yesterday-spend body (D-03: iOS
  // calendar triggers freeze content.body at schedule time — must rebuild daily).
  // The digest re-schedule is a sibling of the biometric check, not nested inside
  // the elapsed-time gate — it fires on every foreground regardless of elapsed time.
  useEffect(() => {
    let backgroundedAt: number | null = null;

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        backgroundedAt = Date.now();
      } else if (nextState === 'active' && backgroundedAt !== null) {
        const elapsed = Date.now() - backgroundedAt;
        backgroundedAt = null;

        // Biometric re-lock (05-01) — only when elapsed > threshold
        if (biometricEnabled && elapsed > RESUME_LOCK_MS) {
          setBiometricPassed(false); // triggers render-gate → re-auth via cold-start effect
        }

        // D-03 / NOTIF-01: re-schedule digest so body reflects THIS day's spend.
        // Unconditional on elapsed time — cancel-before-reschedule is idempotent
        // (T-05-10); graceful so a notification failure never affects the biometric branch.
        if (digestEnabled) {
          scheduleDailyDigest(true).catch(() => {
            // err.name logged inside scheduleDailyDigest; swallow here
          });
        }
      }
    });
    return () => sub.remove();
  }, [biometricEnabled, digestEnabled]);

  // T-05-01: Render gate — never render partial UI when auth is pending/failed.
  if (!fontsLoaded || !i18nReady || !dbReady || !biometricPassed) {
    return null;
  }

  // QUAL-05: Cold-start mark — gate is open, first interactive render is imminent.
  // biometric auth time IS included in coldStartMs (user-perceived time to interactive).
  // Called here (not in an effect) so it fires on the same synchronous pass that
  // produces the first real render. Idempotent — safe across React re-renders.
  markAppReady();

  return (
    <RootErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        {/* key={language} — D-07 root key-bump: changing language forces a full
            remount of the I18nextProvider subtree, retranslating module-scope
            t() calls, Intl.DateTimeFormat date headers, and FlashList sticky
            headers. Brief flash on explicit user language-switch is accepted. */}
        <I18nextProvider key={language} i18n={i18n}>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: COLORS.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="transactions/[id]"
              options={{ title: 'Transaction' }}
            />
            <Stack.Screen
              name="transactions/search"
              options={{ presentation: 'modal', headerShown: false }}
            />
            <Stack.Screen
              name="settings"
              options={{ title: 'Settings', presentation: 'card', headerShown: false }}
            />
            <Stack.Screen
              name="categories"
              options={{ title: 'Categories', presentation: 'card', headerShown: false }}
            />
          </Stack>
          <RecategorizeBottomSheet />
          <PropagationToast />
          <ChatBottomSheet />
          <StatusBar style="dark" />
        </I18nextProvider>
      </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </RootErrorBoundary>
  );
}

// Gate Sentry.wrap on actual init so the SDK never emits "wrap before init"
// on DSN-less builds (EAS preview profile has no EXPO_PUBLIC_SENTRY_DSN).
export default _sentryActive ? Sentry.wrap(RootLayout) : RootLayout;
