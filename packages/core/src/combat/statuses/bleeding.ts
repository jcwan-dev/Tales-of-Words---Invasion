import { addStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import type { StatusModule } from "./types.ts";

/**
 * Bleeding (debuff): turn-start damage arrives with the turn pipeline. On the hit: +1 stack each
 * time the owner takes damage from a physical hit. Hooks only run for statuses the unit already
 * has, so a hit never starts Bleeding on its own. This stack is not an application, so no resistance.
 */
function onTookDamage(hit: HitState, owner: CombatUnit, _stacks: number, ctx: CombatContext): void {
  if (hit.damageType === "physical") addStacks(ctx, owner, bleeding.def.id, 1);
}

export const bleeding: StatusModule = {
  def: { id: "bleeding", kind: "debuff", decay: "ticking", resistedBy: ["vitality"] },
  hooks: { onTookDamage },
};
