/**
 * SOLDI AI chat service — mobile client.
 *
 * HTTP wrapper for the ai-query Supabase Edge Function (Sonnet 4.6).
 *
 * Security contract:
 * - factsPack contains only aggregates (category names + date ranges + sums).
 *   merchant_key is the normalized form — not raw merchant strings.
 * - NEVER include raw transaction descriptions, merchant display names, or
 *   any row-level data in the request payload.
 * - API call is async/await + try/catch; fails gracefully (CHAT-05).
 *
 * Error translation:
 *   HTTP 503 → Error('Service unavailable')
 *   HTTP 408 → Error('Timeout')
 *   HTTP 429 → Error('Daily limit reached')
 *   Other    → rethrow (or Error('Service unavailable') for 5xx)
 *
 * Analog: apps/mobile/src/services/aiCategorize.ts (same patterns).
 */

import { HttpError, httpJson } from '@lib/http';
import { ensureAnonSession } from '@lib/supabase';

// ---------------------------------------------------------------------------
// Types — hand-typed mirror of chat-schemas.ts to avoid bundling zod in mobile
// ---------------------------------------------------------------------------

export type ChartPayload =
  | { kind: 'sparkline'; values: number[]; kpi?: number; unit?: 'EUR' }
  | {
      kind: 'donut';
      slices: { label: string; value: number; color: 'accent' | 'sage' | 'accentSoft' | 'textMuted' }[];
      kpi?: number;
      unit?: 'EUR';
    }
  | { kind: 'bar'; bars: { label: string; value: number }[]; kpi?: number; unit?: 'EUR' };

export type ChatResponse = {
  text: string;
  chart?: ChartPayload;
};

export type FactsPack = {
  currency: 'EUR' | 'UAH';
  date_from: string;
  date_to: string;
  monthly_category_sums: {
    month: string;
    category_slug: string;
    sum_cents: number;
  }[];
  top_merchants_by_month: {
    month: string;
    merchant_key: string;
    category_slug: string;
    total_cents: number;
    count: number;
  }[];
};

// ---------------------------------------------------------------------------
// aiQuery
// ---------------------------------------------------------------------------

/**
 * Sends a chat message + FactsPack to the ai-query Edge Function and returns
 * the assistant's text response + optional chart payload.
 *
 * 45s timeout — generous; real-world target is < 3s (CHAT-02). The extra
 * headroom handles slow network conditions without a hard failure.
 *
 * @throws Error with user-facing message on failure (503/408/429/network)
 */
export async function aiQuery(args: {
  message: string;
  history: readonly { role: 'user' | 'assistant'; text: string }[];
  factsPack: FactsPack;
}): Promise<ChatResponse> {
  const session = await ensureAnonSession();
  if (session == null) {
    throw new Error('Service unavailable');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('[aiQuery] EXPO_PUBLIC_SUPABASE_URL is not set');
  }

  const url = `${supabaseUrl}/functions/v1/ai-query`;

  try {
    const response = await httpJson<ChatResponse>(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: args.message,
        history: args.history,
        facts_pack: args.factsPack,
        // NEVER include: description, raw transactions, or any row-level data (CHAT-04)
      }),
      timeoutMs: 45_000,
    });

    return response;
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 503 || err.status >= 500) throw new Error('Service unavailable');
      if (err.status === 408) throw new Error('Timeout');
      if (err.status === 429) throw new Error('Daily limit reached');
    }
    throw err;
  }
}
