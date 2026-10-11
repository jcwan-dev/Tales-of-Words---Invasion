import { describe, expect, it } from "vitest";
import { beginCombat, createCombatContext, createUnit, passTurn, type CardSpec, type Effect } from "../../../src/index.ts";

// Builder unit tests: createUnit's card and move checks, and the shared play results.

const hit: Effect = { type: "damage", damageType: "physical", amount: 1, target: "enemy" };
const card = (id: string): CardSpec => ({ id, cooldown: 1, effects: [hit] });

describe("createUnit: card and move ids (builder unit tests)", () => {
  it("duplicate card ids throw a RangeError (player and enemy)", () => {
    expect(() => createUnit({ id: "p", side: "player", maxHp: 10, cards: [card("jab"), card("jab")] })).toThrow(RangeError);
    expect(() => createUnit({ id: "e", side: "enemy", maxHp: 10, cards: [card("a"), card("b"), card("a")] })).toThrow(RangeError);
  });

  it("duplicate move ids throw a RangeError", () => {
    expect(() => createUnit({ id: "e", side: "enemy", maxHp: 10, moves: [{ card: card("bite"), weight: 1 }, { card: card("bite"), weight: 2 }] })).toThrow(RangeError);
  });

  it("distinct ids are fine; a card and a move may share an id", () => {
    expect(() =>
      createUnit({ id: "e", side: "enemy", maxHp: 10, cards: [card("bite"), card("claw")], moves: [{ card: card("bite"), weight: 1 }] }),
    ).not.toThrow();
  });

  it("a card with invalid content fails at createUnit (compiled there), not mid-fight", () => {
    const bad: CardSpec = { id: "x", cooldown: 1, effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy", hits: 0 }] };
    expect(() => createUnit({ id: "p", side: "player", maxHp: 10, cards: [bad] })).toThrow(RangeError);
  });
});

describe("play results are shared and frozen (builder unit tests)", () => {
  it("a rejection and a success are frozen objects", () => {
    const ctx = createCombatContext("frozen");
    const state = beginCombat(ctx, [createUnit({ id: "p", side: "player", maxHp: 10 }), createUnit({ id: "e", side: "enemy", maxHp: 10 })]);
    const rejected = passTurn(state); // turn not started
    expect(rejected).toEqual({ ok: false, reason: "turn_not_started" });
    expect(Object.isFrozen(rejected)).toBe(true);
    expect(passTurn(state)).toBe(rejected); // the same shared object
  });
});
