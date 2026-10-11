import type { StatusId } from "../../content/types.ts";
import { removeStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { CombatUnit } from "../unit.ts";

/** Ticking decay (spec: Stacking): −1 stack at the end of each of the owner's turns. */
export function loseOneStack(owner: CombatUnit, _stacks: number, ctx: CombatContext, status: StatusId): void {
  removeStacks(ctx, owner, status, 1);
}
