import type { StatusId } from "../../content/types.ts";
import type { CombatContext } from "../context.ts";
import type { CombatUnit } from "../unit.ts";
import { dotTick } from "./dot.ts";
import type { StatusModule } from "./types.ts";

/** Poisoned: like Burning, but straight to HP, ignoring Shield. Ticks last, after Burning and Bleeding wear down Shield. */
function onTurnStart(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId): void {
  dotTick(owner, stacks, ctx, status, true);
}

export const poisoned: StatusModule = {
  def: { id: "poisoned", kind: "debuff", decay: "ticking", resistedBy: ["vitality"], priority: 3 },
  hooks: { onTurnStart },
};
