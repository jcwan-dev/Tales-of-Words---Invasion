import type { StatusId } from "../../content/types.ts";
import { removeStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { TurnInfo } from "../turn-info.ts";
import type { CombatUnit } from "../unit.ts";

/**
 * Ticking decay (spec: Stacking): −1 stack at the end of each of the owner's turns, unless slow decay
 * holds it this round or the stacks are at the owner's floor (then nothing is emitted).
 */
export function loseOneStack(owner: CombatUnit, _stacks: number, ctx: CombatContext, status: StatusId, turn: TurnInfo): void {
  if (turn.decay.allows(owner, status)) removeStacks(ctx, owner, status, 1);
}
