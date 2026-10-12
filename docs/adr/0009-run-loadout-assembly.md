# ADR 0009: Run layer starts with loadout assembly (`run/loadout`)

- Status: accepted
- Date: 2026-10-12

## Context
Spec 1.8 ("Loadout assembly") defines how the five picks (character, weapon, armor, accessory, path) build the player's starting unit and how the starting technique is offered. This is the first piece of the run layer (M2). It needs content-driven powers and traits on items and paths, pool tags on skills, and a stable card id for the weapon's Strike. Code rule 10 asks for an ADR for a new module type.

## Decision
- New module `packages/core/src/run/loadout.ts`, pure and deterministic like the rest of core: `assemblePlayer` returns a `UnitInit` (ready for `createUnit`) plus the base stats, event tags and path rules; `techniqueOffer` draws the offer from an `Rng` the caller passes (`streams.derive("loadout", "technique")`); `intelligenceBonusOptions` is shared by every future skill or Word offer.
- **Order is data:** modifiers, powers and traits are read in slot order (weapon, armor, accessory, path); converts and slow-decay entries concatenate in that order, decay floors merge by max, and the stat floor of 0 applies once at the end.
- **Pools are tags:** the technique pool is the skills and Words tagged `technique`; "scales with a favoured stat" reads every scaling entry of every effect. Nothing compares content ids; "already held" compares definitions by identity. The pool is sorted by id before drawing, so the offer depends only on the content and the rng, not on file order.
- **Strike card id = the weapon's content id** (`weaponStrikeCard`), as every other card's id is the id of the content it comes from. `strikeCard` (id `"strike"`) stays for tools and tests that build cards by hand.
- **Content:** `tags` on skills and Words; `powers` (integers ≥ 0) and `traits` (converts with stacks ≥ 1, slow decay, decay floors) on weapons, armor, accessories and paths, validated; HP and Shield on a path are rejected. `TRIGGER_EVENTS` moves to the content types so validation can check converts.

## Consequences
- Run state (level-ups against the cap of 7 on base stats, companions, learning skills) builds on `AssembledPlayer` without re-reading the picks.
- Content can give any unit power or trait without code changes.
- Code that looks for Strike by the id `"strike"` must instead use the first card, or the weapon's id.
