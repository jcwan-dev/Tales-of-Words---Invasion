import type { StatusId } from "../content/types.ts";
import type { CombatContext } from "./context.ts";
import type { CombatUnit } from "./unit.ts";

/**
 * Action-gate results, strongest last (spec: Turn pipeline): skip beats redirect beats restrict
 * beats allow. Restrict (a card filter) and redirect (a forced action) are reserved for later
 * statuses; their payloads arrive with them.
 */
export const GATE = { allow: 0, restrict: 1, redirect: 2, skip: 3 } as const;
export type GateResult = (typeof GATE)[keyof typeof GATE];

/** The combined gate for one turn. Pooled per combat; reset before each gate. */
export interface GateState {
  result: GateResult;
  /** The status behind the strongest result; null while allowed. */
  reason: StatusId | null;
}

export const createGateState = (): GateState => ({ result: GATE.allow, reason: null });

export function resetGate(gate: GateState): void {
  gate.result = GATE.allow;
  gate.reason = null;
}

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
