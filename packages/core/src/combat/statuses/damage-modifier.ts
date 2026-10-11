import type { DamageType } from "../../content/types.ts";
import type { HitState } from "../hit-state.ts";

/**
 * Shared by the damage-modifier statuses: adds `steps` (± stacks) to the hit's net modifier
 * when the hit has the given damage type. Each step is 25% of the base value (spec: Hit order details).
 */
export function addDamageModifier(hit: HitState, damageType: DamageType, steps: number): void {
  if (hit.damageType === damageType) hit.modifierSteps += steps;
}
