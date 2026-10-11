import type { StatusId } from "../content/types.ts";
import { addStacks } from "./actions.ts";
import type { CombatContext } from "./context.ts";
import { statusDef } from "./statuses/registry.ts";
import type { CombatUnit } from "./unit.ts";

/** A resisting stat above this removes 1 stack (or turn) per point (spec: Stacking). */
const RESIST_THRESHOLD = 2;

/**
 * Applies `stacks` of a status to `target` as an application (spec: Hit order step 7, Stacking):
 * the chance is rolled first (only when strictly between 0 and 1), then the highest resisting stat
 * above 2 removes 1 stack per point, leaving at least 1.
 */
export function applyStatus(ctx: CombatContext, target: CombatUnit, status: StatusId, stacks: number, chance: number): void {
  if (stacks <= 0) return;
  // Certain outcomes use no roll, so they never shift the combat stream.
  const lands = chance >= 1 ? true : chance <= 0 ? false : ctx.rng.chance(chance);
  if (!lands) {
    ctx.events.push({ type: "StatusMissed", unit: target.id, status });
    return;
  }
  const resistedBy = statusDef(status).resistedBy;
  let resist = 0;
  for (let r = 0; r < resistedBy.length; r++) {
    const stat = resistedBy[r];
    if (stat === undefined) continue;
    const points = target.stats[stat] - RESIST_THRESHOLD;
    if (points > resist) resist = points;
  }
  const maxRemoved = stacks - 1;
  const removed = resist < maxRemoved ? resist : maxRemoved;
  if (removed > 0) ctx.events.push({ type: "StatusResisted", unit: target.id, status, removed });
  addStacks(ctx, target, status, removed > 0 ? stacks - removed : stacks);
}

/**
 * A status a unit puts on itself (a card's self effect): the chance is rolled as usual, but the status
 * is the unit's own, so resistance doesn't apply (spec: Cards in combat).
 */
export function applyOwnStatus(ctx: CombatContext, unit: CombatUnit, status: StatusId, stacks: number, chance: number): void {
  if (stacks <= 0) return;
  const lands = chance >= 1 ? true : chance <= 0 ? false : ctx.rng.chance(chance);
  if (!lands) {
    ctx.events.push({ type: "StatusMissed", unit: unit.id, status });
    return;
  }
  addStacks(ctx, unit, status, stacks);
}
