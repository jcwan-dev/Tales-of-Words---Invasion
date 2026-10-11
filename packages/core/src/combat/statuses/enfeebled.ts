import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { addDamageModifier } from "./damage-modifier.ts";
import type { StatusModule } from "./types.ts";

/** Enfeebled: physical damage dealt -25% per stack. Applying it does not use up stacks. */
function modifyOutgoing(hit: HitState, _owner: CombatUnit, stacks: number): void {
  addDamageModifier(hit, "physical", -stacks);
}

export const enfeebled: StatusModule = {
  def: { id: "enfeebled", kind: "debuff", decay: "ticking", resistedBy: ["vitality"] },
  hooks: { modifyOutgoing },
};
