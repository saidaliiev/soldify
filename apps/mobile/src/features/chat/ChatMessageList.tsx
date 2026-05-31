/**
 * ChatMessageList — scrollable FlashList of user + assistant messages.
 *
 * UI-SPEC §ChatMessageList:
 * - FlashList v2; estimatedItemSize=88; getItemType by role; inverted=false
 * - Horizontal padding SPACING.md; top padding SPACING.xl; bottom SPACING.md
 * - Auto-scroll-to-end on messages.length increase (smooth)
 * - Inter-bubble spacing: same author = SPACING.sm (8pt); different = SPACING.md (16pt)
 * - accessibilityLabel="Chat messages"
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { FlashListRef } from '@shopify/flash-list';

import { SPACING } from '@design/tokens';
import { ChatBubbleUser } from './ChatBubbleUser';
import { ChatBubbleAssistant } from './ChatBubbleAssistant';
import { ChatBubbleAssistantTyping } from './ChatBubbleAssistantTyping';
import type { ChatMessage } from './chatStore';

type Props = {
  readonly messages: readonly ChatMessage[];
  readonly onRetryAssistant?: (messageId: string) => void;
};

function getItemType(item: ChatMessage): string {
  return item.role;
}

function keyExtractor(item: ChatMessage): string {
  return item.id;
}

export function ChatMessageList({ messages, onRetryAssistant }: Props): React.JSX.Element {
  const listRef = React.useRef<FlashListRef<ChatMessage>>(null);
  const prevLengthRef = React.useRef(messages.length);

  // Auto-scroll to end when messages are added
  React.useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      // Small delay to let the new item render before scrolling
      const timer = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 50);
      prevLengthRef.current = messages.length;
      return () => clearTimeout(timer);
    }
    prevLengthRef.current = messages.length;
    return undefined;
  }, [messages.length]);

  const renderItem = React.useCallback(
    ({ item, index }: { item: ChatMessage; index: number }): React.JSX.Element => {
      const prev = index > 0 ? messages[index - 1] : undefined;
      const sameAuthor = prev != null && prev.role === item.role;
      const marginBottom = sameAuthor ? SPACING.sm : SPACING.md;

      if (item.role === 'user') {
        return (
          <View style={{ marginBottom }}>
            <ChatBubbleUser message={item} />
          </View>
        );
      }

      if (item.role === 'assistant-typing') {
        return (
          <View style={{ marginBottom }}>
            <ChatBubbleAssistantTyping />
          </View>
        );
      }

      // role === 'assistant'
      return (
        <View style={{ marginBottom }}>
          <ChatBubbleAssistant
            message={item}
            onRetry={
              item.isError === true && onRetryAssistant != null
                ? () => onRetryAssistant(item.id)
                : undefined
            }
          />
        </View>
      );
    },
    [messages, onRetryAssistant],
  );

  const mutableMessages = messages as ChatMessage[];

  return (
    <FlashList
      ref={listRef}
      data={mutableMessages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      accessibilityLabel="Chat messages"
    />
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
  },
});
