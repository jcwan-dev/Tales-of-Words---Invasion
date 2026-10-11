import { describe, expect, it } from "vitest";
import { createCombatContext, endTurn, resolveAttack, resolveHit, startTurn, type CombatEvent, type StatusId } from "../../src/index.ts";
import { eventsOf } from "./helpers.ts";
import { arc, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Spec 1.4, "Stun and paralysis" (and "Stacking": build-up meters).

const applied = (events: readonly CombatEvent[], status: StatusId): [number, number][] =>
  eventsOf(events, "StatusApplied").filter((e) => e.status === status).map((e) => [e.stacks, e.total]);

describe("Stun power: every hit the unit lands adds X Stunned stacks", () => {
  it("one hit adds Stun power once (resolveHit)", () => {
    const ctx = createCombatContext("stun");
    const a = player({ stunPower: 3 });
    const t = enemy();
    resolveHit(ctx, a, t, phys(2));
    expect(t.statuses.stacks("stunned")).toBe(3);
    expect(applied(ctx.events, "stunned")).toEqual([[3, 3]]);
  });

  it("a two-hit attack adds it twice", () => {
    const ctx = createCombatContext("stun");
    const t = enemy();
    resolveAttack(ctx, player({ stunPower: 3 }), t, { hits: [phys(1), phys(1)] });
    // 3 + 3 = 6
    expect(t.statuses.stacks("stunned")).toBe(6);
    expect(applied(ctx.events, "stunned")).toEqual([[3, 3], [3, 6]]);
  });

  it("comes at step 7, after the hit's own statuses (Lei: Stunned 4 on the hit, then Stun power 3)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy();
    resolveHit(ctx, player({ stunPower: 3 }), t, arc(6, { statuses: [{ status: "burning", stacks: 2 }, { status: "stunned", stacks: 4 }] }));
    // 4 + 3 = 7
    expect(t.statuses.stacks("stunned")).toBe(7);
    const statusEvents = eventsOf(ctx.events, "StatusApplied").map((e) => [e.status, e.stacks, e.total]);
    expect(statusEvents).toEqual([["burning", 2, 2], ["stunned", 4, 4], ["stunned", 3, 7]]);
    expect(ctx.events.at(-1)).toEqual({ type: "StatusApplied", unit: "e", status: "stunned", stacks: 3, total: 7 });
  });

  it("is resisted by Vitality, each application on its own (Stun power 5 vs Vitality 4 -> 3 per hit)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { stats: { vitality: 4 } });
    resolveAttack(ctx, player({ stunPower: 5 }), t, { hits: [phys(1), phys(1)] });
    // Vitality 4 removes 2 per application: 5 - 2 = 3, twice = 6
    expect(t.statuses.stacks("stunned")).toBe(6);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([
      { type: "StatusResisted", unit: "e", status: "stunned", removed: 2 },
      { type: "StatusResisted", unit: "e", status: "stunned", removed: 2 },
    ]);
  });

  it("resistance leaves a minimum of 1 (Stun power 2 vs Vitality 7 -> 1)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { stats: { vitality: 7 } });
    resolveHit(ctx, player({ stunPower: 2 }), t, phys(1));
    expect(t.statuses.stacks("stunned")).toBe(1);
  });

  it("the hit's Stunned and Stun power are resisted separately (Lei 4 and Stun power 3 vs Vitality 4 -> 2 + 1)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { stats: { vitality: 4 } });
    resolveHit(ctx, player({ stunPower: 3 }), t, arc(6, { statuses: [{ status: "stunned", stacks: 4 }] }));
    // 4 - 2 = 2; 3 - 2 = 1; total 3
    expect(t.statuses.stacks("stunned")).toBe(3);
    expect(applied(ctx.events, "stunned")).toEqual([[2, 2], [1, 3]]);
  });

  it("a deflected hit adds none", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveHit(ctx, player({ stunPower: 4 }), t, phys(5));
    expect(t.statuses.stacks("stunned")).toBe(0);
    expect(applied(ctx.events, "stunned")).toEqual([]);
  });

  it("two hits against Warded 1: the first is deflected, only the second adds Stun power", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveAttack(ctx, player({ stunPower: 4 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("stunned")).toBe(4);
  });

  it("a Piercing hit is never deflected, so it adds Stun power through Warded", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveHit(ctx, player({ stunPower: 4 }), t, phys(1, { piercing: true }));
    expect(t.statuses.stacks("stunned")).toBe(4);
    expect(t.statuses.stacks("warded")).toBe(1);
  });

  it("a 0-damage hit still adds it", () => {
    const ctx = createCombatContext("stun");
    const t = enemy();
    resolveHit(ctx, player({ stunPower: 3 }), t, phys(0));
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("stunned")).toBe(3);
  });

  it("is added even if the target fell during that hit (as for every status)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { hp: 2 });
    resolveHit(ctx, player({ stunPower: 3 }), t, phys(5));
    expect(t.fallen).toBe(true);
    expect(t.statuses.stacks("stunned")).toBe(3);
    expect(ctx.events.at(-1)).toEqual({ type: "StatusApplied", unit: "e", status: "stunned", stacks: 3, total: 3 });
  });

  it("Stun power 0 adds nothing (no StatusApplied)", () => {
    const ctx = createCombatContext("stun");
    const t = enemy();
    resolveHit(ctx, player(), t, phys(3));
    expect(t.statuses.has("stunned")).toBe(false);
    expect(applied(ctx.events, "stunned")).toEqual([]);
  });

  it("uses the current Stun power, not the full value", () => {
    const ctx = createCombatContext("stun");
    const a = player({ stunPower: 5 });
    a.stunPower = 2;
    const t = enemy();
    resolveHit(ctx, a, t, phys(1));
    expect(t.statuses.stacks("stunned")).toBe(2);
  });

  it("a hit against a fallen unit adds nothing", () => {
    const ctx = createCombatContext("stun");
    const t = enemy("e", { hp: 0 });
    resolveHit(ctx, player({ stunPower: 3 }), t, phys(1));
    expect(t.statuses.stacks("stunned")).toBe(0);
    expect(ctx.events).toEqual([]);
  });

  it("drops by 1 at the end of each of the unit's turns (skipped turns too), minimum 0, and is back to full next fight", () => {
    const p = player({ stunPower: 2, statuses: { stunned: 10 } });
    let f = fight([p, enemy()]);
    expect(pass(f.state)).toBe(false); // skipped turn still runs turn end
    expect(p.stunPower).toBe(1);
    pass(f.state); // e
    pass(f.state);
    expect(p.stunPower).toBe(0);
    pass(f.state); // e
    pass(f.state);
    expect(p.stunPower).toBe(0);
    f = fight([p, enemy("e2")], "next-fight");
    expect(p.stunPower).toBe(2);
  });
});

describe("Paralysis power: every attack adds X Paralysed stacks once, if at least one hit landed", () => {
  it("one attack adds Paralysis power once, after its hits", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveAttack(ctx, player({ paralysisPower: 2 }), t, { hits: [phys(3)] });
    expect(t.statuses.stacks("paralysed")).toBe(2);
    expect(applied(ctx.events, "paralysed")).toEqual([[2, 2]]);
    expect(ctx.events.at(-1)).toEqual({ type: "StatusApplied", unit: "e", status: "paralysed", stacks: 2, total: 2 });
  });

  it("a two-hit attack adds it once, after the second hit", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveAttack(ctx, player({ paralysisPower: 2 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("paralysed")).toBe(2);
    const lastDamage = ctx.events.map((e) => e.type).lastIndexOf("DamageDealt");
    const para = ctx.events.findIndex((e) => e.type === "StatusApplied" && e.status === "paralysed");
    expect(para).toBeGreaterThan(lastDamage);
  });

  it("a bare resolveHit is not an attack and adds no Paralysis power", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveHit(ctx, player({ paralysisPower: 2 }), t, phys(1));
    expect(t.statuses.has("paralysed")).toBe(false);
  });

  it("Stun power per hit, then Paralysis power once at the end", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveAttack(ctx, player({ stunPower: 1, paralysisPower: 2 }), t, { hits: [phys(1), phys(1)] });
    const order = eventsOf(ctx.events, "StatusApplied").map((e) => e.status);
    expect(order).toEqual(["stunned", "stunned", "paralysed"]);
  });

  it("no hit landed (both deflected): adds nothing", () => {
    const ctx = createCombatContext("para");
    const t = enemy("e", { statuses: { warded: 2 } });
    resolveAttack(ctx, player({ paralysisPower: 3 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.has("paralysed")).toBe(false);
    expect(applied(ctx.events, "paralysed")).toEqual([]);
  });

  it("one of two hits landed (Warded 1 deflects the first): adds it once", () => {
    const ctx = createCombatContext("para");
    const t = enemy("e", { statuses: { warded: 1 } });
    resolveAttack(ctx, player({ paralysisPower: 3 }), t, { hits: [phys(1), phys(1)] });
    expect(t.statuses.stacks("paralysed")).toBe(3);
  });

  it("a 0-damage hit counts as landed", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveAttack(ctx, player({ paralysisPower: 2 }), t, { hits: [phys(0)] });
    expect(t.statuses.stacks("paralysed")).toBe(2);
  });

  it("is resisted by Wisdom (Paralysis power 5 vs Wisdom 4 -> 3; minimum 1)", () => {
    const ctx = createCombatContext("para");
    const t = enemy("e", { stats: { wisdom: 4 } });
    resolveAttack(ctx, player({ paralysisPower: 5 }), t, { hits: [phys(1)] });
    // 5 - (4 - 2) = 3
    expect(t.statuses.stacks("paralysed")).toBe(3);
    expect(eventsOf(ctx.events, "StatusResisted")).toEqual([{ type: "StatusResisted", unit: "e", status: "paralysed", removed: 2 }]);

    const ctx2 = createCombatContext("para");
    const t2 = enemy("e", { stats: { wisdom: 7, vitality: 7 } });
    resolveAttack(ctx2, player({ paralysisPower: 2 }), t2, { hits: [phys(1)] });
    expect(t2.statuses.stacks("paralysed")).toBe(1);
  });

  it("Paralysis power 0 adds nothing", () => {
    const ctx = createCombatContext("para");
    const t = enemy();
    resolveAttack(ctx, player(), t, { hits: [phys(1)] });
    expect(applied(ctx.events, "paralysed")).toEqual([]);
  });

  it("not added to a target the attack killed", () => {
    const ctx = createCombatContext("para");
    const t = enemy("e", { hp: 3 });
    resolveAttack(ctx, player({ paralysisPower: 2 }), t, { hits: [phys(5)] });
    expect(t.fallen).toBe(true);
    expect(applied(ctx.events, "paralysed")).toEqual([]);
  });

  it("not added if the attacker has fallen by the end of the attack (Thorns), even though a hit landed", () => {
    const ctx = createCombatContext("para");
    const a = player({ hp: 2, paralysisPower: 2 });
    const t = enemy("e", { statuses: { thorns: 5 } });
    resolveAttack(ctx, a, t, { hits: [phys(1)] });
    expect(a.fallen).toBe(true);
    expect(t.hp).toBe(29); // the hit still landed
    expect(applied(ctx.events, "paralysed")).toEqual([]);
  });

  it("never drops", () => {
    const p = player({ paralysisPower: 4 });
    const { state } = fight([p, enemy()]);
    for (let i = 0; i < 6; i++) pass(state);
    expect(p.paralysisPower).toBe(4);
  });
});

describe("The meters", () => {
  it("Stunned and Paralysed stacks never decay on their own", () => {
    const e = enemy("e", { statuses: { stunned: 5, paralysed: 7 } });
    const { state } = fight([player(), e]);
    for (let i = 0; i < 8; i++) pass(state);
    expect(e.statuses.stacks("stunned")).toBe(5);
    expect(e.statuses.stacks("paralysed")).toBe(7);
  });

  it("no immunity: a unit can be stunned again on its very next turn", () => {
    // The player's hit carries Stunned 10 each turn; the enemy loses every turn.
    const p = player();
    const e = enemy();
    const { ctx, state } = fight([p, e]);
    const enemyActs: boolean[] = [];
    for (let r = 0; r < 3; r++) {
      startTurn(state);
      resolveAttack(ctx, p, e, { hits: [phys(1, { statuses: [{ status: "stunned", stacks: 10 }] })] });
      endTurn(state);
      enemyActs.push(startTurn(state));
      expect(e.statuses.stacks("stunned")).toBe(0);
      endTurn(state);
    }
    expect(enemyActs).toEqual([false, false, false]);
    expect(eventsOf(ctx.events, "MeterTriggered")).toHaveLength(3);
  });

  it("no immunity: Paralysed can trigger again on the next turn, resetting each time", () => {
    const p = player();
    const e = enemy();
    const { ctx, state } = fight([p, e], "para-again");
    for (let r = 0; r < 4; r++) {
      startTurn(state);
      resolveAttack(ctx, p, e, { hits: [phys(1, { statuses: [{ status: "paralysed", stacks: 10 }] })] });
      endTurn(state);
      const ev = during(ctx, () => startTurn(state));
      expect(eventsOf(ev, "MeterTriggered").map((m) => m.status)).toEqual(["paralysed"]);
      expect(e.statuses.stacks("paralysed")).toBe(0);
      endTurn(state);
    }
  });

  it("a Stunned trigger is certain and uses no RNG: later Paralysed rolls are the same as without it", () => {
    const rolls = (withStun: boolean): boolean[] => {
      const out: boolean[] = [];
      const p = player();
      const e = enemy();
      const { ctx, state } = fight([p, e], "stun-no-rng");
      for (let r = 0; r < 12; r++) {
        startTurn(state);
        const statuses: { status: StatusId; stacks: number }[] = [{ status: "paralysed", stacks: 10 }];
        if (withStun && r % 2 === 0) {
          // Stun on its own turn, then Paralysed rolls on the enemy's following turn.
          resolveAttack(ctx, p, e, { hits: [phys(0, { statuses: [{ status: "stunned", stacks: 10 }] })] });
          endTurn(state);
          startTurn(state); // e: stunned
          endTurn(state);
          startTurn(state); // p
        }
        resolveAttack(ctx, p, e, { hits: [phys(0, { statuses })] });
        endTurn(state);
        out.push(startTurn(state));
        endTurn(state);
      }
      return out;
    };
    const a = rolls(false);
    expect(rolls(true)).toEqual(a);
    expect(a).toContain(true);
    expect(a).toContain(false);
  });
});

describe("Spec worked examples", () => {
  it("Stun 7 against a Vitality 2 enemy, one hit per turn: 7, 13 (stunned, reset), then 5, 9, 12 (stunned again)", () => {
    const p = player({ stunPower: 7 });
    const e = enemy("e", { maxHp: 200, stats: { vitality: 2 } });
    const { ctx, state } = fight([p, e]);
    const afterHit: number[] = [];
    const added: number[] = [];
    const powerAfterTurn: number[] = [];
    const enemyActs: boolean[] = [];
    const afterEnemyTurn: number[] = [];
    for (let r = 0; r < 5; r++) {
      expect(startTurn(state)).toBe(true);
      const ev = during(ctx, () => resolveAttack(ctx, p, e, { hits: [phys(1)] }));
      added.push(...applied(ev, "stunned").map(([s]) => s));
      afterHit.push(e.statuses.stacks("stunned"));
      endTurn(state);
      powerAfterTurn.push(p.stunPower);
      enemyActs.push(startTurn(state));
      afterEnemyTurn.push(e.statuses.stacks("stunned"));
      endTurn(state);
    }
    // +7 (7), +6 (13 -> lost turn, reset 0), +5 (5), +4 (9), +3 (12 -> lost turn, reset 0)
    expect(added).toEqual([7, 6, 5, 4, 3]);
    expect(afterHit).toEqual([7, 13, 5, 9, 12]);
    expect(enemyActs).toEqual([true, false, true, true, false]);
    expect(afterEnemyTurn).toEqual([7, 0, 5, 9, 0]);
    expect(powerAfterTurn).toEqual([6, 5, 4, 3, 2]);
    expect(eventsOf(ctx.events, "MeterTriggered")).toEqual([
      { type: "MeterTriggered", unit: "e", status: "stunned", lostTurn: true },
      { type: "MeterTriggered", unit: "e", status: "stunned", lostTurn: true },
    ]);
  });

  it("Paralysis 2, one attack per turn: after 5 attacks the enemy has 10, rolls 50% on its next turn, resets to 0, and the build-up starts again", () => {
    const p = player({ paralysisPower: 2 });
    const e = enemy("e", { maxHp: 200, stats: { wisdom: 2 } });
    const { ctx, state } = fight([p, e], "paralysis-example");
    const afterAttack: number[] = [];
    for (let r = 0; r < 6; r++) {
      startTurn(state);
      resolveAttack(ctx, p, e, { hits: [phys(1)] });
      afterAttack.push(e.statuses.stacks("paralysed"));
      endTurn(state);
      let acts = false;
      const ev = during(ctx, () => {
        acts = startTurn(state);
      });
      const mt = eventsOf(ev, "MeterTriggered");
      if (r === 4) {
        expect(mt).toEqual([{ type: "MeterTriggered", unit: "e", status: "paralysed", lostTurn: !acts }]);
        expect(e.statuses.stacks("paralysed")).toBe(0);
      } else {
        expect(mt).toEqual([]);
        expect(acts).toBe(true);
      }
      endTurn(state);
    }
    // 2, 4, 6, 8, 10 (roll + reset on the enemy's turn), then 2 again
    expect(afterAttack).toEqual([2, 4, 6, 8, 10, 2]);
  });
});
