# ADR 0011: Combat node and fight session (`nodes/combat`, `run/fight`)

- Status: accepted
- Date: 2026-10-12

## Context
Spec 1.10 ("Combat node") adds the first real node module: enemies and enemy groups as content, tier bands per act, a combat option built from them, and a fight that runs the M1 combat core from the run's data. A fight can be lost and then continued after a revive, which the M2.2 engine couldn't express (a revive always moved on). The combat module also needs content the node interface didn't give it (the pack), and must tell a fixed node without a `ref` (a content bug) from a drawn option. Code rule 10 asks for an ADR for these structure changes.

## Decision
- **Node modules get the pack.** `NodeBuildContext` gains `pack: ContentPack` and `fixed: boolean`; `canAppear(run, act, pack)` gets the pack as a third argument. The engine passes `ctx.pack`. Existing two-argument `canAppear` implementations still type-check. `fixed` is true for an act's fixed node and false for a drawn option, so a module can refuse a fixed node with no `ref` (the combat module throws RangeError) instead of treating it as drawn.
- **Content kinds `enemy` and `group`**, and `act.groups` / `act.tiers` (bands `{ from, weights }`), checked by content validation, including cross-references (group enemies, act groups). The tier list is a data enum (`GROUP_TIERS`); `boss` can't be weighted and is never drawn.
- **Combat module** (`combatNodeType`, id `combat`): `canAppear` asks for a band at the current step with a weighted tier that has a group in the act; `build` draws the tier with `pickWeighted` (the run map's draw) among those tiers, then a group of the tier uniformly in the act's order. A fixed node fights its `ref` group whatever its tier. `data = { group, tier }`, `tag = node.tag.<tier>`, `text = group.text`.
- **The fight session lives outside `RunState`.** `startFight(ctx, run)` builds the units (player from `playerUnitFromRun`, enemies `enemy1..3` from their files, moves as cards `<enemy id>.<move id>`) and a combat context on `derive("combat", actNumber, act, step, option)`, then runs turns to the player's first decision. `fightPlay` / `fightPass` call the core's `playCard` / `passTurn` and then run enemy turns and lost turns until the player decides again or the fight is over. Nothing touches the run until `finishFight`; resuming a save restarts the fight from its beginning (same stream, same commands, same fight).
- **Player unit from the run.** Loadout assembly's slot modifiers, item HP/Shield, powers and traits are shared helpers in `run/loadout.ts` (`loadoutUnit`, `powersOf`, `traitsOf`); `assemblePlayer` and `playerUnitFromRun` both use them, so a fresh run's fight unit equals the assembled one. Enemies reuse `powersOf` and `traitsOf`.
- **Mid-node fall and revive.** `fallInNode(run)` (phase `inNode` only): HP 0, phase `fallen`, node kept, `run.fellInNode = true` (plain data, survives JSON). `revive` after a mid-node fall puts the run back in `inNode` with `[Revived]` only; otherwise it moves on as before. `finishFight` maps "won" to `completeNode({ hp })` (no crowns) and "fallen" to `fallInNode`; it refuses a session that doesn't belong to the run's current node.
- **Continuing a fight** (`resumeFightAfterRevive`): the player's HP from the run, Shield full, statuses cleared, cooldowns and powers kept; enemies untouched. A new combat-core entry point, `reopenFight(state, unit)` in `combat/turn.ts`, clears the fight's end, makes `unit` active and starts a new round; if a side has no living unit (a both-fall), the fight ends again at once. It runs between turns, not in the turn pipeline, and allocates nothing.

## Consequences
- Event and merchant modules read their content through `ctx.pack` the same way; nothing else in the engine changes.
- The fight's round count after a resume counts the player's resumed turn as a new round; when enemies went first, they start the round after it.
- Rewards, crowns and level-ups after fights (M2 step 4) arrive as new optional `NodeResult` fields and a rewards step after `finishFight`.
- Placeholder Act I enemies and groups are tuned only roughly (a fresh Sellsword wins every normal and hard group, the single elite and the boss; the two-enemy elite is rarely won from full HP). The simulator tunes them in M5.
