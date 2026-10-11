import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { addDamageModifier } from "./damage-modifier.ts";
import { loseOneStack } from "./decay.ts";
import type { StatusModule } from "./types.ts";

/** Emboldened: physical damage dealt +25% per stack. Applying it does not use up stacks. */
function modifyOutgoing(hit: HitState, _owner: CombatUnit, stacks: number): void {
  addDamageModifier(hit, "physical", stacks);
}

export const emboldened: StatusModule = {
  def: { id: "emboldened", kind: "buff", decay: "ticking", resistedBy: [], priority: 0 },
  hooks: { modifyOutgoing, onTurnEnd: loseOneStack },
};
