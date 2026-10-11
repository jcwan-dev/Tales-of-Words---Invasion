import { heal } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { loseOneStack } from "./decay.ts";
import type { StatusModule } from "./types.ts";

/**
 * Leeching X (buff): each time the owner deals damage, heal X HP, up to the damage dealt to
 * Shield and HP. A fallen owner is not healed (`heal` refuses).
 */
function onDealtDamage(hit: HitState, owner: CombatUnit, stacks: number, ctx: CombatContext): void {
  const dealt = hit.shieldDamage + hit.hpDamage;
  heal(ctx, owner, stacks < dealt ? stacks : dealt);
}

export const leeching: StatusModule = {
  def: { id: "leeching", kind: "buff", decay: "ticking", resistedBy: [], priority: 0, tags: [] },
  hooks: { onDealtDamage, onTurnEnd: loseOneStack },
};
