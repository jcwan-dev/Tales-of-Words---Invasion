import { describe, expect, it } from "vitest";
import {
  afflictions,
  createCombatContext,
  endTurn,
  resolveAttack,
  resolveConsume,
  resolveHit,
  stacksWithTag,
  startTurn,
  STATUS_IDS,
  statusDef,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type ConvertTrigger,
  type HitSpec,
  type StatusId,
} from "../../src/index.ts";
import { eventsOf } from "./helpers.ts";
import { activeId, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Spec 1.5, "Synergy effects":
// - "Afflictions = number of different DoTs on a target (0–3). Damage can scale with it, and with the number of
//    stacks of a tag on the target (Fester: 4 damage per Affliction + 1 per DoT stack)."
// - "Consume effects remove all stacks of one status for a burst: a normal typed hit dealing stacks × multiplier
//    (Combustion: all Burning, ×3, arcane). It goes through the hit order: modifiers apply, Warded can deflect it,
//    Shield first. The stacks are counted when the hit starts and removed only if it isn't deflected; a deflected
//    consume keeps them."
// - "Convert effects are triggers: when something happens to a unit, it gains a status (Mirror Ward: each deflect
//    gives +1 Thorns). Triggers: a deflect, being attacked, dealing damage, taking damage. A status gained this way
//    can set off further triggers, up to a depth of 4 per hit; deeper triggers are ignored and the event log notes it."
//   Trigger details: "a deflect trigger fires right after the deflect; dealing-damage then taking-damage triggers fire
//    at step 6, after Leeching; being-attacked triggers fire at the end of the hit. A trigger never changes the hit that
//    set it off." "The status gained is the unit's own, so resistance doesn't apply." "A unit that has fallen doesn't
//    trigger." "Thorns damage and damage over time set off no triggers."
//   Consume: "If the hit isn't deflected, all stacks of that status are removed at the end of the hit (including any
//    the hit itself added)". Brief additions: Consumed reports the number removed and is not emitted when 0 were removed.
// - "Slow decay (Plague Censer): while a unit with it is alive, damage over time on the units of the other side loses
//    a stack only every other round (rounds 2, 4, 6…). Damage still happens every turn. Several sources don't stack."
//   Spec 1.6 generalises it (statuses by id or tag, whose: own or the other side); Plague Censer is now the trait
//   { slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }] }. More cases in decay-and-caps.test.ts.

const DOTS: readonly StatusId[] = ["burning", "bleeding", "poisoned"];

/** Fester: 4 damage per Affliction + 1 per DoT stack (physical here; the spec doesn't give its type). */
const fester = (extra: Partial<HitSpec> = {}): HitSpec => ({
  damageType: "physical",
  amount: 0,
  scaling: [{ afflictions: true, per: 4 }, { stacksOfTag: "dot", per: 1 }],
  ...extra,
});

const hitValues = (events: readonly CombatEvent[]): number[] => eventsOf(events, "HitStarted").map((e) => e.value);

const idx = (events: readonly CombatEvent[], pred: (e: CombatEvent) => boolean): number => events.findIndex(pred);

const converts = (...list: ConvertTrigger[]) => ({ traits: { converts: list } });

// ---------------------------------------------------------------------------------------------
describe("Status tags: Burning, Bleeding and Poisoned are tagged \"dot\"", () => {
  for (const id of DOTS) {
    it(`${id} has the "dot" tag`, () => {
      expect([...statusDef(id).tags]).toContain("dot");
    });
  }
  for (const id of STATUS_IDS.filter((s) => !DOTS.includes(s))) {
    it(`${id} has no "dot" tag`, () => {
      expect([...statusDef(id).tags]).not.toContain("dot");
    });
  }
});

describe("afflictions(unit): number of different DoTs present (0-3)", () => {
  it("0 with no statuses", () => {
    expect(afflictions(enemy())).toBe(0);
  });

  it("0 with only non-DoT statuses (Stunned, Enfeebled, Thorns, Warded)", () => {
    expect(afflictions(enemy("e", { statuses: { stunned: 5, enfeebled: 3, thorns: 2, warded: 1 } }))).toBe(0);
  });

  it("counts kinds, not stacks: Burning 50 is 1", () => {
    expect(afflictions(enemy("e", { statuses: { burning: 50 } }))).toBe(1);
  });

  it("1, 2 and 3", () => {
    expect(afflictions(enemy("e", { statuses: { poisoned: 1 } }))).toBe(1);
    expect(afflictions(enemy("e", { statuses: { burning: 3, bleeding: 2 } }))).toBe(2);
    expect(afflictions(enemy("e", { statuses: { burning: 1, bleeding: 1, poisoned: 1, stunned: 4 } }))).toBe(3);
  });

  it("a DoT at 0 stacks does not count", () => {
    expect(afflictions(enemy("e", { statuses: { burning: 0, bleeding: 2 } }))).toBe(1);
  });

  it("follows the unit's current stacks", () => {
    const e = enemy("e", { statuses: { burning: 1 } });
    e.statuses.add("poisoned", 2);
    expect(afflictions(e)).toBe(2);
    e.statuses.remove("burning", 1);
    expect(afflictions(e)).toBe(1);
  });
});

describe("stacksWithTag(unit, \"dot\"): Burning + Bleeding + Poisoned stacks", () => {
  it("0 with none, and non-DoT stacks don't count", () => {
    expect(stacksWithTag(enemy(), "dot")).toBe(0);
    expect(stacksWithTag(enemy("e", { statuses: { stunned: 9, emboldened: 4 } }), "dot")).toBe(0);
  });

  it("sums the three DoTs (3 + 2 + 4 = 9)", () => {
    expect(stacksWithTag(enemy("e", { statuses: { burning: 3, bleeding: 2, poisoned: 4, paralysed: 7 } }), "dot")).toBe(9);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Damage scaling with Afflictions and with stacks of a tag (read when the hit starts)", () => {
  it("Fester: target Burning 3, Bleeding 2 -> 4 x 2 + 1 x 5 = 13", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 3, bleeding: 2 } });
    resolveHit(ctx, player(), t, fester());
    expect(eventsOf(ctx.events, "HitStarted")[0]).toEqual({ type: "HitStarted", attacker: "p", target: "e", damageType: "physical", value: 13 });
    expect(t.hp).toBe(17);
  });

  it("Fester: all three DoTs (Burning 3, Bleeding 2, Poisoned 4) -> 4 x 3 + 9 = 21", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 3, bleeding: 2, poisoned: 4 } });
    resolveHit(ctx, player(), t, fester());
    expect(hitValues(ctx.events)).toEqual([21]);
    expect(t.hp).toBe(9);
  });

  it("Fester on a target with no DoT (only Stunned 5, Enfeebled 3) deals 0", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { stunned: 5, enfeebled: 3 } });
    resolveHit(ctx, player(), t, fester());
    expect(hitValues(ctx.events)).toEqual([0]);
    expect(t.hp).toBe(30);
  });

  it("reads the target, not the attacker (attacker Burning 5, Poisoned 5; target Bleeding 1 -> 4 + 1 = 5)", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { bleeding: 1 } });
    resolveHit(ctx, player({ statuses: { burning: 5, poisoned: 5 } }), t, fester());
    expect(hitValues(ctx.events)).toEqual([5]);
  });

  it("adds to the amount and to stat scaling (2 + 1 x Might 4 + 4 x 1 Affliction = 10)", () => {
    const ctx = createCombatContext("mixed");
    const t = enemy("e", { statuses: { poisoned: 1 } });
    resolveHit(ctx, player({ stats: { might: 4 } }), t, {
      damageType: "physical",
      amount: 2,
      scaling: [{ stat: "might", per: 1 }, { afflictions: true, per: 4 }],
    });
    expect(hitValues(ctx.events)).toEqual([10]);
    expect(t.hp).toBe(20);
  });

  it("stack scaling alone (per 2 x DoT stacks 3 + 4 = 14)", () => {
    const ctx = createCombatContext("stacks");
    const t = enemy("e", { statuses: { burning: 3, poisoned: 4 } });
    resolveHit(ctx, player(), t, { damageType: "arcane", amount: 0, scaling: [{ stacksOfTag: "dot", per: 2 }] });
    expect(hitValues(ctx.events)).toEqual([14]);
  });

  it("modifiers apply after scaling (Fester 13 with Emboldened 1: 13 x 1.25 = 16.25 -> 16)", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 3, bleeding: 2 } });
    resolveHit(ctx, player({ statuses: { emboldened: 1 } }), t, fester());
    expect(hitValues(ctx.events)).toEqual([16]);
    expect(t.hp).toBe(14);
  });

  it("is read when the hit starts, before this hit's statuses (target Burning 2; hit carries Poisoned 3 -> 4 x 1 + 2 = 6)", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 2 } });
    resolveHit(ctx, player(), t, fester({ statuses: [{ status: "poisoned", stacks: 3 }] }));
    expect(hitValues(ctx.events)).toEqual([6]);
    expect(t.hp).toBe(24);
    expect(t.statuses.stacks("poisoned")).toBe(3);
  });

  it("is read when the hit starts, before this hit's Bleed power (target Burning 2, Bleed power 4 -> 4 + 2 = 6)", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 2 } });
    resolveHit(ctx, player({ bleedPower: 4 }), t, fester());
    expect(hitValues(ctx.events)).toEqual([6]);
    expect(t.statuses.stacks("bleeding")).toBe(4);
  });

  it("each hit of an attack reads the state at its own start (Bleed power 2: 5, then 11)", () => {
    // Target Burning 1. Hit 1: 4 x 1 + 1 = 5; then Bleeding 2. Hit 2: 4 x 2 + (1 + 2) = 11. 30 - 16 = 14.
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 1 } });
    resolveAttack(ctx, player({ bleedPower: 2 }), t, { hits: [fester(), fester()] });
    expect(hitValues(ctx.events)).toEqual([5, 11]);
    expect(t.hp).toBe(14);
  });

  it("a deflected scaling hit still reports its value and deals nothing", () => {
    const ctx = createCombatContext("fester");
    const t = enemy("e", { statuses: { burning: 3, warded: 1 } });
    resolveHit(ctx, player(), t, fester());
    // 4 x 1 + 3 = 7
    expect(hitValues(ctx.events)).toEqual([7]);
    expect(t.hp).toBe(30);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Consume: a normal typed hit dealing stacks x multiplier", () => {
  const combustion = { status: "burning", multiplier: 3, damageType: "arcane" } as const;

  it("Combustion on Burning 5: 5 x 3 = 15 arcane; all Burning removed; Consumed; returns true", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { burning: 5 } });
    const landed = resolveConsume(ctx, player(), t, combustion);
    expect(landed).toBe(true);
    expect(eventsOf(ctx.events, "HitStarted")).toEqual([{ type: "HitStarted", attacker: "p", target: "e", damageType: "arcane", value: 15 }]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "p", target: "e", damageType: "arcane", shieldDamage: 0, hpDamage: 15, piercing: false },
    ]);
    expect(t.hp).toBe(15);
    expect(t.statuses.stacks("burning")).toBe(0);
    expect(t.statuses.has("burning")).toBe(false);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 5 }]);
  });

  it("removes only the consumed status (Bleeding 2 and Poisoned 3 stay)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { maxHp: 50, statuses: { burning: 4, bleeding: 2, poisoned: 3 } });
    resolveConsume(ctx, player(), t, combustion);
    // 4 x 3 = 12
    expect(t.hp).toBe(38);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.stacks("poisoned")).toBe(3);
  });

  it("typed: arcane modifiers apply (Kindled 2: 15 x 1.5 = 22.5 -> 22), physical ones don't (Emboldened 4)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { maxHp: 50, statuses: { burning: 5 } });
    resolveConsume(ctx, player({ statuses: { kindled: 2, emboldened: 4 } }), t, combustion);
    expect(hitValues(ctx.events)).toEqual([22]);
    expect(t.hp).toBe(28);
  });

  it("a physical consume uses Emboldened/Enfeebled (Bleeding 4 x 2 = 8; Enfeebled 2: 8 x 0.5 = 4)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { bleeding: 4 } });
    resolveConsume(ctx, player({ statuses: { enfeebled: 2, kindled: 3 } }), t, { status: "bleeding", multiplier: 2, damageType: "physical" });
    expect(eventsOf(ctx.events, "HitStarted")[0]).toMatchObject({ damageType: "physical", value: 4 });
    expect(t.hp).toBe(26);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 4 }]);
  });

  it("Shield first: 15 against Shield 10 -> Shield 0, HP 30 - 5 = 25", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { maxShield: 10, statuses: { burning: 5 } });
    resolveConsume(ctx, player(), t, combustion);
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(25);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ shieldDamage: 10, hpDamage: 5, piercing: false });
  });

  it("piercing option: skips Shield (HP 30 - 15 = 15, Shield 10 kept)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { maxShield: 10, statuses: { burning: 5 } });
    resolveConsume(ctx, player(), t, { ...combustion, piercing: true });
    expect(t.shield).toBe(10);
    expect(t.hp).toBe(15);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ shieldDamage: 0, hpDamage: 15, piercing: true });
  });

  it("an attacker's Piercing charge applies to it too (one charge used)", () => {
    const ctx = createCombatContext("consume");
    const a = player({ statuses: { piercing: 2 } });
    const t = enemy("e", { maxShield: 10, statuses: { burning: 2 } });
    resolveConsume(ctx, a, t, combustion);
    // 2 x 3 = 6 straight to HP
    expect(t.hp).toBe(24);
    expect(t.shield).toBe(10);
    expect(a.statuses.stacks("piercing")).toBe(1);
  });

  it("Warded deflects it: no damage, stacks kept, no Consumed, Warded charge used, returns false", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { burning: 5, warded: 1 } });
    const landed = resolveConsume(ctx, player(), t, combustion);
    expect(landed).toBe(false);
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("burning")).toBe(5);
    expect(t.statuses.stacks("warded")).toBe(0);
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([{ type: "HitDeflected", attacker: "p", target: "e" }]);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([]);
  });

  it("a Piercing consume is never deflected: lands through Warded and removes the stacks", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { burning: 5, warded: 1 } });
    expect(resolveConsume(ctx, player(), t, { ...combustion, piercing: true })).toBe(true);
    expect(t.hp).toBe(15);
    expect(t.statuses.stacks("warded")).toBe(1);
    expect(t.statuses.has("burning")).toBe(false);
  });

  it("Thorns fires on it (it is a hit), even when deflected", () => {
    const ctx = createCombatContext("consume");
    const a = player();
    const t = enemy("e", { statuses: { burning: 5, thorns: 2, warded: 1 } });
    resolveConsume(ctx, a, t, combustion);
    expect(a.hp).toBe(28);
    expect(eventsOf(ctx.events, "ThornsDamage")).toEqual([{ type: "ThornsDamage", source: "e", target: "p", shieldDamage: 0, hpDamage: 2 }]);
  });

  it("Leeching heals from it (min(Leeching 4, 15) = 4)", () => {
    const ctx = createCombatContext("consume");
    const a = player({ hp: 10, statuses: { leeching: 4 } });
    resolveConsume(ctx, a, enemy("e", { statuses: { burning: 5 } }), combustion);
    expect(a.hp).toBe(14);
  });

  it("removes all stacks at the end of the hit, including those the hit added (Bleeding 4, Bleed power 2: hits for 8, removes 6)", () => {
    // Counted at the start: 4 x 2 = 8 physical. Step 7: Bleed power 2 -> Bleeding 6. End of hit: all 6 removed.
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { bleeding: 4 } });
    resolveConsume(ctx, player({ bleedPower: 2, stunPower: 1 }), t, { status: "bleeding", multiplier: 2, damageType: "physical" });
    expect(hitValues(ctx.events)).toEqual([8]);
    expect(t.hp).toBe(22);
    expect(t.statuses.stacks("bleeding")).toBe(0);
    expect(t.statuses.stacks("stunned")).toBe(1);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 6 }]);
    // The removal comes after the per-hit powers.
    const consumed = idx(ctx.events, (e) => e.type === "Consumed");
    const lastPower = ctx.events.map((e) => (e.type === "StatusApplied" && e.status === "stunned" ? 1 : 0)).lastIndexOf(1);
    expect(consumed).toBeGreaterThan(lastPower);
  });

  it("0 stacks at the start but some added by the hit: hits for 0, then removes what the hit added (Bleed power 3 -> Consumed 3)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy();
    expect(resolveConsume(ctx, player({ bleedPower: 3 }), t, { status: "bleeding", multiplier: 2, damageType: "physical" })).toBe(true);
    expect(hitValues(ctx.events)).toEqual([0]);
    expect(t.statuses.stacks("bleeding")).toBe(0);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 3 }]);
  });

  it("0 stacks: deals 0 but is still a hit (Thorns fires, DamageDealt 0/0, returns true)", () => {
    const ctx = createCombatContext("consume");
    const a = player();
    const t = enemy("e", { statuses: { thorns: 3 } });
    expect(resolveConsume(ctx, a, t, combustion)).toBe(true);
    expect(hitValues(ctx.events)).toEqual([0]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "p", target: "e", damageType: "arcane", shieldDamage: 0, hpDamage: 0, piercing: false },
    ]);
    expect(t.hp).toBe(30);
    expect(a.hp).toBe(27);
    // Nothing removed: no Consumed event.
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
  });

  it("0 stacks: per-hit powers still apply (Bleed power 2, Stun power 1)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy();
    resolveConsume(ctx, player({ bleedPower: 2, stunPower: 1 }), t, combustion);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.stacks("stunned")).toBe(1);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
  });

  it("per-hit powers apply to it (Bleed power 2, Stun power 3 on a landed Combustion)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { burning: 5 } });
    resolveConsume(ctx, player({ bleedPower: 2, stunPower: 3 }), t, combustion);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.stacks("stunned")).toBe(3);
  });

  it("is not an attack: no per-attack powers (Burn power 3 does not refill the consumed Burning)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { statuses: { burning: 5 } });
    resolveConsume(ctx, player({ burnPower: 3, poisonPower: 3, paralysisPower: 3 }), t, combustion);
    expect(t.statuses.has("burning")).toBe(false);
    expect(t.statuses.has("poisoned")).toBe(false);
    expect(t.statuses.has("paralysed")).toBe(false);
  });

  it("counts the stacks when the hit starts and removes them even if the target falls (Burning 5 x 3 on 10 HP)", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { hp: 10, statuses: { burning: 5 } });
    expect(resolveConsume(ctx, player(), t, combustion)).toBe(true);
    expect(t.fallen).toBe(true);
    expect(t.hp).toBe(0);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 5 }]);
  });

  it("against a fallen target, or by a fallen attacker, does nothing: no events, stacks kept, returns false", () => {
    const ctx = createCombatContext("consume");
    const dead = enemy("e", { hp: 0, statuses: { burning: 5 } });
    expect(resolveConsume(ctx, player(), dead, combustion)).toBe(false);
    expect(dead.statuses.stacks("burning")).toBe(5);
    const t = enemy("e2", { statuses: { burning: 5 } });
    expect(resolveConsume(ctx, player({ hp: 0 }), t, combustion)).toBe(false);
    expect(t.statuses.stacks("burning")).toBe(5);
    expect(t.hp).toBe(30);
    expect(ctx.events).toEqual([]);
  });

  it("a second consume right after finds 0 stacks and deals 0", () => {
    const ctx = createCombatContext("consume");
    const t = enemy("e", { maxHp: 50, statuses: { burning: 5 } });
    resolveConsume(ctx, player(), t, combustion);
    resolveConsume(ctx, player(), t, combustion);
    expect(hitValues(ctx.events)).toEqual([15, 0]);
    expect(t.hp).toBe(35);
    expect(eventsOf(ctx.events, "Consumed")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Convert triggers: when something happens to a unit, it gains a status", () => {
  describe("deflect (my Warded charge is used)", () => {
    it("Mirror Ward: each deflect gives +1 Thorns; exact order ChargeUsed, HitDeflected, TriggerFired (depth 1), StatusApplied", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { warded: 1 }, ...converts({ on: "deflect", gain: "thorns", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(5));
      expect(t.statuses.stacks("thorns")).toBe(1);
      expect(ctx.events).toEqual([
        { type: "HitStarted", attacker: "p", target: "e", damageType: "physical", value: 5 },
        { type: "ChargeUsed", unit: "e", status: "warded", left: 0 },
        { type: "HitDeflected", attacker: "p", target: "e" },
        { type: "TriggerFired", unit: "e", on: "deflect", gain: "thorns", stacks: 1, depth: 1 },
        { type: "StatusApplied", unit: "e", status: "thorns", stacks: 1, total: 1 },
      ]);
    });

    it("the Thorns gained on a deflect fires on the next hit, not on the deflected one (Warded 2, three hits)", () => {
      // Hit 1: Thorns 0 -> none; deflected -> Thorns 1. Hit 2: Thorns 1 -> attacker 29; deflected -> Thorns 2.
      // Hit 3: Thorns 2 -> attacker 27; lands: 5 -> target 25.
      const ctx = createCombatContext("convert");
      const a = player();
      const t = enemy("e", { statuses: { warded: 2 }, ...converts({ on: "deflect", gain: "thorns", stacks: 1 }) });
      resolveAttack(ctx, a, t, { hits: [phys(5), phys(5), phys(5)] });
      expect(eventsOf(ctx.events, "ThornsDamage").map((e) => e.hpDamage)).toEqual([1, 2]);
      expect(a.hp).toBe(27);
      expect(t.hp).toBe(25);
      expect(t.statuses.stacks("thorns")).toBe(2);
      expect(eventsOf(ctx.events, "TriggerFired")).toHaveLength(2);
    });

    it("no Warded charge used (a Piercing hit, or no Warded): no trigger", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { warded: 1 }, ...converts({ on: "deflect", gain: "thorns", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(5, { piercing: true }));
      const t2 = enemy("e2", converts({ on: "deflect", gain: "thorns", stacks: 1 }));
      resolveHit(ctx, player(), t2, phys(5));
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
      expect(t.statuses.has("thorns")).toBe(false);
      expect(t2.statuses.has("thorns")).toBe(false);
    });

    it("an attacker whose own hit is deflected does not fire its deflect trigger", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "deflect", gain: "thorns", stacks: 1 }));
      resolveHit(ctx, a, enemy("e", { statuses: { warded: 1 } }), phys(5));
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
      expect(a.statuses.has("thorns")).toBe(false);
    });

    it("a deflected consume fires it too", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { warded: 1, burning: 4 }, ...converts({ on: "deflect", gain: "thorns", stacks: 1 }) });
      resolveConsume(ctx, player(), t, { status: "burning", multiplier: 3, damageType: "arcane" });
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([{ type: "TriggerFired", unit: "e", on: "deflect", gain: "thorns", stacks: 1, depth: 1 }]);
    });
  });

  describe("attacked (at the end of the hit, after step 7 and the per-hit powers; whether or not the hit lands)", () => {
    it("fires last: after Thorns, damage, the hit's statuses, Bleed power and Stun power", () => {
      const ctx = createCombatContext("convert");
      const a = player({ bleedPower: 1, stunPower: 1 });
      const t = enemy("e", { statuses: { thorns: 1 }, ...converts({ on: "attacked", gain: "kindled", stacks: 2 }) });
      resolveHit(ctx, a, t, phys(4, { statuses: [{ status: "burning", stacks: 1 }] }));
      expect(t.statuses.stacks("kindled")).toBe(2);
      expect(ctx.events).toEqual([
        { type: "HitStarted", attacker: "p", target: "e", damageType: "physical", value: 4 },
        { type: "ThornsDamage", source: "e", target: "p", shieldDamage: 0, hpDamage: 1 },
        { type: "DamageDealt", attacker: "p", target: "e", damageType: "physical", shieldDamage: 0, hpDamage: 4, piercing: false },
        { type: "StatusApplied", unit: "e", status: "burning", stacks: 1, total: 1 },
        { type: "StatusApplied", unit: "e", status: "bleeding", stacks: 1, total: 1 },
        { type: "StatusApplied", unit: "e", status: "stunned", stacks: 1, total: 1 },
        { type: "TriggerFired", unit: "e", on: "attacked", gain: "kindled", stacks: 2, depth: 1 },
        { type: "StatusApplied", unit: "e", status: "kindled", stacks: 2, total: 2 },
      ]);
    });

    it("fires on a deflected hit, after the deflect", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { warded: 1 }, ...converts({ on: "attacked", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(4));
      expect(t.statuses.stacks("kindled")).toBe(1);
      expect(ctx.events).toEqual([
        { type: "HitStarted", attacker: "p", target: "e", damageType: "physical", value: 4 },
        { type: "ChargeUsed", unit: "e", status: "warded", left: 0 },
        { type: "HitDeflected", attacker: "p", target: "e" },
        { type: "TriggerFired", unit: "e", on: "attacked", gain: "kindled", stacks: 1, depth: 1 },
        { type: "StatusApplied", unit: "e", status: "kindled", stacks: 1, total: 1 },
      ]);
    });

    it("on a deflected hit, the deflect trigger fires before the attacked trigger", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", {
        statuses: { warded: 1 },
        ...converts({ on: "attacked", gain: "kindled", stacks: 1 }, { on: "deflect", gain: "thorns", stacks: 1 }),
      });
      resolveHit(ctx, player(), t, phys(4));
      expect(eventsOf(ctx.events, "TriggerFired").map((e) => e.on)).toEqual(["deflect", "attacked"]);
    });

    it("never changes the hit that set it off: a Warded gained when attacked doesn't deflect that hit, only the next", () => {
      // Hit 1: lands, 30 - 6 = 24; then Warded 1 gained. Hit 2: deflected (Warded 1 -> 0), then Warded 1 gained again.
      const ctx = createCombatContext("convert");
      const t = enemy("e", converts({ on: "attacked", gain: "warded", stacks: 1 }));
      resolveHit(ctx, player(), t, phys(6));
      expect(t.hp).toBe(24);
      expect(t.statuses.stacks("warded")).toBe(1);
      expect(eventsOf(ctx.events, "HitDeflected")).toEqual([]);
      resolveHit(ctx, player(), t, phys(6));
      expect(t.hp).toBe(24);
      expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(1);
      expect(t.statuses.stacks("warded")).toBe(1);
    });

    it("a Thorns gained when attacked doesn't fire on that hit (Thorns fired at step 3), only on the next", () => {
      const ctx = createCombatContext("convert");
      const a = player();
      const t = enemy("e", converts({ on: "attacked", gain: "thorns", stacks: 2 }));
      resolveAttack(ctx, a, t, { hits: [phys(1), phys(1)] });
      // Hit 1: no Thorns; gains 2. Hit 2: Thorns 2 -> attacker 28; gains 2 more -> 4.
      expect(eventsOf(ctx.events, "ThornsDamage").map((e) => e.hpDamage)).toEqual([2]);
      expect(a.hp).toBe(28);
      expect(t.statuses.stacks("thorns")).toBe(4);
    });

    it("fires once per hit (two-hit attack: Emboldened 1 + 1 = 2)", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", converts({ on: "attacked", gain: "emboldened", stacks: 1 }));
      resolveAttack(ctx, player(), t, { hits: [phys(1), phys(1)] });
      expect(t.statuses.stacks("emboldened")).toBe(2);
      expect(eventsOf(ctx.events, "TriggerFired").map((e) => e.depth)).toEqual([1, 1]);
    });

    it("fires on a Piercing hit and on a 0-damage hit", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { warded: 1 }, ...converts({ on: "attacked", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(3, { piercing: true }));
      resolveHit(ctx, player(), t, phys(0, { piercing: true }));
      expect(t.statuses.stacks("kindled")).toBe(2);
    });

    it("the attacker's attacked trigger does not fire when it attacks", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "attacked", gain: "kindled", stacks: 1 }));
      resolveHit(ctx, a, enemy(), phys(3));
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
    });
  });

  describe("dealtDamage (step 6, after Leeching; only when damage > 0)", () => {
    it("fires for the attacker after Healed and before the hit's own statuses", () => {
      // Attacker 20 HP, Leeching 2. Hit 5 carrying Burning 1: DamageDealt, Healed 2, TriggerFired, StatusApplied
      // (emboldened, on the attacker), then StatusApplied (burning, on the target).
      const ctx = createCombatContext("convert");
      const a = player({ hp: 20, statuses: { leeching: 2 }, ...converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }) });
      resolveHit(ctx, a, enemy(), phys(5, { statuses: [{ status: "burning", stacks: 1 }] }));
      expect(ctx.events.slice(1)).toEqual([
        { type: "DamageDealt", attacker: "p", target: "e", damageType: "physical", shieldDamage: 0, hpDamage: 5, piercing: false },
        { type: "Healed", unit: "p", amount: 2 },
        { type: "TriggerFired", unit: "p", on: "dealtDamage", gain: "emboldened", stacks: 1, depth: 1 },
        { type: "StatusApplied", unit: "p", status: "emboldened", stacks: 1, total: 1 },
        { type: "StatusApplied", unit: "e", status: "burning", stacks: 1, total: 1 },
      ]);
    });

    it("damage to Shield counts", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }));
      const t = enemy("e", { maxShield: 10 });
      resolveHit(ctx, a, t, phys(3));
      expect(t.hp).toBe(30);
      expect(a.statuses.stacks("emboldened")).toBe(1);
    });

    it("a 0-damage hit or a deflected hit: no trigger", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }));
      resolveHit(ctx, a, enemy(), phys(0));
      resolveHit(ctx, a, enemy("e2", { statuses: { warded: 1 } }), phys(5));
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
      expect(a.statuses.has("emboldened")).toBe(false);
    });

    it("the gain is in place for the next hit of the attack (8, then 8 x 1.25 = 10)", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }));
      const t = enemy();
      resolveAttack(ctx, a, t, { hits: [phys(8), phys(8)] });
      expect(hitValues(ctx.events)).toEqual([8, 10]);
      expect(t.hp).toBe(12);
      expect(a.statuses.stacks("emboldened")).toBe(2);
    });

    it("the target's dealtDamage trigger does not fire when it is hit", () => {
      const ctx = createCombatContext("convert");
      resolveHit(ctx, player(), enemy("e", converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 })), phys(5));
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
    });
  });

  describe("tookDamage (step 6, after Leeching; only when damage > 0)", () => {
    it("fires for the target after Healed and before the hit's own statuses", () => {
      const ctx = createCombatContext("convert");
      const a = player({ hp: 20, statuses: { leeching: 2 } });
      const t = enemy("e", converts({ on: "tookDamage", gain: "thorns", stacks: 2 }));
      resolveHit(ctx, a, t, phys(5, { statuses: [{ status: "burning", stacks: 1 }] }));
      expect(ctx.events.slice(1)).toEqual([
        { type: "DamageDealt", attacker: "p", target: "e", damageType: "physical", shieldDamage: 0, hpDamage: 5, piercing: false },
        { type: "Healed", unit: "p", amount: 2 },
        { type: "TriggerFired", unit: "e", on: "tookDamage", gain: "thorns", stacks: 2, depth: 1 },
        { type: "StatusApplied", unit: "e", status: "thorns", stacks: 2, total: 2 },
        { type: "StatusApplied", unit: "e", status: "burning", stacks: 1, total: 1 },
      ]);
    });

    it("step 6 order: Healed, then the attacker's dealtDamage triggers, then the target's tookDamage triggers, then step 7", () => {
      const ctx = createCombatContext("convert");
      const a = player({ hp: 20, statuses: { leeching: 2 }, ...converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }) });
      const t = enemy("e", converts({ on: "tookDamage", gain: "thorns", stacks: 2 }));
      resolveHit(ctx, a, t, phys(5, { statuses: [{ status: "burning", stacks: 1 }] }));
      expect(ctx.events.slice(1)).toEqual([
        { type: "DamageDealt", attacker: "p", target: "e", damageType: "physical", shieldDamage: 0, hpDamage: 5, piercing: false },
        { type: "Healed", unit: "p", amount: 2 },
        { type: "TriggerFired", unit: "p", on: "dealtDamage", gain: "emboldened", stacks: 1, depth: 1 },
        { type: "StatusApplied", unit: "p", status: "emboldened", stacks: 1, total: 1 },
        { type: "TriggerFired", unit: "e", on: "tookDamage", gain: "thorns", stacks: 2, depth: 1 },
        { type: "StatusApplied", unit: "e", status: "thorns", stacks: 2, total: 2 },
        { type: "StatusApplied", unit: "e", status: "burning", stacks: 1, total: 1 },
      ]);
    });

    it("the Thorns gained fire on the next hit (two hits: Thorns 0, then 2 -> attacker 28; Thorns 2 + 2 = 4)", () => {
      const ctx = createCombatContext("convert");
      const a = player();
      const t = enemy("e", converts({ on: "tookDamage", gain: "thorns", stacks: 2 }));
      resolveAttack(ctx, a, t, { hits: [phys(3), phys(3)] });
      expect(eventsOf(ctx.events, "ThornsDamage").map((e) => e.hpDamage)).toEqual([2]);
      expect(a.hp).toBe(28);
      expect(t.statuses.stacks("thorns")).toBe(4);
    });

    it("damage to Shield counts; a 0-damage hit and a deflected hit don't", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { maxShield: 10, ...converts({ on: "tookDamage", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(3)); // Shield 10 -> 7: fires
      resolveHit(ctx, player(), t, phys(0)); // 0 damage: no
      t.statuses.add("warded", 1);
      resolveHit(ctx, player(), t, phys(4)); // deflected: no
      expect(t.shield).toBe(7);
      expect(t.statuses.stacks("kindled")).toBe(1);
      expect(eventsOf(ctx.events, "TriggerFired")).toHaveLength(1);
    });

    it("a consume that deals damage fires it", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { statuses: { burning: 2 }, ...converts({ on: "tookDamage", gain: "kindled", stacks: 1 }) });
      resolveConsume(ctx, player(), t, { status: "burning", multiplier: 3, damageType: "arcane" });
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([{ type: "TriggerFired", unit: "e", on: "tookDamage", gain: "kindled", stacks: 1, depth: 1 }]);
    });
  });

  describe("what does not fire converts", () => {
    it("Thorns damage: no tookDamage or attacked trigger for the attacker, no dealtDamage trigger for the Thorns owner", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "tookDamage", gain: "kindled", stacks: 1 }, { on: "attacked", gain: "emboldened", stacks: 1 }));
      const t = enemy("e", { statuses: { thorns: 3 }, ...converts({ on: "dealtDamage", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, a, t, phys(2));
      expect(a.hp).toBe(27);
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
      expect(a.statuses.has("kindled")).toBe(false);
      expect(a.statuses.has("emboldened")).toBe(false);
      expect(t.statuses.has("kindled")).toBe(false);
    });

    it("damage over time at turn start: no tookDamage (or any) trigger", () => {
      const p = player({
        maxShield: 2,
        statuses: { burning: 2, bleeding: 2, poisoned: 2 },
        ...converts({ on: "tookDamage", gain: "kindled", stacks: 1 }, { on: "attacked", gain: "emboldened", stacks: 1 }),
      });
      const { ctx, state } = fight([p, enemy()]);
      const ev = during(ctx, () => startTurn(state));
      // 2 + 2 + 2 = 6 damage: 2 Shield + 4 HP
      expect(p.hp).toBe(26);
      expect(eventsOf(ev, "TriggerFired")).toEqual([]);
      expect(eventsOf(ev, "StatusApplied")).toEqual([]);
      expect(p.statuses.has("kindled")).toBe(false);
    });

    it("a target killed by the hit fires no tookDamage or attacked trigger", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", { hp: 3, ...converts({ on: "tookDamage", gain: "thorns", stacks: 2 }, { on: "attacked", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, player(), t, phys(5));
      expect(t.fallen).toBe(true);
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([]);
      expect(t.statuses.has("thorns")).toBe(false);
      expect(t.statuses.has("kindled")).toBe(false);
    });

    it("an attacker killed by Thorns fires no dealtDamage trigger (the living target's triggers still fire)", () => {
      // Attacker 2 HP vs Thorns 5: falls at step 3; the hit still deals 5 (30 -> 25), so the target took damage.
      const ctx = createCombatContext("convert");
      const a = player({ hp: 2, ...converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }) });
      const t = enemy("e", { statuses: { thorns: 5 }, ...converts({ on: "tookDamage", gain: "kindled", stacks: 1 }) });
      resolveHit(ctx, a, t, phys(5));
      expect(a.fallen).toBe(true);
      expect(t.hp).toBe(25);
      expect(a.statuses.has("emboldened")).toBe(false);
      expect(eventsOf(ctx.events, "TriggerFired")).toEqual([{ type: "TriggerFired", unit: "e", on: "tookDamage", gain: "kindled", stacks: 1, depth: 1 }]);
    });

    it("hits by or against a fallen unit: nothing", () => {
      const ctx = createCombatContext("convert");
      const all = converts(
        { on: "attacked", gain: "kindled", stacks: 1 },
        { on: "tookDamage", gain: "kindled", stacks: 1 },
        { on: "deflect", gain: "kindled", stacks: 1 },
      );
      resolveHit(ctx, player(), enemy("e", { hp: 0, statuses: { warded: 1 }, ...all }), phys(5));
      resolveHit(ctx, player({ hp: 0, ...converts({ on: "dealtDamage", gain: "kindled", stacks: 1 }) }), enemy(), phys(5));
      expect(ctx.events).toEqual([]);
    });
  });

  describe("gains and depth", () => {
    it("the gain is the owner's own status: no resistance (Enfeebled 3 gained by a Vitality 7 unit stays 3)", () => {
      // Spec 1.5, Trigger details: "The status gained is the unit's own, so resistance doesn't apply."
      const ctx = createCombatContext("convert");
      const t = enemy("e", { stats: { vitality: 7 }, ...converts({ on: "attacked", gain: "enfeebled", stacks: 3 }) });
      resolveHit(ctx, player(), t, phys(1));
      expect(t.statuses.stacks("enfeebled")).toBe(3);
      expect(eventsOf(ctx.events, "StatusResisted")).toEqual([]);
    });

    it("several converts on one unit each fire (attacked -> Kindled 1, tookDamage -> Thorns 2)", () => {
      const ctx = createCombatContext("convert");
      const t = enemy("e", converts({ on: "attacked", gain: "kindled", stacks: 1 }, { on: "tookDamage", gain: "thorns", stacks: 2 }));
      resolveHit(ctx, player(), t, phys(3));
      expect(t.statuses.stacks("kindled")).toBe(1);
      expect(t.statuses.stacks("thorns")).toBe(2);
      // tookDamage at step 6, attacked at the end of the hit
      expect(eventsOf(ctx.events, "TriggerFired").map((e) => [e.on, e.depth])).toEqual([
        ["tookDamage", 1],
        ["attacked", 1],
      ]);
    });

    it("both sides' triggers in one hit: every trigger fired directly by the hit is depth 1; nothing is capped", () => {
      const ctx = createCombatContext("convert");
      const a = player(converts({ on: "dealtDamage", gain: "emboldened", stacks: 1 }));
      const t = enemy("e", converts({ on: "attacked", gain: "kindled", stacks: 1 }, { on: "tookDamage", gain: "thorns", stacks: 1 }));
      resolveAttack(ctx, a, t, { hits: [phys(2), phys(2), phys(2)] });
      const fired = eventsOf(ctx.events, "TriggerFired");
      expect(fired).toHaveLength(9);
      expect(fired.every((e) => e.depth === 1)).toBe(true);
      expect(eventsOf(ctx.events, "TriggerCapped")).toEqual([]);
    });

    it("a unit without converts has empty traits", () => {
      const p = player();
      expect(p.traits.converts ?? []).toEqual([]);
      expect(p.traits.slowDecay ?? []).toEqual([]);
      expect(p.traits.decayFloors ?? {}).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("Slow decay: enemy DoTs lose their stack only on even rounds while a living holder is on the other side", () => {
  // Spec 1.6: Plague Censer = slow decay of the other side's damage over time.
  const censer = { traits: { slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }] } } as const;

  /** Plays rounds with no actions; records the given unit's DoT stacks and damage after each of its turn starts. */
  function watch(state: CombatState, unit: CombatUnit, rounds: number, status: StatusId) {
    const stacks: number[] = [];
    const damage: number[] = [];
    const roundsSeen: number[] = [];
    while (stacks.length < rounds && !state.over) {
      if (state.active === unit) {
        roundsSeen.push(state.round);
        const ev = during(state.ctx, () => startTurn(state));
        stacks.push(unit.statuses.stacks(status));
        damage.push(eventsOf(ev, "DotDamage").filter((d) => d.status === status).reduce((n, d) => n + d.shieldDamage + d.hpDamage, 0));
        if (state.active === unit) endTurn(state);
      } else {
        pass(state);
      }
    }
    return { stacks, damage, roundsSeen };
  }

  it("player holder, enemy Burning 3: damage 3, 3, 2, 2, 1, 1 (12 total); stacks 3, 2, 2, 1, 1, 0", () => {
    // Round 1 (odd): 3 damage, keeps 3. Round 2 (even): 3 damage, -> 2. Round 3: 2, keeps 2. Round 4: 2, -> 1.
    // Round 5: 1, keeps 1. Round 6: 1, -> 0. 3 + 3 + 2 + 2 + 1 + 1 = 12; HP 50 -> 38.
    const e = enemy("e", { maxHp: 50, statuses: { burning: 3 } });
    const { state } = fight([player(censer), e], "slow-decay");
    const r = watch(state, e, 6, "burning");
    expect(r.roundsSeen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.damage).toEqual([3, 3, 2, 2, 1, 1]);
    expect(r.stacks).toEqual([3, 2, 2, 1, 1, 0]);
    expect(e.hp).toBe(38);
    expect(e.statuses.has("burning")).toBe(false);
  });

  it("without a holder the same Burning 3 decays every turn: 3, 2, 1 (6 total)", () => {
    const e = enemy("e", { maxHp: 50, statuses: { burning: 3 } });
    const { state } = fight([player(), e], "no-slow-decay");
    const r = watch(state, e, 3, "burning");
    expect(r.damage).toEqual([3, 2, 1]);
    expect(r.stacks).toEqual([2, 1, 0]);
    expect(e.hp).toBe(44);
  });

  it("applies to all three DoTs (Burning 2, Bleeding 2, Poisoned 2): round 1 keeps all, round 2 loses one each", () => {
    const e = enemy("e", { maxHp: 50, statuses: { burning: 2, bleeding: 2, poisoned: 2 } });
    const { state } = fight([player(censer), e], "slow-decay-all");
    watch(state, e, 1, "burning");
    // Round 1: 2 + 2 + 2 = 6 damage, stacks kept
    expect(e.hp).toBe(44);
    expect([e.statuses.stacks("burning"), e.statuses.stacks("bleeding"), e.statuses.stacks("poisoned")]).toEqual([2, 2, 2]);
    watch(state, e, 1, "burning");
    // Round 2: 6 more damage, each -> 1
    expect(e.hp).toBe(38);
    expect([e.statuses.stacks("burning"), e.statuses.stacks("bleeding"), e.statuses.stacks("poisoned")]).toEqual([1, 1, 1]);
  });

  it("enemy holder, player Poisoned 4: the player's DoT slows the same way (4 kept, then 3)", () => {
    const p = player({ maxHp: 50, statuses: { poisoned: 4 } });
    const { state } = fight([p, enemy("e", censer)], "slow-decay-enemy");
    const r = watch(state, p, 4, "poisoned");
    // Round 1: 4, keeps 4. Round 2: 4, -> 3. Round 3: 3, keeps 3. Round 4: 3, -> 2. 4 + 4 + 3 + 3 = 14.
    expect(r.damage).toEqual([4, 4, 3, 3]);
    expect(r.stacks).toEqual([4, 3, 3, 2]);
    expect(p.hp).toBe(36);
  });

  it("the holder's own DoTs and its allies' decay normally", () => {
    const e1 = enemy("e1", { maxHp: 50, statuses: { burning: 3 }, ...censer });
    const e2 = enemy("e2", { maxHp: 50, statuses: { bleeding: 3 } });
    const { state } = fight([player(), e1, e2], "slow-decay-own");
    pass(state); // p
    pass(state); // e1: Burning 3 -> 2
    pass(state); // e2: Bleeding 3 -> 2
    expect(e1.statuses.stacks("burning")).toBe(2);
    expect(e2.statuses.stacks("bleeding")).toBe(2);
  });

  it("does not slow ticking statuses that are not DoTs (enemy Emboldened 3 -> 2 at its round-1 turn end)", () => {
    const e = enemy("e", { statuses: { emboldened: 3, thorns: 2 } });
    const { state } = fight([player(censer), e], "slow-decay-ticking");
    pass(state); // p
    pass(state); // e
    expect(e.statuses.stacks("emboldened")).toBe(2);
    expect(e.statuses.stacks("thorns")).toBe(1);
  });

  it("no effect once the holder has fallen (player Burning 4: kept in round 1, then -1 in rounds 2 and 3)", () => {
    // Round 1: p takes 4 (30 -> 26), keeps 4 (e1 holder alive). p kills e1. Round 2: 4 (-> 22), -> 3.
    // Round 3: 3 (-> 19), -> 2: the holder has fallen, so the odd round no longer keeps the stack.
    const p = player({ statuses: { burning: 4 } });
    const e1 = enemy("e1", { hp: 5, ...censer });
    const { ctx, state } = fight([p, e1, enemy("e2")], "slow-decay-fallen");
    startTurn(state);
    expect(p.statuses.stacks("burning")).toBe(4);
    resolveHit(ctx, p, e1, phys(10));
    expect(e1.fallen).toBe(true);
    endTurn(state);
    expect(activeId(state)).toBe("e2");
    pass(state); // e2
    const r = watch(state, p, 2, "burning");
    expect(r.roundsSeen).toEqual([2, 3]);
    expect(r.damage).toEqual([4, 3]);
    expect(r.stacks).toEqual([3, 2]);
    expect(p.hp).toBe(19);
  });

  it("several holders don't stack: two holders give the same result as one", () => {
    const run = (holders: number): number[] => {
      const p = player({ maxHp: 50, statuses: { burning: 4 } });
      const units = [p, enemy("e1", holders >= 1 ? censer : {}), enemy("e2", holders >= 2 ? censer : {})];
      const { state } = fight(units, `slow-decay-${holders}`);
      return watch(state, p, 4, "burning").stacks;
    };
    // 4 kept, -> 3, kept, -> 2
    expect(run(1)).toEqual([4, 3, 3, 2]);
    expect(run(2)).toEqual([4, 3, 3, 2]);
    expect(run(0)).toEqual([3, 2, 1, 0]);
  });

  it("a DoT at 1 stack on an odd round deals 1 and stays at 1 (not removed)", () => {
    const e = enemy("e", { statuses: { bleeding: 1 } });
    const { ctx, state } = fight([player(censer), e], "slow-decay-one");
    pass(state); // p
    const ev = during(ctx, () => startTurn(state));
    expect(e.hp).toBe(29);
    expect(e.statuses.stacks("bleeding")).toBe(1);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([]);
  });

  it("fresh stacks applied during the fight follow the same rule (Burn power 2 against a slowed enemy)", () => {
    // R1: p adds 2 -> e takes 2, keeps 2. R2: p adds 2 -> 4; e takes 4, -> 3. R3: 5; takes 5, keeps 5. 2 + 4 + 5 = 11.
    const p = player({ burnPower: 2, ...censer });
    const e = enemy("e", { maxHp: 50 });
    const { ctx, state } = fight([p, e], "slow-decay-burn-power");
    const after: number[] = [];
    for (let r = 0; r < 3; r++) {
      startTurn(state);
      resolveAttack(ctx, p, e, { hits: [phys(0)] });
      endTurn(state);
      startTurn(state);
      after.push(e.statuses.stacks("burning"));
      endTurn(state);
    }
    expect(after).toEqual([2, 3, 5]);
    expect(e.hp).toBe(39);
  });
});
