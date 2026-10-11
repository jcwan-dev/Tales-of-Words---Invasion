import type { StatusId } from "../../content/types.ts";
import { removeStacks } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import { loseTurn, type GateState } from "../gate.ts";
import type { CombatUnit } from "../unit.ts";

/** Build-up meters trigger at this many stacks (spec: Stun and paralysis). */
export const METER_THRESHOLD = 10;

/**
 * A build-up meter at the action gate: below the threshold, nothing. At or above it, the turn is
 * lost with `lossChance` (1 = certain, no roll; otherwise one roll on the combat RNG) and the meter
 * resets to 0 either way. Events: MeterTriggered, TurnSkipped (if lost), StatusRemoved.
 */
export function meterGate(owner: CombatUnit, stacks: number, ctx: CombatContext, status: StatusId, gate: GateState, lossChance: number): void {
  if (stacks < METER_THRESHOLD) return;
  const lost = lossChance >= 1 ? true : lossChance <= 0 ? false : ctx.rng.chance(lossChance);
  ctx.events.push({ type: "MeterTriggered", unit: owner.id, status, lostTurn: lost });
  if (lost) loseTurn(ctx, gate, owner, status);
  removeStacks(ctx, owner, status, stacks);
}
