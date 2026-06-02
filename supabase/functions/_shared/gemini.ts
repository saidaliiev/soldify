/**
 * Minimal Gemini REST client for Supabase Edge Functions (Deno).
 *
 * Raw fetch against generativelanguage.googleapis.com v1beta `generateContent`
 * — no SDK, to keep the edge bundle lean and avoid npm-in-Deno surprises.
 * Supports function calling (tools + toolConfig) and multi-turn tool loops.
 *
 * Replaces the previous `@anthropic-ai/sdk` usage: SOLDI's AI runs on Gemini.
 * Secret: GEMINI_API_KEY. Models: gemini-2.5-flash (chat), gemini-2.5-flash-lite
 * (categorize). The key is sent ONLY in the `x-goog-api-key` header and never
 * appears in a thrown message or log.
 *
 * Gemini's function `parameters` accept an OpenAPI-3.0 schema SUBSET — keep them
 * to type/properties/enum/required/items. Do NOT send JSON-Schema-only keywords
 * (`additionalProperties`, `pattern`); callers re-validate args with zod anyway.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiTool = { functionDeclarations: GeminiFunctionDeclaration[] };

export type GeminiToolConfig = {
  functionCallingConfig: {
    mode: 'AUTO' | 'ANY' | 'NONE';
    allowedFunctionNames?: string[];
  };
};

type GeminiCandidate = {
  content?: { role: string; parts?: GeminiPart[] };
  finishReason?: string;
};

export type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
};

/** Carries the HTTP status so callers can map 5xx/429 to a 503 envelope. */
export class GeminiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/**
 * POSTs one `generateContent` turn. Throws GeminiError(status) on non-2xx.
 * The request key lives only in the header — never logged, never in the error.
 */
export async function geminiGenerateContent(args: {
  readonly apiKey: string;
  readonly model: string;
  readonly systemInstruction?: string;
  readonly contents: GeminiContent[];
  readonly tools?: GeminiTool[];
  readonly toolConfig?: GeminiToolConfig;
  readonly generationConfig?: Record<string, unknown>;
}): Promise<GeminiResponse> {
  const body: Record<string, unknown> = { contents: args.contents };
  if (args.systemInstruction) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }
  if (args.tools) body.tools = args.tools;
  if (args.toolConfig) body.toolConfig = args.toolConfig;
  if (args.generationConfig) body.generationConfig = args.generationConfig;

  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${args.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network/DNS failure — treat as a transient upstream outage.
    throw new GeminiError(`gemini fetch failed: ${err instanceof Error ? err.message : 'unknown'}`, 503);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GeminiError(`gemini ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as GeminiResponse;
}

/** Parts of the first candidate (empty when blocked / no candidate). */
function firstCandidateParts(resp: GeminiResponse): GeminiPart[] {
  return resp.candidates?.[0]?.content?.parts ?? [];
}

/** Concatenated text of the first candidate, or null when there is none. */
export function extractText(resp: GeminiResponse): string | null {
  const texts = firstCandidateParts(resp)
    .filter((p): p is { text: string } => 'text' in p)
    .map((p) => p.text);
  return texts.length > 0 ? texts.join('') : null;
}

/** Every functionCall part of the first candidate (parallel calls supported). */
export function extractFunctionCalls(
  resp: GeminiResponse,
): Array<{ name: string; args: Record<string, unknown> }> {
  return firstCandidateParts(resp)
    .filter(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        'functionCall' in p,
    )
    .map((p) => p.functionCall);
}

/** The raw parts of the first candidate — used to echo the model turn back. */
export function modelTurnParts(resp: GeminiResponse): GeminiPart[] {
  return firstCandidateParts(resp);
}
