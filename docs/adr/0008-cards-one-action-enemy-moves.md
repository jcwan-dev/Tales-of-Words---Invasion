# ADR 0008: Cards, one action per turn, enemy moves

- Status: accepted
- Date: 2026-10-11

## Context
Spec 1.7 removes energy: on its turn a unit takes exactly one action (a ready card, or pass), cooldowns are the only limit, and enemies act through weighted moves picked in advance so their intent is exact. Cards are effect data (damage with hits, heal, restore Shield, status, consume) aimed at the user, the chosen enemy or all enemies, and a damaging card's statuses ride on its hits. Code rules 2 and 6 forbid id-based behaviour and allocations on the turn path; code rule 10 asks for an ADR for new module types and turn structure.

## Decision
- **Cards** (`combat/cards.ts`): `CardSpec { id, cooldown, effects }` from content (`cardFromSkill`, `strikeCard`). A unit holds `cards` (a player at most 5) and enemies hold `moves` (`{ card, weight, intent? }`). Each card is **compiled once** at `createUnit` into a `CardPlan`: whether it needs a chosen enemy, and its steps in card order. Riding statuses are resolved at compile time: the first enemy damage effect gets one `AttackSpec` for the chosen enemy (carrying its "enemy" and "allEnemies" statuses) and one for the other enemies (carrying "allEnemies" statuses, only when it hits them); statuses it carries get no step of their own, except a direct step for the enemies that carrier doesn't hit. With no enemy damage effect, enemy statuses are direct steps (chance and resistance, not deflectable, no powers). Self statuses are unresisted.
- **Actions** (`combat/play.ts`): `playCard`, `passTurn` (player side) and `enemyAct` (enemy side) are the turn's one action; each ends the turn with `endTurn`. Validation runs in a fixed order and returns a shared, preallocated rejection with no events and no state change: `fight_over`, `not_your_turn`, `turn_not_started`, `cannot_act`, `unknown_card`, `on_cooldown`, `not_allowed`, `bad_target`. The state tracks `turnStarted` and `canAct` (set by `startTurn`, cleared when the turn advances), so a second action in a turn is `not_your_turn` and a lost turn is `cannot_act`. `endTurn` right after `startTurn` still works (a pass without `Passed`), so tools that drive `resolveAttack` directly keep working.
- **Playing**: CardPlayed, then each step on every unit it reaches (fallen targets skipped; the card stops if the user falls or the fight ends), then the cooldown, then the turn's end. Each damage step is one `resolveAttack` per target, so per-attack powers apply once per enemy.
- **Gate restrict payload**: `GateState.filter` (a `CardFilter`) carries a restrict filter; `gateAllows` is asked before a card is played (`not_allowed`) and when an enemy's intent is checked. No status sets it yet.
- **Enemy moves** (`combat/moves.ts`): `pickIntent` chooses by weight among ready (and, at action time, allowed) moves with one roll on the combat RNG (no roll for a single candidate), sets `unit.intent` and emits `IntentChosen`; with nothing ready the intent is null and the unit will pass. It runs at `beginCombat` for every unit with moves, and in `endTurn` right after TurnEnded, after the cooldown tick (lost turns included). `enemyAct` plays the intent on the first living unit of the other side; if the gate no longer allows it, it picks again among allowed ready moves, or passes.
- **Events**: `CardPlayed`, `Passed`, `IntentChosen`, and `ShieldRestored` (the amount a restore-Shield effect actually restored; the UI needs it as it needs `Healed`). A consume that empties a status now also emits `StatusRemoved`.
- **Content**: no `cost`; `hits` on damage effects and weapon attacks; targets `self | enemy | allEnemies`; heal and restore Shield may not scale with the target.

## Consequences
- A new card is data; a new effect type is a new step kind in `cards.ts` and one case in `play.ts`.
- Card plans are built per unit: units are created per fight, so the cost is paid once, outside the turn path.
- Cards and moves are matched by id only to find which card the caller named; no behaviour reads an id.
- Restricting statuses (silence, confusion) can now be added as gate hooks that set a filter or a redirect.
