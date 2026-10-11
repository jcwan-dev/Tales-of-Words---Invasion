// Shared helpers for the combat tests (not a test file itself).
import { createCombatContext, createUnit, type CombatEvent, type CombatUnit, type UnitInit } from "../../src/index.ts";

export type EventType = CombatEvent["type"];
export type EventOf<T extends EventType> = Extract<CombatEvent, { type: T }>;

/** All events of one type, narrowed. */
export function eventsOf<T extends EventType>(events: readonly CombatEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** The sequence of event types, for order assertions. */
export const typesOf = (events: readonly CombatEvent[]): EventType[] => events.map((e) => e.type);

/** Index of the first event of a type, or -1. */
export const indexOfType = (events: readonly CombatEvent[], type: EventType): number =>
  events.findIndex((e) => e.type === type);

/** A plain attacker: all stats 2, 30 HP, no Shield, no statuses (override any field). */
export const attackerUnit = (over: Partial<UnitInit> = {}): CombatUnit =>
  createUnit({ id: "a", side: "player", maxHp: 30, ...over });

/** A plain target: all stats 2, 30 HP, no Shield, no statuses (override any field). */
export const targetUnit = (over: Partial<UnitInit> = {}): CombatUnit =>
  createUnit({ id: "t", side: "enemy", maxHp: 30, ...over });

export const ctxFor = (seed = "hit-order") => createCombatContext(seed);
