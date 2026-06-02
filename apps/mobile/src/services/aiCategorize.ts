/**
 * SOLDI AI categorization service — mobile client.
 *
 * HTTP wrapper that calls the `ai-categorize` Supabase Edge Function and
 * resolves the returned category_slug values to local category_ids via
 * categoriesRepo.getCategoryIdBySlug.
 *
 * GDPR safety contract (inherited from Edge Function):
 * - Only tx_id, merchant_name, mcc, amount_cents cross the wire.
 * - NEVER description, notes, or any free-text field.
 *
 * Error handling:
 * - HTTP 503 → throws Error('Categorization unavailable') — caller logs, does not crash.
 * - HTTP 429 → throws Error('Daily AI limit reached').
 * - Per-row { error } in results → preserved in AiCategorizeBatchResult (partial success).
 * - Unknown category_slug (not in local DB) → { tx_id, error: 'unknown_category' }.
 *
 * Cost cap (D-24, dormant in Phase 3):
 * Sends X-Daily-Spend-Cents: 0 with every request. The Edge Function reads this
 * header but does not enforce the cap while the value is 0. Phase 5 activates the
 * cap when the client begins tracking actual spend via PostHog cohort analytics.
 * TODO Phase 5: replace the hardcoded 0 with the real per-user spend counter.
 *
 * Mirrors the pattern of apps/mobile/src/api/monobank.ts (HttpError translation,
 * timeout, structured error logging).
 */

import { HttpError, httpJson } from '@lib/http';
import { ensureAnonSession } from '@lib/supabase';
import { getCategoryIdBySlug } from '@data/categoriesRepo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiCategorizeInput = {
  tx_id: number;
  merchant_name: string;
  mcc: string | null;
  amount_cents: number;
};

export type AiCategorizeSuccess = {
  tx_id: number;
  category_slug: string;
  category_id: number;
  confidence: number;
  needs_review: boolean;
  tier: 'override' | 'mcc' | 'llm';
};

export type AiCategorizeError = {
  tx_id: number;
  error: string;
};

export type AiCategorizeBatchResult = {
  results: (AiCategorizeSuccess | AiCategorizeError)[];
};

// ---------------------------------------------------------------------------
// Edge Function response shape (before slug→id resolution)
// ---------------------------------------------------------------------------

type EdgeFnSuccessRow = {
  tx_id: number;
  category_slug: string;
  confidence: number;
  needs_review: boolean;
  tier: 'override' | 'mcc' | 'llm';
};

type EdgeFnErrorRow = {
  tx_id: number;
  error: string;
};

type EdgeFnRow = EdgeFnSuccessRow | EdgeFnErrorRow;

type EdgeFnResponse = {
  results: EdgeFnRow[];
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Sends a batch of uncategorized transactions to the ai-categorize Edge
 * Function and resolves the returned category_slug values to local category
 * ids (via op-sqlite categories table).
 *
 * Non-throwing on per-row errors — partial results are returned.
 * Throws only on whole-batch failures (503, 429) so the caller can decide
 * whether to retry or silently swallow.
 *
 * @param inputs  Array of transaction metadata (max 50 per Edge Function limit).
 * @returns       AiCategorizeBatchResult with resolved category_ids for hits.
 */
export async function aiCategorizeBatch(
  inputs: readonly AiCategorizeInput[],
): Promise<AiCategorizeBatchResult> {
  if (inputs.length === 0) {
    return { results: [] };
  }

  // ---- Session (JWT required by Edge Function auth gate) ----
  // Anonymous session — the app has no sign-in; ensureAnonSession mints/reuses an
  // anon JWT when Supabase is configured, else returns null → skip silently.
  const session = await ensureAnonSession();
  if (session == null) {
    return { results: inputs.map((i) => ({ tx_id: i.tx_id, error: 'no_session' })) };
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('[aiCategorize] EXPO_PUBLIC_SUPABASE_URL is not set');
  }

  const url = `${supabaseUrl}/functions/v1/ai-categorize`;

  // ---- POST to Edge Function ----
  let response: EdgeFnResponse;
  try {
    response = await httpJson<EdgeFnResponse>(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        // D-24 dormant cost cap — client sends 0, Edge Function does not enforce yet.
        // TODO Phase 5: activate when client begins tracking spend via PostHog cohort.
        'X-Daily-Spend-Cents': '0',
      },
      body: JSON.stringify({
        transactions: inputs.map((i) => ({
          tx_id: i.tx_id,
          merchant_name: i.merchant_name,
          mcc: i.mcc,
          amount_cents: i.amount_cents,
          // NEVER include: description, notes, or any free-text field (CHAT-04 / GDPR)
        })),
      }),
      timeoutMs: 30_000,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 503) throw new Error('Categorization unavailable');
      if (err.status === 429) throw new Error('Daily AI limit reached');
    }
    throw err;
  }

  // ---- Resolve category_slug → local category_id ----
  const resolved: (AiCategorizeSuccess | AiCategorizeError)[] = [];

  for (const row of response.results) {
    if ('error' in row) {
      resolved.push({ tx_id: row.tx_id, error: row.error });
      continue;
    }

    const categoryId = getCategoryIdBySlug(row.category_slug);
    if (categoryId == null) {
      // T-03-01-09: Haiku hallucinated an unknown slug or slug not seeded locally.
      resolved.push({ tx_id: row.tx_id, error: 'unknown_category' });
      continue;
    }

    resolved.push({
      tx_id: row.tx_id,
      category_slug: row.category_slug,
      category_id: categoryId,
      confidence: row.confidence,
      needs_review: row.needs_review,
      tier: row.tier,
    });
  }

  return { results: resolved };
}
