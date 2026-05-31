/**
 * Transaction detail / edit screen — UI-SPEC has no full spec for this
 * surface; layout follows the 8pt grid + TYPE presets.
 *
 * Fields: merchant (text), amount (decimal), date (read-only Pressable —
 * native date picker landed in plan 02-03 Task 3's verification — for
 * Task 2 we render the ISO date as an editable text field with the
 * occurred_at unix-sec value reconstructed on Save), category (Pressable
 * → opens RecategorizeBottomSheet).
 *
 * Save CTA at bottom — full-width 52pt, COLORS.accent (gradient swap is
 * left for the polish pass per EmptyState's gradient deferral).
 *
 * Security: no console.log of merchant/amount in production builds.
 */

import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams, Stack } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@design/tokens';
import { TYPE } from '@design/typography';
import {
  getTransactionById,
  updateTransaction,
} from '@data/transactionsRepo';
import { parseAmount, toCents, formatMoney } from '@lib/money';
import { useRecategorizeStore } from '@/src/features/transactions/recategorizeStore';
import { CategoryChip } from '@/src/features/transactions/CategoryChip';
import type { Transaction } from '@/src/features/transactions/types';

function unixToISODate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function isoDateToUnix(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = new Date(`${yyyyMmDd}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 1000);
}

export default function TransactionDetailScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txId = Number(Array.isArray(id) ? id[0] : id);
  const locale = i18n.language === 'uk' ? 'uk-UA' : 'en-IE';
  const openRecategorize = useRecategorizeStore((s) => s.openFor);

  const [tx, setTx] = React.useState<Transaction | null>(null);
  const [merchant, setMerchant] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [dateISO, setDateISO] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(() => {
    if (!Number.isFinite(txId) || txId <= 0) {
      setError(true);
      return;
    }
    try {
      const fresh = getTransactionById(txId);
      if (fresh == null) {
        setError(true);
        return;
      }
      setTx(fresh);
      setMerchant(fresh.merchantName);
      setAmount((Math.abs(fresh.amountCents) / 100).toFixed(2));
      setDateISO(unixToISODate(fresh.dateSec));
      setCategoryId(fresh.categoryId);
      setError(false);
    } catch {
      setError(true);
    }
  }, [txId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleOpenRecategorize = React.useCallback(() => {
    if (tx == null) return;
    openRecategorize(tx.id, (newCategoryId) => {
      setCategoryId(newCategoryId);
      // Refresh tx for chip display (icon/color follow categoryId change).
      try {
        const fresh = getTransactionById(tx.id);
        if (fresh != null) setTx(fresh);
      } catch {
        // ignore — chip falls back to existing tx data
      }
    });
  }, [tx, openRecategorize]);

  const handleSave = React.useCallback(() => {
    if (tx == null) return;
    setSaving(true);
    try {
      const parsedAmount = parseAmount(amount);
      const amountCents =
        parsedAmount != null
          ? (tx.amountCents < 0 ? -1 : 1) * Math.abs(toCents(parsedAmount))
          : tx.amountCents;
      const occurredAt = isoDateToUnix(dateISO) ?? tx.dateSec;

      updateTransaction(tx.id, {
        merchant_name: merchant.trim() === '' ? tx.merchantName : merchant.trim(),
        amount_cents: amountCents,
        occurred_at: occurredAt,
        category_id: categoryId,
      });
      router.back();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [tx, amount, dateISO, merchant, categoryId]);

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel="Transaction detail">
      <Stack.Screen
        options={{
          title: t('transactions.detail_title'),
          headerShown: true,
          // Chevron-only back button. Without this, native-stack falls back to
          // the previous route's title — the "(tabs)" group segment then leaks
          // as the back label (smoke-test 2026-05-31).
          headerBackButtonDisplayMode: 'minimal',
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          {error || tx == null ? (
            <Text style={styles.errorText} allowFontScaling>
              {t('transactions.error_search')}
            </Text>
          ) : (
            <>
              <Text style={styles.amountHero} allowFontScaling>
                {formatMoney(
                  { amountCents: Math.abs(tx.amountCents), currency: tx.currency },
                  locale,
                )}
              </Text>

              <View style={styles.field}>
                <Text style={styles.label} allowFontScaling>
                  {t('transactions.field_merchant')}
                </Text>
                <TextInput
                  value={merchant}
                  onChangeText={setMerchant}
                  style={styles.input}
                  accessibilityLabel={t('transactions.field_merchant')}
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label} allowFontScaling>
                  {t('transactions.field_amount')}
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  accessibilityLabel={t('transactions.field_amount')}
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label} allowFontScaling>
                  {t('transactions.field_date')}
                </Text>
                <TextInput
                  value={dateISO}
                  onChangeText={setDateISO}
                  style={styles.input}
                  accessibilityLabel={t('transactions.field_date')}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label} allowFontScaling>
                  {t('transactions.field_category')}
                </Text>
                <Pressable
                  onPress={handleOpenRecategorize}
                  style={styles.categoryPressable}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('transactions.field_category')} ${tx.categoryName ?? 'Other'}`}
                >
                  <CategoryChip
                    slug={null}
                    name={tx.categoryName ?? 'Other'}
                    color={tx.categoryColor}
                    emoji={tx.categoryEmoji}
                    size="md"
                  />
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel={t('transactions.detail_save')}
            disabled={saving || tx == null}
            style={({ pressed }) => [
              styles.saveCta,
              pressed && styles.saveCtaPressed,
              (saving || tx == null) && styles.saveCtaDisabled,
            ]}
          >
            <Text style={styles.saveLabel} allowFontScaling>
              {t('transactions.detail_save')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    rowGap: SPACING.lg,
  },
  amountHero: {
    ...TYPE.displayL,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  field: { rowGap: SPACING.xs },
  label: {
    ...TYPE.uiMeta,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
  },
  input: {
    ...TYPE.uiBody,
    color: COLORS.textPrimary,
    height: 44,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: `${COLORS.textMuted}33`,
  },
  categoryPressable: {
    minHeight: 44,
    justifyContent: 'center',
  },
  footer: {
    padding: SPACING.lg,
  },
  saveCta: {
    height: 52,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveCtaPressed: {
    backgroundColor: COLORS.accentDeep,
  },
  saveCtaDisabled: {
    opacity: 0.6,
  },
  saveLabel: {
    ...TYPE.uiButton,
    color: COLORS.white,
  },
  errorText: {
    ...TYPE.uiBody,
    color: COLORS.error,
    textAlign: 'center',
    paddingTop: SPACING.xl,
  },
});
