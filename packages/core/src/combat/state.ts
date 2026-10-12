import type { CombatContext } from "./context.ts";
import { createGateState, type GateState } from "./gate.ts";
import { DecayRules } from "./decay-rules.ts";
import { createTurnInfo, type TurnInfo } from "./turn-info.ts";
import type { CombatUnit, Side } from "./unit.ts";

/** A fight in progress (spec: Combat core design). Driven by beginCombat, startTurn and endTurn. */
export interface CombatState {
  readonly ctx: CombatContext;
  /** Turn order for the whole fight. */
  readonly units: readonly CombatUnit[];
  /** 1-based; one pass through all living units is a round. */
  readonly round: number;
  /** Whose turn it is; null once the fight is over. */
  readonly active: CombatUnit | null;
  readonly over: boolean;
  readonly winner: Side | null;
}

/** The mutable state behind `CombatState`. Only the turn controller and the fight-end check write it. */
export class CombatStateImpl implements CombatState {
  readonly ctx: CombatContext;
  readonly units: readonly CombatUnit[];
  round = 1;
  active: CombatUnit | null = null;
  over = false;
  winner: Side | null = null;
  /** Index of `active` in `units`. */
  index = 0;
  /** startTurn has run for the active unit's current turn. */
  turnStarted = false;
  /** The active unit may take its one action (its turn started and the gate didn't skip it). */
  canAct = false;
  /** Pooled action-gate result, reset at every gate. */
  readonly gate: GateState = createGateState();
  /** Slow decay and decay floors for this fight, resolved once from the units' traits. */
  readonly decay: DecayRules;
  /** Pooled turn info for turn hooks, refilled at every turn start and end. */
  readonly turn: TurnInfo;

  constructor(ctx: CombatContext, units: readonly CombatUnit[]) {
    this.ctx = ctx;
    this.units = units;
    this.decay = new DecayRules(units);
    this.turn = createTurnInfo(this.decay);
  }
}

/**
 * The fight ends as soon as every unit on one side has fallen (spec: Turn details). If both sides
 * have fallen, the enemies win. Emits CombatEnded when the fight ends (once per end: a fight reopened after
 * a revive, see reopenFight, can end again). Call after any hit or damage-over-time tick that felled a unit;
 * does nothing for a context without a fight (`ctx.fight` null) or a fight already over.
 */
export function checkFightEnd(ctx: CombatContext): void {
  const state = ctx.fight;
  if (!(state instanceof CombatStateImpl) || state.over) return;
  let playerAlive = false;
  let enemyAlive = false;
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined || u.fallen) continue;
    if (u.side === "player") playerAlive = true;
    else enemyAlive = true;
  }
  if (playerAlive && enemyAlive) return;
  const winner: Side = playerAlive ? "player" : "enemy";
  state.over = true;
  state.winner = winner;
  state.active = null;
  ctx.events.push({ type: "CombatEnded", winner });
}
