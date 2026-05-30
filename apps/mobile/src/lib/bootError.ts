/**
 * bootError.ts — DIAGNOSTIC (build #11) boot-fatal surface.
 *
 * The TF#10 cold-start SIGABRT is NOT captured by Sentry (early-boot crash-loop)
 * and the dev machine has no Mac/atos/llvm to symbolicate the .ips. This tiny
 * store lets the global JS error handler (app/_layout.tsx) and RootErrorBoundary
 * funnel any boot fatal into one place so it can be rendered on-screen in
 * TestFlight. Remove once the root cause is found and the crash is fixed.
 *
 * Security: only ever stores error message/stack (code-level). Never pass
 * transaction values or token bytes here (CLAUDE.md). Boot fatals carry neither.
 */
export type BootError = {
  readonly message: string;
  readonly stack?: string;
  readonly source: 'render' | 'fatal' | 'error';
};

let current: BootError | null = null;
const listeners = new Set<() => void>();

export function setBootError(e: BootError): void {
  current = e;
  listeners.forEach((l) => l());
}

export function getBootError(): BootError | null {
  return current;
}

export function subscribeBootError(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
