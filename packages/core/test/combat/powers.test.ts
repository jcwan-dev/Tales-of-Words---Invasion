import { describe, expect, it } from "vitest";
import { createCombatContext, endTurn, resolveAttack, resolveHit, startTurn, type CombatEvent, type StatusId } from "../../src/index.ts";
import { eventsOf } from "./helpers.ts";
import { arc, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Spec 1.5, "Powers" (with "Hit order" step 7 and "Stun and paralysis").
//   | Bleed power X     | Bleeding X | Every hit that lands             | Never drops |
//   | Burn power X      | Burning X  | Once per attack, if a hit landed | Never drops |
//   | Poison power X    | Poisoned X | Once per attack, if a hit landed | Never drops |
//   "Per-hit powers are added at hit step 7, after the hit's own statuses: Bleed power, then Stun power.
//    Per-attack powers are added after the attack's last hit: Burn, Poison, then Paralysis power."
//   "Powers follow the hit rules: no stacks from a deflected hit; a 0-damage hit still adds them; power 0 adds
//    nothing; resistance applies to each application (minimum 1). Per-attack powers are not added if the
//    attacker or the target has fallen by the end of the attack."

const applied = (events: readonly CombatEvent[], status: StatusId): [number, number][] =>
  eventsOf(events, "StatusApplied").filter((e) => e.status === status).map((e) => [e.stacks, e.total]);

const appliedOrder = (events: readonly CombatEvent[]): StatusId[] => eventsOf(events, "StatusApplied").map((e) => e.status);

describe("Unit attributes: Bleed, Burn and Poison power", () => {
  it("default to 0", () => {
    const p = player();
    expect(p.bleedPower).toBe(0);
    expect(p.burnPower).toBe(0);
    expect(p.poisonPower).toBe(0);
  });

  it("are set from the unit's init", () => {
    const p = player({ bleedPower: 2, burnPower: 3, poisonPower: 4 });
    expect(p.bleedPower).toBe(2);
    expect(p.burnPower).toBe(3);
    expect(p.poisonPower).toBe(4);
  });
});

describe("Bleed power: every hit that lands adds X Bleeding", () => {
  it("one hit adds Bleed power once (resolveHit)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy();
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(3));
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(applied(ctx.events, "bleeding")).toEqual([[2, 2]]);
  });

  it("a two-hit attack adds it twice (2 + 2 = 4)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy();
    resolveAttack(ctx, player({ bleedPower: 2 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("bleeding")).toBe(4);
    expect(applied(ctx.events, "bleeding")).toEqual([[2, 2], [2, 4]]);
  });

  it("adds to existing Bleeding (3 + 2 = 5)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { statuses: { bleeding: 3 } });
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(1));
    expect(t.statuses.stacks("bleeding")).toBe(5);
    expect(applied(ctx.events, "bleeding")).toEqual([[2, 5]]);
  });

  it("works with any damage type: an arcane hit adds it too", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy();
    resolveHit(ctx, player({ bleedPower: 3 }), t, arc(4));
    expect(t.statuses.stacks("bleeding")).toBe(3);
  });

  it("a 0-damage hit still adds it (amount 0, and a hit reduced to 0 by Enfeebled 4)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy();
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(0));
    // 10 * (1 - 0.25 * 4) = 0
    resolveHit(ctx, player({ bleedPower: 2, statuses: { enfeebled: 4 } }), t, phys(10));
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("bleeding")).toBe(4);
  });

  it("a hit fully absorbed by Shield still adds it", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { maxShield: 10 });
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(4));
    expect(t.hp).toBe(30);
    expect(t.shield).toBe(6);
    expect(t.statuses.stacks("bleeding")).toBe(2);
  });

  it("is added even if the target fell during that hit", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { hp: 2 });
    resolveHit(ctx, player({ bleedPower: 3 }), t, phys(5));
    expect(t.fallen).toBe(true);
    expect(t.statuses.stacks("bleeding")).toBe(3);
    expect(ctx.events.at(-1)).toEqual({ type: "StatusApplied", unit: "e", status: "bleeding", stacks: 3, total: 3 });
  });

  it("a hit always finishes: added even if the attacker fell to Thorns at step 3 of that hit", () => {
    // Attacker 2 HP vs Thorns 5: falls at step 3; steps 4-7 still run, so Bleed power 2 is added.
    const ctx = createCombatContext("bleed");
    const a = player({ hp: 2, bleedPower: 2 });
    const t = enemy("e", { statuses: { thorns: 5 } });
    resolveHit(ctx, a, t, phys(3));
    expect(a.fallen).toBe(true);
    expect(t.hp).toBe(27);
    expect(t.statuses.stacks("bleeding")).toBe(2);
  });

  it("a deflected hit adds none", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveHit(ctx, player({ bleedPower: 4 }), t, phys(5));
    expect(t.statuses.has("bleeding")).toBe(false);
    expect(applied(ctx.events, "bleeding")).toEqual([]);
  });

  it("two hits against Warded 1: the first is deflected, only the second adds Bleed power", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveAttack(ctx, player({ bleedPower: 4 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("bleeding")).toBe(4);
    expect(applied(ctx.events, "bleeding")).toEqual([[4, 4]]);
  });

  it("a Piercing hit is never deflected, so it adds Bleed power through Warded", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(1, { piercing: true }));
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(t.statuses.stacks("warded")).toBe(1);
  });

  it("is resisted by Vitality, each application on its own (Bleed power 5 vs Vitality 4 -> 3 per hit)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { stats: { vitality: 4 } });
    resolveAttack(ctx, player({ bleedPower: 5 }), t, { hits: [phys(1), phys(1)] });
    // Vitality 4 removes 4 - 2 = 2 per application: 5 - 2 = 3, twice = 6
    expect(t.statuses.stacks("bleeding")).toBe(6);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([
      { type: "StatusResisted", unit: "e", status: "bleeding", removed: 2 },
      { type: "StatusResisted", unit: "e", status: "bleeding", removed: 2 },
    ]);
  });

  it("resistance leaves a minimum of 1 (Bleed power 2 vs Vitality 7 -> 1)", () => {
    // Vitality 7 would remove 5; 2 - 5 < 1 -> 1
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { stats: { vitality: 7 } });
    resolveHit(ctx, player({ bleedPower: 2 }), t, phys(1));
    expect(t.statuses.stacks("bleeding")).toBe(1);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "e", status: "bleeding", removed: 1 }]);
  });

  it("is not resisted by another stat (Bleed power 3 vs Arcana 7 and Wisdom 7 -> 3)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { stats: { arcana: 7, wisdom: 7 } });
    resolveHit(ctx, player({ bleedPower: 3 }), t, phys(1));
    expect(t.statuses.stacks("bleeding")).toBe(3);
  });

  it("Bleed power 0 adds nothing (no StatusApplied)", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy();
    resolveHit(ctx, player(), t, phys(3));
    expect(t.statuses.has("bleeding")).toBe(false);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("a hit against a fallen unit adds nothing", () => {
    const ctx = createCombatContext("bleed");
    const t = enemy("e", { hp: 0 });
    resolveHit(ctx, player({ bleedPower: 3 }), t, phys(1));
    expect(t.statuses.stacks("bleeding")).toBe(0);
    expect(ctx.events).toEqual([]);
  });

  it("does not add Bleeding to the attacker", () => {
    const ctx = createCombatContext("bleed");
    const a = player({ bleedPower: 3 });
    resolveHit(ctx, a, enemy(), phys(1));
    expect(a.statuses.has("bleeding")).toBe(false);
  });
});

describe("Per-hit order at step 7: the hit's statuses, then Bleed power, then Stun power", () => {
  it("hit carries Burning 2 and Bleeding 3; Bleed power 2; Stun power 1", () => {
    // Bleeding: 3 (hit) + 2 (power) = 5. Stunned 1.
    const ctx = createCombatContext("order");
    const t = enemy();
    resolveHit(ctx, player({ bleedPower: 2, stunPower: 1 }), t, phys(4, { statuses: [{ status: "burning", stacks: 2 }, { status: "bleeding", stacks: 3 }] }));
    expect(eventsOf(ctx.events, "StatusApplied").map((e) => [e.status, e.stacks, e.total])).toEqual([
      ["burning", 2, 2],
      ["bleeding", 3, 3],
      ["bleeding", 2, 5],
      ["stunned", 1, 1],
    ]);
    expect(t.statuses.stacks("bleeding")).toBe(5);
  });

  it("all per-hit powers come after the hit's DamageDealt and Leeching", () => {
    const ctx = createCombatContext("order");
    const a = player({ hp: 10, bleedPower: 1, stunPower: 1, statuses: { leeching: 2 } });
    resolveHit(ctx, a, enemy(), phys(5));
    const types = ctx.events.map((e) => e.type);
    expect(types).toEqual(["HitStarted", "DamageDealt", "Healed", "StatusApplied", "StatusApplied"]);
    expect(appliedOrder(ctx.events)).toEqual(["bleeding", "stunned"]);
  });

  it("two-hit attack: Bleed then Stun on each hit", () => {
    const ctx = createCombatContext("order");
    resolveAttack(ctx, player({ bleedPower: 1, stunPower: 2 }), enemy(), { hits: [phys(1), phys(1)] });
    expect(appliedOrder(ctx.events)).toEqual(["bleeding", "stunned", "bleeding", "stunned"]);
  });
});

describe("Burn power and Poison power: once per attack, after the last hit, if a hit landed", () => {
  it("one attack adds Burn power once, as the last event", () => {
    const ctx = createCombatContext("burn");
    const t = enemy();
    resolveAttack(ctx, player({ burnPower: 3 }), t, { hits: [phys(2)] });
    expect(t.statuses.stacks("burning")).toBe(3);
    expect(applied(ctx.events, "burning")).toEqual([[3, 3]]);
    expect(ctx.events.at(-1)).toEqual({ type: "StatusApplied", unit: "e", status: "burning", stacks: 3, total: 3 });
  });

  it("one attack adds Poison power once", () => {
    const ctx = createCombatContext("poison");
    const t = enemy();
    resolveAttack(ctx, player({ poisonPower: 4 }), t, { hits: [phys(2)] });
    expect(t.statuses.stacks("poisoned")).toBe(4);
    expect(applied(ctx.events, "poisoned")).toEqual([[4, 4]]);
  });

  it("a two-hit attack adds each once, after the second hit", () => {
    const ctx = createCombatContext("burn");
    const t = enemy();
    resolveAttack(ctx, player({ burnPower: 2, poisonPower: 3 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(t.statuses.stacks("poisoned")).toBe(3);
    const lastDamage = ctx.events.map((e) => e.type).lastIndexOf("DamageDealt");
    const burn = ctx.events.findIndex((e) => e.type === "StatusApplied" && e.status === "burning");
    const poison = ctx.events.findIndex((e) => e.type === "StatusApplied" && e.status === "poisoned");
    expect(burn).toBeGreaterThan(lastDamage);
    expect(poison).toBeGreaterThan(burn);
  });

  it("adds to existing stacks (Burning 4 + 3 = 7)", () => {
    const ctx = createCombatContext("burn");
    const t = enemy("e", { statuses: { burning: 4 } });
    resolveAttack(ctx, player({ burnPower: 3 }), t, { hits: [phys(1)] });
    expect(applied(ctx.events, "burning")).toEqual([[3, 7]]);
  });

  it("order after the last hit: Burn, Poison, then Paralysis; per-hit Bleed and Stun come during the hits", () => {
    const ctx = createCombatContext("order");
    const a = player({ bleedPower: 1, stunPower: 1, burnPower: 1, poisonPower: 2, paralysisPower: 3 });
    resolveAttack(ctx, a, enemy(), { hits: [phys(1), phys(1)] });
    expect(appliedOrder(ctx.events)).toEqual(["bleeding", "stunned", "bleeding", "stunned", "burning", "poisoned", "paralysed"]);
    expect(eventsOf(ctx.events, "StatusApplied").slice(-3).map((e) => [e.status, e.stacks])).toEqual([
      ["burning", 1],
      ["poisoned", 2],
      ["paralysed", 3],
    ]);
  });

  it("per-attack powers come after the last hit's own statuses and per-hit powers", () => {
    const ctx = createCombatContext("order");
    const a = player({ bleedPower: 1, burnPower: 2 });
    resolveAttack(ctx, a, enemy(), { hits: [phys(1, { statuses: [{ status: "enfeebled", stacks: 1 }] })] });
    expect(appliedOrder(ctx.events)).toEqual(["enfeebled", "bleeding", "burning"]);
  });

  it("no hit landed (both deflected): adds nothing", () => {
    const ctx = createCombatContext("burn");
    const t = enemy("e", { statuses: { warded: 2 } });
    resolveAttack(ctx, player({ burnPower: 3, poisonPower: 3 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.has("burning")).toBe(false);
    expect(t.statuses.has("poisoned")).toBe(false);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("one of two hits landed (Warded 1 deflects the first): adds each once", () => {
    const ctx = createCombatContext("burn");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveAttack(ctx, player({ burnPower: 3, poisonPower: 2 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("burning")).toBe(3);
    expect(t.statuses.stacks("poisoned")).toBe(2);
  });

  it("a 0-damage hit counts as landed", () => {
    const ctx = createCombatContext("burn");
    const t = enemy();
    resolveAttack(ctx, player({ burnPower: 2, poisonPower: 1 }), t, { hits: [phys(0)] });
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("burning")).toBe(2);
    expect(t.statuses.stacks("poisoned")).toBe(1);
  });

  it("not added to a target the attack killed", () => {
    const ctx = createCombatContext("burn");
    const t = enemy("e", { hp: 3 });
    resolveAttack(ctx, player({ burnPower: 2, poisonPower: 2 }), t, { hits: [phys(5)] });
    expect(t.fallen).toBe(true);
    expect(applied(ctx.events, "burning")).toEqual([]);
    expect(applied(ctx.events, "poisoned")).toEqual([]);
  });

  it("not added if the attacker has fallen by the end of the attack (Thorns), even though a hit landed", () => {
    const ctx = createCombatContext("burn");
    const a = player({ hp: 2, burnPower: 2, poisonPower: 2 });
    const t = enemy("e", { statuses: { thorns: 5 } });
    resolveAttack(ctx, a, t, { hits: [phys(1)] });
    expect(a.fallen).toBe(true);
    expect(t.hp).toBe(29); // the hit still landed
    expect(applied(ctx.events, "burning")).toEqual([]);
    expect(applied(ctx.events, "poisoned")).toEqual([]);
  });

  it("Burn power is resisted by Arcana (5 vs Arcana 4 -> 3); Poison power by Vitality (5 vs Vitality 5 -> 2)", () => {
    const ctx = createCombatContext("resist");
    const t = enemy("e", { stats: { arcana: 4, vitality: 5 } });
    resolveAttack(ctx, player({ burnPower: 5, poisonPower: 5 }), t, { hits: [phys(1)] });
    // Burning: 5 - (4 - 2) = 3. Poisoned: 5 - (5 - 2) = 2.
    expect(t.statuses.stacks("burning")).toBe(3);
    expect(t.statuses.stacks("poisoned")).toBe(2);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([
      { type: "StatusResisted", unit: "e", status: "burning", removed: 2 },
      { type: "StatusResisted", unit: "e", status: "poisoned", removed: 3 },
    ]);
  });

  it("resistance leaves a minimum of 1 (Burn 2 vs Arcana 7 -> 1; Poison 2 vs Vitality 7 -> 1)", () => {
    const ctx = createCombatContext("resist");
    const t = enemy("e", { stats: { arcana: 7, vitality: 7 } });
    resolveAttack(ctx, player({ burnPower: 2, poisonPower: 2 }), t, { hits: [phys(1)] });
    expect(t.statuses.stacks("burning")).toBe(1);
    expect(t.statuses.stacks("poisoned")).toBe(1);
  });

  it("each power uses its own resisting stat (Burn 4 vs Vitality 7 -> 4; Poison 4 vs Arcana 7 -> 4)", () => {
    const ctx = createCombatContext("resist");
    const t1 = enemy("e1", { stats: { vitality: 7, wisdom: 7 } });
    resolveAttack(ctx, player({ burnPower: 4 }), t1, { hits: [phys(1)] });
    expect(t1.statuses.stacks("burning")).toBe(4);
    const t2 = enemy("e2", { stats: { arcana: 7, wisdom: 7 } });
    resolveAttack(ctx, player({ poisonPower: 4 }), t2, { hits: [phys(1)] });
    expect(t2.statuses.stacks("poisoned")).toBe(4);
  });

  it("Burn power 0 and Poison power 0 add nothing", () => {
    const ctx = createCombatContext("burn");
    resolveAttack(ctx, player(), enemy(), { hits: [phys(1)] });
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([]);
  });

  it("a bare resolveHit is not an attack: no Burn, Poison or Paralysis power (Bleed and Stun still apply)", () => {
    const ctx = createCombatContext("bare");
    const t = enemy();
    resolveHit(ctx, player({ bleedPower: 1, stunPower: 1, burnPower: 3, poisonPower: 3, paralysisPower: 3 }), t, phys(1));
    expect(t.statuses.has("burning")).toBe(false);
    expect(t.statuses.has("poisoned")).toBe(false);
    expect(t.statuses.has("paralysed")).toBe(false);
    expect(appliedOrder(ctx.events)).toEqual(["bleeding", "stunned"]);
  });

  it("two attacks add Burn power twice (3 + 3 = 6)", () => {
    const ctx = createCombatContext("burn");
    const t = enemy();
    const a = player({ burnPower: 3 });
    resolveAttack(ctx, a, t, { hits: [phys(1)] });
    resolveAttack(ctx, a, t, { hits: [phys(1)] });
    expect(applied(ctx.events, "burning")).toEqual([[3, 3], [3, 6]]);
  });
});

describe("Powers during a fight: Bleed, Burn and Poison power never drop (Stun power still does)", () => {
  it("after several turns, including the unit's own and a skipped one", () => {
    const p = player({ bleedPower: 2, burnPower: 3, poisonPower: 4, stunPower: 3, statuses: { stunned: 10 } });
    const e = enemy("e", { bleedPower: 1, burnPower: 1, poisonPower: 1 });
    const { state } = fight([p, e]);
    expect(pass(state)).toBe(false); // p: stunned, turn end still runs
    pass(state); // e
    pass(state); // p
    pass(state); // e
    expect(p.bleedPower).toBe(2);
    expect(p.burnPower).toBe(3);
    expect(p.poisonPower).toBe(4);
    expect(e.bleedPower).toBe(1);
    expect(e.burnPower).toBe(1);
    expect(e.poisonPower).toBe(1);
    // Stun power 3 -1 per p turn, two turns: 1
    expect(p.stunPower).toBe(1);
  });

  it("are unchanged by a new fight", () => {
    const p = player({ bleedPower: 2, burnPower: 3, poisonPower: 4 });
    fight([p, enemy()]);
    fight([p, enemy("e2")], "next-fight");
    expect(p.bleedPower).toBe(2);
    expect(p.burnPower).toBe(3);
    expect(p.poisonPower).toBe(4);
  });
});

describe("Damage over time does the rest: Burn power 3 every turn builds Burning", () => {
  it("p attacks e once per turn (0-damage hit); e takes 3, 5, 7, 9 at its turn starts (24 total)", () => {
    // Round r: p's attack adds 3, then e's turn start deals its stacks and loses 1.
    // R1: 0 + 3 = 3 -> 3 damage, 2 left. R2: 2 + 3 = 5 -> 5 damage, 4 left.
    // R3: 4 + 3 = 7 -> 7 damage, 6 left. R4: 6 + 3 = 9 -> 9 damage, 8 left. 3 + 5 + 7 + 9 = 24; HP 100 -> 76.
    const p = player({ burnPower: 3 });
    const e = enemy("e", { maxHp: 100 });
    const { ctx, state } = fight([p, e], "burn-build");
    const afterAttack: number[] = [];
    const dot: number[] = [];
    for (let r = 0; r < 4; r++) {
      expect(startTurn(state)).toBe(true);
      resolveAttack(ctx, p, e, { hits: [phys(0)] });
      afterAttack.push(e.statuses.stacks("burning"));
      endTurn(state);
      const ev = during(ctx, () => expect(startTurn(state)).toBe(true));
      dot.push(...eventsOf(ev, "DotDamage").map((d) => d.shieldDamage + d.hpDamage));
      endTurn(state);
    }
    expect(afterAttack).toEqual([3, 5, 7, 9]);
    expect(dot).toEqual([3, 5, 7, 9]);
    expect(e.hp).toBe(76);
    expect(e.statuses.stacks("burning")).toBe(8);
  });
});
