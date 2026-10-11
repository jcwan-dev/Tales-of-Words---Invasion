import type { CombatContext } from "./context.ts";
import { gateAllows, type GateState } from "./gate.ts";
import type { CombatUnit } from "./unit.ts";

/**
 * Picks the unit's next move (spec: Enemy moves) by weight among its ready moves (and, with a gate,
 * those the gate allows), on the combat RNG, and sets `unit.intent`. One candidate needs no roll (certain
 * outcomes never shift the stream). Emits IntentChosen; with no candidate the intent is null and nothing
 * is emitted (the unit will pass). Plain loops, no allocation (code rule 6).
 */
export function pickIntent(ctx: CombatContext, unit: CombatUnit, gate: GateState | null): void {
  const moves = unit.moves;
  let total = 0;
  let count = 0;
  let only = -1;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m === undefined || !usable(unit, i, gate)) continue;
    total += m.weight;
    count++;
    only = i;
  }
  let chosen = only;
  if (count > 1) {
    let roll = ctx.rng.next() * total;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === undefined || !usable(unit, i, gate)) continue;
      chosen = i;
      roll -= m.weight;
      if (roll < 0) break;
    }
  }
  const move = chosen >= 0 ? moves[chosen] : undefined;
  unit.intent = move === undefined ? null : move.card.id;
  if (move !== undefined) ctx.events.push({ type: "IntentChosen", unit: unit.id, move: move.card.id });
}

/** Is move `i` ready, and allowed by the gate if one is given? */
function usable(unit: CombatUnit, i: number, gate: GateState | null): boolean {
  const m = unit.moves[i];
  if (m === undefined || !unit.cooldowns.ready(m.card.id)) return false;
  return gate === null || gateAllows(gate, m.card);
}

/** Index of the unit's move with this card id, or -1. */
export function moveIndex(unit: CombatUnit, id: string | null): number {
  if (id === null) return -1;
  const moves = unit.moves;
  for (let i = 0; i < moves.length; i++) if (moves[i]?.card.id === id) return i;
  return -1;
}
