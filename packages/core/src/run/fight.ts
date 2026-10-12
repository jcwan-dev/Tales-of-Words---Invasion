/**
 * The fight session of a combat node (spec: Combat node, "The fight"; ADR 0011). It drives the M1 combat core
 * (beginCombat, startTurn, playCard, passTurn, enemyAct, endTurn) from the run's data: the player's commands go in,
 * enemy turns run on their own until the player decides again or the fight is over.
 *
 * The session is not part of `RunState`: the run is saved when the node is entered, and resuming restarts the
 * fight from its beginning (same seed stream, same commands, same fight). Nothing here changes the run until
 * `finishFight`.
 */
import type { EnemyMove } from "../combat/cards.ts";
import type { CombatContext } from "../combat/context.ts";
import { enemyAct, passTurn, playCard, type PlayResult } from "../combat/play.ts";
import type { CombatState } from "../combat/state.ts";
import { beginCombat, endTurn, reopenFight, startTurn } from "../combat/turn.ts";
import { createUnit, type CombatUnit, type UnitInit } from "../combat/unit.ts";
import { STATUS_IDS, type ContentPack, type EnemyDef, type GroupDef } from "../content/types.ts";
import { RngStreams } from "../rng/rng.ts";
import { powersOf, traitsOf } from "./loadout.ts";
import { playerUnitFromRun } from "./player.ts";
import { completeNode, fallInNode, type CommandResult, type RunContext, type RunState } from "./run.ts";

/** A fight in progress. `state` is the combat core's fight (units, turn, event log in `state.ctx.events`). */
export interface FightSession {
  readonly state: CombatState;
  /** The player's unit (id "player"). */
  readonly player: CombatUnit;
  /** The group fought. */
  readonly group: string;
  /** Which node of the run this fight belongs to: act position, act, step and option. */
  readonly node: { readonly actNumber: number; readonly act: string; readonly step: number; readonly option: number };
}

export type FightOutcome = "ongoing" | "won" | "fallen";

/** The session behind `FightSession`: also remembers whether its current fall was already reported to the run. */
class Session implements FightSession {
  /** finishFight reported the current fall (fallInNode); cleared when the fight is resumed after the revive. */
  fallReported = false;
  constructor(
    readonly state: CombatState,
    readonly player: CombatUnit,
    readonly group: string,
    readonly node: FightSession["node"],
  ) {}
}

/** The id of the player's unit in every fight. */
export const PLAYER_UNIT_ID = "player";

function groupOf(pack: ContentPack, id: string): GroupDef {
  const def = pack.byId.get(id);
  if (def?.kind !== "group") throw new RangeError(`fight: "${id}" is not a group in pack "${pack.id}"`);
  return def;
}

function enemyOf(pack: ContentPack, id: string): EnemyDef {
  const def = pack.byId.get(id);
  if (def?.kind !== "enemy") throw new RangeError(`fight: "${id}" is not an enemy in pack "${pack.id}"`);
  return def;
}

/** An enemy's UnitInit from its file: missing stats 2, Shield full, its powers, traits, starting statuses and moves. */
function enemyInit(def: EnemyDef, unitId: string): UnitInit {
  const powers = powersOf([def.powers]);
  const moves: EnemyMove[] = def.moves.map((m) => ({
    card: { id: `${def.id}.${m.id}`, cooldown: m.cooldown, effects: m.effects },
    weight: m.weight,
    intent: m.intent,
  }));
  return {
    id: unitId,
    side: "enemy",
    stats: { ...def.stats },
    maxHp: def.hp,
    maxShield: def.shield ?? 0,
    statuses: { ...def.statuses },
    bleedPower: powers.bleedPower,
    burnPower: powers.burnPower,
    poisonPower: powers.poisonPower,
    stunPower: powers.stunPower,
    paralysisPower: powers.paralysisPower,
    traits: traitsOf([def.traits]),
    moves,
  };
}

/** The group id of the run's current node, if its data names one. */
function nodeGroup(run: RunState): string | null {
  const data = run.node?.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const group = (data as { readonly [k: string]: unknown })["group"];
  return typeof group === "string" ? group : null;
}

/**
 * Runs turns until the player can decide or the fight is over: lost turns end on their own, enemies use their
 * moves. On return, either the fight is over or the player's turn has started and it may act.
 */
function runUntilPlayer(state: CombatState): void {
  while (!state.over) {
    const unit = state.active;
    if (unit === null) return;
    if (!startTurn(state)) {
      // A lost turn (gate) is still open and ends here; a fall at turn start has already ended it.
      if (state.active === unit && !state.over) endTurn(state);
      continue;
    }
    if (unit.side === "player") return;
    enemyAct(state);
  }
}

/**
 * Starts the fight of the run's current combat node. The run must be in phase "inNode" with a node whose data
 * names a group (throws RangeError otherwise). Player "player", enemies "enemy1".."enemy3" in group order. The
 * combat RNG is the run's stream for this node (seed, act position, act, step, option). Runs everything up to the
 * player's first decision. Doesn't change the run.
 */
export function startFight(ctx: RunContext, run: RunState): FightSession {
  const node = run.node;
  const groupId = nodeGroup(run);
  if (run.phase !== "inNode" || node === null || groupId === null) throw new RangeError("startFight: the run is not in a combat node");
  const group = groupOf(ctx.pack, groupId);

  const player = createUnit(playerUnitFromRun(ctx.pack, run));
  const units: CombatUnit[] = [player];
  group.enemies.forEach((id, i) => units.push(createUnit(enemyInit(enemyOf(ctx.pack, id), `enemy${i + 1}`))));

  const combat: CombatContext = {
    rng: new RngStreams(run.seed).derive("combat", run.actNumber, run.act, run.step, node.option),
    events: [],
    fight: null,
    triggerDepth: 0,
  };
  const state = beginCombat(combat, units);
  runUntilPlayer(state);
  return new Session(state, player, group.id, { actNumber: run.actNumber, act: run.act, step: run.step, option: node.option });
}

/**
 * The player uses a card (with a target when needed), then enemy turns run until the player's turn again or the
 * fight's end. A refused command (fight over, card unknown or not ready, bad target…) changes nothing.
 */
export function fightPlay(session: FightSession, cardId: string, targetId?: string): PlayResult {
  const res = playCard(session.state, cardId, targetId);
  if (res.ok) runUntilPlayer(session.state);
  return res;
}

/** The player passes, then enemy turns run as for fightPlay. Refused once the fight is over. */
export function fightPass(session: FightSession): PlayResult {
  const res = passTurn(session.state);
  if (res.ok) runUntilPlayer(session.state);
  return res;
}

export function fightOutcome(session: FightSession): FightOutcome {
  const s = session.state;
  if (!s.over) return "ongoing";
  // Both sides falling in the same hit: the enemies win (the core's rule).
  return s.winner === "player" ? "won" : "fallen";
}

function isSessionNode(run: RunState, session: FightSession): boolean {
  const n = session.node;
  return run.node !== null && run.actNumber === n.actNumber && run.act === n.act && run.step === n.step && run.node.option === n.option;
}

/**
 * Hands a finished fight to the run. Won: completes the node with the HP change only (no crowns). Fallen: the
 * player falls in the node (fallInNode). Refused (wrong_phase) while the fight is ongoing, when the run isn't in
 * this fight's node, for a session not made by startFight, or for a fall already reported (a revive continues the
 * fight with resumeFightAfterRevive; the same fall can't be reported, and revived, twice).
 */
export function finishFight(ctx: RunContext, run: RunState, session: FightSession): CommandResult {
  const outcome = fightOutcome(session);
  if (!(session instanceof Session) || outcome === "ongoing" || run.phase !== "inNode" || !isSessionNode(run, session)) {
    return { ok: false, reason: "wrong_phase" };
  }
  if (outcome === "fallen") {
    if (session.fallReported) return { ok: false, reason: "wrong_phase" };
    const res = fallInNode(run);
    if (res.ok) session.fallReported = true;
    return res;
  }
  return completeNode(ctx, run, { hp: session.player.hp - run.player.hp });
}

/**
 * After a revive put the run back in the node, continues the fight (spec: Combat node, "The player falls"): the
 * player's HP = the run's HP, Shield full, statuses cleared, cooldowns kept; the enemies unchanged. The turn the
 * player fell in is finished first, as any turn ends (reopenFight), then the player acts next, in a new round. If
 * the enemies had fallen too, the fight is won at once. Throws RangeError if the run isn't in this fight's node
 * with HP above 0, or the fight isn't fallen, or its fall wasn't reported with finishFight.
 */
export function resumeFightAfterRevive(run: RunState, session: FightSession): void {
  if (run.phase !== "inNode" || !isSessionNode(run, session) || run.player.hp <= 0) {
    throw new RangeError("resumeFightAfterRevive: the run is not back in this fight's node");
  }
  if (fightOutcome(session) !== "fallen") throw new RangeError("resumeFightAfterRevive: the fight is not fallen");
  if (!(session instanceof Session) || !session.fallReported) throw new RangeError("resumeFightAfterRevive: the fall was not reported with finishFight");
  session.fallReported = false;
  const p = session.player;
  p.hp = Math.min(run.player.hp, p.maxHp);
  p.shield = p.maxShield;
  for (const id of STATUS_IDS) p.statuses.remove(id, p.statuses.stacks(id));
  reopenFight(session.state, p);
  runUntilPlayer(session.state);
}
