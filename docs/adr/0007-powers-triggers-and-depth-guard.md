# ADR 0007: Powers as data, convert triggers and the trigger depth guard

- Status: accepted
- Date: 2026-10-11

## Context
Spec 1.5 adds Bleed, Burn and Poison power next to Stun and Paralysis power, removes the old "+1 Bleeding on a physical hit", and defines four synergy effects: Afflictions and stack scaling, consume, convert triggers (with a recursion cap of 4) and slow decay. Code rule 2 forbids comparing status ids; code rule 6 forbids allocations beyond events in the hit and turn paths; code rule 10 asks for an ADR for new hooks and pipeline structure.

## Decision
- **Powers are data** (`combat/powers.ts`): one `PowerDef` per power: the unit attribute, the status it adds (taken from the status module), the timing (`perHit` at step 7 after the hit's statuses, or `perAttack` after the attack's last hit) and whether it decays (−1 per own turn end, full again at fight start). Table order is application order: Bleed, Stun per hit; Burn, Poison, Paralysis per attack. A unit holds `powers` and `fullPowers` records keyed by power id; the hit, the attack and the turn controller walk pre-filtered lists (`PER_HIT_POWERS`, `PER_ATTACK_POWERS`, `DECAYING_POWERS`) and read `powers[def.power]`. Named getters (`stunPower`, `bleedPower`…) stay for callers.
- **Bleeding** lost its `onTookDamage` hook. The hook point stays (no status uses it today).
- **Tags:** `StatusDef.tags` (Burning, Bleeding, Poisoned: `"dot"`). The registry builds a per-tag list of status indices at load; `countWithTag`, `stacksWithTag` and `afflictions` (= `countWithTag(unit, "dot")`) walk it without allocating.
- **Scaling** (content type) is a union: `{ stat, per }`, `{ afflictions: true, per }`, `{ stacksOfTag, per }`. Step 1 reads target terms when the hit starts; `baseValue` takes the target as an optional fourth argument (the three-argument form still works for stat terms and throws for target terms). The content validator accepts exactly one kind per term.
- **Consume** (`resolveConsume`): the same pipeline as `resolveHit` (one internal runner with fields, no `HitSpec` allocated), with the step-1 value = stacks × multiplier and, if the hit lands, removal of all stacks of the status at the end of the hit (`Consumed`). Not an attack: no per-attack powers.
- **Convert triggers** are unit traits (`traits.converts`), not status hooks: a status hook belongs to a status, while a convert belongs to an item or path on a unit. `fireTriggers(ctx, unit, on)` runs them at fixed points of the hit:

  | Trigger | Fires | On |
  |---|---|---|
  | `deflect` | right after HitDeflected (the Warded charge was used) | target |
  | `dealtDamage` | step 6 after Leeching, if damage > 0 | attacker |
  | `tookDamage` | step 6 after `dealtDamage`, if damage > 0 | target |
  | `attacked` | at the end of the hit (after step 7, per-hit powers and a consume's removal), deflected or not | target |

  A fallen unit doesn't trigger. Gains are the owner's own statuses: added unresisted (TriggerFired, then StatusApplied). Thorns and damage over time call no triggers.
- **Depth guard:** `CombatContext.triggerDepth`, raised around each trigger by `fireTriggers` and restored afterwards (0 outside triggers, so a trigger set off by a hit is depth 1). A trigger that would run deeper than `TRIGGER_DEPTH_CAP` (4) is skipped with `TriggerCapped`. No chain is possible with today's four trigger events, so the guard is unit-tested by presetting the depth.
- **Slow decay:** the turn controller computes `holdDotDecay` once per turn start (odd round and a living unit on the other side has `slowEnemyDotDecay`) and passes it to turn hooks in the pooled `TurnInfo`; the shared DoT tick deals damage and skips the −1 when it is set.

## Consequences
- A new power is a table row and a unit field; no pipeline change.
- When a trigger event that a gained status can set off appears (e.g. "gained a status"), chains will run under the existing guard; the event log already reports capped triggers.
- The end of a hit is now an ordered list: consume removal, attacked triggers, then the fight-end check (so CombatEnded stays last).
