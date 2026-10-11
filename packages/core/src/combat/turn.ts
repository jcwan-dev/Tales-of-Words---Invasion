import type { CombatContext } from "./context.ts";
import { GATE, resetGate } from "./gate.ts";
import { checkFightEnd, CombatStateImpl, type CombatState } from "./state.ts";
import { GATE_HOOKS, TURN_HOOKS, type HookEntry } from "./statuses/registry.ts";
import type { TurnHook } from "./statuses/types.ts";
import type { CombatUnit } from "./unit.ts";

// The turn controller (spec: Turn pipeline, Turn details; ADR 0006). Status behaviour comes only
// from the turn hooks; nothing here names a status. Code rule 6: after beginCombat, nothing here
// allocates except the events it pushes.

/**
 * Starts a fight: every Shield to full, every Stun power to full, and the turn order fixed for the
 * whole fight: the side with the higher Agility first (the highest on each side; ties go to the
 * player), each side in the order given. Emits CombatStarted. Statuses are left as given.
 * Does not start the first turn.
 */
export function beginCombat(ctx: CombatContext, units: readonly CombatUnit[]): CombatState {
  let playerAgility = -Infinity;
  let enemyAgility = -Infinity;
  for (const u of units) {
    u.shield = u.maxShield;
    u.stunPower = u.maxStunPower;
    if (u.side === "player") playerAgility = Math.max(playerAgility, u.stats.agility);
    else enemyAgility = Math.max(enemyAgility, u.stats.agility);
  }
  const first = playerAgility >= enemyAgility ? "player" : "enemy";
  // Built once for the whole fight: the first side, then the other, each in the order given.
  const order: CombatUnit[] = [];
  const ids: string[] = [];
  for (const u of units) if (u.side === first) order.push(u);
  for (const u of units) if (u.side !== first) order.push(u);
  for (const u of order) ids.push(u.id);

  const state = new CombatStateImpl(ctx, order);
  ctx.fight = state;
  ctx.events.push({ type: "CombatStarted", order: ids });
  state.index = -1;
  advance(state);
  checkFightEnd(ctx);
  return state;
}

const impl = (state: CombatState): CombatStateImpl | null => (state instanceof CombatStateImpl ? state : null);

/** Runs one turn hook point on `owner`; with `stopOnFall`, stops as soon as the owner falls. */
function dispatchTurn(list: readonly HookEntry<TurnHook>[], owner: CombatUnit, ctx: CombatContext, stopOnFall: boolean): void {
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry === undefined) continue;
    const stacks = owner.statuses.stacksAt(entry.index);
    if (stacks > 0) entry.hook(owner, stacks, ctx, entry.id);
    if (stopOnFall && owner.fallen) return;
  }
}

/**
 * Turn start, then the action gate, for `state.active`. Returns true if the unit may act.
 * False means the turn is lost or already over; call endTurn only if `state.active` is still the
 * same unit. (A unit that falls at turn start takes no action: its turn ends at once, with
 * TurnEnded and no turn-end effects, and the next living unit becomes active, unless that fall
 * ended the fight. A turn lost at the gate is still open: endTurn runs its turn end.)
 */
export function startTurn(state: CombatState): boolean {
  const s = impl(state);
  if (s === null || s.over || s.active === null) return false;
  const unit = s.active;
  const ctx = s.ctx;
  ctx.events.push({ type: "TurnStarted", unit: unit.id, round: s.round });

  // 1. Turn start: damage over time, in priority order; stops once the unit falls.
  dispatchTurn(TURN_HOOKS.onTurnStart, unit, ctx, true);
  if (unit.fallen) {
    checkFightEnd(ctx);
    if (!s.over) {
      ctx.events.push({ type: "TurnEnded", unit: unit.id });
      advance(s);
    }
    return false;
  }

  // 2. Action gate: statuses combine into one result; once the turn is lost, later checks don't run.
  const gate = s.gate;
  resetGate(gate);
  for (let i = 0; i < GATE_HOOKS.length && gate.result !== GATE.skip; i++) {
    const entry = GATE_HOOKS[i];
    if (entry === undefined) continue;
    const stacks = unit.statuses.stacksAt(entry.index);
    if (stacks > 0) entry.hook(unit, stacks, ctx, entry.id, gate);
  }
  return gate.result !== GATE.skip;
}

/**
 * Turn end for `state.active` (cooldowns tick, ticking decay, Stun power −1), then the next living
 * unit becomes active (the next round after the last one). A unit that fell during its own action
 * skips the turn-end effects; TurnEnded is still emitted.
 */
export function endTurn(state: CombatState): void {
  const s = impl(state);
  if (s === null || s.over || s.active === null) return;
  const unit = s.active;
  const ctx = s.ctx;
  if (!unit.fallen) {
    unit.cooldowns.tick();
    dispatchTurn(TURN_HOOKS.onTurnEnd, unit, ctx, false);
    if (unit.stunPower > 0) unit.stunPower -= 1;
  }
  ctx.events.push({ type: "TurnEnded", unit: unit.id });
  advance(s);
}

/** Moves `active` to the next living unit in the turn order; wrapping past the end starts a new round. */
function advance(s: CombatStateImpl): void {
  const units = s.units;
  const n = units.length;
  let index = s.index;
  for (let step = 0; step < n; step++) {
    index++;
    if (index >= n) {
      index = 0;
      if (s.index >= 0) s.round++;
    }
    const u = units[index];
    if (u !== undefined && !u.fallen) {
      s.index = index;
      s.active = u;
      return;
    }
  }
  s.active = null;
}
