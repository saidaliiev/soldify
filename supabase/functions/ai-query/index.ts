/**
 * ai-query Edge Function — SOLDI chat assistant backed by Claude Sonnet 4.6.
 *
 * Stream decision (D-CD): Phase 3 ships NON-STREAMING chat. Sonnet returns
 * the full response in one shot. Streaming deferred to a future polish pass.
 *
 * FactsPack architecture (D-17 to D-20): Transactions live in local op-sqlite.
 * Mobile client builds a FactsPack (aggregate-only) and ships it with each
 * chat request. No remote Postgres transaction query in Phase 3.
 *
 * Security: Zero console.log of message body or factsPack contents (T-03-03-09).
 */

import { serve } from 'https://deno.land/std@0.220.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  geminiGenerateContent,
  extractText,
  extractFunctionCalls,
  modelTurnParts,
  GeminiError,
  type GeminiContent,
  type GeminiPart,
  type GeminiFunctionDeclaration,
} from '../_shared/gemini.ts';

import {
  ChatRequest,
  ChatResponse,
  ToolInput,
  ChartPayload,
} from '../_shared/chat-schemas.ts';
import { CHAT_SYSTEM_PROMPT } from '../_shared/chat-prompts.ts';
import { QUERY_SHAPES, clampDateRange } from '../_shared/facts-runner.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';

// Gemini function declaration — OpenAPI-3.0 schema SUBSET: no `pattern` /
// `additionalProperties` / `maxItems` (unsupported). ToolInput.safeParse below
// re-validates the date pattern + strips unknown keys, so the contract holds.
const QUERY_AGGREGATES_TOOL: GeminiFunctionDeclaration = {
  name: 'query_aggregates',
  description: "Read aggregate spending data from the user's FactsPack.",
  parameters: {
    type: 'object',
    properties: {
      query_type: {
        type: 'string',
        enum: [
          'sum_by_category',
          'count_by_category',
          'sum_by_month',
          'top_merchants',
          'compare_periods',
          'last_n_transactions_aggregate',
        ],
      },
      filters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Start date, YYYY-MM-DD' },
          date_to: { type: 'string', description: 'End date, YYYY-MM-DD' },
          category_slugs: { type: 'array', items: { type: 'string' } },
          currency: { type: 'string', enum: ['EUR', 'UAH'] },
          compare_from: { type: 'string', description: 'Comparison start, YYYY-MM-DD' },
          compare_to: { type: 'string', description: 'Comparison end, YYYY-MM-DD' },
        },
        required: ['date_from', 'date_to'],
      },
    },
    required: ['query_type', 'filters'],
  },
};

serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const corsResponse = (body: string, status: number): Response =>
    new Response(body, {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return corsResponse(JSON.stringify({ error: 'method_not_allowed' }), 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return corsResponse(JSON.stringify({ error: 'missing_authorization' }), 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return corsResponse(JSON.stringify({ error: 'server_misconfigured' }), 500);
  }
  if (!geminiKey) {
    return corsResponse(JSON.stringify({ error: 'ai_unavailable' }), 503);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return corsResponse(JSON.stringify({ error: 'invalid_json' }), 400);
  }

  const parseResult = ChatRequest.safeParse(rawBody);
  if (!parseResult.success) {
    return corsResponse(
      JSON.stringify({ error: 'invalid_input', detail: parseResult.error.message }),
      400,
    );
  }

  const { message, history, facts_pack } = parseResult.data;

  // D-19 user JWT client (vestigial Phase 3; for JWT-authn + Phase 4 merchant_overrides)
  const _userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\nToday is ${today}. The user's data covers ${facts_pack.date_from} to ${facts_pack.date_to} in ${facts_pack.currency}.`;

  // Gemini conversation. Assistant history maps to the `model` role; each prior
  // turn is a single text part. The tool loop appends model functionCall turns
  // and user functionResponse turns (Gemini's REST function-calling shape).
  const contents: GeminiContent[] = [
    ...history.map((h) => ({
      role: (h.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: h.text }] as GeminiPart[],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const MAX_ITERATIONS = 3;
  let finalText: string | null = null;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await geminiGenerateContent({
        apiKey: geminiKey,
        model: 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
        contents,
        tools: [{ functionDeclarations: [QUERY_AGGREGATES_TOOL] }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: 1024 },
      });

      const calls = extractFunctionCalls(response);
      if (calls.length === 0) {
        // No tool call → the model answered directly.
        finalText = extractText(response);
        break;
      }

      // Echo the model's function-call turn verbatim, then answer each call.
      contents.push({ role: 'model', parts: modelTurnParts(response) });

      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        if (call.name !== 'query_aggregates') {
          responseParts.push({
            functionResponse: { name: call.name, response: { error: 'unknown_function' } },
          });
          continue;
        }
        const inputParse = ToolInput.safeParse(call.args);
        if (!inputParse.success) {
          responseParts.push({
            functionResponse: { name: 'query_aggregates', response: { error: 'invalid_tool_input' } },
          });
          continue;
        }

        const { query_type, filters } = inputParse.data;
        const { date_from, date_to, clamped } = clampDateRange(filters.date_from, filters.date_to);
        const clampedFilters = { ...filters, date_from, date_to };

        const queryFn = QUERY_SHAPES[query_type];
        const queryResult = queryFn(facts_pack, clampedFilters);
        if (clamped) queryResult.clamped_date_range = true;

        responseParts.push({
          functionResponse: {
            name: 'query_aggregates',
            response: queryResult as unknown as Record<string, unknown>,
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    if (finalText === null) {
      // Iterations exhausted while still mid tool-chain: the last turn's tool
      // results are in `contents` but were never synthesized. Force one final
      // text answer with NO tools so the computed data isn't dropped (H1).
      try {
        const synth = await geminiGenerateContent({
          apiKey: geminiKey,
          model: 'gemini-2.5-flash',
          systemInstruction: systemPrompt,
          contents,
          generationConfig: { maxOutputTokens: 1024 },
        });
        finalText = extractText(synth);
      } catch {
        // fall through to the generic message below
      }
    }
    if (finalText === null) {
      finalText = "I couldn't compose a complete answer; try rephrasing.";
    }
  } catch (err) {
    const status = err instanceof GeminiError ? err.status : undefined;
    if (status != null && (status >= 500 || status === 429)) {
      return corsResponse(JSON.stringify({ error: 'ai_unavailable' }), 503);
    }
    return corsResponse(JSON.stringify({ error: 'ai_unavailable' }), 503);
  }

  let chart: ReturnType<typeof ChartPayload.parse> | undefined;
  let cleanText = finalText;

  const chartMatch = /```chart-json\s*([\s\S]+?)```/.exec(finalText);
  if (chartMatch) {
    cleanText = finalText.replace(/```chart-json\s*[\s\S]+?```/, '').trim();
    try {
      const chartJson = JSON.parse(chartMatch[1]!);
      const chartParse = ChartPayload.safeParse(chartJson);
      if (chartParse.success) chart = chartParse.data;
    } catch { /* drop chart silently */ }
  }

  if (!cleanText || cleanText.trim().length === 0) {
    cleanText = "I couldn't compose a complete answer; try rephrasing.";
  }
  if (cleanText.length > 800) cleanText = cleanText.slice(0, 797) + '...';

  const finalResponse = ChatResponse.safeParse({ text: cleanText, chart });
  if (!finalResponse.success) {
    return corsResponse(JSON.stringify({ text: cleanText }), 200);
  }

  return corsResponse(JSON.stringify(finalResponse.data), 200);
});
