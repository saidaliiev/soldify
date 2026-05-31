/**
 * CategoriesScreen — third tab. Lists Default + Custom categories with
 * the + button to create. Tap row to edit; long-press to drag-merge.
 */

import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING, RADIUS } from '@design/tokens';
import { TYPE } from '@design/typography';
import {
  listCategoriesEnriched,
  getCategoryById,
  localizedCategoryName,
  type Category,
} from '@data/categoriesRepo';
import { useCategoryEditorStore } from '@/src/features/categories/store';
import { CategoryListRow } from '@/src/features/categories/CategoryListRow';
import { CategoryEditorBottomSheet } from '@/src/features/categories/CategoryEditorBottomSheet';
import { DragMergeProvider } from '@/src/features/categories/DragMergeContext';
import { ConfirmModal } from '@/src/components/BottomSheet/ConfirmModal';
import { mergeCategories } from '@/src/features/categories/categoryMutations';

type MergeRequest = { readonly fromId: number; readonly toId: number };

export default function CategoriesScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const openForEdit = useCategoryEditorStore((s) => s.openForEdit);
  const openForCreate = useCategoryEditorStore((s) => s.openForCreate);
  const [categories, setCategories] = React.useState<readonly Category[]>([]);
  const [merge, setMerge] = React.useState<MergeRequest | null>(null);

  const refresh = React.useCallback(() => {
    setCategories(listCategoriesEnriched());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refresh();
      return undefined;
    }, [refresh]),
  );

  const defaults = categories.filter((c) => !c.isCustom);
  const customs = categories.filter((c) => c.isCustom);

  const handleMergeRequest = (fromId: number, toId: number) => {
    setMerge({ fromId, toId });
  };

  const handleMergeConfirm = () => {
    if (merge == null) return;
    try {
      mergeCategories(merge.fromId, merge.toId);
      setMerge(null);
      refresh();
    } catch {
      setMerge(null);
    }
  };

  const fromCat = merge != null ? getCategoryById(merge.fromId) : null;
  const toCat = merge != null ? getCategoryById(merge.toId) : null;

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel="Categories screen">
      {/* In-body back affordance — this is a pushed route with the native stack
          header hidden (app/_layout.tsx), so without this the only way back is
          the edge swipe, which gives the user no visible cue (smoke-test
          2026-05-31). Mirrors the Settings/JarDetail back row. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
      >
        <Text style={styles.backLabel} allowFontScaling>
          ‹ {t('common.back', { defaultValue: 'Back' })}
        </Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" allowFontScaling>
          Categories
        </Text>
        <Pressable
          onPress={() => openForCreate()}
          accessibilityRole="button"
          accessibilityLabel={t('categories.cta_new')}
          style={({ pressed }) => [styles.plus, pressed && styles.pressed]}
        >
          <Text style={styles.plusGlyph} allowFontScaling>
            +
          </Text>
        </Pressable>
      </View>

      <DragMergeProvider onMergeRequest={handleMergeRequest}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionLabel} allowFontScaling>
            {t('categories.section_default')}
          </Text>
          {defaults.map((c) => (
            <CategoryListRow key={c.id} category={c} onPress={openForEdit} />
          ))}

          <View style={styles.separator} />

          <Text style={styles.sectionLabel} allowFontScaling>
            {t('categories.section_custom')}
          </Text>
          {customs.length === 0 ? (
            <Text style={styles.emptyCustom} allowFontScaling>
              {t('categories.empty_custom')}
            </Text>
          ) : (
            customs.map((c) => (
              <CategoryListRow key={c.id} category={c} onPress={openForEdit} />
            ))
          )}
        </ScrollView>
      </DragMergeProvider>

      <CategoryEditorBottomSheet />

      {fromCat != null && toCat != null ? (
        <ConfirmModal
          visible={merge != null}
          title={t('categories.merge_title')}
          body={t('categories.merge_confirm_body', {
            from: localizedCategoryName(fromCat, i18n.language),
            to: localizedCategoryName(toCat, i18n.language),
          })}
          confirmLabel={t('categories.merge_confirm')}
          cancelLabel={t('categories.cancel')}
          destructive
          onConfirm={handleMergeConfirm}
          onCancel={() => setMerge(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  backLabel: {
    ...TYPE.uiBody,
    color: COLORS.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  title: {
    ...TYPE.displayM,
    color: COLORS.textPrimary,
    flex: 1,
  },
  plus: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusGlyph: {
    ...TYPE.displayM,
    color: COLORS.accent,
    lineHeight: 28,
  },
  scroll: {
    paddingBottom: SPACING.xl,
    rowGap: SPACING.xs,
  },
  sectionLabel: {
    ...TYPE.uiLabel,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  separator: {
    height: 1,
    backgroundColor: `${COLORS.textMuted}33`,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
  },
  emptyCustom: {
    ...TYPE.editorialBody,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
