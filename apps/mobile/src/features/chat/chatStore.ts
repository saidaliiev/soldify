/**
 * chatStore — ephemeral zustand store for the chat surface.
 *
 * Ephemeral. NO persist middleware (D-14/D-15).
 *
 * Message lifetime: messages survive sheet-close (UI-SPEC "persists for the
 * lifetime of the chat screen mount or until app cold-start"). Because there
 * is no persist middleware, messages are cleared on app cold-start — no
 * explicit clear() needed on sheet-close. close() only sets isOpen=false.
 *
 * retryCount tracks consecutive failures for the error banner copy:
 *   0 → "AI is unavailable. Tap to retry."
 *   >=1 → "Still unavailable. Check your connection."
 */

import { create } from 'zustand';

import type { ChartPayload, FactsPack } from '@services/aiQuery';
import { aiQuery } from '@services/aiQuery';
import { i18n } from '@lib/i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage =
  | { id: string; role: 'user'; text: string; createdAt: number }
  | { id: string; role: 'assistant'; text: string; chart?: ChartPayload; createdAt: number; isError?: boolean }
  | { id: string; role: 'assistant-typing'; createdAt: number };

type ChatState = {
  readonly isOpen: boolean;
  readonly messages: readonly ChatMessage[];
  readonly isAwaitingResponse: boolean;
  readonly lastError: string | null;
  readonly retryCount: number;
  readonly lastFactsPack: FactsPack | null;

  readonly open: () => void;
  readonly close: () => void;
  readonly clear: () => void;
  readonly appendUser: (text: string) => string;
  readonly appendTyping: () => string;
  readonly replaceTypingWithAssistant: (typingId: string, msg: ChatMessage) => void;
  readonly replaceTypingWithError: (typingId: string, errorText: string) => void;
  readonly setError: (text: string | null) => void;
  readonly bumpRetry: () => void;
  readonly resetRetry: () => void;
  readonly retryLast: () => Promise<void>;
  readonly setLastFactsPack: (pack: FactsPack | null) => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  messages: [],
  isAwaitingResponse: false,
  lastError: null,
  retryCount: 0,
  lastFactsPack: null,

  open: () => set({ isOpen: true }),

  close: () => set({ isOpen: false }),

  clear: () =>
    set({
      messages: [],
      isAwaitingResponse: false,
      lastError: null,
      retryCount: 0,
      lastFactsPack: null,
    }),

  appendUser: (text: string): string => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const msg: ChatMessage = { id, role: 'user', text, createdAt: Date.now() };
    set((s) => ({ messages: [...s.messages, msg] }));
    return id;
  },

  appendTyping: (): string => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const msg: ChatMessage = { id, role: 'assistant-typing', createdAt: Date.now() };
    set((s) => ({
      messages: [...s.messages, msg],
      isAwaitingResponse: true,
    }));
    return id;
  },

  replaceTypingWithAssistant: (typingId: string, msg: ChatMessage): void => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === typingId ? msg : m)),
      isAwaitingResponse: false,
    }));
  },

  replaceTypingWithError: (typingId: string, errorText: string): void => {
    const errorMsg: ChatMessage = {
      id: typingId,
      role: 'assistant',
      text: errorText,
      createdAt: Date.now(),
      isError: true,
    };
    set((s) => ({
      messages: s.messages.map((m) => (m.id === typingId ? errorMsg : m)),
      isAwaitingResponse: false,
    }));
  },

  setError: (text: string | null): void => set({ lastError: text }),

  bumpRetry: (): void => set((s) => ({ retryCount: s.retryCount + 1 })),

  resetRetry: (): void => set({ retryCount: 0 }),

  setLastFactsPack: (pack: FactsPack | null): void => set({ lastFactsPack: pack }),

  retryLast: async (): Promise<void> => {
    const { messages, lastFactsPack, appendTyping, replaceTypingWithAssistant, replaceTypingWithError, setError } = get();

    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user') as
      | Extract<ChatMessage, { role: 'user' }>
      | undefined;
    if (!lastUserMsg) return;

    // Remove the last error assistant bubble if present
    const lastErrIdx = [...messages].reverse().findIndex(
      (m) => m.role === 'assistant' && (m as Extract<ChatMessage, { role: 'assistant' }>).isError,
    );
    if (lastErrIdx !== -1) {
      const actualIdx = messages.length - 1 - lastErrIdx;
      set((s) => ({
        messages: s.messages.filter((_, i) => i !== actualIdx),
      }));
    }

    const typingId = appendTyping();

    const history = get()
      .messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m): m is Extract<ChatMessage, { role: 'user' | 'assistant' }> => true)
      .filter((m) => m.id !== typingId)
      .filter((m) => m.role !== 'assistant' || !m.isError)
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.role === 'user' ? (m as Extract<ChatMessage, { role: 'user' }>).text : (m as Extract<ChatMessage, { role: 'assistant' }>).text }));

    try {
      const resp = await aiQuery({
        message: lastUserMsg.text,
        history: history.filter((h) => h.role !== undefined),
        factsPack: lastFactsPack ?? {
          currency: 'EUR',
          date_from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          date_to: new Date().toISOString().slice(0, 10),
          monthly_category_sums: [],
          top_merchants_by_month: [],
        },
      });

      const assistantMsg: ChatMessage = {
        id: typingId,
        role: 'assistant',
        text: resp.text,
        chart: resp.chart,
        createdAt: Date.now(),
      };
      replaceTypingWithAssistant(typingId, assistantMsg);
      setError(null);
    } catch (err) {
      // Never surface the raw Error.message in the UI — it can leak internal
      // config detail (e.g. "[supabase] EXPO_PUBLIC_SUPABASE_URL is not set …",
      // smoke-test 2026-05-31). Show a localized, user-safe line; keep the real
      // cause in dev logs only (AI errors are config/network — no transaction PII).
      if (__DEV__) console.warn('[chat] aiQuery failed:', err);
      const friendly = i18n.t('chat.error_unavailable');
      replaceTypingWithError(typingId, friendly);
      setError(friendly);
    }
  },
}));
