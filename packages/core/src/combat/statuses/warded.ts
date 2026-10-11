import { useCharge } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import type { StatusModule } from "./types.ts";

/**
 * Warded (buff): deflects the next attack completely; stacks are charges. A Piercing hit is
 * never deflected and uses no charge. The charge is used before the deflect is reported.
 */
function modifyIncoming(hit: HitState, owner: CombatUnit, _stacks: number, ctx: CombatContext): void {
  if (hit.piercing || hit.deflected) return;
  hit.deflected = true;
  useCharge(ctx, owner, warded.def.id);
}

export const warded: StatusModule = {
  def: { id: "warded", kind: "buff", decay: "charges", resistedBy: [], priority: 0, tags: [] },
  hooks: { modifyIncoming },
};
