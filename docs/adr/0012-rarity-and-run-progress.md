# ADR 0012: Rarity as a card transform, relics and run progress (`model/rarity`, `run/progress`)

- Status: accepted
- Date: 2026-10-12

## Context
Spec 1.11 ("Rarity", "Rewards and level-ups") gives every skill and Word card a rarity that scales its stat terms (grey 90% to orange 125%), lets items and paths raise starting rarities, adds relics (a new content kind held for the whole run), and defines level-ups, item swaps and learning, upgrading and forgetting cards. Rarity makes amounts fractional, so rounding down must be exact (green "4 +6 per Might" at Might 10 is 61, not 60), and heals and Shield now round down like damage. Code rule 6 forbids per-hit work, and code rule 10 asks for an ADR for a new module and run-state fields.

## Decision
- **Rarity is a card transform at unit build time.** `cardWithRarity(card, rarity)` (in `model/rarity.ts`, with `RARITIES`, `RARITY_SCALING`, `rarityRank`) returns a new card whose `{ stat, per }` terms have `per × factor` (rounded to a 1e-9 grid, so 6 × 0.95 is stored as 5.7); everything else is shared with the input, and blue returns the card itself. It is applied when the player's cards are built (`assemblePlayer`, `loadoutUnit` / `playerUnitFromRun`), so the hit pipeline and the turn controller never see a rarity and do no extra work. Enemy moves have no rarity.
- **Exact rounding.** One helper, `floorAmount` in `combat/hit.ts`, rounds every amount down with a 1e-9 tolerance that absorbs floating-point error: the damage-modifier step of the hit pipeline uses it, and `play.ts` now floors heal and restore Shield amounts with it too (they weren't rounded before). Content numbers are whole or short decimals, rarity factors twentieths and modifier steps quarters, so no genuine amount lies within the tolerance below a whole number. It is arithmetic only: no allocation. The benchmark workload (whole numbers only) is unchanged (hash `da908594`).
- **startRarity** on weapons, armor, accessories and paths: card id (skill, Word, or a weapon id meaning its Strike) → rarity. Validation checks the values and that every key is a weapon, skill or Word of the pack. The highest entry across the four slots counts; anything not named starts grey. `assemblePlayer` returns the starting unit with these rarities applied and the map in `rarities`.
- **Relics** (content kind `relic`, prefix `relic.`): optional stats, HP, Shield (integers ≥ 0), powers, traits and starting statuses (integers ≥ 1). In the player unit they come after the path, in the order gained: stats join the same floor-0 sum, powers add up, converts and slow decay append in relic order, decay floors merge by max, Shield adds to max Shield, starting statuses sum.
- **Run state** (plain data, JSON-safe): `player.rarities` (card id → rarity, one entry per held card; a held card without one counts as grey) and `relics` (ids in order gained). `player.baseStats` tracks level-ups only; the cap of 7 applies to it.
- **Run progress operations** in `run/progress.ts`, each mutating the run in place and changing nothing when refused or throwing: `levelUpOffer` (on an Rng the caller passes), `applyLevelUp`, `equipItem` (returns the card ids the new item offers; cards are learned separately), `itemOfferRarity`, `gainRelic`, `learnCard`, `upgradeCard`, `forgetCard` (`LearnResult` refusals). Max HP is recomputed only by `applyLevelUp`, `equipItem` and `gainRelic`, from the loadout, relics and base stats (`loadoutMaxHp`), and HP moves with it: the HP you were missing stays missing, never below 1, never above max. Everything else keeps reading `run.player.maxHp`.

## Consequences
- The reward screen, reward tables and rerolls (M2.4b) call these operations; their randomness gets its own streams there.
- A card's displayed number (M3 card UI) should use `cardWithRarity` and `floorAmount` so it matches what the pipeline does.
- Relic starting statuses apply when a fight starts; a revive mid-fight clears the player's statuses (spec: Combat node), relic ones included.
- Save data gains two fields; save versioning and migrations arrive with M4.
- Placeholder content: three relics (Pilgrim's Bell, Iron Heart, Whetstone) and the Twin Knives' Strike starting blue.
