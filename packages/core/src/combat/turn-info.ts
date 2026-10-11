/**
 * What the turn controller tells turn hooks about the current turn. Pooled per fight and filled
 * before the hooks run, so passing it allocates nothing.
 */
export interface TurnInfo {
  round: number;
  /**
   * Slow decay (spec: Synergy effects): true when a living unit on the other side has
   * `slowEnemyDotDecay` and the round is odd. DoTs then deal damage but keep their stack.
   */
  holdDotDecay: boolean;
}

export const createTurnInfo = (): TurnInfo => ({ round: 1, holdDotDecay: false });
