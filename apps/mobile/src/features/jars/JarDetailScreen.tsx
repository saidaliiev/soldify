/**
 * JarDetailScreen — shows jar name, target, current balance, animated ring,
 * and a "Sweep round-ups" action (plan 04-02).
 *
 * Hero balance: Oswald displayL (TYPE.displayL) per typography rules.
 * Animated Skia ring: JarRing (animated progress arc, D-05).
 * Sweep: calls sweepToJar() on tap, refreshes balance, animates ring old→new.
 * No raw transaction data shown or logged (CLAUDE.md security rule).
 *
 * A11y: header role on name; all amounts in accessible labels.
 * Tokens only — no hardcoded hex, no BANNED_COLORS.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING, RADIUS } from '@design/tokens';
import { TYPE } from '@design/typography';
import { getJar, jarBalanceCents } from './jarsRepo';
import { sweepToJar } from './sweepRepo';
import { formatMoney } from '@/src/lib/money';
import { JarIcon, type JarIconSlug } from '@design/icons/jars';
import { JarForecastScrubber } from './JarForecastScrubber';
import type { Jar } from './types';

export function JarDetailScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const jarId = parseInt(params.id ?? '0', 10);

  const [jar, setJar] = useState<Jar | null>(null);
  const [balance, setBalance] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  const load = useCallback(() => {
    if (isNaN(jarId) || jarId <= 0) return;
    const found = getJar(jarId);
    if (found == null) return;
    setJar(found);
    setBalance(jarBalanceCents(jarId));
  }, [jarId]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Clear stale sweep result on focus
      setSweepResult(null);
    }, [load]),
  );

  const handleSweep = useCallback(() => {
    if (isNaN(jarId) || jarId <= 0 || sweeping) return;
    setSweeping(true);
    setSweepResult(null);
    try {
      const result = sweepToJar(jarId);
      setBalance(result.newBalanceCents);
      if (result.contributedCents > 0) {
        const amountStr = formatMoney({ amountCents: result.contributedCents, currency: 'EUR' });
        setSweepResult(t('jars.sweep_done', { amount: amountStr }));
      } else {
        setSweepResult(t('jars.sweep_nothing'));
      }
    } catch {
      // WR-05: show error feedback rather than silently clearing the message.
      // CLAUDE.md: "catch blocks fail gracefully (cached data, never crash)" —
      // silent null is not graceful; user sees spinner stop with no explanation.
      setSweepResult(t('jars.error_save'));
    } finally {
      setSweeping(false);
    }
  }, [jarId, sweeping, t]);

  if (jar == null) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: t('jars.title'), headerShown: false }} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundText} allowFontScaling>
            {t('jars.empty_state')}
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('jars.back')}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Text style={styles.backBtnLabel} allowFontScaling>
              {t('jars.back')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const targetStr = formatMoney({ amountCents: jar.targetCents, currency: 'EUR' });
  const iconSlug = jar.icon as JarIconSlug;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen
        options={{
          title: jar.name,
          headerShown: false,
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Back button */}
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('jars.back')}
          style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
        >
          <Text style={styles.backLabel} allowFontScaling>
            ← {t('jars.back')}
          </Text>
        </Pressable>

        {/* C1 — the what-if forecast scrubber is the hero of Jar Detail
            (spec 2026-06-01-jar-forecast-scrubber-design.md). The progress ring
            now lives only in the Jars list as compact status; here the
            projection curve leads. Keyed on jarId AND balance: the scrubber
            seeds weeklyCents/progress once at mount, so a Sweep (which mutates
            balance and shrinks the slider range) must remount it to reseed a
            sensible default plan — otherwise the handle pins outside the new
            range and the projection reads incoherently. */}
        <JarForecastScrubber
          key={`${jarId}-${balance}`}
          balanceCents={balance}
          targetCents={jar.targetCents}
        />

        <View style={styles.jarHeader}>
          <View style={styles.iconWrap}>
            <JarIcon slug={iconSlug} color={COLORS.sage} size={28} />
          </View>
          <Text style={styles.jarName} accessibilityRole="header" allowFontScaling>
            {jar.name}
          </Text>
        </View>

        {/* Target */}
        <View style={styles.targetRow}>
          <Text style={styles.targetLabel} allowFontScaling>
            {t('jars.target_display_label')}
          </Text>
          <Text style={styles.targetValue} allowFontScaling>
            {targetStr}
          </Text>
        </View>

        {/* Sweep result message */}
        {sweepResult != null && (
          <View style={styles.sweepResultWrap}>
            <Text style={styles.sweepResultText} allowFontScaling>
              {sweepResult}
            </Text>
          </View>
        )}

        {/* Sweep CTA */}
        <Pressable
          onPress={handleSweep}
          disabled={sweeping}
          accessibilityRole="button"
          accessibilityLabel={t('jars.sweep_cta')}
          style={({ pressed }) => [
            styles.sweepBtn,
            pressed && !sweeping && styles.pressed,
            sweeping && styles.sweepBtnDisabled,
          ]}
        >
          {sweeping ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.sweepBtnLabel} allowFontScaling>
              {t('jars.sweep_cta')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  backRow: {
    paddingVertical: SPACING.md,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  backLabel: {
    ...TYPE.uiBody,
    color: COLORS.accent,
  },
  jarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: `${COLORS.sage}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jarName: {
    // Wave 5: Garamond editorial name per HTML §6 (21pt). Not displayM (Oswald)
    // — Oswald is reserved for the hero amount that lives inside the ring.
    ...TYPE.editorialLead,
    fontSize: 21,
    lineHeight: 26,
    color: COLORS.textPrimary,
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  targetLabel: {
    ...TYPE.uiLabel,
    color: COLORS.textMuted,
  },
  targetValue: {
    ...TYPE.tabular,
    color: COLORS.textSecondary,
  },
  sweepResultWrap: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: `${COLORS.sage}1A`,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  sweepResultText: {
    ...TYPE.uiBody,
    color: COLORS.sageDeep,
    textAlign: 'center',
  },
  sweepBtn: {
    height: 52,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.sage,
    marginTop: SPACING.md,
    minHeight: 44,
  },
  sweepBtnDisabled: {
    opacity: 0.4,
  },
  sweepBtnLabel: {
    ...TYPE.uiButton,
    color: COLORS.white,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    rowGap: SPACING.md,
  },
  notFoundText: {
    ...TYPE.editorialBody,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  backBtn: {
    height: 48,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnLabel: {
    ...TYPE.uiButton,
    color: COLORS.white,
  },
  pressed: {
    opacity: 0.7,
  },
});
