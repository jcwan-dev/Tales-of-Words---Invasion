import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { addDamageModifier } from "./damage-modifier.ts";
import type { StatusModule } from "./types.ts";

/** Dimmed: arcane damage dealt -25% per stack. Applying it does not use up stacks. */
function modifyOutgoing(hit: HitState, _owner: CombatUnit, stacks: number): void {
  addDamageModifier(hit, "arcane", -stacks);
}

export const dimmed: StatusModule = {
  def: { id: "dimmed", kind: "debuff", decay: "ticking", resistedBy: ["wisdom"] },
  hooks: { modifyOutgoing },
};
