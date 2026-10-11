import type { StatusId } from "../../content/types.ts";
import type { CombatContext } from "../context.ts";
import type { GateState } from "../gate.ts";
import type { CombatUnit } from "../unit.ts";
import { meterGate } from "./meter.ts";
import type { StatusModule } from "./types.ts";

/** Stunned (build-up meter): at 10+ stacks the unit loses the turn for certain, then the meter resets. Checked after Ambushed. */
function gateAction(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, gate: GateState): void {
  meterGate(owner, stacks, ctx, status, gate, 1);
}

export const stunned: StatusModule = {
  def: { id: "stunned", kind: "debuff", decay: "buildup", resistedBy: ["vitality"], priority: 2, tags: [] },
  hooks: { gateAction },
};
