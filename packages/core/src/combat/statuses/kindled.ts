import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { addDamageModifier } from "./damage-modifier.ts";
import type { StatusModule } from "./types.ts";

/** Kindled: arcane damage dealt +25% per stack. Applying it does not use up stacks. */
function modifyOutgoing(hit: HitState, _owner: CombatUnit, stacks: number): void {
  addDamageModifier(hit, "arcane", stacks);
}

export const kindled: StatusModule = {
  def: { id: "kindled", kind: "buff", decay: "ticking", resistedBy: [] },
  hooks: { modifyOutgoing },
};
