import type { StatusId } from "../content/types.ts";
import type { CombatContext } from "./context.ts";
import type { DamageResult } from "./hit-state.ts";
import type { CombatUnit } from "./unit.ts";

// Small state changes shared by the pipeline and status hooks. Each one emits its own events
// and allocates nothing but those events.

/**
 * Applies damage to a unit: Shield first unless `skipShield`, then HP, never below 0.
 * Writes what happened into `out`; the caller emits the main event, then `reportDamage`.
 */
export function applyDamage(unit: CombatUnit, amount: number, skipShield: boolean, out: DamageResult): void {
  let rest = amount > 0 ? amount : 0;
  let toShield = 0;
  if (!skipShield && unit.shield > 0) {
    toShield = rest < unit.shield ? rest : unit.shield;
    unit.shield -= toShield;
    rest -= toShield;
  }
  const hpBefore = unit.hp;
  const toHp = rest < hpBefore ? rest : hpBefore;
  unit.hp = hpBefore - toHp;
  out.shield = toShield;
  out.hp = toHp;
  out.shieldBroken = toShield > 0 && unit.shield === 0;
  out.fell = hpBefore > 0 && unit.hp === 0;
}

/** Emits ShieldBroken and UnitFell for a damage application, in that order. */
export function reportDamage(ctx: CombatContext, unit: CombatUnit, result: DamageResult): void {
  if (result.shieldBroken) ctx.events.push({ type: "ShieldBroken", unit: unit.id });
  if (result.fell) ctx.events.push({ type: "UnitFell", unit: unit.id });
}

/** Heals up to max HP. A fallen unit cannot be healed. Emits Healed for the amount actually healed. */
export function heal(ctx: CombatContext, unit: CombatUnit, amount: number): void {
  if (unit.fallen || amount <= 0) return;
  const missing = unit.maxHp - unit.hp;
  const healed = amount < missing ? amount : missing;
  if (healed <= 0) return;
  unit.hp += healed;
  ctx.events.push({ type: "Healed", unit: unit.id, amount: healed });
}

/** Adds stacks and emits StatusApplied. */
export function addStacks(ctx: CombatContext, unit: CombatUnit, status: StatusId, stacks: number): void {
  if (stacks <= 0) return;
  unit.statuses.add(status, stacks);
  ctx.events.push({ type: "StatusApplied", unit: unit.id, status, stacks, total: unit.statuses.stacks(status) });
}

/** Uses one charge of a charges status and emits ChargeUsed. */
export function useCharge(ctx: CombatContext, unit: CombatUnit, status: StatusId): void {
  unit.statuses.remove(status, 1);
  ctx.events.push({ type: "ChargeUsed", unit: unit.id, status, left: unit.statuses.stacks(status) });
}
