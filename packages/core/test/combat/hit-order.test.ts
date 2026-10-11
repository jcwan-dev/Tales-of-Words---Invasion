import { describe, expect, it } from "vitest";
import {
  baseValue,
  createCombatContext,
  createUnit,
  resolveHit,
  statusDef,
  type HitSpec,
  type StatId,
  type StatusId,
} from "../../src/index.ts";
import { attackerUnit, ctxFor, eventsOf, indexOfType, targetUnit, typesOf } from "./helpers.ts";

const phys = (amount: number, extra: Partial<HitSpec> = {}): HitSpec => ({ damageType: "physical", amount, ...extra });
const arc = (amount: number, extra: Partial<HitSpec> = {}): HitSpec => ({ damageType: "arcane", amount, ...extra });

describe("Hit order step 1: base value from the skill and the attacker's stats", () => {
  it("baseValue with no scaling is the amount", () => {
    const stats = createUnit({ id: "u", side: "player", maxHp: 10 }).stats;
    expect(baseValue(7, undefined, stats)).toBe(7);
    expect(baseValue(7, [], stats)).toBe(7);
  });

  it("baseValue adds per x stat for each scaling entry (spec worked example: Strike 12, Cleave 15, Huo 9)", () => {
    // Sellsword: Might 4, Agility 1, Arcana 2.
    const stats = createUnit({ id: "s", side: "player", maxHp: 50, stats: { might: 4, vitality: 4, agility: 1, wisdom: 3 } }).stats;
    // Strike: 4 + 2*4 = 12
    expect(baseValue(4, [{ stat: "might", per: 2 }], stats)).toBe(12);
    // Cleave: 6 + 2*4 + 1*1 = 15
    expect(baseValue(6, [{ stat: "might", per: 2 }, { stat: "agility", per: 1 }], stats)).toBe(15);
    // Huo: 3 + 3*2 = 9
    expect(baseValue(3, [{ stat: "arcana", per: 3 }], stats)).toBe(9);
    // Mend: 4 + 3*3 = 13
    expect(baseValue(4, [{ stat: "wisdom", per: 3 }], stats)).toBe(13);
  });

  it("missing stats default to 2 (BASE_STAT)", () => {
    const stats = createUnit({ id: "u", side: "player", maxHp: 10 }).stats;
    // 3 + 2*2 = 7
    expect(baseValue(3, [{ stat: "cunning", per: 2 }], stats)).toBe(7);
  });

  it("resolveHit uses the attacker's stats for the base value", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ stats: { might: 4 } });
    const t = targetUnit({ maxHp: 50 });
    // 4 + 2*4 = 12
    resolveHit(ctx, a, t, phys(4, { scaling: [{ stat: "might", per: 2 }] }));
    expect(t.hp).toBe(38);
    expect(eventsOf(ctx.events, "HitStarted")[0]).toEqual({ type: "HitStarted", attacker: "a", target: "t", damageType: "physical", value: 12 });
  });
});

describe("Hit order step 2: attacker modifiers (damage modifiers net out, then round down)", () => {
  const valueAfter = (statuses: Partial<Record<StatusId, number>>, hit: HitSpec): number => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses });
    const t = targetUnit({ maxHp: 200 });
    resolveHit(ctx, a, t, hit);
    const started = eventsOf(ctx.events, "HitStarted")[0];
    expect(started).toBeDefined();
    // The damage actually dealt matches the value after steps 1-2 (no Shield here).
    expect(200 - t.hp).toBe(started?.value);
    return started?.value ?? -1;
  };

  it("Emboldened 3 and Enfeebled 1 = +50% on a physical hit", () => {
    // 10 * (1 + 0.25*(3-1)) = 15
    expect(valueAfter({ emboldened: 3, enfeebled: 1 }, phys(10))).toBe(15);
  });

  it("each Emboldened stack is +25%", () => {
    // 8 * (1 + 0.25*2) = 12
    expect(valueAfter({ emboldened: 2 }, phys(8))).toBe(12);
  });

  it("the result is rounded down", () => {
    // 7 * 1.25 = 8.75 -> 8
    expect(valueAfter({ emboldened: 1 }, phys(7))).toBe(8);
    // 7 * 0.75 = 5.25 -> 5
    expect(valueAfter({ enfeebled: 1 }, phys(7))).toBe(5);
  });

  it("the result is never below 0", () => {
    // 10 * (1 - 0.25*4) = 0
    expect(valueAfter({ enfeebled: 4 }, phys(10))).toBe(0);
    // 10 * (1 - 0.25*6) = -5 -> 0
    expect(valueAfter({ enfeebled: 6 }, phys(10))).toBe(0);
  });

  it("arcane hits use Kindled/Dimmed, netted", () => {
    // 10 * (1 + 0.25*(2-1)) = 12.5 -> 12
    expect(valueAfter({ kindled: 2, dimmed: 1 }, arc(10))).toBe(12);
    // 10 * (1 - 0.25*2) = 5
    expect(valueAfter({ dimmed: 2 }, arc(10))).toBe(5);
  });

  it("physical modifiers do not touch arcane hits", () => {
    expect(valueAfter({ emboldened: 4, enfeebled: 1 }, arc(10))).toBe(10);
  });

  it("arcane modifiers do not touch physical hits", () => {
    expect(valueAfter({ kindled: 4, dimmed: 1 }, phys(10))).toBe(10);
  });

  it("modifiers apply after scaling (step 1 then step 2)", () => {
    // base 4 + 2*4 = 12; 12 * 1.25 = 15
    const ctx = ctxFor();
    const a = attackerUnit({ stats: { might: 4 }, statuses: { emboldened: 1 } });
    const t = targetUnit({ maxHp: 50 });
    resolveHit(ctx, a, t, phys(4, { scaling: [{ stat: "might", per: 2 }] }));
    expect(eventsOf(ctx.events, "HitStarted")[0]?.value).toBe(15);
    expect(t.hp).toBe(35);
  });

  it("applying modifiers does not use up stacks", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { emboldened: 3, enfeebled: 1, kindled: 2, dimmed: 1 } });
    const t = targetUnit({ maxHp: 100 });
    resolveHit(ctx, a, t, phys(10));
    resolveHit(ctx, a, t, arc(10));
    expect(a.statuses.stacks("emboldened")).toBe(3);
    expect(a.statuses.stacks("enfeebled")).toBe(1);
    expect(a.statuses.stacks("kindled")).toBe(2);
    expect(a.statuses.stacks("dimmed")).toBe(1);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([]);
  });

  it("modifiers on the target do not change the attacker's hit", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ maxHp: 100, statuses: { emboldened: 4, enfeebled: 2 } });
    resolveHit(ctx, a, t, phys(10));
    expect(t.hp).toBe(90);
  });
});

describe("Hit order step 2: Piercing (buff charges and keyword)", () => {
  it("Piercing hits skip Shield: the keyword sends all damage to HP and uses no charge", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ maxShield: 10 });
    resolveHit(ctx, a, t, phys(6, { piercing: true }));
    expect(t.shield).toBe(10);
    expect(t.hp).toBe(24);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "a", target: "t", damageType: "physical", shieldDamage: 0, hpDamage: 6, piercing: true },
    ]);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([]);
  });

  it("Piercing buff: one charge is used per hit and the hit skips Shield", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 2 } });
    const t = targetUnit({ maxShield: 10 });
    resolveHit(ctx, a, t, arc(6));
    expect(a.statuses.stacks("piercing")).toBe(1);
    expect(t.shield).toBe(10);
    expect(t.hp).toBe(24);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([{ type: "ChargeUsed", unit: "a", status: "piercing", left: 1 }]);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ piercing: true, shieldDamage: 0, hpDamage: 6 });
  });

  it("Piercing buff: the last charge removes the status, and the next hit hits Shield again", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 1 } });
    const t = targetUnit({ maxShield: 10 });
    resolveHit(ctx, a, t, phys(4)); // pierces: hp 30 -> 26
    expect(a.statuses.has("piercing")).toBe(false);
    expect(a.statuses.stacks("piercing")).toBe(0);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([{ type: "ChargeUsed", unit: "a", status: "piercing", left: 0 }]);
    resolveHit(ctx, a, t, phys(4)); // shield 10 -> 6
    expect(t.hp).toBe(26);
    expect(t.shield).toBe(6);
    expect(eventsOf(ctx.events, "DamageDealt")[1]).toMatchObject({ piercing: false, shieldDamage: 4, hpDamage: 0 });
  });

  it("a hit that already has the Piercing keyword uses no Piercing charge", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 2 } });
    const t = targetUnit({ maxShield: 10 });
    resolveHit(ctx, a, t, phys(6, { piercing: true }));
    expect(a.statuses.stacks("piercing")).toBe(2);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([]);
    expect(t.shield).toBe(10);
    expect(t.hp).toBe(24);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ piercing: true, shieldDamage: 0, hpDamage: 6 });
  });

  it("Piercing charge (step 2) is used before Thorns fires (step 3)", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 1 } });
    const t = targetUnit({ statuses: { thorns: 1 } });
    resolveHit(ctx, a, t, phys(3));
    expect(indexOfType(ctx.events, "ChargeUsed")).toBeLessThan(indexOfType(ctx.events, "ThornsDamage"));
  });

  it("a Piercing hit on a target with no Shield deals the same HP damage", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit();
    resolveHit(ctx, a, t, phys(5, { piercing: true }));
    expect(t.hp).toBe(25);
  });
});

describe("Hit order step 3: Thorns (attacked trigger)", () => {
  it("Thorns X: the attacker takes X damage, Shield first, then HP", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ maxShield: 2 });
    const t = targetUnit({ statuses: { thorns: 5 } });
    resolveHit(ctx, a, t, phys(1));
    // 5 thorns: 2 to attacker Shield, 3 to HP
    expect(a.shield).toBe(0);
    expect(a.hp).toBe(27);
    expect(eventsOf(ctx.events, "ThornsDamage")).toEqual([{ type: "ThornsDamage", source: "t", target: "a", shieldDamage: 2, hpDamage: 3 }]);
    expect(eventsOf(ctx.events, "ShieldBroken")).toEqual([{ type: "ShieldBroken", unit: "a" }]);
  });

  it("Thorns damage is untyped: attacker modifiers (on either unit) don't apply to it", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { emboldened: 4, kindled: 4 } });
    const t = targetUnit({ statuses: { thorns: 4, enfeebled: 2, dimmed: 2, emboldened: 3, kindled: 3 } });
    resolveHit(ctx, a, t, phys(1));
    expect(a.hp).toBe(26);
    expect(eventsOf(ctx.events, "ThornsDamage")[0]).toMatchObject({ shieldDamage: 0, hpDamage: 4 });
  });

  it("Thorns damage is not Piercing: it hits Shield even if the Thorns owner has Piercing charges, and uses none", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ maxShield: 10 });
    const t = targetUnit({ statuses: { thorns: 3, piercing: 2 } });
    resolveHit(ctx, a, t, phys(1));
    expect(a.shield).toBe(7);
    expect(a.hp).toBe(30);
    expect(t.statuses.stacks("piercing")).toBe(2);
  });

  it("Thorns triggers nothing: no Thorns or Warded back on the Thorns owner", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { thorns: 4, warded: 1 } });
    const t = targetUnit({ statuses: { thorns: 3 } });
    resolveHit(ctx, a, t, phys(5));
    expect(eventsOf(ctx.events, "ThornsDamage")).toHaveLength(1);
    expect(a.statuses.stacks("warded")).toBe(1); // Thorns is not an attack, so Warded does not deflect it
    expect(a.hp).toBe(27);
    expect(t.hp).toBe(25); // only the hit, no Thorns back from the attacker
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([]);
  });

  it("Thorns triggers nothing: no Leeching for the Thorns owner, no Bleeding stack on the attacker", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { bleeding: 2 } });
    const t = targetUnit({ hp: 20, statuses: { thorns: 3, leeching: 5 } });
    resolveHit(ctx, a, t, phys(4));
    expect(a.statuses.stacks("bleeding")).toBe(2);
    expect(t.hp).toBe(16); // 20 - 4, no heal from Thorns damage
    expect(eventsOf(ctx.events, "Healed")).toEqual([]);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("Thorns does not use up stacks (it is a ticking status)", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ statuses: { thorns: 3 } });
    resolveHit(ctx, a, t, phys(1));
    resolveHit(ctx, a, t, phys(1));
    expect(t.statuses.stacks("thorns")).toBe(3);
    expect(a.hp).toBe(24);
  });

  it("Thorns fires even on a hit that deals 0 damage", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { enfeebled: 4 } });
    const t = targetUnit({ statuses: { thorns: 2 } });
    resolveHit(ctx, a, t, phys(10)); // 10 * 0 = 0
    expect(a.hp).toBe(28);
    expect(t.hp).toBe(30);
  });

  it("no Thorns status, no ThornsDamage", () => {
    const ctx = ctxFor();
    resolveHit(ctx, attackerUnit(), targetUnit(), phys(3));
    expect(eventsOf(ctx.events, "ThornsDamage")).toEqual([]);
  });
});

describe("Hit order step 4: Warded check", () => {
  it("a Warded target deflects the hit: one charge used, no damage, no statuses", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ maxShield: 5, statuses: { warded: 2 } });
    resolveHit(ctx, a, t, phys(10, { statuses: [{ status: "burning", stacks: 3 }, { status: "stunned", stacks: 1 }] }));
    expect(t.hp).toBe(30);
    expect(t.shield).toBe(5);
    expect(t.statuses.stacks("warded")).toBe(1);
    expect(t.statuses.has("burning")).toBe(false);
    expect(t.statuses.has("stunned")).toBe(false);
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([{ type: "HitDeflected", attacker: "a", target: "t" }]);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([{ type: "ChargeUsed", unit: "t", status: "warded", left: 1 }]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([]);
    expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(1);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
    expect(eventsOf(ctx.events, "StatusMissed")).toEqual([]);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([]);
  });

  it("a deflected hit triggers nothing after step 4: no Leeching", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 5 } });
    const t = targetUnit({ statuses: { warded: 1 } });
    resolveHit(ctx, a, t, phys(10));
    expect(a.hp).toBe(10);
    expect(eventsOf(ctx.events, "Healed")).toEqual([]);
  });

  it("a deflected hit triggers nothing after step 4: no Bleeding stack", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ statuses: { warded: 1, bleeding: 2 } });
    resolveHit(ctx, a, t, phys(10));
    expect(t.statuses.stacks("bleeding")).toBe(2);
  });

  it("Thorns still fires on a deflected hit, and before the deflect", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ statuses: { warded: 1, thorns: 3 } });
    resolveHit(ctx, a, t, phys(10));
    expect(a.hp).toBe(27);
    expect(t.hp).toBe(30);
    const thorns = indexOfType(ctx.events, "ThornsDamage");
    expect(thorns).toBeGreaterThanOrEqual(0);
    expect(thorns).toBeLessThan(indexOfType(ctx.events, "HitDeflected"));
    expect(thorns).toBeLessThan(indexOfType(ctx.events, "ChargeUsed"));
  });

  it("The Warded charge is used before the deflect is reported: ChargeUsed (Warded) comes right before HitDeflected", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { warded: 3 } });
    resolveHit(ctx, attackerUnit(), t, phys(4));
    expect(ctx.events).toEqual([
      { type: "HitStarted", attacker: "a", target: "t", damageType: "physical", value: 4 },
      { type: "ChargeUsed", unit: "t", status: "warded", left: 2 },
      { type: "HitDeflected", attacker: "a", target: "t" },
    ]);
  });

  it("each Warded charge deflects one hit; the third hit lands", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ statuses: { warded: 2 } });
    resolveHit(ctx, a, t, phys(4));
    resolveHit(ctx, a, t, phys(4));
    expect(t.statuses.has("warded")).toBe(false);
    expect(t.hp).toBe(30);
    resolveHit(ctx, a, t, phys(4));
    expect(t.hp).toBe(26);
    expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(2);
  });

  it("Piercing ignores Warded: a Piercing keyword hit is never deflected, uses no Warded charge, and skips Shield", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 10, statuses: { warded: 1, bleeding: 1 } });
    resolveHit(ctx, attackerUnit(), t, phys(8, { piercing: true, statuses: [{ status: "burning", stacks: 2 }] }));
    // 8 straight to HP: 30 - 8 = 22; Bleeding 1 + 1 = 2; Burning 2 applied
    expect(t.hp).toBe(22);
    expect(t.shield).toBe(10);
    expect(t.statuses.stacks("warded")).toBe(1);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([]);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "a", target: "t", damageType: "physical", shieldDamage: 0, hpDamage: 8, piercing: true },
    ]);
  });

  it("Piercing ignores Warded: a hit made piercing by an attacker's Piercing charge is never deflected and uses no Warded charge", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 1 } });
    const t = targetUnit({ maxShield: 10, statuses: { warded: 2 } });
    resolveHit(ctx, a, t, arc(6));
    // 6 straight to HP: 30 - 6 = 24
    expect(a.statuses.stacks("piercing")).toBe(0);
    expect(t.statuses.stacks("warded")).toBe(2);
    expect(t.hp).toBe(24);
    expect(t.shield).toBe(10);
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([]);
    expect(eventsOf(ctx.events, "ChargeUsed")).toEqual([{ type: "ChargeUsed", unit: "a", status: "piercing", left: 0 }]);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ piercing: true, shieldDamage: 0, hpDamage: 6 });
  });

  it("Piercing ignores Warded: once the Piercing charges run out, Warded deflects again", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { piercing: 1 } });
    const t = targetUnit({ statuses: { warded: 1 } });
    resolveHit(ctx, a, t, phys(5)); // pierces: 30 -> 25, Warded kept
    resolveHit(ctx, a, t, phys(5)); // no charge left: deflected
    expect(t.hp).toBe(25);
    expect(t.statuses.stacks("warded")).toBe(0);
    expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(1);
  });

  it("Piercing ignores Warded: Thorns still fires on a Piercing hit", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit({ statuses: { warded: 1, thorns: 2 } });
    resolveHit(ctx, a, t, phys(4, { piercing: true }));
    expect(a.hp).toBe(28);
    expect(t.hp).toBe(26);
  });

  it("Warded on the attacker does not deflect the attacker's own hit", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { warded: 1 } });
    const t = targetUnit();
    resolveHit(ctx, a, t, phys(5));
    expect(t.hp).toBe(25);
    expect(a.statuses.stacks("warded")).toBe(1);
  });

  it("a deflected hit still emits HitStarted with the value after steps 1-2", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { warded: 1 } });
    resolveHit(ctx, attackerUnit({ statuses: { emboldened: 2 } }), t, phys(10));
    // 10 * 1.5 = 15
    expect(eventsOf(ctx.events, "HitStarted")[0]?.value).toBe(15);
  });
});

describe("Hit order step 5: Shield, then HP", () => {
  it("damage takes Shield first, the rest goes to HP", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 5 });
    resolveHit(ctx, attackerUnit(), t, phys(8));
    // 8: 5 to Shield, 3 to HP
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(27);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "a", target: "t", damageType: "physical", shieldDamage: 5, hpDamage: 3, piercing: false },
    ]);
  });

  it("damage smaller than Shield only lowers Shield", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 5 });
    resolveHit(ctx, attackerUnit(), t, arc(3));
    expect(t.shield).toBe(2);
    expect(t.hp).toBe(30);
    expect(eventsOf(ctx.events, "ShieldBroken")).toEqual([]);
  });

  it("current Shield, not max Shield, absorbs damage", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 10, shield: 3 });
    resolveHit(ctx, attackerUnit(), t, phys(5));
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(28);
  });

  it("ShieldBroken is emitted once, when Shield goes from >0 to 0", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 4 });
    resolveHit(ctx, attackerUnit(), t, phys(4)); // exactly breaks it
    resolveHit(ctx, attackerUnit(), t, phys(4)); // shield already 0
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(26);
    expect(eventsOf(ctx.events, "ShieldBroken")).toEqual([{ type: "ShieldBroken", unit: "t" }]);
  });

  it("no ShieldBroken for a unit that never had Shield", () => {
    const ctx = ctxFor();
    resolveHit(ctx, attackerUnit(), targetUnit(), phys(4));
    expect(eventsOf(ctx.events, "ShieldBroken")).toEqual([]);
  });

  it("At 0 HP the unit falls: hp never goes below 0, fallen is set, UnitFell once", () => {
    const ctx = ctxFor();
    const t = targetUnit({ hp: 5 });
    resolveHit(ctx, attackerUnit(), t, phys(20));
    expect(t.hp).toBe(0);
    expect(t.fallen).toBe(true);
    const after = ctx.events.length;
    resolveHit(ctx, attackerUnit(), t, phys(20)); // against a fallen unit: does nothing
    expect(t.hp).toBe(0);
    expect(ctx.events.length).toBe(after);
    expect(eventsOf(ctx.events, "UnitFell")).toEqual([{ type: "UnitFell", unit: "t" }]);
  });

  it("a unit above 0 HP has not fallen", () => {
    const ctx = ctxFor();
    const t = targetUnit({ hp: 5 });
    expect(t.fallen).toBe(false);
    resolveHit(ctx, attackerUnit(), t, phys(4));
    expect(t.hp).toBe(1);
    expect(t.fallen).toBe(false);
    expect(eventsOf(ctx.events, "UnitFell")).toEqual([]);
  });

  it("DamageDealt is emitted even when both damages are 0", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 5 });
    resolveHit(ctx, attackerUnit(), t, phys(0));
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "a", target: "t", damageType: "physical", shieldDamage: 0, hpDamage: 0, piercing: false },
    ]);
  });
});

describe("Hit order step 6: damage triggers — Leeching", () => {
  it("Leeching X heals X when the hit dealt at least X", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 5 } });
    resolveHit(ctx, a, targetUnit(), phys(10));
    expect(a.hp).toBe(15);
    expect(eventsOf(ctx.events, "Healed")).toEqual([{ type: "Healed", unit: "a", amount: 5 }]);
  });

  it("Leeching heals up to the damage dealt", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 5 } });
    resolveHit(ctx, a, targetUnit(), phys(3));
    // min(5, 3) = 3
    expect(a.hp).toBe(13);
    expect(eventsOf(ctx.events, "Healed")).toEqual([{ type: "Healed", unit: "a", amount: 3 }]);
  });

  it("Leeching is capped at max HP, and Healed reports the amount actually healed", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 28, statuses: { leeching: 5 } });
    resolveHit(ctx, a, targetUnit(), phys(10));
    // min(5, 10) = 5, but only 2 missing
    expect(a.hp).toBe(30);
    expect(eventsOf(ctx.events, "Healed")).toEqual([{ type: "Healed", unit: "a", amount: 2 }]);
  });

  it("Leeching at full HP heals nothing and emits no Healed", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { leeching: 5 } });
    resolveHit(ctx, a, targetUnit(), phys(10));
    expect(a.hp).toBe(30);
    expect(eventsOf(ctx.events, "Healed")).toEqual([]);
  });

  it("Shield damage counts as damage: Leeching heals up to the total damage dealt to Shield and HP", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 6 } });
    const t = targetUnit({ maxShield: 10 });
    resolveHit(ctx, a, t, phys(4)); // all 4 to Shield
    expect(a.hp).toBe(14);
    const a2 = attackerUnit({ hp: 10, statuses: { leeching: 6 } });
    const t2 = targetUnit({ maxShield: 2 });
    const ctx2 = ctxFor();
    resolveHit(ctx2, a2, t2, phys(5)); // 2 Shield + 3 HP = 5 dealt; min(6, 5) = 5
    expect(a2.hp).toBe(15);
  });

  it("A hit that deals 0 damage triggers no Leeching", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 5, enfeebled: 4 } });
    resolveHit(ctx, a, targetUnit(), phys(10));
    expect(a.hp).toBe(10);
    expect(eventsOf(ctx.events, "Healed")).toEqual([]);
  });

  it("Leeching does not use up stacks (it is a ticking status)", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 2 } });
    resolveHit(ctx, a, targetUnit(), phys(5));
    expect(a.statuses.stacks("leeching")).toBe(2);
  });

  it("Leeching on the target does not heal the target when it is hit", () => {
    const ctx = ctxFor();
    const t = targetUnit({ hp: 20, statuses: { leeching: 5 } });
    resolveHit(ctx, attackerUnit(), t, phys(4));
    expect(t.hp).toBe(16);
  });
});

describe("Hit order step 6: damage triggers — Bleeding", () => {
  it("Bleeding on the target gains a stack if the hit was physical", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit(), t, phys(5));
    expect(t.statuses.stacks("bleeding")).toBe(3);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "t", status: "bleeding", stacks: 1, total: 3 }]);
  });

  it("an arcane hit adds no Bleeding stack", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit(), t, arc(5));
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("A physical hit fully absorbed by Shield still adds a Bleeding stack", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 10, statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit(), t, phys(4));
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("bleeding")).toBe(3);
  });

  it("a Piercing physical hit adds a Bleeding stack", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 10, statuses: { bleeding: 1 } });
    resolveHit(ctx, attackerUnit(), t, phys(4, { piercing: true }));
    expect(t.statuses.stacks("bleeding")).toBe(2);
  });

  it("A hit never starts Bleeding on its own: a target that is not Bleeding gains nothing", () => {
    const ctx = ctxFor();
    const t = targetUnit();
    resolveHit(ctx, attackerUnit(), t, phys(5));
    expect(t.statuses.has("bleeding")).toBe(false);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("A hit that deals 0 damage triggers no Bleeding stack", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit({ statuses: { enfeebled: 4 } }), t, phys(10));
    expect(t.statuses.stacks("bleeding")).toBe(2);
  });

  it("Bleeding applied by the hit at step 7 does not also gain the step-6 stack (Bloodletter on a fresh target)", () => {
    // Bloodletter: 4 physical, Piercing, Bleeding 3. Not Bleeding before step 6 -> only the 3 from step 7.
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 5 });
    resolveHit(ctx, attackerUnit(), t, phys(4, { piercing: true, statuses: [{ status: "bleeding", stacks: 3 }] }));
    expect(t.statuses.stacks("bleeding")).toBe(3);
    expect(t.hp).toBe(26);
    expect(t.shield).toBe(5);
  });

  it("Bloodletter on a Bleeding target: +1 at step 6, then +3 at step 7", () => {
    // 2 + 1 + 3 = 6
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit(), t, phys(4, { piercing: true, statuses: [{ status: "bleeding", stacks: 3 }] }));
    expect(t.statuses.stacks("bleeding")).toBe(6);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([
      { type: "StatusApplied", unit: "t", status: "bleeding", stacks: 1, total: 3 },
      { type: "StatusApplied", unit: "t", status: "bleeding", stacks: 3, total: 6 },
    ]);
  });

  it("Bleeding on the attacker gains nothing from the attacker's own hit", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ statuses: { bleeding: 2 } });
    resolveHit(ctx, a, targetUnit(), phys(5));
    expect(a.statuses.stacks("bleeding")).toBe(2);
  });
});

describe("Hit order step 7: statuses carried by the hit", () => {
  it("applies the statuses to the target; reapplying adds stacks", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { burning: 3 } });
    resolveHit(ctx, attackerUnit(), t, arc(3, { statuses: [{ status: "burning", stacks: 2 }] }));
    // Burning 3 + Burning 2 = Burning 5
    expect(t.statuses.stacks("burning")).toBe(5);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "t", status: "burning", stacks: 2, total: 5 }]);
  });

  it("different statuses never replace each other", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { poisoned: 1 } });
    resolveHit(ctx, attackerUnit(), t, phys(1, { statuses: [{ status: "burning", stacks: 2 }, { status: "bleeding", stacks: 3 }] }));
    expect(t.statuses.stacks("poisoned")).toBe(1);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(t.statuses.stacks("bleeding")).toBe(3);
  });

  it("A hit that deals 0 damage still goes through steps 5-7, so its statuses still apply", () => {
    const ctx = ctxFor();
    const t = targetUnit({ maxShield: 5 });
    resolveHit(ctx, attackerUnit({ statuses: { enfeebled: 4 } }), t, phys(10, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(t.shield).toBe(5);
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ shieldDamage: 0, hpDamage: 0 });
    expect(eventsOf(ctx.events, "ShieldBroken")).toEqual([]);
  });

  it("a hit with amount 0 (status-only) applies its statuses", () => {
    const ctx = ctxFor();
    const t = targetUnit();
    resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [{ status: "enfeebled", stacks: 2 }] }));
    expect(t.statuses.stacks("enfeebled")).toBe(2);
  });

  it("timed statuses can be applied: stacks are turns", () => {
    const ctx = ctxFor();
    const t = targetUnit();
    resolveHit(ctx, attackerUnit(), t, arc(1, { statuses: [{ status: "stunned", stacks: 1 }, { status: "paralysed", stacks: 2 }] }));
    expect(t.statuses.stacks("stunned")).toBe(1);
    expect(t.statuses.stacks("paralysed")).toBe(2);
  });

  it("A hit always finishes: if the target falls at step 5, its statuses still apply", () => {
    const ctx = ctxFor();
    const t = targetUnit({ hp: 5, statuses: { bleeding: 1 } });
    resolveHit(ctx, attackerUnit(), t, phys(10, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(t.hp).toBe(0);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(t.statuses.stacks("bleeding")).toBe(2); // step 6 still ran
    expect(eventsOf(ctx.events, "UnitFell")).toEqual([{ type: "UnitFell", unit: "t" }]);
    expect(indexOfType(ctx.events, "UnitFell")).toBeLessThan(ctx.events.findIndex((e) => e.type === "StatusApplied" && e.status === "burning"));
  });

  it("A hit always finishes: if the attacker falls to Thorns at step 3, steps 4-7 still run", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 2 });
    const t = targetUnit({ maxShield: 3, statuses: { thorns: 5 } });
    resolveHit(ctx, a, t, phys(6, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(a.hp).toBe(0);
    expect(a.fallen).toBe(true);
    // 6: 3 to Shield, 3 to HP
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(27);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(eventsOf(ctx.events, "UnitFell")).toEqual([{ type: "UnitFell", unit: "a" }]);
    expect(indexOfType(ctx.events, "UnitFell")).toBeLessThan(indexOfType(ctx.events, "DamageDealt"));
  });
});

describe("Hit order: fallen units", () => {
  it("A hit by a unit that has already fallen does nothing (no events, no state change)", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 0, statuses: { piercing: 2, leeching: 5, emboldened: 1 } });
    const t = targetUnit({ maxShield: 5, statuses: { thorns: 3, warded: 1, bleeding: 2 } });
    expect(a.fallen).toBe(true);
    resolveHit(ctx, a, t, phys(10, { statuses: [{ status: "burning", stacks: 2, chance: 0.5 }, { status: "stunned", stacks: 1 }] }));
    expect(ctx.events).toEqual([]);
    expect(a.hp).toBe(0);
    expect(a.statuses.stacks("piercing")).toBe(2);
    expect(t.hp).toBe(30);
    expect(t.shield).toBe(5);
    expect(t.statuses.stacks("warded")).toBe(1);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.has("burning")).toBe(false);
    expect(t.statuses.has("stunned")).toBe(false);
  });

  it("A hit against a unit that has already fallen does nothing: no Thorns from it, no Piercing charge, no Leeching", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, maxShield: 4, statuses: { piercing: 2, leeching: 5 } });
    const t = targetUnit({ hp: 0, maxShield: 5, statuses: { thorns: 3, warded: 1, bleeding: 2 } });
    expect(t.fallen).toBe(true);
    resolveHit(ctx, a, t, phys(10, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(ctx.events).toEqual([]);
    expect(a.hp).toBe(10);
    expect(a.shield).toBe(4);
    expect(a.statuses.stacks("piercing")).toBe(2);
    expect(t.hp).toBe(0);
    expect(t.shield).toBe(5);
    expect(t.statuses.stacks("warded")).toBe(1);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.has("burning")).toBe(false);
  });

  it("a hit by or against a fallen unit uses no RNG: the next roll is the same as with no such hit", () => {
    const outcomes = (withFallenHits: boolean): boolean[] => {
      const ctx = createCombatContext("fallen-rng");
      const half = phys(1, { statuses: [{ status: "stunned", stacks: 1, chance: 0.5 }] });
      const out: boolean[] = [];
      for (let i = 0; i < 16; i++) {
        if (withFallenHits) {
          resolveHit(ctx, attackerUnit(), targetUnit({ id: "dead", hp: 0 }), half); // against a fallen target
          resolveHit(ctx, attackerUnit({ id: "dead", hp: 0 }), targetUnit(), half); // by a fallen attacker
        }
        const t = targetUnit();
        resolveHit(ctx, attackerUnit(), t, phys(1, { statuses: [{ status: "stunned", stacks: 1, chance: 0.5 }] }));
        out.push(t.statuses.has("stunned"));
      }
      return out;
    };
    expect(outcomes(true)).toEqual(outcomes(false));
  });

  it("A unit that falls during a hit cannot be healed by that hit: no Leeching on an attacker killed by Thorns", () => {
    // Attacker 2 HP, Leeching 5; target Thorns 5 -> attacker falls at step 3.
    // Steps 4-7 still run: 6 damage to the target (30 -> 24), but step 6 heals nothing.
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 2, statuses: { leeching: 5 } });
    const t = targetUnit({ statuses: { thorns: 5, bleeding: 1 } });
    resolveHit(ctx, a, t, phys(6, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(a.hp).toBe(0);
    expect(a.fallen).toBe(true);
    expect(t.hp).toBe(24);
    expect(t.statuses.stacks("bleeding")).toBe(2); // the rest of step 6 still runs
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(eventsOf(ctx.events, "Healed")).toEqual([]);
    expect(eventsOf(ctx.events, "UnitFell")).toEqual([{ type: "UnitFell", unit: "a" }]);
  });

  it("a unit fallen in one hit makes the next hit do nothing", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 2 });
    const t = targetUnit({ statuses: { thorns: 5 } });
    resolveHit(ctx, a, t, phys(6)); // attacker falls to Thorns, target 30 -> 24
    const after = ctx.events.length;
    resolveHit(ctx, a, t, phys(6));
    expect(ctx.events.length).toBe(after);
    expect(t.hp).toBe(24);
  });
});

describe("Hit order step 7: chance to apply (rolled on the combat RNG)", () => {
  it("a missing chance means the status always applies (default 1)", () => {
    for (let i = 0; i < 50; i++) {
      const ctx = createCombatContext(`default-chance-${i}`);
      const t = targetUnit();
      resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [{ status: "burning", stacks: 1 }] }));
      expect(t.statuses.stacks("burning")).toBe(1);
    }
  });

  it("chance 0 never applies and emits StatusMissed", () => {
    for (let i = 0; i < 50; i++) {
      const ctx = createCombatContext(`chance0-${i}`);
      const t = targetUnit();
      resolveHit(ctx, attackerUnit(), t, phys(1, { statuses: [{ status: "stunned", stacks: 1, chance: 0 }] }));
      expect(t.statuses.has("stunned")).toBe(false);
      expect(eventsOf(ctx.events, "StatusMissed")).toEqual([{ type: "StatusMissed", unit: "t", status: "stunned" }]);
      expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
    }
  });

  it("chance 1 always applies", () => {
    for (let i = 0; i < 50; i++) {
      const ctx = createCombatContext(`chance1-${i}`);
      const t = targetUnit();
      resolveHit(ctx, attackerUnit(), t, phys(1, { statuses: [{ status: "stunned", stacks: 1, chance: 1 }] }));
      expect(t.statuses.stacks("stunned")).toBe(1);
      expect(eventsOf(ctx.events, "StatusMissed")).toEqual([]);
    }
  });

  it("chance 0.25 (Lei-style) applies about a quarter of the time across seeds", () => {
    let applied = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const ctx = createCombatContext(`chance-quarter-${i}`);
      const t = targetUnit();
      resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [{ status: "paralysed", stacks: 2, chance: 0.25 }] }));
      const hit = t.statuses.has("paralysed");
      if (hit) applied++;
      // Exactly one of StatusApplied / StatusMissed for this application.
      expect(eventsOf(ctx.events, "StatusApplied").length + eventsOf(ctx.events, "StatusMissed").length).toBe(1);
    }
    // Expected 250; sd about 13.7. Seeds are fixed, so this is deterministic.
    expect(applied).toBeGreaterThan(190);
    expect(applied).toBeLessThan(310);
  });

  it("the roll is seeded: same seed, same outcomes; the roll uses the context's RNG", () => {
    const pattern = (seed: string): boolean[] => {
      const ctx = createCombatContext(seed);
      const out: boolean[] = [];
      for (let i = 0; i < 32; i++) {
        const t = targetUnit();
        resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [{ status: "stunned", stacks: 1, chance: 0.5 }] }));
        out.push(t.statuses.has("stunned"));
      }
      return out;
    };
    expect(pattern("seed-x")).toEqual(pattern("seed-x"));
    expect(pattern("seed-x")).not.toEqual(pattern("seed-y"));
    const p = pattern("seed-x");
    expect(p).toContain(true);
    expect(p).toContain(false);
  });

  it("Only chances strictly between 0% and 100% use the combat RNG: chance 0, chance 1, no chance and deflected hits never shift later rolls", () => {
    const roll = (status: "stunned" | "burning", chance?: number): HitSpec =>
      phys(1, { statuses: [chance === undefined ? { status, stacks: 1 } : { status, stacks: 1, chance }] });
    const half = roll("stunned", 0.5);
    const fillers: { hit: HitSpec; warded: boolean }[] = [
      { hit: roll("burning", 0), warded: false },
      { hit: roll("burning", 1), warded: false },
      { hit: roll("burning"), warded: false },
      { hit: roll("burning", 0.5), warded: true }, // deflected: its 0.5 status is never rolled
    ];
    const run = (withFillers: boolean): boolean[] => {
      const ctx = createCombatContext("rng-position");
      const out: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        if (withFillers) {
          for (const f of fillers) {
            resolveHit(ctx, attackerUnit(), targetUnit(f.warded ? { statuses: { warded: 1 } } : {}), f.hit);
          }
        }
        const t = targetUnit();
        resolveHit(ctx, attackerUnit(), t, half);
        out.push(t.statuses.has("stunned"));
      }
      if (withFillers) {
        // Sanity: the filler hits really ran (certain outcomes, and deflections).
        expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(20);
        expect(ctx.events.filter((e) => e.type === "StatusMissed" && e.status === "burning")).toHaveLength(20);
        expect(ctx.events.filter((e) => e.type === "StatusApplied" && e.status === "burning")).toHaveLength(40);
      }
      return out;
    };
    const a = run(false);
    const b = run(true);
    expect(b).toEqual(a);
    // The 0.5 rolls are real rolls, not all the same.
    expect(a).toContain(true);
    expect(a).toContain(false);
  });

  it("a deflected hit rolls nothing (no StatusMissed, no StatusApplied)", () => {
    const ctx = ctxFor();
    const t = targetUnit({ statuses: { warded: 1 } });
    resolveHit(ctx, attackerUnit(), t, phys(1, { statuses: [{ status: "stunned", stacks: 1, chance: 0.5 }] }));
    expect(eventsOf(ctx.events, "StatusMissed")).toEqual([]);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });
});

describe("Hit order step 7: resistance", () => {
  const applyTo = (stats: Partial<Record<StatId, number>>, status: StatusId, stacks: number, chance?: number) => {
    const ctx = ctxFor();
    const t = targetUnit({ stats });
    const app = chance === undefined ? { status, stacks } : { status, stacks, chance };
    resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [app] }));
    return { ctx, t };
  };

  it("each point of the resisting stat above 2 removes 1 stack (Enfeebled, Vitality 5: 5 -> 2)", () => {
    // Vitality 5: 3 points above 2 -> remove 3; 5 - 3 = 2
    const { ctx, t } = applyTo({ vitality: 5 }, "enfeebled", 5);
    expect(t.statuses.stacks("enfeebled")).toBe(2);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "t", status: "enfeebled", removed: 3 }]);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "t", status: "enfeebled", stacks: 2, total: 2 }]);
  });

  it("resistance leaves a minimum of 1 stack (Burning 3, Arcana 7)", () => {
    // Arcana 7: would remove 5; 3 - 5 < 1 -> 1 left, 2 removed
    const { ctx, t } = applyTo({ arcana: 7 }, "burning", 3);
    expect(t.statuses.stacks("burning")).toBe(1);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "t", status: "burning", removed: 2 }]);
  });

  it("each status uses its own resisting stat (Poisoned/Vitality, Dimmed/Wisdom, Bleeding/Vitality)", () => {
    // Poisoned 4 vs Vitality 4 -> 2
    expect(applyTo({ vitality: 4 }, "poisoned", 4).t.statuses.stacks("poisoned")).toBe(2);
    // Poisoned 4 vs Wisdom 7 (wrong stat) -> 4
    expect(applyTo({ wisdom: 7 }, "poisoned", 4).t.statuses.stacks("poisoned")).toBe(4);
    // Dimmed 4 vs Wisdom 3 -> 3
    expect(applyTo({ wisdom: 3 }, "dimmed", 4).t.statuses.stacks("dimmed")).toBe(3);
    // Bleeding 6 vs Vitality 6 -> 2
    expect(applyTo({ vitality: 6 }, "bleeding", 6).t.statuses.stacks("bleeding")).toBe(2);
  });

  it("A resisting stat of 2 or less has no effect (it never adds stacks)", () => {
    const at2 = applyTo({ vitality: 2 }, "enfeebled", 3);
    expect(at2.t.statuses.stacks("enfeebled")).toBe(3);
    expect(eventsOf(at2.ctx.events, "StatusResisted")).toEqual([]);
    for (const v of [0, 1]) {
      const low = applyTo({ vitality: v }, "enfeebled", 3);
      expect(low.t.statuses.stacks("enfeebled")).toBe(3);
      expect(eventsOf(low.ctx.events, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "t", status: "enfeebled", stacks: 3, total: 3 }]);
      expect(eventsOf(low.ctx.events, "StatusResisted")).toEqual([]);
    }
    // Timed status, and several resisting stats both low (Ambushed: Agility 0, Cunning 1).
    expect(applyTo({ vitality: 0 }, "stunned", 2).t.statuses.stacks("stunned")).toBe(2);
    expect(applyTo({ agility: 0, cunning: 1 }, "ambushed", 2).t.statuses.stacks("ambushed")).toBe(2);
  });

  it("no StatusResisted when the application is already at the minimum of 1", () => {
    const { ctx, t } = applyTo({ vitality: 7 }, "bleeding", 1);
    expect(t.statuses.stacks("bleeding")).toBe(1);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([]);
  });

  it("Several resisting stats (Ambushed: Agility, Cunning): the highest one counts", () => {
    // Agility 3, Cunning 6 -> highest 6 -> remove 4; 6 - 4 = 2
    const a = applyTo({ agility: 3, cunning: 6 }, "ambushed", 6);
    expect(a.t.statuses.stacks("ambushed")).toBe(2);
    expect(eventsOf(a.ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "t", status: "ambushed", removed: 4 }]);
    // Agility 5, Cunning 1 -> highest 5 -> remove 3; 6 - 3 = 3 (not summed, not lowest)
    expect(applyTo({ agility: 5, cunning: 1 }, "ambushed", 6).t.statuses.stacks("ambushed")).toBe(3);
  });

  it("Resistance on timed statuses reduces turns (Stunned 3 vs Vitality 4 -> 1 turn; Paralysed 2 vs Wisdom 3 -> 1)", () => {
    // Vitality 4: remove 2 turns; 3 - 2 = 1
    const s = applyTo({ vitality: 4 }, "stunned", 3);
    expect(s.t.statuses.stacks("stunned")).toBe(1);
    expect(eventsOf(s.ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "t", status: "stunned", removed: 2 }]);
    // Wisdom 3: remove 1 turn; 2 - 1 = 1
    expect(applyTo({ wisdom: 3 }, "paralysed", 2).t.statuses.stacks("paralysed")).toBe(1);
    // Minimum 1 turn
    expect(applyTo({ vitality: 7 }, "stunned", 2).t.statuses.stacks("stunned")).toBe(1);
  });

  it("buffs have no resistance (Emboldened, Kindled, Warded, Thorns, Leeching, Piercing applied in full)", () => {
    const all7 = { might: 7, vitality: 7, cunning: 7, agility: 7, arcana: 7, intelligence: 7, wisdom: 7 };
    const buffs: StatusId[] = ["emboldened", "kindled", "warded", "thorns", "leeching", "piercing"];
    for (const b of buffs) {
      const { ctx, t } = applyTo(all7, b, 4);
      expect(t.statuses.stacks(b)).toBe(4);
      expect(eventsOf(ctx.events, "StatusResisted")).toEqual([]);
    }
  });

  it("A chance to apply is rolled first; a missed roll is never resisted", () => {
    const { ctx, t } = applyTo({ vitality: 7 }, "stunned", 3, 0);
    expect(t.statuses.has("stunned")).toBe(false);
    expect(typesOf(ctx.events).filter((x) => x === "StatusMissed" || x === "StatusResisted" || x === "StatusApplied")).toEqual(["StatusMissed"]);
  });

  it("resistance never changes the chance: a 100% application against high resistance still lands (reduced)", () => {
    for (let i = 0; i < 20; i++) {
      const ctx = createCombatContext(`resist-chance-${i}`);
      const t = targetUnit({ stats: { vitality: 7 } });
      resolveHit(ctx, attackerUnit(), t, phys(0, { statuses: [{ status: "stunned", stacks: 3, chance: 1 }] }));
      expect(t.statuses.stacks("stunned")).toBe(1);
    }
  });

  it("the step-6 Bleeding stack is still 1 against a high Vitality", () => {
    const ctx = ctxFor();
    const t = targetUnit({ stats: { vitality: 7 }, statuses: { bleeding: 2 } });
    resolveHit(ctx, attackerUnit(), t, phys(3));
    expect(t.statuses.stacks("bleeding")).toBe(3);
  });
});

describe("Hit order: event order for a full hit", () => {
  it("HitStarted, ThornsDamage, DamageDealt, ShieldBroken, then step 6 (Healed, Bleeding stack), then step 7", () => {
    // Attacker: 20/30 HP, Leeching 4. Target: 30 HP, Shield 3, Thorns 2, Bleeding 1.
    // Hit: physical 10, Burning 2.
    // Step 1-2: value 10. Step 3: Thorns 2 -> attacker HP 18. Step 5: 3 Shield + 7 HP -> target 23.
    // Step 6: Leeching min(4, 10) = 4 -> attacker 22; Bleeding 1 -> 2. Step 7: Burning 2.
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 20, statuses: { leeching: 4 } });
    const t = targetUnit({ maxShield: 3, statuses: { thorns: 2, bleeding: 1 } });
    resolveHit(ctx, a, t, phys(10, { statuses: [{ status: "burning", stacks: 2 }] }));

    expect(a.hp).toBe(22);
    expect(t.hp).toBe(23);
    expect(t.shield).toBe(0);
    expect(ctx.events).toEqual([
      { type: "HitStarted", attacker: "a", target: "t", damageType: "physical", value: 10 },
      { type: "ThornsDamage", source: "t", target: "a", shieldDamage: 0, hpDamage: 2 },
      { type: "DamageDealt", attacker: "a", target: "t", damageType: "physical", shieldDamage: 3, hpDamage: 7, piercing: false },
      { type: "ShieldBroken", unit: "t" },
      // Step 6: Leeching first, then the Bleeding stack
      { type: "Healed", unit: "a", amount: 4 },
      { type: "StatusApplied", unit: "t", status: "bleeding", stacks: 1, total: 2 },
      // Step 7
      { type: "StatusApplied", unit: "t", status: "burning", stacks: 2, total: 2 },
    ]);
  });

  it("Order inside step 6: Leeching's Healed comes before Bleeding's StatusApplied", () => {
    // Attacker 10/30 HP, Leeching 3. Target Bleeding 4. Physical 5: Healed 3, then Bleeding 4 -> 5.
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 10, statuses: { leeching: 3 } });
    const t = targetUnit({ statuses: { bleeding: 4 } });
    resolveHit(ctx, a, t, phys(5));
    expect(ctx.events.slice(-2)).toEqual([
      { type: "Healed", unit: "a", amount: 3 },
      { type: "StatusApplied", unit: "t", status: "bleeding", stacks: 1, total: 5 },
    ]);
  });

  it("each hit starts with HitStarted and appends to the same log", () => {
    const ctx = ctxFor();
    const a = attackerUnit();
    const t = targetUnit();
    resolveHit(ctx, a, t, phys(1));
    const first = ctx.events.length;
    resolveHit(ctx, a, t, arc(2));
    expect(ctx.events[0]?.type).toBe("HitStarted");
    expect(ctx.events[first]).toEqual({ type: "HitStarted", attacker: "a", target: "t", damageType: "arcane", value: 2 });
    expect(eventsOf(ctx.events, "HitStarted")).toHaveLength(2);
  });

  it("deflected hit event order: HitStarted, ThornsDamage, then the Warded charge and HitDeflected, nothing after", () => {
    const ctx = ctxFor();
    const a = attackerUnit({ hp: 20, statuses: { leeching: 4 } });
    const t = targetUnit({ statuses: { warded: 1, thorns: 2, bleeding: 1 } });
    resolveHit(ctx, a, t, phys(10, { statuses: [{ status: "burning", stacks: 2 }] }));
    expect(ctx.events).toEqual([
      { type: "HitStarted", attacker: "a", target: "t", damageType: "physical", value: 10 },
      { type: "ThornsDamage", source: "t", target: "a", shieldDamage: 0, hpDamage: 2 },
      { type: "ChargeUsed", unit: "t", status: "warded", left: 0 },
      { type: "HitDeflected", attacker: "a", target: "t" },
    ]);
  });
});

describe("Status list (metadata used by the hit)", () => {
  const cases: [StatusId, "buff" | "debuff", "ticking" | "charges" | "timed", StatId[]][] = [
    ["burning", "debuff", "ticking", ["arcana"]],
    ["poisoned", "debuff", "ticking", ["vitality"]],
    ["bleeding", "debuff", "ticking", ["vitality"]],
    ["stunned", "debuff", "timed", ["vitality"]],
    ["paralysed", "debuff", "timed", ["wisdom"]],
    ["ambushed", "debuff", "timed", ["agility", "cunning"]],
    ["enfeebled", "debuff", "ticking", ["vitality"]],
    ["dimmed", "debuff", "ticking", ["wisdom"]],
    ["emboldened", "buff", "ticking", []],
    ["kindled", "buff", "ticking", []],
    ["warded", "buff", "charges", []],
    ["thorns", "buff", "ticking", []],
    ["leeching", "buff", "ticking", []],
    ["piercing", "buff", "charges", []],
  ];
  for (const [id, kind, decay, resistedBy] of cases) {
    it(`${id}: ${kind}, ${decay}, resisted by ${resistedBy.join("/") || "nothing"}`, () => {
      const def = statusDef(id);
      expect(def.id).toBe(id);
      expect(def.kind).toBe(kind);
      expect(def.decay).toBe(decay);
      expect([...def.resistedBy].sort()).toEqual([...resistedBy].sort());
    });
  }
});

describe("StatusSet storage (one entry per id with a stack count)", () => {
  it("add, remove, has and stacks; never below 0; entry removed at 0", () => {
    const u = createUnit({ id: "u", side: "player", maxHp: 10 });
    expect(u.statuses.stacks("burning")).toBe(0);
    expect(u.statuses.has("burning")).toBe(false);
    u.statuses.add("burning", 50);
    expect(u.statuses.stacks("burning")).toBe(50);
    u.statuses.remove("burning", 20);
    expect(u.statuses.stacks("burning")).toBe(30);
    u.statuses.remove("burning", 100);
    expect(u.statuses.stacks("burning")).toBe(0);
    expect(u.statuses.has("burning")).toBe(false);
  });

  it("createUnit defaults: hp = maxHp, shield = maxShield (0 if absent), stats 2", () => {
    const u = createUnit({ id: "u", side: "enemy", maxHp: 50, maxShield: 8, statuses: { warded: 1 } });
    expect(u.hp).toBe(50);
    expect(u.maxShield).toBe(8);
    expect(u.shield).toBe(8);
    expect(u.fallen).toBe(false);
    expect(u.stats.wisdom).toBe(2);
    expect(u.statuses.stacks("warded")).toBe(1);
    const v = createUnit({ id: "v", side: "enemy", maxHp: 10 });
    expect(v.maxShield).toBe(0);
    expect(v.shield).toBe(0);
  });
});
