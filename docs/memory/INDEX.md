# SOLDI (soldify) — Project Memory Index

> Auto-loaded at session start via `CLAUDE.md` → `@docs/memory/INDEX.md`. Single entry point tying
> together durable project knowledge. Thin map (<150 lines) — full detail in the linked files.
>
> **How to use:** scan at task start. `grep -ri "<term>" docs/memory/` for a gotcha/decision.
> A separate GSD executor also drives this repo — keep memory edits additive and atomic.

## Where knowledge lives (the map)

| Layer | Source | What's in it |
|---|---|---|
| **Live phase status** | [.planning/STATE.md](../../.planning/STATE.md) | **Authoritative** current position. ⚠️ `CLAUDE.md` "Phase status" line is STALE (says Phase 0, last touched 2026-05-13) — trust STATE.md. |
| Rules / stack / design | [CLAUDE.md](../../CLAUDE.md) | Stack (locked), workflow, design rules (banned values), security rules, skills routing |
| Strategy / scope | [.planning/PROJECT.md](../../.planning/PROJECT.md), [.planning/PLAN.md](../../.planning/PLAN.md) | Why this exists, scope guardrails (re-read on scope drift) |
| Roadmap | [.planning/ROADMAP.md](../../.planning/ROADMAP.md), [.planning/phases/](../../.planning/phases/) | Phase breakdown + per-phase PLAN/SUMMARY |
| Design tokens | `apps/mobile/src/design/{tokens,typography,motion,glass}.ts` | Slate & Sand palette, TYPE.*, MOTION.*, glass gating |
| **Env & tooling traps** | [gotchas.md](./gotchas.md) | WSL2/emulator dev-client, jest-CI broken, iOS-26 glass crash gate |
| **Decision log** | [decisions.md](./decisions.md) | Human-blocked P0, stack/palette/scope decisions |
| Episodic memory | claude-mem | Past sessions — `claude-mem:mem-search` at task start |
| Knowledge graph | `graphify-out/` | God nodes — `GRAPH_REPORT.md` before arch questions |

## Fast facts (30-second orientation)

- **Product:** premium iOS personal finance manager. **Portfolio piece, NOT a regulated fintech** — no PSD2/TrueLayer/AISP. Core value: install → see your spending in 90s without exposing real bank creds.
- **Stack (locked):** Expo SDK 54 + RN 0.81.5 + TS strict + expo-router v6; Zustand + TanStack Query v5; op-sqlite local + Supabase (project `oomohxczfazokevulhco`, eu-west-1) for AI pipeline only; **Google Gemini** (`gemini-2.5-flash-lite` categorize, `gemini-2.5-flash` chat) via deployed edge functions — LIVE 2026-06-02.
- **Status (STATE.md):** milestone v1.0 executing, Phase 05 polish-testflight-beta, ~57% phases (15/19 plans). Redesign track (Waves 1–6) CODE-complete. TestFlight #9 + Android preview queued.
- **Verify gate:** `cd apps/mobile && npx tsc --noEmit` exit 0 + `npx expo lint` exit 0 + device test (Expo Go / TestFlight). jest is NOT wired (see gotchas) — tsc+lint are the only automated gates.
- **App scheme is `soldi`** (not `soldify`) — `apps/mobile/app.json`.

## Blocking reality (full detail in [decisions.md](./decisions.md))

- **soldify is HUMAN-blocked, not code-blocked.** P0 needs user action: Apple Developer Program enrollment (€99) + `eas init` (real projectId + Apple credential login) + GitHub remote push. No code change unblocks these.
- TestFlight #8 cold-start crash (pre-iOS-26 iPhones + `expo-glass-effect` beta) fixed via `Platform.Version>=26` lazy-gate (`src/lib/glassEffect.ts`, commit `ff48ab2`) — was pending push as of 2026-05-24; verify it landed before assuming fixed.

## Top traps (full detail in [gotchas.md](./gotchas.md))

- Emulator dev-client: use `npx expo start --dev-client --lan` + WSL LAN IP — NOT `adb reverse` (it tunnels to the Windows host, not WSL).
- `ADB_SERVER_SOCKET` host = default-route gateway (`ip route | awk '/default/{print $3}'`), NOT the resolv.conf nameserver.
- jest harness never set up → CI `npm test` is already broken; do not claim "tests pass" — verification is tsc + expo lint only.
