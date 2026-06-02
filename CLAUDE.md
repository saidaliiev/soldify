# CLAUDE.md — SOLDI

> Premium iOS personal finance manager. Portfolio piece for Designer/Design Engineer + full-stack hiring signal.
> Solo dev on Windows + WSL2 Ubuntu. React Native + Expo SDK 54. Ships to App Store free in ~13 weeks.

## Project Memory

**Read [docs/memory/INDEX.md](docs/memory/INDEX.md) at task start** — the map of durable project knowledge: live phase status (`.planning/STATE.md` is authoritative; the "Phase status" line below is stale), env/tooling gotchas (emulator dev-client, jest-CI broken, iOS-26 glass crash gate), and the decision log (incl. the human-blocked P0 list). When you learn a durable gotcha/decision, append it to `docs/memory/gotchas.md` / `decisions.md`.

@docs/memory/INDEX.md

## Scope

This is a **portfolio piece, not a regulated fintech startup.** No PSD2, no TrueLayer, no AISP licensing, no DPO. The full strategic context lives in `.planning/PROJECT.md` and `.planning/PLAN.md`. Re-read them when scope drifts. Read `.planning/STATE.md` first in every new session.

## Stack (locked)

- **Mobile**: Expo SDK 54 + React Native 0.81.5 + TypeScript strict + expo-router v6
- **State**: Zustand for UI/app state, TanStack Query v5 for server cache
- **DB**: op-sqlite (local), Supabase Postgres (Frankfurt EU) for AI-pipeline only
- **Lists**: @shopify/flash-list v2
- **Charts/Motion**: @shopify/react-native-skia + Victory Native + react-native-reanimated v4 (+ react-native-worklets)
- **Security primitives**: expo-secure-store, expo-local-authentication
- **i18n**: i18next + react-i18next + expo-localization
- **Backend**: Supabase Edge Functions (Deno + TypeScript)
- **AI**: Google Gemini API — `gemini-2.5-flash-lite` for categorization, `gemini-2.5-flash` for chat (was Anthropic Claude; migrated 2026-06-02). Edge functions call Gemini REST `generateContent` via `supabase/functions/_shared/gemini.ts`. Secret: `GEMINI_API_KEY`.
- **Obs**: Sentry (EU) for crashes, PostHog (EU) for product analytics
- **CI**: GitHub Actions (tsc + expo lint + jest), EAS Build for iOS preview/production

## Workflow (non-negotiable)

**Context discipline**
- Offload exploration >3 greps/reads to a subagent (`Agent` tool, `subagent_type=Explore` or `caveman:cavecrew-investigator`)
- Never run 20 greps in main thread
- `/compact` when context fills — hint what to keep

**Plan → execute → verify**
- Feature work → `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans`
- Bug → `superpowers:systematic-debugging` before any fix
- Before any "done/works/fixed" claim → `superpowers:verification-before-completion`
- Library API question → `context7` MCP, never trust training data

**Commits**
- Atomic, conventional. Subject ≤50 chars; body only when "why" isn't obvious
- Never `git commit --no-verify` without explicit user instruction
- Never amend pushed commits
- Never force-push to main

**Verification gate** — before any "done" claim:
1. `cd apps/mobile && npx tsc --noEmit` exits 0
2. `cd apps/mobile && npx expo lint` exits 0
3. Feature tested on physical iPhone via Expo Go (or via TestFlight Internal for native module changes)
4. If can't test on device, say so explicitly — don't claim success

## Design rules (enforced)

Tokens are at `apps/mobile/src/design/tokens.ts`. Components must import from there, never hardcode.

**Banned values** (never appear in code, even in tests):
- `#667EEA` AI-slop blue, `#8B7AB8` AI-slop purple, `#E8E0FF` lavender
- `#10B981` bright Tailwind green (use `sage`)
- `#1A73E8`, `#2563EB` fintech blue
- Neon gradients
- Glassmorphism / floating blur cards ON CONTENT (lists, dashboard cards, chat bubbles) — still banned, AI-slop pattern
- EXCEPTION: iOS 26 native Liquid Glass (`expo-glass-effect`) IS allowed on system chrome ONLY — tab bar, nav, bottom-sheet backgrounds — warm-tinted, with mandatory non-glass fallback for iOS<26. Never on content surfaces.
- Emoji as UI icons EXCEPT category icons (decision 2026-05-26 — single-grapheme curated set; tab bar + jars stay SVG)
- Inline `style` objects with hex colors — must use tokens

**Typography rules**:
- Oswald (display): monthly total, hero numbers, large titles
- EB Garamond (editorial): chat bubbles, long-form insights, body with personality
- Manrope (UI): buttons, labels, pills, meta, tabular numbers in lists
- Never mix the wrong typeface — preset via `TYPE.*` in `src/design/typography.ts`

**Component rules**:
- React Native primitives only (`View`, `Text`, `ScrollView`, `Pressable`, etc.) — no `div`/`span`/`p`
- `StyleSheet.create()` exclusively, no inline style objects except for dynamic values
- No Tailwind / NativeWind
- All interactive elements: `accessibilityLabel` + `accessibilityRole`
- Minimum tap target: 44×44pt
- `LinearGradient` colors: spread the tuple — `colors={[...GRADIENTS.primary]}`
- Motion: only via `apps/mobile/src/design/motion.ts` vocabulary. No ad-hoc `Animated`/`withTiming` literals in components. reduce-motion (`AccessibilityInfo`) must be respected.
- Glass: only via `apps/mobile/src/design/glass.ts`. Direct `expo-glass-effect` import in screens is banned. The non-glass fallback path is not optional.

## Security rules (fintech-grade defaults even though we don't touch real banks)

- No sensitive data in `AsyncStorage` ever — `expo-secure-store` only
- No transaction details in `console.log` in production builds
- All API calls: async/await + try/catch — catch blocks fail gracefully (cached data, never crash)
- monobank token: encrypted at rest via `expo-secure-store`, never sent to backend except hashed for analytics
- AI prompts (chat + categorize): NEVER include raw transaction descriptions. Aggregates and category names only.
- TLS 1.3 enforced (ATS on iOS, Network Security Config on Android in v1.1)
- Biometric (FaceID/TouchID) gate: every cold start when enabled in settings

## Skills routing (auto-invoke)

| Trigger | Skill |
|---|---|
| Every session start | `claude-mem:mem-search` for prior context |
| Bug / crash / unexpected | `superpowers:systematic-debugging` |
| "done"/"works"/"fixed" claim | `superpowers:verification-before-completion` |
| Library API question | `context7` MCP |
| New feature design | `superpowers:brainstorming` → `superpowers:writing-plans` |
| Animation/gesture/SVG code | `react-native-best-practices` |
| Auth, secrets, AI pipeline, encryption code | `everything-claude-code:security-reviewer` |
| Schema/migration changes | `everything-claude-code:database-reviewer` |
| New screen | `everything-claude-code:a11y-architect` |
| Transaction list, chart, cold start | `everything-claude-code:performance-optimizer` |
| Atomic commits during work | `commit-commands:commit` or `caveman:caveman-commit` |
| GSD phase work | `gsd-plan-phase` / `gsd-execute-phase` / `gsd-ship` |

`Agent(subagent_type=Explore)` for any >3-file exploration. `caveman:cavecrew-investigator` for compressed file lookups.

## Skip for this project

- Django/Spring/Laravel skills — wrong stack
- Browser-based skills (`browse`, `qa`, `playwright`) — no DOM in RN (use `gstack` only if web demo added)
- TrueLayer / PSD2 / AISP-related — explicitly out of scope per `.planning/PROJECT.md`

## Phase status

Current: **Phase 0 Foundation** (in progress). See `.planning/STATE.md` for live position. ROADMAP is in `.planning/ROADMAP.md`.

When working on a phase: read its plan in `.planning/phases/0X/PLAN.md`, execute one plan at a time, verify each plan's gate, commit atomically.

## Two AIs in this project

**Claude.ai (planning chat, optional)** — strategy, prompts for Claude Code, business decisions.

**Claude Code (this CLI)** — reads files, implements changes, runs verification, commits atomically. Can be asked for opinions and pushback. Treat as a senior engineer who hasn't seen this conversation — brief with intent + context, not low-level keystrokes.

---
*Last updated: 2026-05-13 after P0 scaffold init.*
