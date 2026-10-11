import { describe, expect, it } from "vitest";
import { baseValue, createCombatContext, createUnit, resolveHit } from "../../../src/index.ts";

const stats = createUnit({ id: "u", side: "player", maxHp: 10, stats: { might: 5, agility: 0 } }).stats;

describe("baseValue edge cases (builder unit tests)", () => {
  it("amount 0 with no scaling is 0", () => {
    expect(baseValue(0, undefined, stats)).toBe(0);
  });

  it("a stat of 0 adds nothing", () => {
    expect(baseValue(3, [{ stat: "agility", per: 4 }], stats)).toBe(3);
  });

  it("the same stat twice adds twice", () => {
    // 1 + 2*5 + 1*5 = 16
    expect(baseValue(1, [{ stat: "might", per: 2 }, { stat: "might", per: 1 }], stats)).toBe(16);
  });

  it("baseValue itself does not clamp (negative per can go below 0)", () => {
    expect(baseValue(1, [{ stat: "might", per: -1 }], stats)).toBe(-4);
  });

  it("resolveHit treats a negative base as 0: no damage, no healing of the target", () => {
    const ctx = createCombatContext("neg-base");
    const a = createUnit({ id: "a", side: "player", maxHp: 10, stats: { might: 5 } });
    const t = createUnit({ id: "t", side: "enemy", maxHp: 10, hp: 5, statuses: { bleeding: 1 } });
    resolveHit(ctx, a, t, { damageType: "physical", amount: 1, scaling: [{ stat: "might", per: -1 }] });
    expect(t.hp).toBe(5);
    expect(t.statuses.stacks("bleeding")).toBe(1);
    expect(ctx.events[0]).toMatchObject({ type: "HitStarted", value: 0 });
  });

  it("a negative base stays 0 even with buff modifiers (clamp before modifiers)", () => {
    const ctx = createCombatContext("neg-base-buff");
    const a = createUnit({ id: "a", side: "player", maxHp: 10, statuses: { emboldened: 3 } });
    const t = createUnit({ id: "t", side: "enemy", maxHp: 10 });
    resolveHit(ctx, a, t, { damageType: "physical", amount: -4 });
    expect(t.hp).toBe(10);
  });
});

describe("createUnit validation (builder unit tests)", () => {
  it("clamps hp and shield to their maximums", () => {
    const u = createUnit({ id: "u", side: "player", maxHp: 10, hp: 99, maxShield: 3, shield: 7 });
    expect(u.hp).toBe(10);
    expect(u.shield).toBe(3);
  });

  it("rejects negative or fractional life values", () => {
    expect(() => createUnit({ id: "u", side: "player", maxHp: -1 })).toThrow(RangeError);
    expect(() => createUnit({ id: "u", side: "player", maxHp: 10, hp: 2.5 })).toThrow(RangeError);
    expect(() => createUnit({ id: "u", side: "player", maxHp: 10, maxShield: -2 })).toThrow(RangeError);
  });

  it("stats are frozen", () => {
    const u = createUnit({ id: "u", side: "player", maxHp: 10 });
    expect(Object.isFrozen(u.stats)).toBe(true);
  });
});

describe("baseValue target scaling (builder unit tests)", () => {
  it("Afflictions and tag terms read the target passed as the 4th argument", () => {
    const t = createUnit({ id: "t", side: "enemy", maxHp: 10, statuses: { burning: 2, poisoned: 3, stunned: 9 } });
    // 1 + 4 x 2 Afflictions + 1 x 5 DoT stacks = 14
    expect(baseValue(1, [{ afflictions: true, per: 4 }, { stacksOfTag: "dot", per: 1 }], stats, t)).toBe(14);
  });

  it("the 3-argument form still works for stat terms, and refuses target terms", () => {
    expect(baseValue(2, [{ stat: "might", per: 1 }], stats)).toBe(7);
    expect(() => baseValue(2, [{ afflictions: true, per: 1 }], stats)).toThrow(RangeError);
  });
});
