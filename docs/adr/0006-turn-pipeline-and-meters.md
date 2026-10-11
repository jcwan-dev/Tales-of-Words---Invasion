# ADR 0006: Turn controller, turn hooks and build-up meters

- Status: accepted
- Date: 2026-10-11

## Context
Spec 1.4 defines the turn: fight start, turn start (damage over time), the action gate, the action, turn end, rounds and fight end. Stunned and Paralysed became build-up meters fed by two unit attributes, Stun power (every hit) and Paralysis power (once per attack). As with hits (ADR 0005), no status may be special-cased in rules code, the orders the spec fixes (Burning, Bleeding, Poisoned; Ambushed, Stunned, Paralysed) must come from data, and the turn controller allocates nothing but its events (code rule 6).

## Decision
- **Turn controller** (`combat/turn.ts`): `beginCombat` (Shield and Stun power to full, turn order built once, CombatStarted), `startTurn` (turn start, then the gate; returns whether the unit may act) and `endTurn` (turn end, then the next living unit; a wrap starts a new round). The caller resolves the action in between with `resolveAttack` / `resolveHit`. `startTurn` returning false means the turn is lost or already over; call `endTurn` only if `state.active` is still the same unit (a unit that falls at turn start has already ended its turn). `CombatState` is read-only outside; `CombatStateImpl` holds the turn index and a pooled gate.
- **New hook points** on `StatusHooks`, called on the active unit:

  | Point | Hook | Signature | Used by |
  |---|---|---|---|
  | Turn start | `onTurnStart` | `(owner, stacks, ctx, status)` | Burning, Bleeding, Poisoned (damage, then −1 stack) |
  | Action gate | `gateAction` | `(owner, stacks, ctx, status, gate)` | Ambushed, Stunned, Paralysed |
  | Turn end | `onTurnEnd` | `(owner, stacks, ctx, status)` | Ticking decay: Emboldened, Enfeebled, Kindled, Dimmed, Thorns, Leeching |

  Hooks get their own status id, so shared behaviour (a DoT tick, a meter, one-stack decay) is one function used by several modules without naming any of them.
- **Orders from data:** `StatusDef.priority` sorts every hook list at load (lower first, ties in `STATUS_IDS` order). Burning 1, Bleeding 2, Poisoned 3; Ambushed 1, Stunned 2, Paralysed 3; the rest 0.
- **Gate combination** (`combat/gate.ts`): results are ranked `allow < restrict < redirect < skip`; each answer is combined into a pooled `GateState`, the stronger result wins and keeps its reason. Skip beats restrict beats allow, as the spec says; redirect sits under skip, as in the spec's `runTurn` sketch. Restrict and redirect carry no payload yet; they arrive with the first status that needs them. Once the result is skip, the controller stops asking, so later meters keep their stacks.
- **Meters** (`statuses/meter.ts`): at 10+ stacks a meter loses the turn with a set chance (Stunned 1, so no roll; Paralysed 0.5, one roll on the combat RNG) and resets to 0 either way. Events: MeterTriggered, TurnSkipped if lost, StatusRemoved. No immunity turn.
- **Powers:** the registry names which statuses Stun power and Paralysis power fill (`STUN_POWER_STATUS`, `PARALYSIS_POWER_STATUS`, taken from the modules). Stun power is applied at hit step 7 after the hit's statuses; Paralysis power once at the end of `resolveAttack`. Both are ordinary applications (resistance, minimum 1).
- **Fight end:** `CombatContext` has an explicit mutable `fight` field, null by default and set by `beginCombat`, so a bare `resolveHit` can end the fight; there is no hidden module state. The check runs after every hit that felled a unit and after damage over time; if both sides have fallen, the enemies win. CombatEnded is always the last event.
- **Cooldowns** (`combat/cooldowns.ts`): parallel arrays per unit, searched linearly (a handful of cards). A card used this turn is spared at that turn end.

## Consequences
- A new turn-time status is a module plus a registry line; a new place in a spec order is a priority value.
- Units are built per fight: `beginCombat` restores Shield and Stun power but leaves statuses alone (the run layer decides what carries over).
- Units that fall during their own turn skip turn-end effects; one that falls at turn start ends its turn inside `startTurn`, so callers never see a fallen active unit between turns.
- Gate payloads (card filters, forced actions), card rules and enemy move choice will extend this controller without changing its steps.
