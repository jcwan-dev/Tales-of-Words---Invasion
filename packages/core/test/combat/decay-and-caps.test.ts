import { describe, expect, it } from "vitest";
import {
  createCombatContext,
  endTurn,
  resolveConsume,
  resolveHit,
  startTurn,
  validatePack,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type SlowDecay,
  type StatusId,
} from "../../src/index.ts";
import { eventsOf } from "./helpers.ts";
import { activeId, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Task M1.3b. Spec Draft 1.6, "Synergy effects":
// - Consume: "The stacks are counted when the hit starts. If the hit isn't deflected, all stacks of that status are
//   removed at the end of the hit (including any the hit itself added); a deflected consume keeps them. A consume with
//   0 stacks still hits for 0."
//   "Cap (optional, per skill): a consume can set a maximum ("consume up to 10 Burning, ×3"). It then counts
//   min(stacks, cap) when the hit starts, deals that × multiplier, and removes exactly that many stacks at the end of
//   the hit if it isn't deflected; the rest stay. Without a cap it eats all stacks, as above."
// - "Slow decay (a unit trait from items, paths or companions): it names which statuses it slows (by id or tag, e.g.
//   the `dot` tag) and whose (the holder's own, or the units of the other side). While the holder is alive, those
//   statuses lose a stack only every other round (rounds 2, 4, 6…); on the other rounds their decay is skipped. Damage
//   over time still deals its damage every turn. Several sources covering the same status don't stack. Plague Censer:
//   the other side's damage over time."
// - "Decay floors (a unit trait): a status on the holder never decays below a minimum (The Glutton's Path: Leeching
//   never drops below 1). A floor only stops decay (turn-end ticking and the damage-over-time −1); it never creates a
//   status the unit doesn't have, and stacks spent as charges, consumed, or reset by a meter still go to 0. Several
//   floors on the same status: the highest counts. Floors and slow decay combine: a slowed status skips its decay on
//   odd rounds and never drops below its floor."
// "Turn details": turn start = DoT damage then −1 (Burning, Bleeding, Poisoned); turn end = ticking statuses other
// than DoTs lose 1 (Emboldened, Enfeebled, Kindled, Dimmed, Thorns, Leeching). A round is one pass through all
// living units; the player acts first on ties.
// Brief: UnitTraits.slowDecay?: readonly SlowDecay[] with SlowDecay { statuses: StatusId[] | { tag }, whose: "own" |
// "enemies" }; UnitTraits.decayFloors?: Partial<Record<StatusId, number>>; ConsumeSpec.max?: positive integer; the
// Consumed event reports the number removed (not emitted when 0 were removed, as in M1.3).

const hitValues = (events: readonly CombatEvent[]): number[] => eventsOf(events, "HitStarted").map((e) => e.value);

const censer: SlowDecay = { statuses: { tag: "dot" }, whose: "enemies" };
const slow = (...list: SlowDecay[]) => ({ traits: { slowDecay: list } });
const floors = (decayFloors: Partial<Record<StatusId, number>>) => ({ traits: { decayFloors } });

interface Track {
  /** Round of each of the watched unit's turns. */
  rounds: number[];
  /** The watched statuses' stacks after each of its turns (after turn end). */
  stacks: Record<string, number[]>;
  /** DoT damage (Shield + HP) the unit took at each of its turn starts. */
  dot: number[];
  /** StatusRemoved events for the unit during its turns. */
  removed: StatusId[];
}

/** Plays turns with no actions until the watched unit has had `turns` turns; records after each of its turns. */
function watch(state: CombatState, unit: CombatUnit, turns: number, statuses: readonly StatusId[]): Track {
  const t: Track = { rounds: [], stacks: {}, dot: [], removed: [] };
  for (const s of statuses) t.stacks[s] = [];
  while (t.rounds.length < turns && !state.over) {
    if (state.active === unit) {
      t.rounds.push(state.round);
      const ev = during(state.ctx, () => pass(state));
      for (const s of statuses) t.stacks[s]?.push(unit.statuses.stacks(s));
      t.dot.push(eventsOf(ev, "DotDamage").filter((d) => d.unit === unit.id).reduce((n, d) => n + d.shieldDamage + d.hpDamage, 0));
      for (const r of eventsOf(ev, "StatusRemoved")) if (r.unit === unit.id) t.removed.push(r.status);
    } else {
      pass(state);
    }
  }
  return t;
}

// =============================================================================================
describe("Consume with a cap: counts min(stacks, cap), deals n x multiplier, removes exactly n", () => {
  const capped = (max: number) => ({ status: "burning", multiplier: 3, damageType: "arcane", max }) as const;

  it("Burning 15, cap 10, x3: hits for 30; removes exactly 10; Burning 5 stays; Consumed reports 10", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 50, statuses: { burning: 15 } });
    expect(resolveConsume(ctx, player(), t, capped(10))).toBe(true);
    // n = min(15, 10) = 10; 10 x 3 = 30; HP 50 - 30 = 20
    expect(eventsOf(ctx.events, "HitStarted")).toEqual([{ type: "HitStarted", attacker: "p", target: "e", damageType: "arcane", value: 30 }]);
    expect(t.hp).toBe(20);
    expect(t.statuses.stacks("burning")).toBe(5);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 10 }]);
    expect(eventsOf(ctx.events, "StatusRemoved")).toEqual([]);
  });

  it("cap 1: Burning 5 -> hits for 1 x 3 = 3, Burning 4 stays", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { statuses: { burning: 5 } });
    resolveConsume(ctx, player(), t, capped(1));
    expect(hitValues(ctx.events)).toEqual([3]);
    expect(t.hp).toBe(27);
    expect(t.statuses.stacks("burning")).toBe(4);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 1 }]);
  });

  it("cap equal to the stacks (Burning 10, cap 10): hits for 30 and removes all 10", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 50, statuses: { burning: 10 } });
    resolveConsume(ctx, player(), t, capped(10));
    expect(hitValues(ctx.events)).toEqual([30]);
    expect(t.statuses.stacks("burning")).toBe(0);
    expect(t.statuses.has("burning")).toBe(false);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 10 }]);
  });

  it("cap above the stacks (Burning 4, cap 10): hits for 4 x 3 = 12 and removes all 4", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { statuses: { burning: 4 } });
    resolveConsume(ctx, player(), t, capped(10));
    expect(hitValues(ctx.events)).toEqual([12]);
    expect(t.hp).toBe(18);
    expect(t.statuses.has("burning")).toBe(false);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 4 }]);
  });

  it("with a cap, stacks the hit itself added stay (Bleeding 4, cap 10, Bleed power 2: hits for 8, removes 4, Bleeding 2 stays)", () => {
    // n = min(4, 10) = 4 counted at the start: 4 x 2 = 8 physical. Step 7: Bleed power 2 -> Bleeding 6.
    // End of hit: removes exactly n = 4 -> Bleeding 2. (Without a cap all 6 would go: see synergies.test.ts.)
    const ctx = createCombatContext("cap");
    const t = enemy("e", { statuses: { bleeding: 4 } });
    resolveConsume(ctx, player({ bleedPower: 2 }), t, { status: "bleeding", multiplier: 2, damageType: "physical", max: 10 });
    expect(hitValues(ctx.events)).toEqual([8]);
    expect(t.hp).toBe(22);
    expect(t.statuses.stacks("bleeding")).toBe(2);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 4 }]);
  });

  it("over the cap with hit-added stacks (Bleeding 12, cap 10, Bleed power 2: hits for 20, Bleeding 14 - 10 = 4 stays)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 50, statuses: { bleeding: 12 } });
    resolveConsume(ctx, player({ bleedPower: 2 }), t, { status: "bleeding", multiplier: 2, damageType: "physical", max: 10 });
    // 10 x 2 = 20; HP 50 - 20 = 30
    expect(hitValues(ctx.events)).toEqual([20]);
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("bleeding")).toBe(4);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 10 }]);
  });

  it("without a cap the same hit still eats everything, including what the hit added (Bleeding 12, Bleed power 2 -> Consumed 14)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 50, statuses: { bleeding: 12 } });
    resolveConsume(ctx, player({ bleedPower: 2 }), t, { status: "bleeding", multiplier: 2, damageType: "physical" });
    // 12 x 2 = 24; HP 50 - 24 = 26
    expect(hitValues(ctx.events)).toEqual([24]);
    expect(t.hp).toBe(26);
    expect(t.statuses.stacks("bleeding")).toBe(0);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "bleeding", stacks: 14 }]);
  });

  it("modifiers apply to n x multiplier (Burning 15, cap 10, Kindled 2: 30 x 1.5 = 45)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 60, statuses: { burning: 15 } });
    resolveConsume(ctx, player({ statuses: { kindled: 2 } }), t, capped(10));
    expect(hitValues(ctx.events)).toEqual([45]);
    expect(t.hp).toBe(15);
    expect(t.statuses.stacks("burning")).toBe(5);
  });

  it("Shield first (Burning 15, cap 10 -> 30 against Shield 12: Shield 0, HP 30 - 18 = 12)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxShield: 12, statuses: { burning: 15 } });
    resolveConsume(ctx, player(), t, capped(10));
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(12);
    expect(eventsOf(ctx.events, "DamageDealt")[0]).toMatchObject({ shieldDamage: 12, hpDamage: 18, piercing: false });
  });

  it("a deflected capped consume keeps all stacks: no damage, no Consumed, Warded charge used, returns false", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { statuses: { burning: 15, warded: 1 } });
    expect(resolveConsume(ctx, player(), t, capped(10))).toBe(false);
    // The hit still reports its value: 10 x 3 = 30
    expect(hitValues(ctx.events)).toEqual([30]);
    expect(t.hp).toBe(30);
    expect(t.statuses.stacks("burning")).toBe(15);
    expect(t.statuses.stacks("warded")).toBe(0);
    expect(eventsOf(ctx.events, "HitDeflected")).toEqual([{ type: "HitDeflected", attacker: "p", target: "e" }]);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
  });

  it("0 stacks with a cap: hits for 0, still a hit (Thorns fires), nothing removed, no Consumed", () => {
    const ctx = createCombatContext("cap");
    const a = player();
    const t = enemy("e", { statuses: { thorns: 3 } });
    expect(resolveConsume(ctx, a, t, capped(10))).toBe(true);
    expect(hitValues(ctx.events)).toEqual([0]);
    expect(eventsOf(ctx.events, "DamageDealt")).toEqual([
      { type: "DamageDealt", attacker: "p", target: "e", damageType: "arcane", shieldDamage: 0, hpDamage: 0, piercing: false },
    ]);
    expect(a.hp).toBe(27);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
  });

  it("0 stacks with a cap and Bleed power 3: n = 0, so the 3 Bleeding the hit added stay (no Consumed)", () => {
    // "removes exactly that many stacks": n = min(0, 10) = 0.
    const ctx = createCombatContext("cap");
    const t = enemy();
    expect(resolveConsume(ctx, player({ bleedPower: 3 }), t, { status: "bleeding", multiplier: 2, damageType: "physical", max: 10 })).toBe(true);
    expect(hitValues(ctx.events)).toEqual([0]);
    expect(t.statuses.stacks("bleeding")).toBe(3);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([]);
  });

  it("removes n even if the target falls (Burning 15, cap 10 on 20 HP: 30 damage, Consumed 10, Burning 5 left)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { hp: 20, statuses: { burning: 15 } });
    expect(resolveConsume(ctx, player(), t, capped(10))).toBe(true);
    expect(t.fallen).toBe(true);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 10 }]);
    expect(t.statuses.stacks("burning")).toBe(5);
  });

  it("two capped consumes in a row: Burning 15 -> 30 (5 left), then 15 (0 left)", () => {
    const ctx = createCombatContext("cap");
    const t = enemy("e", { maxHp: 60, statuses: { burning: 15 } });
    resolveConsume(ctx, player(), t, capped(10));
    resolveConsume(ctx, player(), t, capped(10));
    // 10 x 3 = 30, then min(5, 10) x 3 = 15; HP 60 - 45 = 15
    expect(hitValues(ctx.events)).toEqual([30, 15]);
    expect(t.hp).toBe(15);
    expect(t.statuses.has("burning")).toBe(false);
    expect(eventsOf(ctx.events, "Consumed").map((e) => e.stacks)).toEqual([10, 5]);
  });
});

describe("Content validation: the consume effect's optional max", () => {
  const consumeSkill = (extra: Record<string, unknown>) => ({
    path: "s.json",
    data: {
      kind: "skill",
      id: "skill.combustion",
      name: "skill.combustion.name",
      cost: 1,
      cooldown: 2,
      effects: [{ type: "consume", status: "burning", multiplier: 3, damageType: "arcane", target: "enemy", ...extra }],
    },
  });
  const issuesFor = (extra: Record<string, unknown>) => validatePack("test", [consumeSkill(extra)]).issues.map((i) => i.path);

  it("accepts a consume without max and with a positive integer max (1, 10)", () => {
    expect(issuesFor({})).toEqual([]);
    expect(issuesFor({ max: 1 })).toEqual([]);
    expect(issuesFor({ max: 10 })).toEqual([]);
    const res = validatePack("test", [consumeSkill({ max: 10 })]);
    expect(res.pack?.byId.size).toBe(1);
  });

  for (const bad of [0, -1, -10, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null, true]) {
    it(`rejects max = ${typeof bad === "string" ? JSON.stringify(bad) : String(bad)} at effects[0].max`, () => {
      const res = validatePack("test", [consumeSkill({ max: bad })]);
      expect(res.issues.map((i) => i.path)).toEqual(["s.json#effects[0].max"]);
      expect(res.pack).toBeUndefined();
    });
  }

  const otherBad: readonly [string, Record<string, unknown>, string][] = [
    ["an unknown status (frozen)", { status: "frozen" }, "s.json#effects[0].status"],
    ["multiplier -2", { multiplier: -2 }, "s.json#effects[0].multiplier"],
    ['multiplier "3"', { multiplier: "3" }, "s.json#effects[0].multiplier"],
    ['an invalid damageType ("fire")', { damageType: "fire" }, "s.json#effects[0].damageType"],
  ];
  for (const [label, extra, path] of otherBad) {
    it(`rejects ${label} at ${path.slice("s.json#".length)}`, () => {
      const res = validatePack("test", [consumeSkill(extra)]);
      expect(res.issues.map((i) => i.path)).toEqual([path]);
      expect(res.pack).toBeUndefined();
    });
  }
});

// =============================================================================================
describe("Slow decay by tag \"dot\" on the other side (Plague Censer)", () => {
  it("player holder, enemy Burning 3: damage 3, 3, 2, 2, 1, 1; stacks 3, 2, 2, 1, 1, 0 on rounds 1-6", () => {
    // Odd rounds keep the stack, even rounds lose 1. 3 + 3 + 2 + 2 + 1 + 1 = 12; HP 50 -> 38.
    const e = enemy("e", { maxHp: 50, statuses: { burning: 3 } });
    const { state } = fight([player(slow(censer)), e], "slow-tag");
    const r = watch(state, e, 6, ["burning"]);
    expect(r.rounds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.dot).toEqual([3, 3, 2, 2, 1, 1]);
    expect(r.stacks.burning).toEqual([3, 2, 2, 1, 1, 0]);
    expect(e.hp).toBe(38);
  });

  it("does not cover the other side's non-DoT ticking statuses (enemy Emboldened 3 -> 2 in round 1)", () => {
    const e = enemy("e", { statuses: { emboldened: 3, burning: 2 } });
    const { state } = fight([player(slow(censer)), e], "slow-tag-ticking");
    const r = watch(state, e, 1, ["emboldened", "burning"]);
    expect(r.stacks.emboldened).toEqual([2]);
    expect(r.stacks.burning).toEqual([2]);
  });

  it("does not cover the holder's own DoTs (player Poisoned 3 -> 2 in round 1)", () => {
    const p = player({ statuses: { poisoned: 3 }, ...slow(censer) });
    const { state } = fight([p, enemy()], "slow-tag-own");
    const r = watch(state, p, 1, ["poisoned"]);
    expect(r.dot).toEqual([3]);
    expect(r.stacks.poisoned).toEqual([2]);
  });

  it("by tag on the holder's own statuses (whose: own): player Bleeding 3 -> 3, 2, 2, 1; damage 3, 3, 2, 2", () => {
    const p = player({ maxHp: 50, statuses: { bleeding: 3 }, ...slow({ statuses: { tag: "dot" }, whose: "own" }) });
    const { state } = fight([p, enemy()], "slow-tag-own-dot");
    const r = watch(state, p, 4, ["bleeding"]);
    expect(r.rounds).toEqual([1, 2, 3, 4]);
    expect(r.dot).toEqual([3, 3, 2, 2]);
    expect(r.stacks.bleeding).toEqual([3, 2, 2, 1]);
    // 50 - 10 = 40
    expect(p.hp).toBe(40);
  });
});

describe("Slow decay by id list on the holder's own ticking statuses (turn-end ticking)", () => {
  it("Emboldened 3 and Thorns 3 lose a stack only on even rounds; uncovered Kindled 3 ticks every turn", () => {
    // Round:      1  2  3  4  5  6
    // Emboldened: 3  2  2  1  1  0
    // Thorns:     3  2  2  1  1  0
    // Kindled:    2  1  0  0  0  0
    const p = player({ statuses: { emboldened: 3, thorns: 3, kindled: 3 }, ...slow({ statuses: ["emboldened", "thorns"], whose: "own" }) });
    const { state } = fight([p, enemy()], "slow-own-ids");
    const r = watch(state, p, 6, ["emboldened", "thorns", "kindled"]);
    expect(r.rounds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.stacks.emboldened).toEqual([3, 2, 2, 1, 1, 0]);
    expect(r.stacks.thorns).toEqual([3, 2, 2, 1, 1, 0]);
    expect(r.stacks.kindled).toEqual([2, 1, 0, 0, 0, 0]);
    expect(p.statuses.has("emboldened")).toBe(false);
  });

  it("a covered status at 1 on an odd round stays at 1 (no StatusRemoved)", () => {
    const p = player({ statuses: { thorns: 1 }, ...slow({ statuses: ["thorns"], whose: "own" }) });
    const { state } = fight([p, enemy()], "slow-own-one");
    const r = watch(state, p, 2, ["thorns"]);
    // Round 1 (odd): kept at 1. Round 2 (even): 1 -> 0, removed.
    expect(r.stacks.thorns).toEqual([1, 0]);
    expect(r.removed).toEqual(["thorns"]);
  });

  it("own means the holder only: an ally's Emboldened ticks normally", () => {
    const e1 = enemy("e1", { statuses: { emboldened: 3 }, ...slow({ statuses: ["emboldened"], whose: "own" }) });
    const e2 = enemy("e2", { statuses: { emboldened: 3 } });
    const { state } = fight([player(), e1, e2], "slow-own-ally");
    pass(state); // p
    pass(state); // e1: kept (round 1)
    pass(state); // e2: 3 -> 2
    expect(e1.statuses.stacks("emboldened")).toBe(3);
    expect(e2.statuses.stacks("emboldened")).toBe(2);
  });

  it("own does not reach the other side: the enemy's Emboldened ticks normally", () => {
    const e = enemy("e", { statuses: { emboldened: 3 } });
    const { state } = fight([player(slow({ statuses: ["emboldened"], whose: "own" })), e], "slow-own-enemy");
    const r = watch(state, e, 1, ["emboldened"]);
    expect(r.stacks.emboldened).toEqual([2]);
  });
});

describe("Slow decay by id list on the other side's ticking statuses", () => {
  it("enemy Enfeebled 4 with a player holder: 4, 3, 3, 2 on rounds 1-4; the holder's own Enfeebled 4 ticks normally", () => {
    const p = player({ statuses: { enfeebled: 4 }, ...slow({ statuses: ["enfeebled"], whose: "enemies" }) });
    const e = enemy("e", { statuses: { enfeebled: 4 } });
    const { state } = fight([p, e], "slow-enemies-ids");
    const r = watch(state, e, 4, ["enfeebled"]);
    expect(r.rounds).toEqual([1, 2, 3, 4]);
    expect(r.stacks.enfeebled).toEqual([4, 3, 3, 2]);
    // p had 4 turn ends (rounds 1-4): 4 -> 0
    expect(p.statuses.stacks("enfeebled")).toBe(0);
  });

  it("covers every unit of the other side (two enemies with Dimmed 2: both kept in round 1, both 1 after round 2)", () => {
    const e1 = enemy("e1", { statuses: { dimmed: 2 } });
    const e2 = enemy("e2", { statuses: { dimmed: 2 } });
    const { state } = fight([player(slow({ statuses: ["dimmed"], whose: "enemies" })), e1, e2], "slow-enemies-all");
    for (let i = 0; i < 3; i++) pass(state); // round 1
    expect([e1.statuses.stacks("dimmed"), e2.statuses.stacks("dimmed")]).toEqual([2, 2]);
    for (let i = 0; i < 3; i++) pass(state); // round 2
    expect([e1.statuses.stacks("dimmed"), e2.statuses.stacks("dimmed")]).toEqual([1, 1]);
  });

  it("an enemy holder slows the player's Leeching (4, 3, 3, 2)", () => {
    const p = player({ statuses: { leeching: 4 } });
    const { state } = fight([p, enemy("e", slow({ statuses: ["leeching"], whose: "enemies" }))], "slow-enemies-player");
    const r = watch(state, p, 4, ["leeching"]);
    expect(r.stacks.leeching).toEqual([4, 3, 3, 2]);
  });
});

describe("Slow decay does not touch charges, consumes or meter resets", () => {
  it("Warded charges on a covered enemy are still used on an odd round (Warded 2 -> 1)", () => {
    const p = player(slow({ statuses: ["warded", "piercing"], whose: "enemies" }));
    const e = enemy("e", { statuses: { warded: 2 } });
    const { ctx, state } = fight([p, e], "slow-charges");
    startTurn(state); // round 1
    resolveHit(ctx, p, e, phys(5));
    endTurn(state);
    expect(e.statuses.stacks("warded")).toBe(1);
  });

  it("the holder's own covered Piercing charge is still used on an odd round (Piercing 2 -> 1)", () => {
    const p = player({ statuses: { piercing: 2 }, ...slow({ statuses: ["piercing"], whose: "own" }) });
    const e = enemy("e", { maxShield: 10 });
    const { ctx, state } = fight([p, e], "slow-piercing");
    startTurn(state);
    resolveHit(ctx, p, e, phys(5));
    endTurn(state);
    expect(p.statuses.stacks("piercing")).toBe(1);
    expect(e.hp).toBe(25);
  });

  it("a consume on a slowed Burning in round 1 still removes all of it", () => {
    const p = player(slow(censer));
    const e = enemy("e", { statuses: { burning: 4 } });
    const { ctx, state } = fight([p, e], "slow-consume");
    startTurn(state);
    resolveConsume(ctx, p, e, { status: "burning", multiplier: 3, damageType: "arcane" });
    endTurn(state);
    expect(e.statuses.has("burning")).toBe(false);
    expect(e.hp).toBe(18);
  });

  it("a covered Stunned 10 still resets to 0 at the enemy's round-1 gate", () => {
    const e = enemy("e", { statuses: { stunned: 10 } });
    const { state } = fight([player(slow({ statuses: ["stunned"], whose: "enemies" })), e], "slow-meter");
    pass(state); // p
    expect(startTurn(state)).toBe(false);
    expect(e.statuses.stacks("stunned")).toBe(0);
  });
});

describe("Slow decay ends when the holder falls", () => {
  it("DoT: enemy holder killed in round 1; the player's Burning 4 then loses a stack in rounds 2 and 3", () => {
    // Round 1: p takes 4 (30 -> 26), kept (holder alive at turn start). p kills e1. Round 2: 4 (-> 22), -> 3.
    // Round 3 (odd): 3 (-> 19), -> 2, because the holder has fallen.
    const p = player({ statuses: { burning: 4 } });
    const e1 = enemy("e1", { hp: 5, ...slow(censer) });
    const { ctx, state } = fight([p, e1, enemy("e2")], "slow-fallen-dot");
    startTurn(state);
    expect(p.statuses.stacks("burning")).toBe(4);
    resolveHit(ctx, p, e1, phys(10));
    expect(e1.fallen).toBe(true);
    endTurn(state);
    expect(activeId(state)).toBe("e2");
    pass(state); // e2
    const r = watch(state, p, 2, ["burning"]);
    expect(r.rounds).toEqual([2, 3]);
    expect(r.dot).toEqual([4, 3]);
    expect(r.stacks.burning).toEqual([3, 2]);
    expect(p.hp).toBe(19);
  });

  it("ticking: player Emboldened 4 slowed by e1; e1 killed in round 2; round 3 ticks normally (4, 3, 2)", () => {
    // Round 1: kept 4. Round 2: p kills e1, then turn end (even round anyway) -> 3. Round 3 (odd): holder fallen -> 2.
    const p = player({ statuses: { emboldened: 4 } });
    const e1 = enemy("e1", { hp: 5, ...slow({ statuses: ["emboldened"], whose: "enemies" }) });
    const { ctx, state } = fight([p, e1, enemy("e2")], "slow-fallen-tick");
    const seen: number[] = [];
    pass(state); // p, round 1
    seen.push(p.statuses.stacks("emboldened"));
    pass(state); // e1
    pass(state); // e2
    startTurn(state); // p, round 2
    resolveHit(ctx, p, e1, phys(10));
    expect(e1.fallen).toBe(true);
    endTurn(state);
    seen.push(p.statuses.stacks("emboldened"));
    pass(state); // e2
    expect(state.round).toBe(3);
    pass(state); // p, round 3
    seen.push(p.statuses.stacks("emboldened"));
    expect(seen).toEqual([4, 3, 2]);
  });

  it("ticking: the holder falling during the player's odd-round action means that turn end already ticks (Emboldened 4 -> 3)", () => {
    // "While the holder is alive": at the player's round-1 turn end the holder has already fallen.
    const p = player({ statuses: { emboldened: 4 } });
    const e1 = enemy("e1", { hp: 5, ...slow({ statuses: ["emboldened"], whose: "enemies" }) });
    const { ctx, state } = fight([p, e1, enemy("e2")], "slow-fallen-mid-turn");
    startTurn(state);
    resolveHit(ctx, p, e1, phys(10));
    endTurn(state);
    expect(p.statuses.stacks("emboldened")).toBe(3);
  });
});

describe("Several slow decay sources covering the same status don't stack", () => {
  const playerBurning = (units: (p: CombatUnit) => CombatUnit[], seed: string): number[] => {
    const p = player({ maxHp: 50, statuses: { burning: 4 } });
    const { state } = fight(units(p), seed);
    return watch(state, p, 4, ["burning"]).stacks.burning ?? [];
  };

  it("one holder: 4, 3, 3, 2; no holder: 3, 2, 1, 0", () => {
    expect(playerBurning((p) => [p, enemy("e1", slow(censer)), enemy("e2")], "stack-1")).toEqual([4, 3, 3, 2]);
    expect(playerBurning((p) => [p, enemy("e1"), enemy("e2")], "stack-0")).toEqual([3, 2, 1, 0]);
  });

  it("two holders on the other side: same as one (4, 3, 3, 2)", () => {
    expect(playerBurning((p) => [p, enemy("e1", slow(censer)), enemy("e2", slow(censer))], "stack-2")).toEqual([4, 3, 3, 2]);
  });

  it("two entries on one holder covering Burning (tag dot and id list): same as one", () => {
    const both = slow(censer, { statuses: ["burning"], whose: "enemies" });
    expect(playerBurning((p) => [p, enemy("e1", both), enemy("e2")], "stack-entries")).toEqual([4, 3, 3, 2]);
  });

  it("the player's own slow decay plus an enemy Censer: same as one", () => {
    const p = player({ maxHp: 50, statuses: { burning: 4 }, ...slow({ statuses: { tag: "dot" }, whose: "own" }) });
    const { state } = fight([p, enemy("e1", slow(censer))], "stack-own-and-enemy");
    expect(watch(state, p, 4, ["burning"]).stacks.burning).toEqual([4, 3, 3, 2]);
  });

  it("ticking status: two holders slowing enemy Enfeebled 4 -> 4, 3, 3, 2", () => {
    const tick: SlowDecay = { statuses: ["enfeebled"], whose: "enemies" };
    const p = player({ maxHp: 50, statuses: { enfeebled: 4 } });
    const { state } = fight([p, enemy("e1", slow(tick)), enemy("e2", slow(tick))], "stack-tick");
    expect(watch(state, p, 4, ["enfeebled"]).stacks.enfeebled).toEqual([4, 3, 3, 2]);
  });
});

// =============================================================================================
describe("Decay floors: a status on the holder never decays below a minimum", () => {
  it("The Glutton's Path: Leeching 3 with floor 1 -> 2, 1, 1, 1, 1 (turn-end ticking stops at 1, never removed)", () => {
    const p = player({ statuses: { leeching: 3 }, ...floors({ leeching: 1 }) });
    const { state } = fight([p, enemy()], "floor-leeching");
    const r = watch(state, p, 5, ["leeching"]);
    expect(r.rounds).toEqual([1, 2, 3, 4, 5]);
    expect(r.stacks.leeching).toEqual([2, 1, 1, 1, 1]);
    expect(r.removed).toEqual([]);
    expect(p.statuses.has("leeching")).toBe(true);
  });

  it("only the floored status: Emboldened 2 on the same holder ticks to 0", () => {
    const p = player({ statuses: { leeching: 2, emboldened: 2 }, ...floors({ leeching: 1 }) });
    const { state } = fight([p, enemy()], "floor-only");
    const r = watch(state, p, 3, ["leeching", "emboldened"]);
    expect(r.stacks.leeching).toEqual([1, 1, 1]);
    expect(r.stacks.emboldened).toEqual([1, 0, 0]);
    expect(r.removed).toEqual(["emboldened"]);
  });

  it("only on the holder: the enemy's Leeching 2 ticks to 0", () => {
    const e = enemy("e", { statuses: { leeching: 2 } });
    const { state } = fight([player(floors({ leeching: 1 })), e], "floor-holder-only");
    const r = watch(state, e, 2, ["leeching"]);
    expect(r.stacks.leeching).toEqual([1, 0]);
  });

  it("DoT floor: Burning 4 with floor 2 deals 4, 3, 2, 2, 2 and stops at 2 (the -1 at turn start is stopped)", () => {
    // R1: 4 dmg -> 3. R2: 3 -> 2. R3: 2 dmg, stays 2. R4: 2, stays. R5: 2, stays. 4 + 3 + 2 + 2 + 2 = 13; HP 50 -> 37.
    const e = enemy("e", { maxHp: 50, statuses: { burning: 4 }, ...floors({ burning: 2 }) });
    const { state } = fight([player(), e], "floor-dot");
    const r = watch(state, e, 5, ["burning"]);
    expect(r.dot).toEqual([4, 3, 2, 2, 2]);
    expect(r.stacks.burning).toEqual([3, 2, 2, 2, 2]);
    expect(e.hp).toBe(37);
    expect(r.removed).toEqual([]);
  });

  it("DoT floor 1 on Bleeding 1: 1 damage every turn, forever (5 turns -> 5 damage)", () => {
    const e = enemy("e", { statuses: { bleeding: 1 }, ...floors({ bleeding: 1 }) });
    const { state } = fight([player(), e], "floor-dot-one");
    const r = watch(state, e, 5, ["bleeding"]);
    expect(r.dot).toEqual([1, 1, 1, 1, 1]);
    expect(r.stacks.bleeding).toEqual([1, 1, 1, 1, 1]);
    expect(e.hp).toBe(25);
  });

  it("a status already below its floor doesn't decay and isn't raised (Leeching 1 with floor 2 stays 1)", () => {
    const p = player({ statuses: { leeching: 1 }, ...floors({ leeching: 2 }) });
    const { state } = fight([p, enemy()], "floor-below");
    const r = watch(state, p, 3, ["leeching"]);
    expect(r.stacks.leeching).toEqual([1, 1, 1]);
  });

  it("a stopped decay emits nothing (no StatusApplied, no StatusRemoved during the turn)", () => {
    const p = player({ statuses: { leeching: 1 }, ...floors({ leeching: 1 }) });
    const { ctx, state } = fight([p, enemy()], "floor-events");
    const ev = during(ctx, () => pass(state));
    expect(eventsOf(ev, "StatusApplied")).toEqual([]);
    expect(eventsOf(ev, "StatusRemoved")).toEqual([]);
    expect(p.statuses.stacks("leeching")).toBe(1);
  });

  it("never creates a status: a holder with floors and no Leeching or Burning keeps none (no events)", () => {
    const p = player(floors({ leeching: 1, burning: 2 }));
    const { ctx, state } = fight([p, enemy()], "floor-no-create");
    const ev = during(ctx, () => {
      for (let i = 0; i < 6; i++) pass(state); // 3 rounds
    });
    expect(p.statuses.has("leeching")).toBe(false);
    expect(p.statuses.has("burning")).toBe(false);
    expect(eventsOf(ev, "StatusApplied")).toEqual([]);
    expect(eventsOf(ev, "DotDamage")).toEqual([]);
    expect(p.hp).toBe(30);
  });

  it("a status gained mid-fight is floored from then on (Leeching 2 gained in round 1 -> 1, 1, 1)", () => {
    const p = player(floors({ leeching: 1 }));
    const { state } = fight([p, enemy()], "floor-gained");
    startTurn(state);
    p.statuses.add("leeching", 2);
    endTurn(state);
    expect(p.statuses.stacks("leeching")).toBe(1);
    const r = watch(state, p, 2, ["leeching"]);
    expect(r.stacks.leeching).toEqual([1, 1]);
  });
});

describe("Decay floors don't stop charges, consumes or meter resets", () => {
  it("consumed: Burning 5 with floor 3 is consumed to 0 (Consumed 5)", () => {
    const ctx = createCombatContext("floor-consume");
    const t = enemy("e", { statuses: { burning: 5 }, ...floors({ burning: 3 }) });
    resolveConsume(ctx, player(), t, { status: "burning", multiplier: 3, damageType: "arcane" });
    expect(t.statuses.stacks("burning")).toBe(0);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 5 }]);
  });

  it("capped consume: Burning 5 with floor 3, cap 10 -> removes all 5 (floor ignored)", () => {
    const ctx = createCombatContext("floor-consume-cap");
    const t = enemy("e", { statuses: { burning: 5 }, ...floors({ burning: 3 }) });
    resolveConsume(ctx, player(), t, { status: "burning", multiplier: 3, damageType: "arcane", max: 10 });
    expect(t.statuses.stacks("burning")).toBe(0);
    expect(eventsOf(ctx.events, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 5 }]);
  });

  it("charges: Warded 1 with floor 1 is used by a deflect (-> 0)", () => {
    const ctx = createCombatContext("floor-warded");
    const t = enemy("e", { statuses: { warded: 1 }, ...floors({ warded: 1 }) });
    resolveHit(ctx, player(), t, phys(5));
    expect(eventsOf(ctx.events, "HitDeflected")).toHaveLength(1);
    expect(t.statuses.stacks("warded")).toBe(0);
  });

  it("charges: Piercing 1 with floor 1 is used by a hit (-> 0)", () => {
    const ctx = createCombatContext("floor-piercing");
    const a = player({ statuses: { piercing: 1 }, ...floors({ piercing: 1 }) });
    resolveHit(ctx, a, enemy("e", { maxShield: 10 }), phys(5));
    expect(a.statuses.stacks("piercing")).toBe(0);
  });

  it("meter reset: Stunned 10 with floor 5 resets to 0 at the gate", () => {
    const e = enemy("e", { statuses: { stunned: 10 }, ...floors({ stunned: 5 }) });
    const { state } = fight([player(), e], "floor-meter");
    pass(state); // p
    expect(startTurn(state)).toBe(false);
    expect(e.statuses.stacks("stunned")).toBe(0);
  });
});

describe("Floors and slow decay combine", () => {
  it("own Leeching 5, slowed (own) with floor 2: 5, 4, 4, 3, 3, 2, 2, 2 on rounds 1-8", () => {
    // Odd rounds skip; even rounds -1 until the floor: R2 4, R4 3, R6 2, R8 stays 2 (floor).
    const p = player({ statuses: { leeching: 5 }, traits: { slowDecay: [{ statuses: ["leeching"], whose: "own" }], decayFloors: { leeching: 2 } } });
    const { state } = fight([p, enemy("e", { maxHp: 100 })], "combine-leeching");
    const r = watch(state, p, 8, ["leeching"]);
    expect(r.rounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.stacks.leeching).toEqual([5, 4, 4, 3, 3, 2, 2, 2]);
  });

  it("enemy Burning 4 with floor 2 under a player Censer: damage 4, 4, 3, 3, 2, 2, 2; stacks 4, 3, 3, 2, 2, 2, 2", () => {
    // R1 keep 4. R2 -> 3. R3 keep. R4 -> 2. R5 keep. R6 stays 2 (floor). R7 keep.
    // 4 + 4 + 3 + 3 + 2 + 2 + 2 = 20; HP 50 -> 30.
    const e = enemy("e", { maxHp: 50, statuses: { burning: 4 }, ...floors({ burning: 2 }) });
    const { state } = fight([player(slow(censer)), e], "combine-dot");
    const r = watch(state, e, 7, ["burning"]);
    expect(r.rounds).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.dot).toEqual([4, 4, 3, 3, 2, 2, 2]);
    expect(r.stacks.burning).toEqual([4, 3, 3, 2, 2, 2, 2]);
    expect(e.hp).toBe(30);
  });
});
