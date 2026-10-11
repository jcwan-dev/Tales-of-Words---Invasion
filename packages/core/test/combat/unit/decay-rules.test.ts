import { describe, expect, it } from "vitest";
import { createCombatContext, createUnit, DecayRules, resolveConsume, type UnitInit } from "../../../src/index.ts";

const u = (id: string, side: "player" | "enemy", over: Partial<UnitInit> = {}) => createUnit({ id, side, maxHp: 10, ...over });

describe("DecayRules (builder unit tests)", () => {
  it("no traits: every decay is allowed on every round", () => {
    const a = u("a", "player", { statuses: { burning: 3 } });
    const rules = new DecayRules([a, u("b", "enemy")]);
    for (const round of [1, 2, 3]) {
      rules.round = round;
      expect(rules.allows(a, "burning")).toBe(true);
    }
  });

  it("slow decay by tag on the other side: held on odd rounds only, and only while the holder lives", () => {
    const holder = u("h", "player", { traits: { slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }] } });
    const e = u("e", "enemy", { statuses: { poisoned: 2, emboldened: 2 } });
    const rules = new DecayRules([holder, e]);
    rules.round = 1;
    expect(rules.allows(e, "poisoned")).toBe(false);
    expect(rules.allows(e, "emboldened")).toBe(true); // not tagged dot
    rules.round = 2;
    expect(rules.allows(e, "poisoned")).toBe(true);
    rules.round = 3;
    holder.hp = 0; // "alive" is read at each call
    expect(rules.allows(e, "poisoned")).toBe(true);
  });

  it("own vs enemies: an own entry covers only the holder; an enemies entry never covers allies", () => {
    const h = u("h", "enemy", { traits: { slowDecay: [{ statuses: ["thorns"], whose: "own" }, { statuses: ["dimmed"], whose: "enemies" }] } });
    const ally = u("ally", "enemy", { statuses: { thorns: 2, dimmed: 2 } });
    const p = u("p", "player", { statuses: { thorns: 2, dimmed: 2 } });
    const rules = new DecayRules([p, h, ally]);
    rules.round = 1;
    h.statuses.add("thorns", 2);
    expect(rules.allows(h, "thorns")).toBe(false);
    expect(rules.allows(ally, "thorns")).toBe(true);
    expect(rules.allows(ally, "dimmed")).toBe(true);
    expect(rules.allows(p, "dimmed")).toBe(false);
    expect(rules.allows(p, "thorns")).toBe(true);
  });

  it("floors: decay stops at the floor and below it, on any round; a floor of 0 is no floor", () => {
    const a = u("a", "player", { statuses: { leeching: 2, kindled: 1 }, traits: { decayFloors: { leeching: 1, kindled: 0 } } });
    const rules = new DecayRules([a]);
    rules.round = 2;
    expect(rules.allows(a, "leeching")).toBe(true); // 2 > 1
    a.statuses.remove("leeching", 1);
    expect(rules.allows(a, "leeching")).toBe(false); // 1 = floor
    expect(rules.allows(a, "kindled")).toBe(true);
  });

  it("an owner outside the fight's units has no floors, but a holder in the fight still slows it by side", () => {
    const rules = new DecayRules([u("h", "player", { traits: { slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }] } })]);
    rules.round = 1;
    expect(rules.allows(u("x", "enemy", { statuses: { burning: 2 } }), "burning")).toBe(false);
    expect(rules.allows(u("y", "player", { statuses: { burning: 2 } }), "burning")).toBe(true);
  });
});

describe("resolveConsume max guard (builder unit tests)", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    it(`rejects max = ${String(bad)} before any event`, () => {
      const ctx = createCombatContext("cap-guard");
      const t = u("t", "enemy", { statuses: { burning: 3 } });
      expect(() => resolveConsume(ctx, u("a", "player"), t, { status: "burning", multiplier: 3, damageType: "arcane", max: bad })).toThrow(RangeError);
      expect(ctx.events).toEqual([]);
      expect(t.statuses.stacks("burning")).toBe(3);
    });
  }
});
