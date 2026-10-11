import { describe, expect, it } from "vitest";
import { createUnit, DECAYING_POWERS, PER_ATTACK_POWERS, PER_HIT_POWERS, POWER_IDS, POWERS } from "../../../src/index.ts";

describe("power table (builder unit tests)", () => {
  it("every power id has exactly one entry", () => {
    expect(POWERS.map((p) => p.power).sort()).toEqual([...POWER_IDS].sort());
  });

  it("orders from the spec: per hit Bleed, Stun; per attack Burn, Poison, Paralysis; only Stun decays", () => {
    expect(PER_HIT_POWERS.map((p) => [p.power, p.status])).toEqual([["bleedPower", "bleeding"], ["stunPower", "stunned"]]);
    expect(PER_ATTACK_POWERS.map((p) => [p.power, p.status])).toEqual([["burnPower", "burning"], ["poisonPower", "poisoned"], ["paralysisPower", "paralysed"]]);
    expect(DECAYING_POWERS.map((p) => p.power)).toEqual(["stunPower"]);
  });

  it("unit getters read the powers record; full values are frozen; stunPower writes through", () => {
    const u = createUnit({ id: "u", side: "player", maxHp: 10, bleedPower: 1, burnPower: 2, poisonPower: 3, stunPower: 4, paralysisPower: 5 });
    expect([u.bleedPower, u.burnPower, u.poisonPower, u.stunPower, u.paralysisPower]).toEqual([1, 2, 3, 4, 5]);
    expect(Object.isFrozen(u.fullPowers)).toBe(true);
    u.stunPower = 1;
    expect(u.powers.stunPower).toBe(1);
    expect(u.maxStunPower).toBe(4);
  });

  it("rejects negative or fractional powers", () => {
    expect(() => createUnit({ id: "u", side: "player", maxHp: 10, burnPower: -1 })).toThrow(RangeError);
    expect(() => createUnit({ id: "u", side: "player", maxHp: 10, bleedPower: 1.5 })).toThrow(RangeError);
  });
});
