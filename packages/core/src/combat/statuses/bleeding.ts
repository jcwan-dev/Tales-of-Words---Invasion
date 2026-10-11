import type { StatusId } from "../../content/types.ts";
import { addStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { dotTick } from "./dot.ts";
import type { StatusModule } from "./types.ts";

/**
 * Bleeding (debuff): at turn start, damage equal to stacks (Shield first), then −1 stack; ticks
 * after Burning and before Poisoned. On the hit: +1 stack each
 * time the owner takes damage from a physical hit. Hooks only run for statuses the unit already
 * has, so a hit never starts Bleeding on its own. This stack is not an application, so no resistance.
 */
function onTookDamage(hit: HitState, owner: CombatUnit, _stacks: number, ctx: CombatContext): void {
  if (hit.damageType === "physical") addStacks(ctx, owner, bleeding.def.id, 1);
}

function onTurnStart(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId): void {
  dotTick(owner, stacks, ctx, status, false);
}

export const bleeding: StatusModule = {
  def: { id: "bleeding", kind: "debuff", decay: "ticking", resistedBy: ["vitality"], priority: 2 },
  hooks: { onTookDamage, onTurnStart },
};
