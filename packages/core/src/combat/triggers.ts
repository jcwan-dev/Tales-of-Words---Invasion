import type { StatusId, TRIGGER_EVENTS } from "../content/types.ts";
import { addStacks } from "./actions.ts";
import type { CombatContext } from "./context.ts";
import type { SlowDecay } from "./decay-rules.ts";
import type { CombatUnit } from "./unit.ts";

/** What can set off a convert trigger (spec: Synergy effects). */
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** "When `on` happens to me, gain `stacks` of `gain`." The gain is the owner's own status: unresisted. */
export interface ConvertTrigger {
  on: TriggerEvent;
  gain: StatusId;
  stacks: number;
}

/** Unit traits from items, paths and companions (loaded by the run layer, M2). */
export interface UnitTraits {
  /** Slow decay: while this unit lives, the covered statuses lose stacks only on even rounds. Plague Censer: `{ statuses: { tag: "dot" }, whose: "enemies" }`. */
  slowDecay?: readonly SlowDecay[];
  /**
   * Decay floors: on this unit, a status never decays below its minimum (turn-end ticking and the DoT −1 only).
   * A unit holds one number per status: several floors on the same status are merged by max when the traits
   * are assembled (the run layer, M2).
   */
  decayFloors?: Partial<Record<StatusId, number>>;
  converts?: readonly ConvertTrigger[];
}

/** Triggers caused by triggers are capped at this depth per hit (spec: Combat core design, recursion guard). */
export const TRIGGER_DEPTH_CAP = 4;

/**
 * Fires `unit`'s converts for `on`. A fallen unit doesn't trigger. Each trigger runs one level deeper
 * than whatever is resolving now (`ctx.triggerDepth`, 0 outside triggers, so a trigger set off by a hit
 * is depth 1); beyond the cap it is ignored with TriggerCapped. The depth is restored afterwards,
 * so it is back to 0 when the hit ends. Events: TriggerFired, then the gain's StatusApplied.
 */
export function fireTriggers(ctx: CombatContext, unit: CombatUnit, on: TriggerEvent): void {
  if (unit.fallen) return;
  const list = unit.traits.converts;
  if (list === undefined) return;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t === undefined || t.on !== on) continue;
    const depth = ctx.triggerDepth + 1;
    if (depth > TRIGGER_DEPTH_CAP) {
      ctx.events.push({ type: "TriggerCapped", unit: unit.id, on, depth });
      continue;
    }
    ctx.triggerDepth = depth;
    try {
      ctx.events.push({ type: "TriggerFired", unit: unit.id, on, gain: t.gain, stacks: t.stacks, depth });
      addStacks(ctx, unit, t.gain, t.stacks);
    } finally {
      ctx.triggerDepth = depth - 1;
    }
  }
}
