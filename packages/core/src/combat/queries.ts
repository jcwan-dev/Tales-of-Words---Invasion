import type { StatusTag } from "../content/types.ts";
import { TAGGED } from "./statuses/registry.ts";
import type { CombatUnit } from "./unit.ts";

// Cross-status queries go through tags, never ids (spec: Combat core design). Allocation-free.

/** The tag that makes a status a damage over time (Afflictions count them). */
export const DOT_TAG: StatusTag = "dot";

/** Number of different statuses with the tag that the unit has (stacks > 0). */
export function countWithTag(unit: CombatUnit, tag: StatusTag): number {
  const list = TAGGED[tag];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const index = list[i];
    if (index !== undefined && unit.statuses.stacksAt(index) > 0) n++;
  }
  return n;
}

/** Total stacks of the statuses with the tag. */
export function stacksWithTag(unit: CombatUnit, tag: StatusTag): number {
  const list = TAGGED[tag];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const index = list[i];
    if (index !== undefined) n += unit.statuses.stacksAt(index);
  }
  return n;
}

/** Afflictions: the number of different damage-over-time statuses on the unit, 0-3 (spec: Synergy effects). */
export const afflictions = (unit: CombatUnit): number => countWithTag(unit, DOT_TAG);
