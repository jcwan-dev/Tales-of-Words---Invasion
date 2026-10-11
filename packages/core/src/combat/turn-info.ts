import type { StatusId } from "../content/types.ts";
import type { CombatUnit } from "./unit.ts";

/** Answers whether a stack may decay now (slow decay, decay floors). See ./decay-rules.ts. */
export interface DecayGate {
  allows(owner: CombatUnit, status: StatusId): boolean;
}

/** Outside a fight's rules (none set): every decay happens. */
const ALWAYS: DecayGate = { allows: () => true };

/**
 * What the turn controller tells turn hooks about the current turn. Pooled per fight and filled
 * before the hooks run, so passing it allocates nothing.
 */
export interface TurnInfo {
  round: number;
  /** Ask before every turn-time decay (DoT −1 at turn start, ticking −1 at turn end). */
  decay: DecayGate;
}

export const createTurnInfo = (decay: DecayGate = ALWAYS): TurnInfo => ({ round: 1, decay });
