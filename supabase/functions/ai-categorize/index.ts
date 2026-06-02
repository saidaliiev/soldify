/**
 * ai-categorize Edge Function — 3-tier categorization resolver.
 *
 * Pipeline per request:
 *   1. CORS preflight
 *   2. JWT extraction → user-scoped supabase-js client (for RLS reads of merchant_overrides)
 *   3. zod-strict parse of the request body (rejects any description/notes smuggling)
 *   4. Tier 1 — merchant_overrides exact match on normalized merchant_key (RLS auto-scoped)
 *   5. Tier 2 — MCC pre-pass against MCC_TO_CATEGORY
 *   6. Tier 3 — Haiku-4.5 with tool-use (closed-enum category_slug); Promise.allSettled,
 *      concurrency capped at 5 (D-21)
 *   7. Cost cap (D-24) — dormant in Phase 3; reads X-Daily-Spend-Cents header,
 *      degrades to MCC-only if exceeded (currently inert since client sends 0)
 *   8. 200 with per-row results, or 503 envelope on whole-batch failure
 *
 * GDPR safety gate:
 *   - CategorizeRequest .strict() rejects any extra field (description, notes, raw_data)
 *   - HaikuPayload .strict() ensures only merchant_name+mcc+amount_sign+amount_bucket
 *     cross the wire to the LLM (Gemini)
 *   - Zero console.log of payload contents (matches lib/http.ts discipline)
 *
 * Version pinning (deno imports below) keeps Edge Function builds reproducible.
 * Gemini model IDs are pinned to avoid drift between flash revisions.
 */

import { serve } from 'https://deno.land/std@0.220.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  geminiGenerateContent,
  extractFunctionCalls,
  type GeminiFunctionDeclaration,
} from '../_shared/gemini.ts';

import {
  CategorizeRequest,
  HaikuPayload,
  bucketize,
  type AiCategorizeBatchResult,
  type CategorizeRequestTx,
} from '../_shared/schemas.ts';
import { mccToCategorySlug } from '../_shared/mccMap.ts';
import { normalizeMerchantKey } from '../_shared/normalize.ts';
import { CATEGORIZE_SYSTEM_PROMPT, CATEGORY_SLUGS, categorizeUserMessage } from '../_shared/prompts.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = 'gemini-2.5-flash-lite'; // categorize tier-3 (was claude-haiku-4-5)
const GEMINI_CONCURRENCY = 5;         // D-21
const CONFIDENCE_AUTO_APPLY = 0.75;   // D-11
const CONFIDENCE_PERSIST_OVERRIDE = 0.85; // D-12 (client-side persist)
const DAILY_CAP_CENTS = 2000;         // $0.20 categorize cap per CONTEXT D-24


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tier1Hit = { tx_id: number; category_slug: string; confidence: number; tier: 'override' };
type Tier2Hit = { tx_id: number; category_slug: string; confidence: number; tier: 'mcc' };
type Unresolved = { tx_id: number; payload: HaikuPayload; original: CategorizeRequestTx };

type SuccessResult = AiCategorizeBatchResult['results'][number] & { tx_id: number };

/**
 * Resolves Tier 1 — exact match against the user's merchant_overrides rows.
 *
 * Single batched SELECT against the RLS-scoped userClient so we never see
 * another user's row. Returns a Map<tx_id, Tier1Hit> for the matched rows
 * and leaves the rest for tiers 2/3.
 *
 * The remote merchant_overrides table is currently empty in Phase 3 — the
 * client-side mobile flow writes to LOCAL merchant_overrides only (per
 * D-17′..D-20′ FactsPack architecture). The remote write path lands in
 * Phase 4. This function is still wired so Phase 4 activates by data
 * presence rather than code change.
 */
async function resolveTier1(
  userClient: ReturnType<typeof createClient>,
  txs: ReadonlyArray<CategorizeRequestTx>,
): Promise<Map<number, Tier1Hit>> {
  const out = new Map<number, Tier1Hit>();
  if (txs.length === 0) return out;

  const keys = Array.from(new Set(txs.map((t) => normalizeMerchantKey(t.merchant_name))));
  const { data, error } = await userClient
    .from('merchant_overrides')
    .select('merchant_key, category_id, source, confidence')
    .in('merchant_key', keys);

  if (error) {
    // SENTRY breadcrumb: ai.flow=categorize ai.tier=override status=error
    // Soft fail — log + treat as no Tier 1 hits so tier 2/3 still resolves.
    return out;
  }
  // Build a Map of merchant_key → row (first-wins on duplicates per user_id UNIQUE).
  // NOTE: remote rows carry category_id (numeric, local categories.id). The client
  // resolves that back to a slug after this function returns when needed; but the
  // contract with the client is category_slug, so the Edge Function does NOT have
  // access to the local slug here. We accept this as "Phase 3 dormant" — Tier 1
  // is effectively no-op in Phase 3 because the remote table stays empty. The
  // CODE PATH is wired for Phase 4 activation; in Phase 3 we return no hits.
  // TODO Phase 4: introduce a remote `categories` lookup or store `category_slug`
  //       alongside category_id in merchant_overrides for slug-only resolution.
  void data; // intentionally not used until Phase 4
  return out;
}

/**
 * Resolves Tier 2 — MCC pre-pass for rows without a Tier 1 hit.
 *
 * Cheap, no I/O — pure JS lookup in MCC_TO_CATEGORY.
 */
function resolveTier2(unresolved: ReadonlyArray<Unresolved>): {
  hits: Tier2Hit[];
  remaining: Unresolved[];
} {
  const hits: Tier2Hit[] = [];
  const remaining: Unresolved[] = [];
  for (const u of unresolved) {
    const slug = mccToCategorySlug(u.payload.mcc);
    if (slug != null) {
      hits.push({ tx_id: u.tx_id, category_slug: slug, confidence: 0.85, tier: 'mcc' });
    } else {
      remaining.push(u);
    }
  }
  return { hits, remaining };
}

/**
 * Resolves Tier 3 — Haiku-4.5 with tool-use, concurrency capped.
 *
 * Each row is its own Gemini call (Promise.allSettled across batches of
 * HAIKU_CONCURRENCY). Per-row failures emit { tx_id, error }; whole-batch
 * failure (all rows rejected with 5xx/429) signals the caller to 503.
 *
 * Tool-use is forced and the input_schema enum on category_slug is closed.
 * Per AI-SPEC G10 + T-03-01-09: Gemini function-calling enforces the enum; we also
 * validate again on receipt as defense in depth.
 */
async function resolveTier3(
  unresolved: ReadonlyArray<Unresolved>,
  apiKey: string,
): Promise<{
  hits: Array<SuccessResult & { tier: 'llm' }>;
  errors: Array<{ tx_id: number; error: string }>;
  allFailed: boolean;
}> {
  if (unresolved.length === 0) {
    return { hits: [], errors: [], allFailed: false };
  }

  // Gemini function declaration — OpenAPI-3.0 schema subset (no
  // additionalProperties / numeric bounds / maxLength; args re-checked below).
  const TOOL: GeminiFunctionDeclaration = {
    name: 'assign_category',
    description: 'Assign a single category slug + confidence to the transaction.',
    parameters: {
      type: 'object',
      properties: {
        category_slug: { type: 'string', enum: [...CATEGORY_SLUGS] },
        confidence: { type: 'number' },
        rationale: { type: 'string' },
      },
      required: ['category_slug', 'confidence'],
    },
  };

  const hits: Array<SuccessResult & { tier: 'llm' }> = [];
  const errors: Array<{ tx_id: number; error: string }> = [];

  // Process in concurrency-capped chunks.
  for (let i = 0; i < unresolved.length; i += GEMINI_CONCURRENCY) {
    const chunk = unresolved.slice(i, i + GEMINI_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (u) => {
        const userMsg = categorizeUserMessage([u.payload]);
        const resp = await geminiGenerateContent({
          apiKey,
          model: MODEL_ID,
          systemInstruction: CATEGORIZE_SYSTEM_PROMPT,
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          tools: [{ functionDeclarations: [TOOL] }],
          // mode ANY + a single allowed name forces the function call (the
          // closed `category_slug` enum is the closed-set guarantee).
          toolConfig: {
            functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['assign_category'] },
          },
          generationConfig: { maxOutputTokens: 256, temperature: 0 },
        });

        const call =
          extractFunctionCalls(resp).find((c) => c.name === 'assign_category') ??
          extractFunctionCalls(resp)[0];
        let slug: string | null = null;
        let confidence = 0;
        if (call) {
          const args = call.args as { category_slug?: unknown; confidence?: unknown };
          if (typeof args.category_slug === 'string') slug = args.category_slug;
          if (typeof args.confidence === 'number') confidence = args.confidence;
        }
        // Defense in depth: re-validate the slug against the closed enum.
        if (slug == null || !CATEGORY_SLUGS.includes(slug)) {
          throw new Error('gemini_unknown_slug');
        }
        return { tx_id: u.tx_id, category_slug: slug, confidence };
      }),
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      const u = chunk[j];
      if (r.status === 'fulfilled') {
        const { tx_id, category_slug, confidence } = r.value;
        hits.push({
          tx_id,
          category_slug,
          confidence,
          needs_review: confidence < CONFIDENCE_AUTO_APPLY,
          tier: 'llm',
        });
      } else {
        errors.push({ tx_id: u.tx_id, error: 'gemini_failed' });
      }
    }
  }

  const allFailed = hits.length === 0 && errors.length === unresolved.length;
  return { hits, errors, allFailed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req, 'x-daily-spend-cents');
  const jsonResponse = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...cors },
    });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // ---- Auth gate ----
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'missing_authorization' }, 401);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // ---- Parse + schema-validate request body ----
  let parsed: CategorizeRequest;
  try {
    const json = await req.json();
    parsed = CategorizeRequest.parse(json);
  } catch (err) {
    return jsonResponse(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : String(err) },
      400,
    );
  }

  // ---- Cost cap (D-24, dormant in Phase 3) ----
  // TODO Phase 5: activate when client begins tracking spend via PostHog cohort.
  const spendHeader = req.headers.get('X-Daily-Spend-Cents');
  const dailySpend = spendHeader ? Number.parseInt(spendHeader, 10) : 0;
  const capExceeded = Number.isFinite(dailySpend) && dailySpend >= DAILY_CAP_CENTS;
  // capExceeded === true → skip Tier 3 and degrade to MCC-only fallback.

  // ---- Build per-row HaikuPayload (the GDPR safety gate is here) ----
  // The .strict() schema rejects unknown fields at HaikuPayload.parse — even if
  // somehow upstream merged a description field, it dies here before any LLM call.
  const txs: CategorizeRequestTx[] = parsed.transactions;
  const unresolved: Unresolved[] = [];
  const payloadErrors: Array<{ tx_id: number; error: string }> = [];
  for (const tx of txs) {
    try {
      const payload = HaikuPayload.parse({
        merchant_name: tx.merchant_name,
        mcc: tx.mcc,
        amount_sign: tx.amount_cents < 0 ? 'expense' : 'income',
        amount_bucket: bucketize(Math.abs(tx.amount_cents)),
      });
      unresolved.push({ tx_id: tx.tx_id, payload, original: tx });
    } catch (_err) {
      payloadErrors.push({ tx_id: tx.tx_id, error: 'invalid_payload' });
    }
  }

  // ---- Tier 1 — merchant_overrides ----
  const tier1 = await resolveTier1(userClient, txs);
  const afterTier1 = unresolved.filter((u) => !tier1.has(u.tx_id));

  // ---- Tier 2 — MCC pre-pass ----
  const { hits: tier2Hits, remaining: afterTier2 } = resolveTier2(afterTier1);

  // ---- Tier 3 — Haiku (skipped when cost cap exceeded) ----
  let tier3Hits: Array<SuccessResult & { tier: 'llm' }> = [];
  let tier3Errors: Array<{ tx_id: number; error: string }> = [];
  let tier3AllFailed = false;
  if (!capExceeded && afterTier2.length > 0) {
    try {
      const apiKey = geminiApiKey();
      const t3 = await resolveTier3(afterTier2, apiKey);
      tier3Hits = t3.hits;
      tier3Errors = t3.errors;
      tier3AllFailed = t3.allFailed;
    } catch (_err) {
      // Whole-batch failure (e.g. Gemini outage, missing key) → 503 envelope.
      return jsonResponse(
        { error: 'ai_unavailable', retry_after: 60 },
        503,
      );
    }
  } else if (capExceeded && afterTier2.length > 0) {
    // Cap exceeded + still-unresolved rows: emit per-row error so client knows.
    for (const u of afterTier2) {
      tier3Errors.push({ tx_id: u.tx_id, error: 'daily_cap_exceeded' });
    }
  }

  if (tier3AllFailed && (tier1.size + tier2Hits.length + payloadErrors.length) === 0) {
    // Whole-batch Haiku failure with no other tier hits → 503.
    return jsonResponse({ error: 'ai_unavailable', retry_after: 60 }, 503);
  }

  // ---- Compose response ----
  const results: AiCategorizeBatchResult['results'] = [
    ...Array.from(tier1.values()).map((h) => ({
      tx_id: h.tx_id,
      category_slug: h.category_slug,
      confidence: h.confidence,
      needs_review: false,
      tier: h.tier,
    })),
    ...tier2Hits.map((h) => ({
      tx_id: h.tx_id,
      category_slug: h.category_slug,
      confidence: h.confidence,
      needs_review: false,
      tier: h.tier,
    })),
    ...tier3Hits.map((h) => ({
      tx_id: h.tx_id,
      category_slug: h.category_slug,
      confidence: h.confidence,
      needs_review: h.needs_review,
      tier: h.tier,
    })),
    ...payloadErrors,
    ...tier3Errors,
  ];

  return jsonResponse({ results }, 200);
});

// ---------------------------------------------------------------------------
// Test-internals export (consumed by tests + eval harness)
// ---------------------------------------------------------------------------

function geminiApiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY missing');
  return key;
}

export const __test_internals = {
  resolveTier1,
  resolveTier2,
  resolveTier3,
  bucketize,
  CATEGORY_SLUGS,
  CONFIDENCE_AUTO_APPLY,
  CONFIDENCE_PERSIST_OVERRIDE,
};

