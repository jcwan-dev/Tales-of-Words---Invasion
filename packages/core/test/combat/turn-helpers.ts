// Shared helpers for the turn tests (M1.2). Not a test file itself.
// Kept apart from helpers.ts so the M1.1 tests don't depend on the turn API.
import {
  beginCombat,
  createCombatContext,
  createUnit,
  endTurn,
  startTurn,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type HitSpec,
  type UnitInit,
} from "../../src/index.ts";

export const phys = (amount: number, extra: Partial<HitSpec> = {}): HitSpec => ({ damageType: "physical", amount, ...extra });
export const arc = (amount: number, extra: Partial<HitSpec> = {}): HitSpec => ({ damageType: "arcane", amount, ...extra });

/** The player unit: all stats 2, 30 HP, no Shield (override any field). */
export const player = (over: Partial<UnitInit> = {}): CombatUnit => createUnit({ id: "p", side: "player", maxHp: 30, ...over });

/** An enemy unit: all stats 2, 30 HP, no Shield (override any field). */
export const enemy = (id = "e", over: Partial<UnitInit> = {}): CombatUnit => createUnit({ id, side: "enemy", maxHp: 30, ...over });

/** A fresh context and a begun combat. */
export function fight(units: readonly CombatUnit[], seed = "turns"): { ctx: CombatContext; state: CombatState } {
  const ctx = createCombatContext(seed);
  const state = beginCombat(ctx, units);
  return { ctx, state };
}

/** The events emitted while running fn. */
export function during(ctx: CombatContext, fn: () => void): CombatEvent[] {
  const start = ctx.events.length;
  fn();
  return ctx.events.slice(start);
}

/** A turn where the active unit does nothing: startTurn, then endTurn. Returns startTurn's result. */
export function pass(state: CombatState): boolean {
  const unit = state.active;
  const acts = startTurn(state);
  // A unit that fell at turn start has already ended its turn.
  if (state.active === unit) endTurn(state);
  return acts;
}

export const activeId = (state: CombatState): string | null => state.active?.id ?? null;
