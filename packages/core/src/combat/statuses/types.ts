import type { StatusId, StatusTag } from "../../content/types.ts";
import type { StatId } from "../../model/stats.ts";
import type { CombatContext } from "../context.ts";
import type { GateState } from "../gate.ts";
import type { HitState } from "../hit-state.ts";
import type { TurnInfo } from "../turn-info.ts";
import type { CombatUnit } from "../unit.ts";

/** How stacks run out (spec: Stacking). */
export type DecayKind = "ticking" | "charges" | "timed" | "buildup";

/** Status metadata from the spec's status list. */
export interface StatusDef {
  readonly id: StatusId;
  readonly kind: "buff" | "debuff";
  readonly decay: DecayKind;
  /** The highest of these stats resists an application; empty = not resisted. */
  readonly resistedBy: readonly StatId[];
  /**
   * Position inside every hook point this status implements: lower runs first, ties keep
   * `STATUS_IDS` order. This is how the spec's orders live in data (turn start: Burning,
   * Bleeding, Poisoned; action gate: Ambushed, Stunned, Paralysed).
   */
  readonly priority: number;
  /** Tags for cross-status queries (Afflictions, stack scaling). Burning, Bleeding, Poisoned: "dot". */
  readonly tags: readonly StatusTag[];
}

/**
 * A hit hook. `owner` is the unit that has the status, `stacks` its current stacks (always > 0).
 * Hooks must not allocate beyond the events they emit.
 */
export type HitHook = (hit: HitState, owner: CombatUnit, stacks: number, ctx: CombatContext) => void;

/** A turn hook (turn start, turn end). `status` is the id of the status the hook belongs to. */
export type TurnHook = (owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, turn: TurnInfo) => void;

/** An action-gate hook: reads its stacks and narrows `gate` (see ../gate.ts). */
export type GateHook = (owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, gate: GateState) => void;

/**
 * Hook points (ADR 0005 for hits, ADR 0006 for turns). Each is called on one unit:
 * - `modifyOutgoing` (hit step 2, attacker): damage modifiers, Piercing charge.
 * - `onAttacked` (hit step 3, target): fires whether or not the hit lands (Thorns).
 * - `modifyIncoming` (hit step 4, target): may deflect the hit (Warded).
 * - `onDealtDamage` (hit step 6, attacker): only when damage > 0 was dealt (Leeching).
 * - `onTookDamage` (hit step 6, target): only when damage > 0 was taken (no status uses it since spec 1.5).
 * - `onTurnStart` (turn start, active unit): damage over time. Stops once the unit falls.
 * - `gateAction` (action gate, active unit): Ambushed, Stunned, Paralysed. Stops once the turn is lost.
 * - `onTurnEnd` (turn end, active unit): ticking decay.
 */
export interface StatusHooks {
  readonly modifyOutgoing?: HitHook;
  readonly onAttacked?: HitHook;
  readonly modifyIncoming?: HitHook;
  readonly onDealtDamage?: HitHook;
  readonly onTookDamage?: HitHook;
  readonly onTurnStart?: TurnHook;
  readonly gateAction?: GateHook;
  readonly onTurnEnd?: TurnHook;
}

export type HitHookName = "modifyOutgoing" | "onAttacked" | "modifyIncoming" | "onDealtDamage" | "onTookDamage";
export type TurnHookName = "onTurnStart" | "onTurnEnd";
export type HookName = keyof StatusHooks;

export const HIT_HOOK_NAMES: readonly HitHookName[] = ["modifyOutgoing", "onAttacked", "modifyIncoming", "onDealtDamage", "onTookDamage"];
export const TURN_HOOK_NAMES: readonly TurnHookName[] = ["onTurnStart", "onTurnEnd"];
export const HOOK_NAMES: readonly HookName[] = [...HIT_HOOK_NAMES, "onTurnStart", "gateAction", "onTurnEnd"];

/** A status: stateless definition plus hooks, registered once by id. */
export interface StatusModule {
  readonly def: StatusDef;
  readonly hooks: StatusHooks;
}
