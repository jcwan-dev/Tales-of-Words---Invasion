# ADR 0005: Fixed hit pipeline; statuses join it through hook points

- Status: accepted
- Date: 2026-10-11

## Context
Every hit goes through the seven steps of the spec's hit order, and fourteen statuses (more later) change what happens at those steps. The spec requires that no status is special-cased in combat code, that statuses never name each other, and that the hit pipeline allocates nothing but its events (Combat core design, Performance rules). Code rule 10 asks for an ADR for new pipeline stages, hooks and module types.

## Decision
- `resolveHit` (`packages/core/src/combat/hit.ts`) is a fixed list of the seven steps. It never names a status; statuses take part only through hook points.
- A status is a **module** (`combat/statuses/<id>.ts`): stateless metadata (`StatusDef`: kind, decay, resisted by, priority) plus optional hooks. All modules are registered once in `statuses/registry.ts`, typed as `Record<StatusId, StatusModule>` so a missing status fails to compile.
- **Hook points per step** (all share one signature: `(hit, owner, stacks, ctx)`):

  | Step | Hook | Called on | Used by |
  |---|---|---|---|
  | 1 Base value | none (pipeline: amount + per × stat) | | |
  | 2 Attacker modifiers | `modifyOutgoing` | attacker | Emboldened, Enfeebled, Kindled, Dimmed, Piercing |
  | 3 Attacked triggers | `onAttacked` | target | Thorns |
  | 4 Warded check | `modifyIncoming` | target | Warded |
  | 5 Shield, then HP | none (pipeline) | | |
  | 6 Damage triggers (only if damage > 0) | `onDealtDamage`, then `onTookDamage` | attacker, then target | Leeching, Bleeding |
  | 7 Statuses | none (pipeline: the hit's statuses, then the attacker's Stun power; each an application with chance, then resistance from `StatusDef.resistedBy`) | | |

- Damage modifiers add ± stacks to `hit.modifierSteps`; the pipeline turns the net into a value once: `floor(base × (4 + steps) / 4)`, never below 0. Hooks set `hit.piercing` / `hit.deflected` and use their own charges.
- **Pre-sorted hook lists:** at load, the registry builds one list per hook point holding only the statuses that implement it, sorted by `StatusDef.priority` (ties in `STATUS_IDS` order; amended by ADR 0006). Dispatch walks that list and calls a hook only when the owner has stacks. The lists are global rather than per unit, because a dense stacks lookup is cheaper than keeping per-unit lists in sync on every add and remove.
- **Storage:** a unit's statuses are a fixed `Float64Array` indexed by status index (one entry per id, integer stacks). Iteration and updates allocate nothing.
- **Pooling:** the mutable `HitState` (attacker, target, value, piercing, deflected, damage dealt, scratch) comes from a pool indexed by nesting depth and is reused, so the pipeline allocates only the events it emits. `HitStarted` is pushed first and its value filled in after step 2, so step-2 charges are reported after it.
- Thorns damage and the Bleeding stack run no hooks, which is how "Thorns triggers nothing" holds without naming statuses.

## Consequences
- A new hit-time status is a new module file plus one registry line; the pipeline does not change. A new hook point or step needs a new ADR.
- Turn-time hooks (turn start, action gate, turn end) extend `StatusHooks` the same way: see ADR 0006.
- `resolveHit` returns whether the hit landed (not deflected), for `resolveAttack`, and runs the fight-end check after step 7 when a unit fell (ADR 0006).
- The pool depth counter is where the recursion cap (spec: Combat core design) will sit once triggers can cause hits.
- A status added during a step (e.g. by a hook) can run its hook later in the same step if its list entry comes after. No current status does this; revisit with consume/convert effects.
