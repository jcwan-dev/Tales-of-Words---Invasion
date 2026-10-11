import type { StatusId } from "../../content/types.ts";
import type { CombatContext } from "../context.ts";
import type { CombatUnit } from "../unit.ts";
import { dotTick } from "./dot.ts";
import type { StatusModule } from "./types.ts";

/** Burning: at turn start, take damage equal to stacks (Shield first), then lose 1 stack. First DoT to tick. */
function onTurnStart(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId): void {
  dotTick(owner, stacks, ctx, status, false);
}

export const burning: StatusModule = {
  def: { id: "burning", kind: "debuff", decay: "ticking", resistedBy: ["arcana"], priority: 1 },
  hooks: { onTurnStart },
};
