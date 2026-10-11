import type { StatusId } from "../../content/types.ts";
import { applyDamage, removeStacks, reportDamage } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { DamageResult } from "../hit-state.ts";
import type { TurnInfo } from "../turn-info.ts";
import type { CombatUnit } from "../unit.ts";

// Reused for every tick: turn start is synchronous and a tick never causes another tick.
const scratch: DamageResult = { shield: 0, hp: 0, shieldBroken: false, fell: false };

/**
 * One damage-over-time tick (spec: Turn details): damage equal to the stacks, then −1 stack, unless
 * slow decay holds it this round or the stacks are at the owner's floor (spec: Synergy effects). Not an attack, so it runs no hit
 * hooks and no triggers: no Thorns, Warded, Leeching, powers or converts.
 */
export function dotTick(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, skipShield: boolean, turn: TurnInfo): void {
  applyDamage(owner, stacks, skipShield, scratch);
  ctx.events.push({ type: "DotDamage", unit: owner.id, status, shieldDamage: scratch.shield, hpDamage: scratch.hp });
  reportDamage(ctx, owner, scratch);
  if (turn.decay.allows(owner, status)) removeStacks(ctx, owner, status, 1);
}
