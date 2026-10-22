# Development log and handoff: Tales of Words: Invasion

**Read this first in any new chat.** It records where development stands, how to get access, and what to do next.
Last updated: 22 Oct 2026 (Europe/London). `main` has PR #16 (inkjs added to `@tow/narrative`, 21 Oct); CI green on `main`. M2 step 5 product-owner questions are being asked.

## Working locally (from 21 Oct 2026)
- Development now moves to **Claude Code on the product owner's Windows PC**, in `D:\_Claude\Tales-of-Words---Invasion`. Git (HTTPS, signed in with `gh auth login`), Node, pnpm and Claude Code are installed; `pnpm install` has run.
- Locally, **npm works**: real vitest, ESLint, the React build and Playwright can run here, and new dependencies can be added. The cloud-session workarounds under "How to get access in a new chat" (vitest stand-in, `gh api` REST calls instead of `gh pr create`, no branch deletion) **don't apply locally**.
- This file was copied from the claude.ai project doc `game/dev-log.md`. The spec and lore docs still live in the claude.ai project too (the repo has snapshots of the spec and magic system in `docs/spec/`). Keep the sync rule: spec changes go to the repo snapshot, the project doc and the mockup page.
- **One chat at a time** still applies: drive the repo from the local Claude Code session only.

## Resume here
- **Where we stopped:** M2 steps 1–4 are done and live (PRs #10–#15). Nothing is in progress: no open branch, no half-done agent work.
- **Next task:** M2 step 5, **events (Ink) and the merchant**. First ask the product owner the step 5 questions listed under "Next steps" below (with AskUserQuestion, recommended option first), then write spec 1.12 (repo snapshot + project doc + mockup page, per the sync rule), then run the agent loop (spec-to-tests → builder → fresh reviewer → PR → product owner merges).
- **inkjs:** added to `@tow/narrative` in PR #16 (21 Oct). Locally, run pnpm as `npx -y pnpm@10.28.0` (the global pnpm is 12 and rewrites the lockfile).
- **Lore snapshot:** `docs/lore/` (copied 21 Oct; the claude.ai project stays canonical).
- **Lore for event writing:** the project also has `world/faiths-and-orders.md` (alongside bestiary, peoples and cultures, items and relics, factions, countries and politics, magic system). Event text in content stays placeholder until the wiki defines it.
- **Watch:** GitHub's `ubuntu-latest` moved to Ubuntu 26 from 19 Oct; check the first CI run after that (new runner CPUs may need a benchmark baseline entry).
- **Housekeeping done:** the Chrome tab group from the 10 Oct live check was closed by the product owner (safe; the staging site itself must stay).

## Key links
| What | Where |
|---|---|
| GitHub repository | https://github.com/jcwan-dev/Tales-of-Words---Invasion (public; owner: `jcwan-dev`) |
| Live staging build | https://jcwan-dev.github.io/Tales-of-Words---Invasion/ (redeploys automatically on every merge to `main`) |
| Debug fight page | https://jcwan-dev.github.io/Tales-of-Words---Invasion/#debug |
| Game spec (canonical) | Project doc `game/roguelike-spec.md` (snapshot in the repo at `docs/spec/roguelike-spec.md`), Draft 1.11 |
| Magic system lore | Project doc `world/magic-system.md` (snapshot at `docs/spec/magic-system.md`) |
| Screen mockups | https://claude.ai/artifact/L1sHrieFqRf2CYbsc8m61s (version 23, spec 1.11) |
| Agent brief (rules for anyone writing code) | `CLAUDE.md` at the repo root |
| Architecture decisions | `docs/adr/0001` to `0013` in the repo |

## How to get access in a new chat
1. **GitHub:** the **Claude GitHub App** (https://github.com/apps/claude) is installed on the `jcwan-dev` account with access to this repo. In a Claude Code cloud session, attach the repo (`jcwan-dev/Tales-of-Words---Invasion`, push access), then clone it. If the session says "link your GitHub account", the session predates the app install: start a new session.
2. **What works from a cloud session** (as of 10 Oct 2026):
   - git clone and push through the session's proxy (a push can fail once with "fatal error in commit_refs": wait and retry);
   - the GitHub REST API through `gh api …`: opening PRs, merging them (`PUT …/pulls/<n>/merge`), reading runs, jobs and step results, annotations, and re-running workflow runs (`POST …/actions/runs/<id>/rerun`);
   - Claude Code subagents for the agent workflow.
3. **What does not work from a cloud session:**
   - GitHub GraphQL, so `gh pr create`, `gh pr list` and the like fail. Use `gh api` REST calls instead, e.g. `gh api repos/jcwan-dev/tales-of-words---invasion/pulls -f title=… -f head=<branch> -f base=main -F body=@file.md`.
   - Deleting branches through the API (`DELETE …/git/refs/…` is refused by the proxy). Merged branches stay on GitHub; delete them from the PR page if wanted.
   - `gh api` on other repos (e.g. `actions/checkout` releases) is refused; `git ls-remote --tags https://github.com/<repo>` works to find versions.
   - Enabling Pages through the API.
   - Downloading CI artifacts or full job logs (they are stored on a host the proxy blocks).
   - Reaching `github.io` (the live page) from the shell.
   - CI job logs can't be downloaded, but when the chat is linked to the product owner's computer, the job page on github.com can be read in Chrome (`get_page_text`), which shows the full log. Vitest failures also need `--testTimeout` headroom: CI runners are about 5× slower than the cloud session.
   - **The npm registry is blocked by the organisation's egress policy** (confirmed again 11 Oct: CONNECT to registry.npmjs.org is refused with 403; don't try to route around it). CI on GitHub runs the full install, lint, build and tests; local checks use a small vitest stand-in (rebuild it in the session scratchpad: an ESM loader mapping `vitest` to a shim and `@tow/*` to `packages/*/src/index.ts`, run with `node --experimental-transform-types`) plus the global `tsc`. Real vitest and ESLint run only in CI (ESLint uses `tseslint.configs.strict`: e.g. no dynamic `delete`). App (React) code can't be built locally: keep its logic in plain `.ts` modules that can be checked headless, and read Playwright failures from CI annotations (github reporter). No new dependencies can be added from here (the lockfile can't change): the sim's tests use `node:test` through `tsx`.
   - **Shallow clones:** the session clone only fetches `main`. To track a branch, add a fetch refspec: `git config --add remote.origin.fetch +refs/heads/<b>:refs/remotes/origin/<b>`, otherwise the stop hook reports false "unpushed commits".
   - `project_write` with `local_path` only accepts files inside the working directory (stage a copy in the repo folder, upload, then delete it).
4. **Testing the live page in a browser** works when the chat is linked to the product owner's computer through the Claude desktop app (confirmed 10 Oct 2026). Two options:
   - **Chrome** (the product owner's preference): the Claude in Chrome extension must be installed, Chrome open, and the extension signed in to the same claude.ai account. If it reports "not connected", ask the product owner to open Chrome and retry. Claude's tabs go into their own tab group; close them when done.
   - **The desktop app's built-in browser**: `jcwan-dev.github.io` is already allowed there. It can emulate a phone viewport without resizing the product owner's windows.
   - Not required for merging: CI's browser tests and the `live-smoke` job cover the build.
5. **One chat at a time.** On 11 Oct two chats drove the same workspace and builder agent (Cards was started in one and finished in the other). Work on the repo from one chat only.
6. **Usage limits and resets.** When the session hits a usage limit mid-task, a subagent can stop half-way and leave uncommitted files; after a context reset the orchestrator may not remember them. Before starting new work, check `git status`, local branches (`git branch -a`), the scratchpad's `task-*.md` briefs and the open PRs, and resume from there (13 Oct: the M2.4b test pass was found half-done this way and finished). Work done by this same chat while the product owner sent "continue" is still this chat's work, not another chat's.

## Status
### M0 Foundations: done, merged, live
- PR #1 merged into `main` (merge commit `af1c685`). All CI checks green: lint (architecture rules), typecheck, tests, content validation, simulator, build, Playwright browser tests, GitHub Pages deploy.
- GitHub Pages is enabled (Source: GitHub Actions). The product owner confirmed the live page opens.
- `pnpm-lock.yaml` is committed; CI uses frozen installs.

### What M0 contains
- pnpm monorepo: `packages/core`, `packages/narrative`, `packages/platform`, `packages/app`, `tools/sim`, `content/base`, `docs/adr`, `docs/spec`.
- **Core** (pure, deterministic, zero runtime dependencies):
  - seeded RNG with named and derived streams;
  - 7 stats (start 2, favoured 3, cap 7, HP = 20 + 5 per Vitality);
  - run limits (revive 2, reroll 3) enforced with grants;
  - content types and hand-written validation.
- **Platform:** ad and billing adapter interfaces; `MonetisationService` (Premium instant, rewarded ad, no-ad fallback after 3 s, end-of-run ad skipped for Premium); web mocks.
- **Content:** 3 characters (Scholar, Sellsword, Urchin), 3 weapons, 2 armors, 3 accessories, 1 path, 5 skills, 5 placeholder Words (火 Huo, 冰 Bing, 雷 Lei, 盾 Dun, 愈 Yu).
- **App:** title screen, live content check, revive/reroll test panel using the real core limits with mock ads and purchases (`?adms=300` shortens mock ads).
- **CI** (`.github/workflows/ci.yml`): every push and PR runs all checks; pushes to `main` deploy to GitHub Pages.

### Findings from the M0 deploy run
- ~~Actions on deprecated Node 20~~: fixed in PR #2 (merged).
- GitHub's `ubuntu-latest` runners move to Ubuntu 26 from 19 Oct 2026. Watch the first run after that (the benchmark may meet a new CPU model: see M1 step 5).

### Live check in Chrome (10 Oct 2026)
The live staging build was tested in the product owner's Chrome. The page loads with no console errors, and the revive limit (2, through ads) and the Premium reroll limit (3, no ads) both hold. The test-panel issues found there are fixed in PR #2. Phone-width layout checked by the product owner on a phone (fine). One earlier plain, unstyled load on the phone was a one-off loading glitch; a browser test now checks the stylesheet is applied.

## M1 Combat core: done
Each step went through the agent loop in `CLAUDE.md` (spec-to-tests → builder → fresh reviewer → product owner merges).
0. **Housekeeping.** PR #2 (`de044bb`): Actions on Node 24 versions; `live-smoke` job after each deploy (waits for `version.json` to show the new commit, runs the browser tests against the live URL, writes an annotation readable with `gh api repos/jcwan-dev/tales-of-words---invasion/check-runs/<job id>/annotations`); test-panel log fixes.
1. **Shield, HP and the hit order.** PR #3 (`3ab90a9`). Spec 1.3 "Hit order details": netted modifiers rounded down; Shield damage counts for triggers; Thorns untyped and triggerless; **Piercing ignores Warded**; fallen units; certain chances use no RNG. ADR 0005.
2. **Turn pipeline.** PR #4 (`781fb3c`). Spec 1.4: **stun and paralysis are build-up meters** (Stun power every hit, −1 per own turn, full each fight; Paralysis power once per attack; at 10 stacks the turn is lost, or 50% for Paralysed, then reset; no immunity turn); turn order by side Agility (ties to the player); cooldown N = N turns of waiting. ADR 0006.
3. **Powers and synergies.** PR #5 (`a311895`). Spec 1.5: Bleed, Burn and Poison powers; consume; convert triggers with a depth guard of 4; slow decay; Afflictions and stack scaling. ADR 0007.
   - **Follow-up.** PR #6 (`0f0e7d9`). Spec 1.6: consume cap; slow decay by id or tag, own or enemies; decay floors (Glutton's Path). Several floors on one status merge by max when traits are assembled (done in M2 step 1).
3b. **Debug fight page.** PR #7 (`a58a86e`). At `#debug` on staging: two editable units, four presets, seed, Start / Next turn / Run to end (50-round cap) / Reset, readable event log. Logic in `packages/app/src/debug/fight-model.ts`; English only (debug exemption from code rule 5).
4. **Cards, one action per turn, enemy moves.** PR #8 (`b5d5a5e`). Spec 1.7 (decided by the product owner): **no energy, one action per turn** (Strike, one ready skill incl. the companion's, or pass); skill costs removed; Strike at most once per turn; cards with target choice and multi-hit damage effects; statuses ride on the first damage effect's hits (none on a deflected hit); enemy moves weighted with cooldowns, picked in advance on the combat RNG so the intent is exact, re-picked if restricted. Content: costs removed, Twin Knives 2 hits. ADR 0008. 695 core tests.
5. **Performance benchmark.** PR #9 (`2040be9`). CI step "Performance benchmark" (`pnpm --filter @tow/sim bench -- --check`, about 6 s): 10,000 seeded fights with 59+ starting stacks through the public API, workload hash `da908594`. Fails if more than 20% slower than the baseline **for the runner's CPU model** (`tools/sim/bench-baseline.json`, `byCpu`), or over the spec budgets (100 µs per hit, 2 ms per round). Today about 0.55 µs per hit and 6 µs per round.
   - Baselines: EPYC 7763 ratio 7.261 (median of 4 CI runs, 2% spread); EPYC 9V74 ratio 5.795 (1 run: re-record from more runs). **New CPU seen 12 Oct: Intel Xeon 6973P-C** (ratio 6.876 on one run, no baseline yet). A CPU without an entry only checks the budgets and prints a "no baseline for <cpu>" notice: copy its numbers in (median of several runs). Procedure in `CLAUDE.md`.

## M2 Run layer: in progress (steps 1–4 done)
1. **Loadout assembly.** PR #10 (`d66c240`). Spec 1.8 "Loadout assembly" (decided by the product owner): stats 2 / favoured 3 plus item and path modifiers, floor 0; **the run cap of 7 applies to level-ups only**; HP = 20 + 5 × Vitality + item HP, Shield from items; powers add up, traits combine (decay floors by max); cards in order Strike, accessory grant, technique; **the companion's skill counts toward the 5 cards**. **Starting technique offer:** 2 skills tagged `technique` that scale with a favoured stat + 1 from any, plus 1 option at Intelligence 4 and 2 at 6 (these Intelligence bonuses apply to all skill and Word offers); the player may start without one. API in `packages/core/src/run/loadout.ts` (`techniqueOffer`, `assemblePlayer`); the Strike card's id is the weapon's id. ADR 0009. 124 new core tests.
2. **Run engine, node registry and act map.** PR #11 (`189c461`). Spec 1.9 "Run map" (product owner took the recommended options): **no map ahead**, choices drawn at each step; **always 3 options** with at least two node types when possible; the merchant never offered right after a merchant (`mayFollowItself: false`, across acts and fixed nodes); step count rolled once per act from `act.json` (Act I 10–14); fixed nodes (mid-act event, boss) replace the choice; routes after the boss by story flags; run state is plain JSON data; quitting mid-node restarts the node with the same seed; revive at half HP rounded up. Commands in, events out (`startRun`, `chooseOption`, `completeNode`, `chooseRoute`, `revive`, `endRun`). ADR 0010. 179 new core tests.
3. **Combat node.** PR #12 (`1a6b657`). Spec 1.10 "Combat node" (product owner chose the recommended options): enemies and **enemy groups** as data, groups tiered **normal / hard / elite / boss**; the act's **tier weights shift by step band**, no stat scaling; HP carries over, Shield refills, statuses/cooldowns/meters reset each fight; **falling mid-fight can be revived and the fight continues** (half HP, Shield full, the player's statuses cleared, enemies unchanged, the player acts next; the turn of the fall finishes first, without status decay; if both sides fell the revived player wins). **Fights give no crowns directly**: crowns are the in-run money for merchants (skills, equipment) and come from the rewards screen; Ink ✒ is counted at the end of the run (product owner confirmed 12 Oct). Placeholder Act I content: 5 enemies, 8 groups incl. `group.act1_boss`. ADR 0011. Core suite 1,135 tests.
   - Follow-ups: a combat event for the resume after a revive (M3 combat screen); the placeholder elite `warden_and_hound` is very hard for a fresh Sellsword (about 12% win) — tune in M5.
4a. **Rarity, relics, level-ups, item swaps and learning.** PR #13 (`2de7f09`). Spec 1.11 "Rarity" and "Rewards and level-ups" (decided by the product owner 12 Oct): five rarities grey 90% / green 95% / blue 100% / purple 110% / orange 125% of a card's stat scaling, applied when the unit is built (no cost in the hit pipeline); exact round-down (green "4 +6 per Might" at Might 10 = 61), heals and Shield round down too; everything starts grey unless items/paths name a `startRarity`; **relics** (new content kind, passive for the run); level-ups (two stats, one favoured; +2 / +1; cap 7 on base stats; Vitality raises max and current HP together); item swaps keep the HP you were missing; learning, upgrading and forgetting cards (`run/progress.ts`). ADR 0012.
   - An earlier attempt with a different rarity model (common/uncommon/rare as draw odds) is on branch `m2-rewards`: superseded, not to be merged.
4b. **Reward screen, rerolls and the after-fight flow.** PR #14 (`96dc781`, live on staging, live browser tests passed). Spec 1.11 "After-fight flow": rewards → learning (only with 5 held) → level-up (elite and boss) → next step or routes; 3 cards + the Intelligence bonus (skills or Words); the boss's third card is a relic; per-tier reward tables in `act.json` (kinds, rarity, crowns range) required for every act that can fight; at most one purse; upgrades of held cards; rerolls per screen on their own stream, 3 per run through grants. Placeholder Act I tables. ADR 0013. Core suite 1,524 tests.
   - PR #15 (`35a78c9`): doc-only refresh of two Run map notes in the spec.
   - Known, accepted: a content bug from an unvalidated pack can leave a reward screen half-cleared (state after a content-bug error is unspecified, as elsewhere).

### Next steps
From the spec's build order: loadout, stats and level-ups, node registry, events via inkjs, merchant, rewards and rerolls, learning skills, companions, run limits. **Done when** a full Act I run plays headless in the simulator. Suggested order, one PR each through the agent loop:
1. ~~Loadout and unit assembly~~: done (PR #10).
2. ~~Run state, node registry, act map~~: done (PR #11).
3. ~~Combat node~~: done (PR #12).
4. ~~Rarity, relics, level-ups, learning~~ (PR #13); ~~reward screen, rerolls, after-fight flow~~ (PR #14). **Done.**
5. **Next:** events through inkjs (`packages/narrative`) and the merchant. Raise product-owner questions first, e.g.: what event choices can check and change (stats, tags, path rules, items, flags, HP, crowns, cards, relics, companions); how locked choices show; whether events can give rewards screens or start fights; how events are drawn (pool per act, repeats, the fixed mid-act event `event.act1_crossroads`); merchant stock (what kinds, how many, prices by rarity and act, healing, removing a card, rerolling stock?), whether merchants can appear twice; whether Ink is tracked in the run now. inkjs is a dependency of `@tow/narrative` (PR #16).
6. Headless Act I run in the simulator; Ink earned at the end of the run. Then M2 is done (companions may be pulled into step 5 or later).
Each step will need product-owner decisions (e.g. rewards tables, level-up offers); raise them before building.

## Decisions log (short)
- Tech: web app in TypeScript (React, Vite) packaged with Capacitor; rules core is pure TS (ADR 0001, 0002).
- Revive and reroll limits live only in the core; Premium keeps the same limits (ADR 0003).
- Staging on GitHub Pages first; per-PR preview links (Cloudflare Pages) later, once an account exists (ADR 0004).
- No-ad fallback grants a revive or reroll after a short wait (accepted, so a bad connection never costs a run).
- Spec 1.3: hit order details; Piercing ignores Warded (PR #3).
- Spec 1.4: stun and paralysis as build-up meters, no immunity turn; turn order by side Agility (PR #4).
- Spec 1.5: powers for every DoT; consume, convert, slow decay (PR #5).
- Spec 1.6: consume cap, general slow decay, decay floors (PR #6).
- A debug fight page lives on staging at `#debug` during development (PR #7).
- Spec 1.7: no energy, one action per turn; enemy moves picked in advance (PR #8).
- Performance benchmark baselines are per CPU model, because GitHub runner CPUs differ (PR #9).
- Spec 1.8: loadout assembly; run cap applies to level-ups only; Intelligence widens all offers; companion skill counts toward 5 cards (PR #10).
- Spec 1.9: no map ahead, 3 options per step, merchant never twice in a row, fixed nodes replace the choice, restart a node on resume (PR #11).
- Spec 1.10: enemy groups with tiers and step bands, no enemy scaling, revive continues the fight, fights give no crowns directly (PR #12).
- Spec 1.11: five rarities scaling stat terms, relics, level-ups, item swaps, after-fight flow with per-tier reward tables (PR #13, #14).
- Crowns = in-run money (merchants); Ink = meta currency earned at the end of each run, win or lose (confirmed 12 Oct).
- Test-panel buttons are disabled at 0 left by reading `remaining()` from the core; the core still enforces the limits (PR #2).
- Development moves to local Claude Code on the product owner's PC (21 Oct 2026).
