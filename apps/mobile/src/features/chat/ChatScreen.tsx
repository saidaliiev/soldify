/**
 * ChatScreen — full-screen Chat tab surface (HTML §7).
 *
 * Replaces the chat-FAB-and-bottom-sheet entry point: Chat is now a
 * first-class tab destination per the docs/design/soldify-screens.html
 * §2 tab bar (Overview / Activity / Jars / Chat).
 *
 * Composition (reuses the chat feature primitives that ChatBottomSheet
 * also uses, so a single source of truth for bubbles/input/error):
 *   - In-body Oswald title (matches the Transactions/Settings pattern —
 *     native stack header is hidden via _layout.tsx)
 *   - ChatEmptyState when no messages; ChatMessageList otherwise
 *   - ChatErrorBanner anchored between list and input
 *   - ChatInputRow anchored bottom with safe-area + tab-bar clearance
 *   - KeyboardAvoidingView padding behavior on iOS
 *
 * Accessibility: header labelled, message list role=list (in
 * ChatMessageList), input row has its own labels.
 */

import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING } from '@design/tokens';
import { TYPE } from '@design/typography';

import { useChatStore } from './chatStore';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatMessageList } from './ChatMessageList';
import { ChatInputRow } from './ChatInputRow';
import { ChatErrorBanner } from './ChatErrorBanner';
import { TAB_BAR_HEIGHT, TAB_BAR_FLOATING_MARGIN } from '@/src/features/chrome/GlassTabBar';

export function ChatScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const lastError = useChatStore((s) => s.lastError);

  const [prefillText, setPrefillText] = React.useState<string | undefined>(undefined);

  const handlePromptSubmit = React.useCallback((prompt: string) => {
    setPrefillText(prompt);
  }, []);

  const handlePrefillConsumed = React.useCallback(() => {
    setPrefillText(undefined);
  }, []);

  const handleRetryAssistant = React.useCallback((): void => {
    useChatStore.getState().retryLast().catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel={t('chat.sheet_title')}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header} accessibilityRole="header">
          <Text style={styles.title} allowFontScaling numberOfLines={1}>
            {t('chat.header_title')}
          </Text>
          <Text style={styles.subline} allowFontScaling numberOfLines={1}>
            {t('chat.header_subline')}
          </Text>
        </View>

        <View style={styles.body}>
          {messages.length === 0 ? (
            // The input is multiline (Return inserts a newline, never dismisses)
            // and there is no scroll list on the empty state, so without this the
            // keyboard could not be dismissed at all (smoke-test 2026-05-31).
            // Tapping the empty area drops focus; the chips keep their own taps.
            <Pressable
              style={styles.flex}
              onPress={() => Keyboard.dismiss()}
              accessible={false}
            >
              <ChatEmptyState onSubmitPrompt={handlePromptSubmit} />
            </Pressable>
          ) : (
            <ChatMessageList
              messages={messages}
              onRetryAssistant={handleRetryAssistant}
            />
          )}
        </View>

        <ChatErrorBanner visible={lastError != null} />

        {/* The floating GlassTabBar (position:absolute) overlays the bottom of
            every tab screen, so this bottom-anchored input row rendered BEHIND
            it — the field + send button were unreachable. Reserve the bar's
            footprint (height + floating margin) so the row docks above it. */}
        <View style={styles.inputDock}>
          <ChatInputRow
            prefillText={prefillText}
            onPrefillConsumed={handlePrefillConsumed}
          />
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
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: {
    ...TYPE.displayM,
    color: COLORS.textPrimary,
  },
  subline: {
    ...TYPE.uiBody,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs / 2,
  },
  body: {
    flex: 1,
  },
  inputDock: {
    marginBottom: TAB_BAR_HEIGHT + TAB_BAR_FLOATING_MARGIN,
  },
});
