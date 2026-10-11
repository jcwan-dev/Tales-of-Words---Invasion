# Agent brief: Tales of Words: Invasion

Read this before changing anything. It applies to every agent role (orchestrator, spec-to-tests, builder, reviewer).

## Source of truth
- **The spec is the source of truth:** `docs/spec/roguelike-spec.md`. Rules change in the spec first, then in tests, then in code. If the spec is unclear or wrong for a task, stop and raise it; do not guess.
- The canonical spec lives in the claude.ai project "Tales of Words" (`game/roguelike-spec.md`). `docs/spec/` is a snapshot, updated in the same pull request as any spec change.
- Lore for magic: `docs/spec/magic-system.md` (canonical: `world/magic-system.md` in the project). Words and effects in content are placeholders until the wiki defines them.
- The mockups for every screen: https://claude.ai/artifact/L1sHrieFqRf2CYbsc8m61s

## Layout
| Path | What | May import |
|---|---|---|
| `packages/core` | Rules: combat, statuses, effects, units, run, limits, content validation. Pure, deterministic TypeScript, zero runtime dependencies. | nothing else in the repo |
| `packages/narrative` | inkjs adapter (M2) | core |
| `packages/platform` | Ads, billing, entitlements, storage adapters; web mocks | core |
| `packages/app` | React screens, animation, input | core, narrative, platform |
| `tools/sim` | Content validation, simulator, benchmarks (Node) | core |
| `content/<pack>` | JSON content packs; `content/art` (M3) | — |
| `docs/adr` | Architecture decision records | — |

## Commands
```
pnpm install
pnpm check              # lint + typecheck + tests + content validation
pnpm dev                # app at http://localhost:5173
pnpm test:e2e           # browser tests against the production build
pnpm validate:content
pnpm sim -- --runs 1000 --seed any
pnpm --filter @tow/sim bench -- --check    # performance benchmark against tools/sim/bench-baseline.json
pnpm --filter @tow/sim bench -- --record   # write this machine's CPU entry (local experiments; CI numbers go in by hand)
```
Benchmark baseline: one entry per CPU model, taken from CI. Copy the numbers from the CI notice "no baseline for <cpu>" into `byCpu`, using the median of several runs. Re-record only when the workload hash changes on purpose; a CPU with no entry only checks the per-hit and per-round budgets.

## Code rules (the reviewer's checklist)
1. `packages/core` imports nothing from `app`, `platform`, `narrative`, React, the DOM, Node or Capacitor. Enforced by ESLint.
2. No content id is compared in rules code (`if (status.id === "burning")` is rejected). Use hooks, tags and data.
3. All randomness through the RNG streams (`RngStreams`, `createRng`). No `Math.random()`, `Date.now()` or `new Date()` in core. Enforced by ESLint.
4. TypeScript strict, no `any`, no non-null assertions in core.
5. All player-facing text through localisation keys (content uses keys like `skill.cleave.name`).
6. No allocations, spreads or closures in the hit pipeline or turn controller (from M1).
7. Revive and reroll limits live only in `packages/core/src/run/limits.ts`. The UI never grants a revive or reroll itself; ads and billing are only reached through `@tow/platform`.
8. Every rule in the spec has a scenario test; every new behaviour arrives with its tests.
9. Save data is versioned with a migration for every format change (from M4).
10. Any change to the core structure (new pipeline stage, new hook, new module type) needs a short ADR in `docs/adr/`.
11. CI must be green: lint, types, tests, content validation, simulator, build, browser tests.

## Workflow
1. The orchestrator turns one spec section into a task.
2. Spec-to-tests writes failing tests from the spec only, without reading the implementation.
3. The builder makes them pass and adds unit tests.
4. CI runs everything and, on main, publishes the staging link.
5. The reviewer, with fresh context, checks the diff against the code rules.
6. The product owner plays the build and approves the merge.

Branches: `m<N>-<topic>` for milestone work. Never push directly to `main`. One pull request per task.

## Milestones
M0 Foundations (this) · M1 Combat core · M2 Run layer · M3 Game shell · M4 Platform · M5 Content and balance · M6 Release. Details in the spec, "Build order".
