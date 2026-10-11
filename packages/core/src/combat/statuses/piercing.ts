import { useCharge } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import type { StatusModule } from "./types.ts";

/**
 * Piercing (buff): the next hits skip Shield and are never deflected; stacks are charges.
 * One charge is used at step 2, unless the hit already has the Piercing keyword.
 */
function modifyOutgoing(hit: HitState, owner: CombatUnit, _stacks: number, ctx: CombatContext): void {
  if (hit.piercing) return;
  hit.piercing = true;
  useCharge(ctx, owner, piercing.def.id);
}

export const piercing: StatusModule = {
  def: { id: "piercing", kind: "buff", decay: "charges", resistedBy: [], priority: 0, tags: [] },
  hooks: { modifyOutgoing },
};
