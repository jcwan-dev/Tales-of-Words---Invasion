import { describe, expect, it } from "vitest";
import { beginCombat, createCombatContext, createUnit, endTurn, startTurn, type CombatUnit, type UnitInit } from "../../../src/index.ts";

const unit = (id: string, side: "player" | "enemy", over: Partial<UnitInit> = {}): CombatUnit => createUnit({ id, side, maxHp: 10, ...over });

describe("turn order and rounds (builder unit tests)", () => {
  it("several player units: the highest player Agility counts, each side keeps its given order", () => {
    const units = [unit("e1", "enemy", { stats: { agility: 4 } }), unit("p1", "player", { stats: { agility: 1 } }), unit("p2", "player", { stats: { agility: 4 } })];
    const state = beginCombat(createCombatContext("o"), units);
    expect(state.units.map((u) => u.id)).toEqual(["p1", "p2", "e1"]);
  });

  it("the turn order array is built once: the same array for the whole fight", () => {
    const state = beginCombat(createCombatContext("o"), [unit("p", "player"), unit("e", "enemy")]);
    const order = state.units;
    for (let i = 0; i < 5; i++) {
      startTurn(state);
      endTurn(state);
    }
    expect(state.units).toBe(order);
  });

  it("a unit already fallen at fight start is skipped from the first turn", () => {
    const state = beginCombat(createCombatContext("o"), [unit("e0", "enemy", { hp: 0, stats: { agility: 5 } }), unit("e1", "enemy"), unit("p", "player")]);
    expect(state.units.map((u) => u.id)).toEqual(["e0", "e1", "p"]);
    expect(state.active?.id).toBe("e1");
    expect(state.round).toBe(1);
  });

  it("a fight where one side has already fallen ends at once", () => {
    const ctx = createCombatContext("o");
    const state = beginCombat(ctx, [unit("p", "player"), unit("e", "enemy", { hp: 0 })]);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("player");
    expect(ctx.events.map((e) => e.type)).toEqual(["CombatStarted", "CombatEnded"]);
    expect(startTurn(state)).toBe(false);
  });

  it("rounds count wraps of the order, one per pass", () => {
    const state = beginCombat(createCombatContext("o"), [unit("p", "player"), unit("e1", "enemy"), unit("e2", "enemy")]);
    const rounds: number[] = [];
    for (let i = 0; i < 9; i++) {
      rounds.push(state.round);
      startTurn(state);
      endTurn(state);
    }
    expect(rounds).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });
});
