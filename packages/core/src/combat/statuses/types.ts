import type { StatusId } from "../../content/types.ts";
import type { StatId } from "../../model/stats.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";

/** How stacks run out (spec: Stacking). */
export type DecayKind = "ticking" | "charges" | "timed";

/** Status metadata from the spec's status list. */
export interface StatusDef {
  readonly id: StatusId;
  readonly kind: "buff" | "debuff";
  readonly decay: DecayKind;
  /** The highest of these stats resists an application; empty = not resisted. */
  readonly resistedBy: readonly StatId[];
}

/**
 * A hit hook. `owner` is the unit that has the status, `stacks` its current stacks (always > 0).
 * Hooks must not allocate beyond the events they emit.
 */
export type HitHook = (hit: HitState, owner: CombatUnit, stacks: number, ctx: CombatContext) => void;

/**
 * Hook points of the hit pipeline (ADR 0005). Each is called on one side of the hit:
 * - `modifyOutgoing` (step 2, attacker): damage modifiers, Piercing charge.
 * - `onAttacked` (step 3, target): fires whether or not the hit lands (Thorns).
 * - `modifyIncoming` (step 4, target): may deflect the hit (Warded).
 * - `onDealtDamage` (step 6, attacker): only when damage > 0 was dealt (Leeching).
 * - `onTookDamage` (step 6, target): only when damage > 0 was taken (Bleeding).
 */
export interface StatusHooks {
  readonly modifyOutgoing?: HitHook;
  readonly onAttacked?: HitHook;
  readonly modifyIncoming?: HitHook;
  readonly onDealtDamage?: HitHook;
  readonly onTookDamage?: HitHook;
}

export type HitHookName = keyof StatusHooks;

export const HIT_HOOK_NAMES: readonly HitHookName[] = ["modifyOutgoing", "onAttacked", "modifyIncoming", "onDealtDamage", "onTookDamage"];

/** A status: stateless definition plus hooks, registered once by id. */
export interface StatusModule {
  readonly def: StatusDef;
  readonly hooks: StatusHooks;
}
