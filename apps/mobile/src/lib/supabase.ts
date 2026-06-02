/**
 * SOLDI Supabase client — LAZY singleton.
 *
 * Scope: Supabase is **AI-pipeline only** (CLAUDE.md / PROJECT.md). The core
 * app — dashboard, biometric gate, CSV export, local op-sqlite data — MUST
 * launch with zero Supabase configuration. Therefore this module performs NO
 * work and NO validation at import time.
 *
 * Regression guard (crash incident 6485AB3B, TestFlight build 4): the previous
 * version validated env + created the client at module scope and `throw`- on
 * absence. expo-router eagerly evaluates `app/**` and its static import graph
 * at cold start; the chain
 *   app/_layout.tsx -> ChatBottomSheet -> chatStore -> aiQuery -> @lib/supabase
 * meant the import-time throw fired before React mounted, surfaced via Expo's
 * errorRecoveryQueue, and aborted the app (SIGABRT) — bypassing the try/catch
 * guards already present at every AI call site. Validation is now deferred to
 * first real use; AI callers (aiQuery / aiCategorize) already catch and degrade
 * gracefully. Mirrors the graceful-optional pattern in lib/observability.ts.
 *
 * Client config:
 * - expo-secure-store as auth session storage (never AsyncStorage —
 *   CLAUDE.md §Security: "No sensitive data in AsyncStorage ever").
 * - autoRefreshToken + persistSession enabled.
 * - detectSessionInUrl: false (RN apps have no URL OAuth callback).
 */

import { createClient } from '@supabase/supabase-js';
import { secureStorageAdapter } from './secureStorage';

type SupabaseClientInstance = ReturnType<typeof createClient>;

let _client: SupabaseClientInstance | null = null;

/**
 * True when both Supabase env vars are present. AI features call this to skip
 * network work (and show a graceful "AI unavailable" path) when the optional
 * backend is unconfigured, instead of throwing.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return (
    typeof url === 'string' &&
    url.trim() !== '' &&
    typeof anonKey === 'string' &&
    anonKey.trim() !== ''
  );
}

/**
 * Lazily creates and caches the Supabase client.
 *
 * Throws a clear error if the env vars are absent — but only at CALL time, by
 * which point every caller is inside a try/catch (chatStore.retryLast,
 * aiCategorizeTrigger .catch) and degrades gracefully. NEVER call this at
 * module scope: doing so reintroduces the cold-start crash.
 */
export function getSupabase(): SupabaseClientInstance {
  if (_client !== null) {
    return _client;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || url.trim() === '') {
    throw new Error(
      '[supabase] EXPO_PUBLIC_SUPABASE_URL is not set. ' +
        'Add it to .env / EAS build env (Supabase Dashboard → Project Settings → API → Project URL).',
    );
  }
  if (!anonKey || anonKey.trim() === '') {
    throw new Error(
      '[supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. ' +
        'Add it to .env / EAS build env (Supabase Dashboard → Project Settings → API → anon public key).',
    );
  }

  _client = createClient(url, anonKey, {
    auth: {
      storage: secureStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // RN apps do not use URL-based OAuth callbacks
    },
  });
  return _client;
}

/**
 * Returns the current Supabase session, or null if the user is not signed in.
 *
 * Usage: `const session = await getSession();`
 * Throws if Supabase is unconfigured or the auth layer fails (network error,
 * keychain locked). All call sites are inside try/catch and degrade gracefully.
 */
export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) {
    throw new Error(`[supabase] getSession failed: ${error.message}`);
  }
  return data.session;
}

/**
 * Returns a valid Supabase session, creating an ANONYMOUS one if none exists.
 *
 * The app is offline-first with no sign-in UI, but the AI Edge Functions deploy
 * with verify_jwt=true — every request needs a bearer JWT. An anonymous user
 * (requires Supabase Auth → "Anonymous sign-ins" enabled in the project) yields
 * exactly that: a persisted JWT with the `authenticated` audience that passes
 * verify_jwt and scopes Phase-4 merchant_overrides RLS per device. Idempotent —
 * reuses the persisted session on every launch after the first.
 *
 * NEVER throws and NEVER runs at module scope. Returns null when Supabase is
 * unconfigured or anonymous auth is unavailable/fails, so AI callers degrade to
 * the graceful "AI unavailable" path instead of crashing.
 */
export async function ensureAnonSession() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  try {
    const client = getSupabase();
    const existing = await client.auth.getSession();
    if (existing.data.session != null) {
      return existing.data.session;
    }
    const { data, error } = await client.auth.signInAnonymously();
    if (error) {
      return null;
    }
    return data.session;
  } catch {
    return null;
  }
}
