import type { StatusId } from "../../content/types.ts";
import { removeStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import { loseTurn, type GateState } from "../gate.ts";
import type { CombatUnit } from "../unit.ts";
import type { StatusModule } from "./types.ts";

/** Ambushed N (timed): each stack is one lost turn, used when it causes a skip. Checked first. */
function gateAction(owner: CombatUnit, _stacks: number, ctx: CombatContext, status: StatusId, gate: GateState): void {
  loseTurn(ctx, gate, owner, status);
  removeStacks(ctx, owner, status, 1);
}

export const ambushed: StatusModule = {
  def: { id: "ambushed", kind: "debuff", decay: "timed", resistedBy: ["agility", "cunning"], priority: 1, tags: [] },
  hooks: { gateAction },
};
