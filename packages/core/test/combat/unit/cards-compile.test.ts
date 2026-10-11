import { describe, expect, it } from "vitest";
import { compileCard, type CardSpec, type Effect } from "../../../src/index.ts";

// Builder unit tests: what compileCard works out once per card (riding statuses, direct statuses, reach).

const dmg = (target: "enemy" | "allEnemies" | "self", hits = 1): Effect => ({ type: "damage", damageType: "physical", amount: 2, target, hits });
const st = (status: "enfeebled" | "burning", target: "enemy" | "allEnemies" | "self", stacks = 1): Effect => ({ type: "status", status, stacks, target });
const card = (...effects: Effect[]): CardSpec => ({ id: "c", cooldown: 1, effects });

describe("compileCard (builder unit tests)", () => {
  it("needsTarget only when an effect targets the chosen enemy", () => {
    expect(compileCard(card(dmg("enemy"))).needsTarget).toBe(true);
    expect(compileCard(card(dmg("allEnemies"), st("burning", "allEnemies"))).needsTarget).toBe(false);
    expect(compileCard(card(st("burning", "self"))).needsTarget).toBe(false);
  });

  it("enemy statuses ride on every hit of the first enemy damage effect only; no direct status step", () => {
    const plan = compileCard(card(dmg("enemy", 2), dmg("enemy"), st("enfeebled", "enemy", 2)));
    expect(plan.steps.map((s) => s.kind)).toEqual(["attack", "attack"]);
    const [first, second] = plan.steps;
    if (first?.kind !== "attack" || second?.kind !== "attack") throw new Error("expected attacks");
    expect(first.chosenAttack.hits).toHaveLength(2);
    expect(first.chosenAttack.hits.map((h) => h.statuses)).toEqual([[{ status: "enfeebled", stacks: 2 }], [{ status: "enfeebled", stacks: 2 }]]);
    expect(second.chosenAttack.hits[0]?.statuses).toBeUndefined();
  });

  it("allEnemies status with a chosen-enemy carrier: rides on the chosen's hits, direct for the others", () => {
    const plan = compileCard(card(dmg("enemy"), st("burning", "allEnemies")));
    const [attack, status] = plan.steps;
    if (attack?.kind !== "attack") throw new Error("expected an attack");
    expect(attack.chosenAttack.hits[0]?.statuses).toEqual([{ status: "burning", stacks: 1 }]);
    expect(attack.otherAttack.hits[0]?.statuses).toBeUndefined();
    expect(status).toMatchObject({ kind: "status", reach: "othersThanChosen", status: "burning" });
  });

  it("allEnemies carrier: allEnemies statuses ride for everyone, chosen-only statuses only on the chosen's hits", () => {
    const plan = compileCard(card(dmg("allEnemies"), st("burning", "allEnemies"), st("enfeebled", "enemy")));
    expect(plan.steps).toHaveLength(1);
    const [attack] = plan.steps;
    if (attack?.kind !== "attack") throw new Error("expected an attack");
    expect(attack.chosenAttack.hits[0]?.statuses?.map((a) => a.status)).toEqual(["burning", "enfeebled"]);
    expect(attack.otherAttack.hits[0]?.statuses?.map((a) => a.status)).toEqual(["burning"]);
  });

  it("no enemy damage effect: statuses apply directly; self statuses are always direct", () => {
    const plan = compileCard(card(st("enfeebled", "enemy"), st("burning", "allEnemies"), st("burning", "self")));
    expect(plan.steps.map((s) => s.reach)).toEqual(["chosen", "allEnemies", "self"]);
  });

  it("a self damage effect is not a carrier (statuses on enemies apply directly)", () => {
    const plan = compileCard(card(dmg("self"), st("enfeebled", "enemy")));
    expect(plan.steps.map((s) => [s.kind, s.reach])).toEqual([["attack", "self"], ["status", "chosen"]]);
  });

  it("heal and restoreShield scaling that reads the target throws a RangeError (as the validator rejects it)", () => {
    for (const type of ["heal", "restoreShield"] as const) {
      expect(() => compileCard(card({ type, amount: 4, target: "self", scaling: [{ afflictions: true, per: 1 }] }))).toThrow(RangeError);
      expect(() => compileCard(card({ type, amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 1 }, { stacksOfTag: "dot", per: 1 }] }))).toThrow(RangeError);
      expect(() => compileCard(card({ type, amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 3 }] }))).not.toThrow();
    }
  });

  it("invalid hits throw a RangeError instead of falling back to 1", () => {
    for (const hits of [0, -1, 1.5, Number.NaN]) {
      expect(() => compileCard(card({ type: "damage", damageType: "physical", amount: 2, target: "enemy", hits }))).toThrow(RangeError);
    }
    expect(() => compileCard(card({ type: "damage", damageType: "physical", amount: 2, target: "enemy" }))).not.toThrow();
  });
});

