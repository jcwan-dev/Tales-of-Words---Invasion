import type { StatusId } from "../../content/types.ts";
import type { CombatContext } from "../context.ts";
import type { TurnInfo } from "../turn-info.ts";
import type { CombatUnit } from "../unit.ts";
import { dotTick } from "./dot.ts";
import type { StatusModule } from "./types.ts";

/**
 * Bleeding (debuff): at turn start, damage equal to stacks (Shield first), then −1 stack; ticks
 * after Burning and before Poisoned. Filled by Bleed power on every hit, or by skills (spec 1.5:
 * a hit no longer adds a stack on its own).
 */
function onTurnStart(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, turn: TurnInfo): void {
  dotTick(owner, stacks, ctx, status, false, turn);
}

export const bleeding: StatusModule = {
  def: { id: "bleeding", kind: "debuff", decay: "ticking", resistedBy: ["vitality"], priority: 2, tags: ["dot"] },
  hooks: { onTurnStart },
};
