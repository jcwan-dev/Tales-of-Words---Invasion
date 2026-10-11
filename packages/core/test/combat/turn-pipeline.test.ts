import { describe, expect, it } from "vitest";
import { createCombatContext, endTurn, resolveAttack, resolveHit, startTurn, type CombatEvent, type CombatUnit, type StatusId } from "../../src/index.ts";
import { eventsOf, typesOf } from "./helpers.ts";
import { activeId, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Spec 1.4, "Turns and status effects": Turn pipeline, Turn details, Status list, Stacking.

const turnStarts = (events: readonly CombatEvent[]): [string, number][] =>
  eventsOf(events, "TurnStarted").map((e) => [e.unit, e.round]);

const removed = (events: readonly CombatEvent[]): StatusId[] =>
  eventsOf(events, "StatusRemoved").map((e) => e.status).sort();

describe("Fight start", () => {
  it("every unit's Shield refills to full; HP carries over", () => {
    const p = player({ hp: 12, maxShield: 8, shield: 3 });
    const e = enemy("e", { hp: 20, maxShield: 5, shield: 0 });
    fight([p, e]);
    expect(p.shield).toBe(8);
    expect(e.shield).toBe(5);
    expect(p.hp).toBe(12);
    expect(e.hp).toBe(20);
  });

  it("every unit's Stun power goes back to full", () => {
    const p = player({ stunPower: 4 });
    const e = enemy("e", { stunPower: 2 });
    expect(p.maxStunPower).toBe(4);
    expect(p.stunPower).toBe(4);
    p.stunPower = 1;
    e.stunPower = 0;
    fight([p, e]);
    expect(p.stunPower).toBe(4);
    expect(e.stunPower).toBe(2);
  });

  it("Stun power and Paralysis power default to 0", () => {
    const p = player();
    expect(p.maxStunPower).toBe(0);
    expect(p.stunPower).toBe(0);
    expect(p.paralysisPower).toBe(0);
  });

  it("beginCombat emits only CombatStarted and does not start the first turn (no DoT tick yet)", () => {
    const p = player({ statuses: { burning: 3 } });
    const { ctx, state } = fight([p, enemy()]);
    expect(ctx.events).toEqual([{ type: "CombatStarted", order: ["p", "e"] }]);
    expect(p.hp).toBe(30);
    expect(p.statuses.stacks("burning")).toBe(3);
    expect(state.round).toBe(1);
    expect(activeId(state)).toBe("p");
    expect(state.over).toBe(false);
    expect(state.winner).toBeNull();
  });

  it("beginCombat leaves the given statuses alone (meters included)", () => {
    const p = player({ statuses: { stunned: 7, paralysed: 4, ambushed: 1, burning: 3, emboldened: 2, warded: 1 } });
    fight([p, enemy()]);
    expect(p.statuses.stacks("stunned")).toBe(7);
    expect(p.statuses.stacks("paralysed")).toBe(4);
    expect(p.statuses.stacks("ambushed")).toBe(1);
    expect(p.statuses.stacks("burning")).toBe(3);
    expect(p.statuses.stacks("emboldened")).toBe(2);
    expect(p.statuses.stacks("warded")).toBe(1);
  });

  describe("Turn order: the side with the higher Agility acts first; ties go to the player; within a side, the order given", () => {
    const cases: { name: string; units: () => CombatUnit[]; order: string[] }[] = [
      { name: "player Agility 2 = enemy 2 (tie) -> player first", units: () => [player(), enemy()], order: ["p", "e"] },
      { name: "player Agility 2 < enemy 3 -> enemy first", units: () => [player(), enemy("e", { stats: { agility: 3 } })], order: ["e", "p"] },
      { name: "player Agility 5 > enemy 4 -> player first", units: () => [enemy("e", { stats: { agility: 4 } }), player({ stats: { agility: 5 } })], order: ["p", "e"] },
      {
        name: "highest enemy Agility counts (4 vs 1 and 5) -> enemies first, in the order given",
        units: () => [player({ stats: { agility: 4 } }), enemy("e1", { stats: { agility: 1 } }), enemy("e2", { stats: { agility: 5 } })],
        order: ["e1", "e2", "p"],
      },
      {
        name: "player 5 ties the highest enemy 5 -> player first; enemies keep the order given (not sorted by Agility)",
        units: () => [enemy("e1", { stats: { agility: 5 } }), player({ stats: { agility: 5 } }), enemy("e2", { stats: { agility: 1 } })],
        order: ["p", "e1", "e2"],
      },
      {
        name: "mixed input order with enemies first",
        units: () => [enemy("e1"), player({ stats: { agility: 0 } }), enemy("e2", { stats: { agility: 1 } })],
        order: ["e1", "e2", "p"],
      },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const { ctx, state } = fight(c.units());
        expect(state.units.map((u) => u.id)).toEqual(c.order);
        expect(eventsOf(ctx.events, "CombatStarted")).toEqual([{ type: "CombatStarted", order: c.order }]);
        expect(activeId(state)).toBe(c.order[0]);
      });
    }
  });
});

describe("Rounds: fixed alternation through living units", () => {
  it("player, then each enemy in order, then the player again; one pass is a round", () => {
    const { ctx, state } = fight([player(), enemy("e1"), enemy("e2")]);
    const rounds: number[] = [];
    for (let i = 0; i < 7; i++) {
      rounds.push(state.round);
      pass(state);
    }
    expect(turnStarts(ctx.events)).toEqual([
      ["p", 1], ["e1", 1], ["e2", 1],
      ["p", 2], ["e1", 2], ["e2", 2],
      ["p", 3],
    ]);
    expect(rounds).toEqual([1, 1, 1, 2, 2, 2, 3]);
    expect(state.round).toBe(3);
    expect(activeId(state)).toBe("e1");
  });

  it("enemies first: each enemy, then the player, then round 2", () => {
    const { ctx, state } = fight([player(), enemy("e1", { stats: { agility: 3 } })]);
    for (let i = 0; i < 4; i++) pass(state);
    expect(turnStarts(ctx.events)).toEqual([["e1", 1], ["p", 1], ["e1", 2], ["p", 2]]);
  });

  it("endTurn moves to the next unit; TurnEnded is emitted for the unit whose turn ended", () => {
    const { ctx, state } = fight([player(), enemy()]);
    startTurn(state);
    const ev = during(ctx, () => endTurn(state));
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(activeId(state)).toBe("e");
  });

  it("fallen units are skipped: an enemy killed in round 1 never gets a turn", () => {
    const e1 = enemy("e1", { hp: 1 });
    const { ctx, state } = fight([player(), e1, enemy("e2")]);
    startTurn(state);
    resolveHit(state.ctx, state.units[0] as CombatUnit, e1, phys(5));
    expect(e1.fallen).toBe(true);
    expect(state.over).toBe(false);
    endTurn(state);
    expect(activeId(state)).toBe("e2");
    expect(state.round).toBe(1);
    pass(state); // e2
    expect(activeId(state)).toBe("p");
    expect(state.round).toBe(2);
    pass(state); // p
    pass(state); // e2
    expect(turnStarts(ctx.events)).toEqual([["p", 1], ["e2", 1], ["p", 2], ["e2", 2]]);
  });

  it("if the last unit in the order falls, the round wraps after the last living one", () => {
    const e2 = enemy("e2", { hp: 1 });
    const { ctx, state } = fight([player(), enemy("e1"), e2]);
    startTurn(state);
    resolveHit(state.ctx, state.units[0] as CombatUnit, e2, phys(5));
    endTurn(state);
    pass(state); // e1, round 1
    expect(activeId(state)).toBe("p");
    expect(state.round).toBe(2);
    pass(state);
    expect(turnStarts(ctx.events)).toEqual([["p", 1], ["e1", 1], ["p", 2]]);
  });
});

describe("Turn start: damage over time (Burning, then Bleeding, then Poisoned)", () => {
  it("TurnStarted is the first event of the turn and carries the round", () => {
    const { ctx, state } = fight([player({ statuses: { burning: 1 } }), enemy()]);
    const ev = during(ctx, () => startTurn(state));
    expect(ev[0]).toEqual({ type: "TurnStarted", unit: "p", round: 1 });
  });

  it("each deals damage equal to its stacks, in order, then loses 1 stack; Burning and Bleeding hit Shield first, Poisoned goes straight to HP", () => {
    // Shield 4, HP 30, Burning 3, Bleeding 2, Poisoned 4.
    // Burning 3: Shield 4 -> 1 (3 Shield). Burning 3 -> 2.
    // Bleeding 2: Shield 1 -> 0 (1 Shield), HP 30 -> 29 (1 HP). Bleeding 2 -> 1.
    // Poisoned 4: HP 29 -> 25 (Shield skipped, already 0 anyway). Poisoned 4 -> 3.
    const p = player({ maxShield: 4, statuses: { burning: 3, bleeding: 2, poisoned: 4 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => expect(startTurn(state)).toBe(true));
    expect(eventsOf(ev, "DotDamage")).toEqual([
      { type: "DotDamage", unit: "p", status: "burning", shieldDamage: 3, hpDamage: 0 },
      { type: "DotDamage", unit: "p", status: "bleeding", shieldDamage: 1, hpDamage: 1 },
      { type: "DotDamage", unit: "p", status: "poisoned", shieldDamage: 0, hpDamage: 4 },
    ]);
    expect(p.shield).toBe(0);
    expect(p.hp).toBe(25);
    expect(p.statuses.stacks("burning")).toBe(2);
    expect(p.statuses.stacks("bleeding")).toBe(1);
    expect(p.statuses.stacks("poisoned")).toBe(3);
  });

  it("Poisoned ignores Shield even when Shield is up", () => {
    // Shield 10, Poisoned 3: HP 30 -> 27, Shield stays 10.
    const p = player({ maxShield: 10, statuses: { poisoned: 3 } });
    const { ctx, state } = fight([p, enemy()]);
    startTurn(state);
    expect(p.shield).toBe(10);
    expect(p.hp).toBe(27);
    expect(eventsOf(ctx.events, "DotDamage")).toEqual([{ type: "DotDamage", unit: "p", status: "poisoned", shieldDamage: 0, hpDamage: 3 }]);
  });

  it("a DoT at 1 stack deals 1, reaches 0 and is removed (StatusRemoved after its DotDamage)", () => {
    const p = player({ statuses: { burning: 1 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => startTurn(state));
    expect(p.hp).toBe(29);
    expect(p.statuses.has("burning")).toBe(false);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([{ type: "StatusRemoved", unit: "p", status: "burning" }]);
    expect(ev.findIndex((e) => e.type === "DotDamage")).toBeLessThan(ev.findIndex((e) => e.type === "StatusRemoved"));
  });

  it("only the active unit's DoTs tick", () => {
    const e = enemy("e", { statuses: { burning: 3 } });
    const { state } = fight([player(), e]);
    startTurn(state);
    expect(e.hp).toBe(30);
    expect(e.statuses.stacks("burning")).toBe(3);
  });

  it("DoTs don't also tick at turn end (they lose their stack at turn start only)", () => {
    const p = player({ statuses: { burning: 3, bleeding: 2, poisoned: 2 } });
    const { state } = fight([p, enemy()]);
    startTurn(state);
    endTurn(state);
    expect(p.statuses.stacks("burning")).toBe(2);
    expect(p.statuses.stacks("bleeding")).toBe(1);
    expect(p.statuses.stacks("poisoned")).toBe(1);
  });

  it("DoT damage is not an attack: no Thorns, no Warded charge, no Leeching, no Bleeding stack", () => {
    // HP 20, Burning 2, Bleeding 3, Thorns 3, Warded 1, Leeching 4.
    // Burning 2 + Bleeding 3 = 5 damage -> HP 15. Bleeding 3 -> 2 (no +1 from its own tick or Burning).
    const p = player({ hp: 20, statuses: { burning: 2, bleeding: 3, thorns: 3, warded: 1, leeching: 4 } });
    const e = enemy("e", { maxShield: 2 });
    const { ctx, state } = fight([p, e]);
    const ev = during(ctx, () => startTurn(state));
    expect(p.hp).toBe(15);
    expect(p.statuses.stacks("warded")).toBe(1);
    expect(p.statuses.stacks("thorns")).toBe(3);
    expect(p.statuses.stacks("leeching")).toBe(4);
    expect(p.statuses.stacks("bleeding")).toBe(2);
    expect(e.hp).toBe(30);
    expect(e.shield).toBe(2);
    for (const t of ["HitStarted", "ThornsDamage", "ChargeUsed", "HitDeflected", "DamageDealt", "Healed", "StatusApplied"] as const) {
      expect(eventsOf(ev, t)).toEqual([]);
    }
  });

  it("a Bleeding unit's own Bleeding tick adds no Bleeding stack", () => {
    const p = player({ maxShield: 5, statuses: { bleeding: 3 } });
    const { state } = fight([p, enemy()]);
    startTurn(state);
    // 3 damage to Shield (5 -> 2); Bleeding 3 -> 2
    expect(p.shield).toBe(2);
    expect(p.statuses.stacks("bleeding")).toBe(2);
  });

  it("DoT damage runs before the action gate", () => {
    const p = player({ statuses: { burning: 2, stunned: 10 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => startTurn(state));
    const dot = ev.findIndex((e) => e.type === "DotDamage");
    const meter = ev.findIndex((e) => e.type === "MeterTriggered");
    expect(dot).toBeGreaterThan(0);
    expect(meter).toBeGreaterThan(dot);
  });

  it("a unit that falls to DoT takes no action and its turn ends: the gate is not reached, TurnEnded, next living unit", () => {
    // e1: 3 HP, Poisoned 5 -> falls. Its Ambushed and Stunned 12 are never checked.
    const e1 = enemy("e1", { hp: 3, statuses: { poisoned: 5, ambushed: 1, stunned: 12 } });
    const { ctx, state } = fight([player(), e1, enemy("e2")]);
    pass(state); // p
    expect(activeId(state)).toBe("e1");
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(e1.hp).toBe(0);
    expect(e1.fallen).toBe(true);
    expect(eventsOf(ev, "UnitFell")).toEqual([{ type: "UnitFell", unit: "e1" }]);
    expect(eventsOf(ev, "TurnEnded")).toEqual([{ type: "TurnEnded", unit: "e1" }]);
    expect(eventsOf(ev, "TurnSkipped")).toEqual([]);
    expect(eventsOf(ev, "MeterTriggered")).toEqual([]);
    expect(e1.statuses.stacks("ambushed")).toBe(1);
    expect(e1.statuses.stacks("stunned")).toBe(12);
    expect(state.over).toBe(false);
    expect(activeId(state)).toBe("e2");
    expect(state.round).toBe(1);
    // The next unit's turn starts normally.
    const next = during(ctx, () => expect(startTurn(state)).toBe(true));
    expect(next[0]).toEqual({ type: "TurnStarted", unit: "e2", round: 1 });
  });

  it("a DoT kill: the remaining DoTs don't tick and there are no turn-end effects (cooldowns, decay, Stun power unchanged)", () => {
    const p = player();
    const e1 = enemy("e1", { hp: 3, stunPower: 3, statuses: { emboldened: 3 } });
    const { ctx, state } = fight([p, e1, enemy("e2")]);
    // Round 1: p passes; e1 uses a cooldown-2 card; e2 passes.
    pass(state);
    startTurn(state);
    resolveAttack(ctx, e1, p, { hits: [phys(1)], cardId: "bite", cooldown: 2 });
    endTurn(state); // e1 turn end: bite stays 2 (use turn), Emboldened 3 -> 2, Stun power 3 -> 2
    pass(state);
    expect(e1.cooldowns.remaining("bite")).toBe(2);
    expect(e1.statuses.stacks("emboldened")).toBe(2);
    expect(e1.stunPower).toBe(2);
    // Round 2: p gives e1 Burning 5 and Poisoned 4 (0-damage hit; Arcana and Vitality 2: no resistance).
    startTurn(state);
    resolveAttack(ctx, p, e1, { hits: [phys(0, { statuses: [{ status: "burning", stacks: 5 }, { status: "poisoned", stacks: 4 }] })] });
    endTurn(state);
    // e1's turn: Burning 5 kills it (3 HP); Poisoned doesn't tick.
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(e1.fallen).toBe(true);
    expect(eventsOf(ev, "DotDamage").map((d) => d.status)).toEqual(["burning"]);
    expect(e1.statuses.stacks("poisoned")).toBe(4);
    expect(e1.cooldowns.remaining("bite")).toBe(2);
    expect(e1.statuses.stacks("emboldened")).toBe(2);
    expect(e1.stunPower).toBe(2);
    expect(eventsOf(ev, "TurnEnded")).toEqual([{ type: "TurnEnded", unit: "e1" }]);
    expect(removed(ev)).toEqual([]);
    expect(activeId(state)).toBe("e2");
  });

  it("a DoT kill can end the fight (winner: the other side)", () => {
    const e = enemy("e", { hp: 2, statuses: { burning: 4 } });
    const { ctx, state } = fight([player(), e]);
    pass(state);
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(state.over).toBe(true);
    expect(state.winner).toBe("player");
    expect(state.active).toBeNull();
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([{ type: "CombatEnded", winner: "player" }]);
    expect(ev.findIndex((x) => x.type === "UnitFell")).toBeLessThan(ev.findIndex((x) => x.type === "CombatEnded"));
  });

  it("a DoT kill of the player ends the fight with the enemy as winner", () => {
    const p = player({ hp: 1, statuses: { bleeding: 2 } });
    const { ctx, state } = fight([p, enemy()]);
    expect(startTurn(state)).toBe(false);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("enemy");
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([{ type: "CombatEnded", winner: "enemy" }]);
  });
});

describe("Action gate: Ambushed, then Stunned 10+, then Paralysed 10+", () => {
  it("Ambushed: the turn is skipped, then Ambushed is removed; the next turn is normal", () => {
    const p = player({ statuses: { ambushed: 1 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(p.statuses.has("ambushed")).toBe(false);
    const gate = ev.filter((e) => e.type === "TurnSkipped" || e.type === "StatusRemoved");
    expect(gate).toEqual([
      { type: "TurnSkipped", unit: "p", reason: "ambushed" },
      { type: "StatusRemoved", unit: "p", status: "ambushed" },
    ]);
    endTurn(state);
    pass(state); // e
    expect(startTurn(state)).toBe(true);
  });

  it("Ambushed 2: two lost turns in a row (one stack used per skip), StatusRemoved at 0, then the unit acts", () => {
    const p = player({ statuses: { ambushed: 2 } });
    const { ctx, state } = fight([p, enemy()]);
    // Turn 1: skip, Ambushed 2 -> 1, not removed yet.
    let ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "p", reason: "ambushed" }]);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([]);
    expect(p.statuses.stacks("ambushed")).toBe(1);
    endTurn(state); // Ambushed is not a ticking status: turn end leaves it at 1
    expect(p.statuses.stacks("ambushed")).toBe(1);
    pass(state); // e
    // Turn 2: skip, Ambushed 1 -> 0, removed.
    ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "p", reason: "ambushed" }]);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([{ type: "StatusRemoved", unit: "p", status: "ambushed" }]);
    expect(p.statuses.has("ambushed")).toBe(false);
    endTurn(state);
    pass(state); // e
    // Turn 3: acts.
    expect(startTurn(state)).toBe(true);
  });

  it("resistance on Ambushed removes turns: Ambushed 3 vs Agility 4 -> 1 lost turn, then the unit acts", () => {
    const p = player();
    const e = enemy("e", { stats: { agility: 4 } });
    // The encounter's Ambushed arrives as an application, before the fight: 3 - (4 - 2) = 1 turn.
    resolveHit(createCombatContext("ambush-setup"), p, e, phys(0, { statuses: [{ status: "ambushed", stacks: 3 }] }));
    expect(e.statuses.stacks("ambushed")).toBe(1);
    // Enemy Agility 4 > player 2: the enemy acts first.
    const { state } = fight([p, e]);
    expect(activeId(state)).toBe("e");
    expect(pass(state)).toBe(false); // e: ambushed
    pass(state); // p
    expect(pass(state)).toBe(true); // e acts
  });

  it("Stunned 9: no effect, the unit acts, the meter stays", () => {
    const p = player({ statuses: { stunned: 9 } });
    const { ctx, state } = fight([p, enemy()]);
    expect(startTurn(state)).toBe(true);
    expect(p.statuses.stacks("stunned")).toBe(9);
    expect(eventsOf(ctx.events, "MeterTriggered")).toEqual([]);
    expect(eventsOf(ctx.events, "TurnSkipped")).toEqual([]);
  });

  it("Stunned 10: the turn is lost and Stunned resets to 0", () => {
    const p = player({ statuses: { stunned: 10 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(p.statuses.stacks("stunned")).toBe(0);
    expect(eventsOf(ev, "MeterTriggered")).toEqual([{ type: "MeterTriggered", unit: "p", status: "stunned", lostTurn: true }]);
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "p", reason: "stunned" }]);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([{ type: "StatusRemoved", unit: "p", status: "stunned" }]);
    expect(ev.findIndex((e) => e.type === "MeterTriggered")).toBeLessThan(ev.findIndex((e) => e.type === "TurnSkipped"));
  });

  it("Stunned 15: resets to 0 (the excess is lost, not carried over)", () => {
    const p = player({ statuses: { stunned: 15 } });
    const { state } = fight([p, enemy()]);
    expect(startTurn(state)).toBe(false);
    expect(p.statuses.stacks("stunned")).toBe(0);
  });

  it("Paralysed 9: no roll, the unit acts", () => {
    const p = player({ statuses: { paralysed: 9 } });
    const { ctx, state } = fight([p, enemy()]);
    expect(startTurn(state)).toBe(true);
    expect(p.statuses.stacks("paralysed")).toBe(9);
    expect(eventsOf(ctx.events, "MeterTriggered")).toEqual([]);
  });

  it("Paralysed 10+: 50% to lose the turn (combat RNG); resets to 0 either way", () => {
    let lost = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const p = player({ statuses: { paralysed: 10 + (i % 5) } });
      const { ctx, state } = fight([p, enemy()], `paralysed-gate-${i}`);
      const ev = during(ctx, () => {
        const acts = startTurn(state);
        const mt = eventsOf(ctx.events, "MeterTriggered");
        expect(mt).toHaveLength(1);
        expect(mt[0]?.status).toBe("paralysed");
        expect(mt[0]?.lostTurn).toBe(!acts);
        if (!acts) lost++;
      });
      expect(p.statuses.stacks("paralysed")).toBe(0);
      expect(eventsOf(ev, "StatusRemoved")).toEqual([{ type: "StatusRemoved", unit: "p", status: "paralysed" }]);
      const lostTurn = eventsOf(ev, "MeterTriggered")[0]?.lostTurn;
      expect(eventsOf(ev, "TurnSkipped")).toEqual(lostTurn ? [{ type: "TurnSkipped", unit: "p", reason: "paralysed" }] : []);
    }
    // Expected 200, sd 10. Seeds are fixed, so this is deterministic.
    expect(lost).toBeGreaterThan(150);
    expect(lost).toBeLessThan(250);
  });

  it("Paralysed roll is seeded: the same seed gives the same outcome", () => {
    const outcome = (seed: string): boolean => {
      const { state } = fight([player({ statuses: { paralysed: 10 } }), enemy()], seed);
      return startTurn(state);
    };
    for (let i = 0; i < 20; i++) expect(outcome(`para-same-${i}`)).toBe(outcome(`para-same-${i}`));
  });

  it("a lost turn stops later checks and keeps their stacks: Ambushed, then Stunned, then Paralysed on later turns", () => {
    const p = player({ statuses: { ambushed: 1, stunned: 12, paralysed: 15 } });
    const { ctx, state } = fight([p, enemy()]);

    // Turn 1: Ambushed. Stunned and Paralysed are not checked.
    let ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "p", reason: "ambushed" }]);
    expect(eventsOf(ev, "MeterTriggered")).toEqual([]);
    expect(p.statuses.stacks("stunned")).toBe(12);
    expect(p.statuses.stacks("paralysed")).toBe(15);
    endTurn(state);
    pass(state); // e

    // Turn 2: Stunned 12. Paralysed is not checked.
    ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "p", reason: "stunned" }]);
    expect(eventsOf(ev, "MeterTriggered")).toEqual([{ type: "MeterTriggered", unit: "p", status: "stunned", lostTurn: true }]);
    expect(p.statuses.stacks("stunned")).toBe(0);
    expect(p.statuses.stacks("paralysed")).toBe(15);
    endTurn(state);
    pass(state); // e

    // Turn 3: Paralysed 15 rolls and resets.
    ev = during(ctx, () => startTurn(state));
    expect(eventsOf(ev, "MeterTriggered").map((e) => e.status)).toEqual(["paralysed"]);
    expect(p.statuses.stacks("paralysed")).toBe(0);
  });

  it("Stunned 10 and Paralysed 10 together: the stun takes the turn and the paralysis roll waits", () => {
    const p = player({ statuses: { stunned: 10, paralysed: 10 } });
    const { ctx, state } = fight([p, enemy()]);
    const ev = during(ctx, () => expect(startTurn(state)).toBe(false));
    expect(eventsOf(ev, "MeterTriggered")).toEqual([{ type: "MeterTriggered", unit: "p", status: "stunned", lostTurn: true }]);
    expect(p.statuses.stacks("paralysed")).toBe(10);
  });

  it("a lost turn still runs turn end (ticking decay, Stun power -1)", () => {
    const p = player({ stunPower: 3, statuses: { stunned: 10, emboldened: 2 } });
    const { ctx, state } = fight([p, enemy()]);
    expect(startTurn(state)).toBe(false);
    const ev = during(ctx, () => endTurn(state));
    expect(p.statuses.stacks("emboldened")).toBe(1);
    expect(p.stunPower).toBe(2);
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(activeId(state)).toBe("e");
  });
});

describe("Falling during your own action", () => {
  it("an attacker that falls to Thorns: endTurn emits TurnEnded, skips turn-end effects and moves to the next living unit", () => {
    // p: Thorns 6. e1: 9 HP, Emboldened 3, Stun power 3.
    const p = player({ maxHp: 100, statuses: { thorns: 6 } });
    const e1 = enemy("e1", { hp: 9, stunPower: 3, statuses: { emboldened: 3 } });
    const e2 = enemy("e2");
    const { ctx, state } = fight([p, e1, e2]);
    pass(state); // p round 1: Thorns 6 -> 5
    startTurn(state);
    resolveAttack(ctx, e1, p, { hits: [phys(1)], cardId: "bite", cooldown: 2 }); // Thorns 5: e1 9 -> 4
    endTurn(state); // e1: bite 2 (use turn), Emboldened 3 -> 2, Stun power 3 -> 2
    pass(state); // e2
    pass(state); // p round 2: Thorns 5 -> 4
    expect(e1.hp).toBe(4);
    expect(startTurn(state)).toBe(true); // e1 round 2
    resolveAttack(ctx, e1, p, { hits: [phys(1)] }); // Thorns 4: e1 4 -> 0
    expect(e1.fallen).toBe(true);
    expect(state.over).toBe(false);
    const ev = during(ctx, () => endTurn(state));
    expect(eventsOf(ev, "TurnEnded")).toEqual([{ type: "TurnEnded", unit: "e1" }]);
    expect(removed(ev)).toEqual([]);
    expect(e1.cooldowns.remaining("bite")).toBe(2);
    expect(e1.statuses.stacks("emboldened")).toBe(2);
    expect(e1.stunPower).toBe(2);
    expect(activeId(state)).toBe("e2");
    expect(state.round).toBe(2);
  });
});

describe("Turn end", () => {
  it("ticking statuses other than DoT lose 1 stack; charges, meters and DoTs are untouched; StatusRemoved at 0", () => {
    const p = player({
      statuses: {
        emboldened: 3, enfeebled: 2, kindled: 1, dimmed: 4, thorns: 2, leeching: 1,
        warded: 2, piercing: 3, stunned: 7, paralysed: 6, burning: 3,
      },
    });
    const { ctx, state } = fight([p, enemy()]);
    startTurn(state); // Burning 3 -> 2 here
    const ev = during(ctx, () => endTurn(state));
    expect(p.statuses.stacks("emboldened")).toBe(2);
    expect(p.statuses.stacks("enfeebled")).toBe(1);
    expect(p.statuses.stacks("kindled")).toBe(0);
    expect(p.statuses.stacks("dimmed")).toBe(3);
    expect(p.statuses.stacks("thorns")).toBe(1);
    expect(p.statuses.stacks("leeching")).toBe(0);
    expect(p.statuses.stacks("warded")).toBe(2);
    expect(p.statuses.stacks("piercing")).toBe(3);
    expect(p.statuses.stacks("stunned")).toBe(7);
    expect(p.statuses.stacks("paralysed")).toBe(6);
    expect(p.statuses.stacks("burning")).toBe(2);
    expect(removed(ev)).toEqual(["kindled", "leeching"]);
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(typesOf(ev).filter((t) => t === "TurnEnded")).toHaveLength(1);
  });

  it("turn end only affects the unit whose turn it was", () => {
    const e = enemy("e", { stunPower: 3, statuses: { emboldened: 2, thorns: 1 } });
    const { state } = fight([player(), e]);
    pass(state);
    expect(e.statuses.stacks("emboldened")).toBe(2);
    expect(e.statuses.stacks("thorns")).toBe(1);
    expect(e.stunPower).toBe(3);
  });

  it("the unit's Stun power drops by 1 at the end of each of its turns, minimum 0", () => {
    const p = player({ stunPower: 2 });
    const e = enemy("e", { stunPower: 5 });
    const { state } = fight([p, e]);
    const seen: number[] = [];
    for (let r = 0; r < 3; r++) {
      pass(state); // p
      seen.push(p.stunPower);
      pass(state); // e
    }
    expect(seen).toEqual([1, 0, 0]);
    expect(p.maxStunPower).toBe(2);
    // e had 3 turns: 5 -> 2
    expect(e.stunPower).toBe(2);
  });
});

describe("Fight end", () => {
  it("as soon as the last enemy falls to a hit: over, winner, no active unit, CombatEnded once", () => {
    const e = enemy("e", { hp: 5 });
    const { ctx, state } = fight([player(), e]);
    startTurn(state);
    resolveHit(ctx, state.units[0] as CombatUnit, e, phys(10));
    expect(state.over).toBe(true);
    expect(state.winner).toBe("player");
    expect(state.active).toBeNull();
    expect(ctx.events.at(-1)).toEqual({ type: "CombatEnded", winner: "player" });
    expect(eventsOf(ctx.events, "CombatEnded")).toHaveLength(1);
  });

  it("later calls do nothing", () => {
    const e = enemy("e", { hp: 5 });
    const p = player();
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(10)] });
    const after = ctx.events.length;
    endTurn(state);
    expect(startTurn(state)).toBe(false);
    endTurn(state);
    expect(ctx.events.length).toBe(after);
    expect(state.round).toBe(1);
    expect(eventsOf(ctx.events, "CombatEnded")).toHaveLength(1);
  });

  it("killing one of two enemies does not end the fight; killing the second does", () => {
    const p = player();
    const e1 = enemy("e1", { hp: 3 });
    const e2 = enemy("e2", { hp: 3 });
    const { ctx, state } = fight([p, e1, e2]);
    startTurn(state);
    resolveHit(ctx, p, e1, phys(5));
    expect(state.over).toBe(false);
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([]);
    resolveHit(ctx, p, e2, phys(5));
    expect(state.over).toBe(true);
    expect(state.winner).toBe("player");
  });

  it("the player falling to Thorns ends the fight with the enemy as winner", () => {
    const p = player({ hp: 2 });
    const e = enemy("e", { statuses: { thorns: 5 } });
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(1), phys(1)] });
    expect(p.fallen).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("enemy");
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([{ type: "CombatEnded", winner: "enemy" }]);
    // Thorns killed the attacker during hit 1; hit 2 does nothing.
    expect(eventsOf(ctx.events, "HitStarted")).toHaveLength(1);
  });

  it("both sides fall in the same hit (player attacks into Thorns): the enemies win", () => {
    // p 2 HP vs Thorns 5: falls at step 3; the hit (10) still kills e (3 HP) at step 5.
    const p = player({ hp: 2 });
    const e = enemy("e", { hp: 3, statuses: { thorns: 5 } });
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(10)] });
    expect(p.fallen).toBe(true);
    expect(e.fallen).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("enemy");
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([{ type: "CombatEnded", winner: "enemy" }]);
  });

  it("both sides fall in the same hit (enemy attacks a player with Thorns): the enemies win", () => {
    // e 2 HP vs the player's Thorns 5: falls at step 3; the hit (10) still kills p (3 HP).
    const p = player({ hp: 3, statuses: { thorns: 5 } });
    const e = enemy("e", { hp: 2 });
    const { ctx, state } = fight([p, e]);
    pass(state); // p: Thorns 5 -> 4, still enough to kill e
    startTurn(state);
    resolveAttack(ctx, e, p, { hits: [phys(10)] });
    expect(p.fallen).toBe(true);
    expect(e.fallen).toBe(true);
    expect(state.winner).toBe("enemy");
    expect(eventsOf(ctx.events, "CombatEnded")).toEqual([{ type: "CombatEnded", winner: "enemy" }]);
  });

  it("a multi-hit attack whose first hit kills: the second hit does nothing", () => {
    const p = player();
    const e = enemy("e", { hp: 4 });
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(6), phys(6)] });
    expect(eventsOf(ctx.events, "HitStarted")).toHaveLength(1);
    expect(eventsOf(ctx.events, "CombatEnded")).toHaveLength(1);
  });
});
