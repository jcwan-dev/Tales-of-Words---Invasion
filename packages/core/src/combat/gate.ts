import type { StatusId } from "../content/types.ts";
import type { CardSpec } from "./cards.ts";
import type { CombatContext } from "./context.ts";
import type { CombatUnit } from "./unit.ts";

/**
 * Action-gate results, strongest last (spec: Turn pipeline): skip beats redirect beats restrict
 * beats allow. Restrict (a card filter) and redirect (a forced action) are reserved for later
 * statuses; their payloads arrive with them.
 */
export const GATE = { allow: 0, restrict: 1, redirect: 2, skip: 3 } as const;
export type GateResult = (typeof GATE)[keyof typeof GATE];

/** A restrict payload: which cards the unit may use this turn. Set by a restricting status (none yet). */
export interface CardFilter {
  allows(card: CardSpec): boolean;
}

/** The combined gate for one turn. Pooled per combat; reset before each gate. */
export interface GateState {
  result: GateResult;
  /** The status behind the strongest result; null while allowed. */
  reason: StatusId | null;
  /** With a restrict result: the filter on usable cards. */
  filter: CardFilter | null;
}

export const createGateState = (): GateState => ({ result: GATE.allow, reason: null, filter: null });

export function resetGate(gate: GateState): void {
  gate.result = GATE.allow;
  gate.reason = null;
  gate.filter = null;
}

/** May the unit use this card under the gate? (A restrict filter can forbid it.) */
export const gateAllows = (gate: GateState, card: CardSpec): boolean => gate.filter === null || gate.filter.allows(card);

/** Combines one status's answer into the gate: the stronger result wins, the first one on a tie. */
export function combineGate(gate: GateState, result: GateResult, reason: StatusId): void {
  if (result > gate.result) {
    gate.result = result;
    gate.reason = reason;
  }
}

/** A gate hook's "skip": combines skip into the gate and reports the lost turn. */
export function loseTurn(ctx: CombatContext, gate: GateState, owner: CombatUnit, reason: StatusId): void {
  combineGate(gate, GATE.skip, reason);
  ctx.events.push({ type: "TurnSkipped", unit: owner.id, reason });
}
