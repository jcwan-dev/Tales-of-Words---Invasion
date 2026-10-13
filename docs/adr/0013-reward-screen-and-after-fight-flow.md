# ADR 0013: Reward screen and after-fight flow (`run/rewards`, run phases)

- Status: accepted
- Date: 2026-10-13

## Context
Spec 1.11 ("Rewards and level-ups", "After-fight flow (decided 12 Oct 2026, M2.4b)") adds a rewards screen after every won fight, per-tier reward tables in `act.json`, rerolls limited per run, learning a card with a full hand, and level-ups after elite and boss fights, all before the run moves on. A revive after falling at such a node runs the same steps. Code rule 10 asks for an ADR for a new module, new run phases and new run-state fields.

## Decision
- **Content.** `ActDef.rewards`: fight tier → `RewardTableDef { kinds, rarity, crowns }` (`REWARD_KINDS` = skill, item, crowns; rarities grey to orange; non-negative integer weights with one above 0; integer purse `0 ≤ min ≤ max`). No unknown keys at any level. An act that can fight (it has `groups`, or a fixed node whose `ref` is a group in the pack) needs all four tiers; this is a pack-level check in `validatePack`.
- **The node result carries the tier.** `NodeResult.rewardTier` (a `GroupTier`); `finishFight` sets it to the group's tier on a win. `completeNode` refuses (`invalid_result`, nothing changes) a value that isn't a tier or has no table in the current act. Results without it behave exactly as before.
- **The draw is a pure module**, `run/rewards.ts`: `drawRewardScreen(pack, input, rng)` returns `RewardCard[]` (skill with rarity and `upgrade`, item with slot, crowns, relic). Candidates are read through content kinds, `upgrade` and the run's rarities, in id order (load order never changes a screen): skills and Words not named as another's upgrade, not held or held below the drawn rarity; items not equipped; relics not held. Kind weights apply among kinds that still have something (at most one purse); a card nothing can fill is not drawn. The tiers with a relic card (boss) and with a level-up (elite, boss) are data constants (`RELIC_CARD_TIERS`, `LEVEL_UP_TIERS`), not comparisons in the flow. The screen size is 3 + `intelligenceBonusOptions(final Intelligence)`, from the new `loadoutFinalStats` (the same stat sum as the fight unit).
- **Randomness.** The screen uses `derive("rewards", actNumber, act, step, rerollIndex)` with the reroll number of the current screen (0 first), and the level-up `derive("levelup", actNumber, act, step)`. A reroll or a different pick never shifts the map, fights or level-ups.
- **Run state and phases.** New phases `rewards`, `learning`, `levelUp`. New JSON-safe fields, each null outside its phase: `rewards { tier, rerolls, cards }`, `learning { card, rarity, queue }` (queue: further incoming cards, e.g. an item's offer), `levelUp { options }`; and `rewardTier`, the pending flow's tier, kept through a fall (phase `fallen`) and cleared when the run moves on or ends. The node stays current until the run moves on.
- **Commands** (refusals change nothing): `takeReward`, `skipReward`, `rerollRewards` (spends a reroll grant through `consume` in `run/limits.ts`, code rule 7), `learnForget`, `learnLeave`, `chooseLevelUp`. They reuse `run/progress.ts` (`upgradeCard`, `learnCard`, `equipItem`, `itemOfferRarity`, `gainRelic`, `levelUpOffer`, `applyLevelUp`) and add no rules of their own. Events: `RewardsOffered`, `RewardsRerolled`, `RewardTaken`, `RewardSkipped`, `CardOffered`, `CardLearned`, `CardUpgraded`, `CardLeft`, `ItemEquipped`, `CrownsGained`, `RelicGained`, `LevelUpOffered`, `StatRaised`; payloads are copies.
- **Flow.** `completeNode` → HP, `NodeCompleted` → (0 HP: `PlayerFell`, the flow waits; a revive runs it) → rewards (nothing to offer: no screen) → learning (one card at a time) → level-up (elite and boss, if a stat can rise) → the next step, or the routes or victory.

## Consequences
- In `rewards`, `learning` and `levelUp` the map, fall, revive and end-run commands are refused by their existing phase checks, so a choice can't be skipped by falling or quitting the tale.
- The app's run screens (M3) render the three phases from the state fields and the events; replays record rerolls as commands.
- Save data gains four fields and three phases; save versioning and migrations arrive with M4.
- Unlocks (Ink, bundles) will filter candidates in `run/rewards.ts` when they exist (M4).
- Act I has placeholder tables for all four tiers (normal and hard grey to blue, elite green to purple, boss blue to orange), to be tuned with the simulator.
