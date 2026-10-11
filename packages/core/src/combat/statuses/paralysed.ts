import type { StatusId } from "../../content/types.ts";
import type { CombatContext } from "../context.ts";
import type { GateState } from "../gate.ts";
import type { CombatUnit } from "../unit.ts";
import { meterGate } from "./meter.ts";
import type { StatusModule } from "./types.ts";

/** Chance that a triggered Paralysed meter costs the turn. */
const LOSS_CHANCE = 0.5;

/** Paralysed (build-up meter): at 10+ stacks, 50% to lose the turn (combat RNG); resets either way. Checked last. */
function gateAction(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, gate: GateState): void {
  meterGate(owner, stacks, ctx, status, gate, LOSS_CHANCE);
}

export const paralysed: StatusModule = {
  def: { id: "paralysed", kind: "debuff", decay: "buildup", resistedBy: ["wisdom"], priority: 3, tags: [] },
  hooks: { gateAction },
};
