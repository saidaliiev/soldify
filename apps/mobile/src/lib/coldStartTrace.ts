/**
 * coldStartTrace.ts — DIAGNOSTIC (build #11) cold-start breadcrumb trail.
 *
 * Why: the TF#10 cold-start crash is a NATIVE ObjC NSException (SIGABRT) re-raised
 * on expo.controller.errorRecoveryQueue. A native fatal — e.g. op-sqlite `open()`
 * inside runMigrations — is NOT catchable by the JS ErrorUtils handler, so the
 * RootErrorBoundary overlay never renders and the process aborts with nothing on
 * screen and nothing in Sentry (early-boot crash-loop). This Windows/WSL setup
 * cannot symbolicate the .ips either (no Mac/atos/llvm).
 *
 * This module writes the last-reached boot milestone to a file SYNCHRONOUSLY
 * (expo-file-system v19 File.write flushes to disk) BEFORE each risky step. On the
 * NEXT launch we read the previous boot's trail first: if it never reached
 * 'render', the previous boot crashed right AFTER the last recorded milestone —
 * which localizes the fault even when nothing is catchable.
 *
 * Crash-loop safety: once a crash trail is recorded (no 'render'), this boot
 * PRESERVES it (markBootStage becomes a no-op) so an expo-updates auto-relaunch
 * cannot overwrite the original deepest milestone. RootLayout reads
 * didPreviousBootCrash() and renders BootTraceScreen instead of re-running the
 * risky path — which both breaks the loop and shows the milestone on-device.
 *
 * Security: stores ONLY milestone keywords (no transaction data, no token bytes) —
 * CLAUDE.md fintech rule. Diagnostic only; remove with the build #11
 * instrumentation once the root cause is found.
 */
import { File, Paths } from 'expo-file-system';

export type BootStage =
  | 'module-load'
  | 'fonts'
  | 'i18n'
  | 'migrations:start'
  | 'migrations:done'
  | 'biometric:start'
  | 'biometric:passed'
  | 'render';

const FILE_NAME = 'boot-trace.txt';

function traceFile(): File {
  return new File(Paths.document, FILE_NAME);
}

let previousTrail: string | null = null;
// true → previous boot crashed (no 'render'); preserve its trail, never overwrite.
let preserved = false;
let snapshotTaken = false;
let currentTrail = '';

function ensureSnapshot(): void {
  if (snapshotTaken) return;
  snapshotTaken = true;
  try {
    const f = traceFile();
    previousTrail = f.exists ? f.textSync() : null;
  } catch {
    previousTrail = null;
  }
  preserved =
    previousTrail !== null &&
    previousTrail.length > 0 &&
    !previousTrail.includes('render');
}

/** Append a milestone to this boot's trail and flush synchronously to disk. */
export function markBootStage(stage: BootStage): void {
  ensureSnapshot();
  if (preserved) return; // keep the prior crash trail intact across relaunches
  try {
    currentTrail = currentTrail ? `${currentTrail} > ${stage}` : stage;
    traceFile().write(currentTrail);
  } catch {
    // never let the diagnostic break boot
  }
}

/** The previous boot's recorded trail (captured before this launch overwrote it). */
export function getPreviousBootTrail(): string | null {
  ensureSnapshot();
  return previousTrail;
}

/** True when the previous boot recorded milestones but never reached 'render'. */
export function didPreviousBootCrash(): boolean {
  ensureSnapshot();
  return preserved;
}

/** Deletes the trail so the next launch boots normally (diagnostic acknowledge). */
export function clearBootTrace(): void {
  try {
    const f = traceFile();
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
  previousTrail = null;
  preserved = false;
  currentTrail = '';
}
