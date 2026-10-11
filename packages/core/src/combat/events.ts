import type { DamageType, StatusId } from "../content/types.ts";

/**
 * The event log is the single output of combat (spec: Combat core design): the UI animates it,
 * tests assert on it, replays compare it. Unit fields are unit ids.
 * Events are immutable once `resolveHit` returns (`HitStarted.value` is filled in after step 2).
 */
export type CombatEvent =
  /** `value` is the hit's value after steps 1-2. */
  | { type: "HitStarted"; attacker: string; target: string; damageType: DamageType; value: number }
  /** `source` is the Thorns owner, `target` the attacker. */
  | { type: "ThornsDamage"; source: string; target: string; shieldDamage: number; hpDamage: number }
  | { type: "HitDeflected"; attacker: string; target: string }
  /** Emitted for every hit that is not deflected, even when both damages are 0. */
  | { type: "DamageDealt"; attacker: string; target: string; damageType: DamageType; shieldDamage: number; hpDamage: number; piercing: boolean }
  /** Shield went from above 0 to 0. */
  | { type: "ShieldBroken"; unit: string }
  /** HP actually healed (capped at max HP); never emitted for 0. */
  | { type: "Healed"; unit: string; amount: number }
  /** `stacks` actually added (after resistance), `total` after adding. */
  | { type: "StatusApplied"; unit: string; status: StatusId; stacks: number; total: number }
  /** Stacks (or turns) removed by resistance; only when above 0. */
  | { type: "StatusResisted"; unit: string; status: StatusId; removed: number }
  /** The chance roll failed. */
  | { type: "StatusMissed"; unit: string; status: StatusId }
  /** A charge (Piercing, Warded...) was used. */
  | { type: "ChargeUsed"; unit: string; status: StatusId; left: number }
  /** HP reached 0 (once per unit). */
  | { type: "UnitFell"; unit: string };

export type CombatEventType = CombatEvent["type"];
