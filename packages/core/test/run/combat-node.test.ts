import { describe, expect, it } from "vitest";
import {
  assemblePlayer,
  cardFromSkill,
  cardWithRarity,
  chooseOption,
  combatNodeType,
  completeNode,
  endRun,
  fallInNode,
  fightOutcome,
  fightPass,
  fightPlay,
  finishFight,
  playerUnitFromRun,
  resumeFightAfterRevive,
  revive,
  RUN_LIMITS,
  startFight,
  startRun,
  STATUS_IDS,
  validatePack,
  type CombatUnit,
  type CommandResult,
  type ContentFile,
  type FightSession,
  type Grant,
  type LoadoutPicks,
  type NodeOption,
  type RunContext,
  type RunState,
  type UnitInit,
} from "../../src/index.ts";
import { BASE_FILES } from "../combat/base-pack.ts";
import { picks } from "./loadout-pack.ts";
import { kinds, ok, snapshot } from "./run-pack.ts";
import {
  advanceTo,
  combatAct,
  combatCtx,
  combatData,
  combatRegistry,
  enemiesOf,
  eventsOf,
  fightAct,
  fightAgainst,
  FIGHT_PICKS,
  fightSnapshot,
  playerOf,
  runInFight,
  startCombatRun,
  STRIKE,
  strikeUntilOver,
  TECHNIQUE,
  unitOf,
} from "./combat-pack.ts";

// Spec Draft 1.10, "Combat node" (decided 12 Oct 2026), with "Run map", "Enemy moves", "Turn pipeline",
// "Loadout assembly", "Shield and HP"; brief M2.3 (public API, rules notes):
//   Act data: `groups` (group ids the act draws from) and `tiers` (step bands { from, weights }; a band applies
//     from its step until the next band; boss can't be drawn). Enemies don't scale with steps.
//   Combat type (id "combat", may follow itself): can appear when the current band has a tier with weight > 0
//     that has at least one non-boss group in the act.
//   Drawn build: the tier by the current band's weights among tiers with at least one group in the act, then one
//     group of that tier with equal chance; tag `node.tag.<tier>`, text = the group's text, data { group, tier }.
//   Fixed build: ref is the group id, whatever its tier (not a group → RangeError).
//   Fight: the player unit from the run (loadout modifiers on the run's base stats, floor 0; the run's HP;
//     Shield full; the run's cards in order, the weapon id being Strike; powers and traits from the loadout; no
//     statuses). Enemies from their files, ids enemy1..enemy3 in group order. Own RNG stream from the run seed,
//     act position, act, step, option. Commands: play a card or pass; enemy turns run on their own until it is the
//     player's turn again or the fight is over. Refused commands change nothing.
//   Won: node result = HP change only (no crowns). Fallen: phase "fallen", the node stays current; a revive puts the
//     run back in the node at half max HP rounded up (no advance), and the fight continues: Shield full, the
//     player's statuses cleared, enemies unchanged (HP, statuses, intents, cooldowns), the player's cooldowns
//     kept, the player acts next (a new round). Ending the tale: the run is lost. Revive limit 2 per run.
//   Same seed + same commands → same fight; a JSON round trip of the run in "inNode" + startFight → the same
//     fight from the start. Both sides falling in the same hit: the enemies win → outcome "fallen".

const REVIVE: Grant = { action: "revive", source: "ad" };
const seeds = (n: number, prefix = "s"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Every option offered at `step` over runs with the given seeds. */
function offersAt(ctx: RunContext, seedList: readonly string[], step = 1): NodeOption[] {
  const out: NodeOption[] = [];
  for (const seed of seedList) {
    const run = startCombatRun(ctx, seed);
    advanceTo(ctx, run, step);
    out.push(...run.offer);
  }
  return out;
}

const combatOptions = (options: readonly NodeOption[]): NodeOption[] => options.filter((o) => o.type === "combat");

const fraction = (options: readonly NodeOption[], pred: (o: NodeOption) => boolean): number =>
  options.filter(pred).length / options.length;

function expectRefusedRun(run: RunState, command: () => CommandResult, reason: string): void {
  const before = snapshot(run);
  const res = command();
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe(reason);
  expect(snapshot(run)).toEqual(before);
}

/** Every status's stacks on a unit, as a record (0 included). */
const statusesOf = (u: CombatUnit): Record<string, number> => Object.fromEntries(STATUS_IDS.map((s) => [s, u.statuses.stacks(s)]));
const hasAnyStatus = (u: CombatUnit): boolean => STATUS_IDS.some((s) => u.statuses.stacks(s) > 0);

/** Per-unit state the revive must keep for enemies. */
const enemyState = (session: FightSession) =>
  enemiesOf(session).map((u) => ({
    id: u.id,
    hp: u.hp,
    shield: u.shield,
    intent: u.intent,
    statuses: statusesOf(u),
    cooldowns: u.moves.map((m) => u.cooldowns.remaining(m.card.id)),
  }));

/** Against group.brute: Strike, then the technique; two smashes (30 each) fell the player (43 HP, 1 Shield). */
function fallToBrute(session: FightSession): void {
  expect(fightPlay(session, STRIKE).ok).toBe(true);
  expect(fightOutcome(session)).toBe("ongoing");
  expect(fightPlay(session, TECHNIQUE).ok).toBe(true);
  expect(fightOutcome(session)).toBe("fallen");
}

/** A deterministic policy for the determinism tests: Strike the first living enemy, the technique every third turn. */
function scriptedFight(session: FightSession, maxTurns = 60): void {
  for (let n = 0; n < maxTurns && fightOutcome(session) === "ongoing"; n++) {
    const target = enemiesOf(session).find((u) => !u.fallen)?.id;
    const card = n % 3 === 2 ? TECHNIQUE : STRIKE;
    if (!fightPlay(session, card, target).ok && !fightPlay(session, STRIKE, target).ok) fightPass(session);
  }
}

// =============================================================================================
// The module

describe("combat node type", () => {
  it('has id "combat" and may follow itself', () => {
    expect(combatNodeType.id).toBe("combat");
    expect(combatNodeType.mayFollowItself).toBe(true);
  });
});

// =============================================================================================
// canAppear (observed through the run engine: weights combat 1 / event 1)

describe("combat node: when it can appear", () => {
  const mixed = (over: Record<string, unknown>) => combatCtx([combatAct("act.c", { weights: { combat: 1, event: 1 }, ...over })]);
  const types = (ctx: RunContext, step = 1): string[] => offersAt(ctx, seeds(40), step).map((o) => o.type);

  it("appears when the act has groups and the band has a tier with groups", () => {
    expect(types(mixed({}))).toContain("combat");
  });

  it("never appears in an act without groups and tiers", () => {
    expect(types(mixed({ groups: undefined, tiers: undefined }))).not.toContain("combat");
  });

  it("never appears when the act's only group is a boss group", () => {
    expect(types(mixed({ groups: ["group.boss"], tiers: [{ from: 1, weights: { normal: 1, hard: 1, elite: 1 } }] }))).not.toContain("combat");
  });

  it("never appears when the band's positive tiers have no group in the act", () => {
    // Hard weight only, but only normal groups: nothing to draw.
    expect(types(mixed({ tiers: [{ from: 1, weights: { normal: 0, hard: 1 } }] }))).not.toContain("combat");
  });

  it("only counts the act's own groups, not every group of the pack", () => {
    // The pack has normal groups, but the act lists only a hard one; the band draws normal only.
    expect(types(mixed({ groups: ["group.h1"], tiers: [{ from: 1, weights: { normal: 1 } }] }))).not.toContain("combat");
  });

  it("depends on the band of the current step", () => {
    const ctx = mixed({ tiers: [{ from: 1, weights: { hard: 1 } }, { from: 2, weights: { normal: 1 } }] });
    expect(types(ctx, 1)).not.toContain("combat");
    expect(types(ctx, 2)).toContain("combat");
  });

  it("an act whose only weighted type is combat, with nothing drawable, is a content error", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: undefined, tiers: undefined })]);
    expect(() => startCombatRun(ctx)).toThrow();
  });
});

// =============================================================================================
// Drawn builds

describe("combat node: drawn options", () => {
  it("builds tag node.tag.<tier>, the group's text and data { group, tier }", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1", "group.h2"], tiers: [{ from: 1, weights: { normal: 1, hard: 1 } }] })]);
    const options = offersAt(ctx, seeds(20));
    expect(options).toHaveLength(60);
    for (const o of options) {
      const d = combatData(o);
      expect(o.type).toBe("combat");
      expect(o.fixed).toBe(false);
      expect(o.ref).toBeNull();
      expect(o.data).toMatchObject({ group: d.group, tier: d.tier });
      expect(["group.n1", "group.h2"]).toContain(d.group);
      expect(d.tier).toBe(d.group === "group.n1" ? "normal" : "hard");
      expect(o.tag).toBe(`node.tag.${d.tier}`);
      expect(o.text).toBe(`${d.group}.text`);
    }
  });

  it("draws the tier from the band of the current step (band boundaries included)", () => {
    // Steps 1–2 normal, 3–5 hard, 6 elite (7 is the boss).
    const act = combatAct("act.c", {
      steps: { min: 7, max: 7 },
      groups: ["group.n1", "group.h1", "group.e1"],
      tiers: [
        { from: 1, weights: { normal: 1 } },
        { from: 3, weights: { hard: 1 } },
        { from: 6, weights: { elite: 1 } },
      ],
    });
    const ctx = combatCtx([act]);
    const expected = ["normal", "normal", "hard", "hard", "hard", "elite"];
    for (const seed of seeds(5)) {
      const run = startCombatRun(ctx, seed);
      for (let step = 1; step <= 6; step++) {
        advanceTo(ctx, run, step);
        expect(run.step).toBe(step);
        for (const o of run.offer) expect(combatData(o).tier).toBe(expected[step - 1]);
      }
    }
  });

  it("weights the tiers by the band's weights", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1", "group.h1"], tiers: [{ from: 1, weights: { normal: 3, hard: 1 } }] })]);
    const options = offersAt(ctx, seeds(300));
    const normal = fraction(options, (o) => combatData(o).tier === "normal");
    expect(normal).toBeGreaterThan(0.68);
    expect(normal).toBeLessThan(0.82);
  });

  it("draws only among tiers that have a group in the act", () => {
    // Hard has weight but no group: only normal and elite are drawn, about half each.
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1", "group.e1"], tiers: [{ from: 1, weights: { normal: 1, hard: 1, elite: 1 } }] })]);
    const options = offersAt(ctx, seeds(200));
    expect(options.some((o) => combatData(o).tier === "hard")).toBe(false);
    const normal = fraction(options, (o) => combatData(o).tier === "normal");
    expect(normal).toBeGreaterThan(0.4);
    expect(normal).toBeLessThan(0.6);
  });

  it("a huge weight on a tier without groups changes nothing", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1"], tiers: [{ from: 1, weights: { normal: 1, hard: 1000, elite: 1000 } }] })]);
    for (const o of offersAt(ctx, seeds(30))) expect(combatData(o)).toMatchObject({ group: "group.n1", tier: "normal" });
  });

  it("draws a group of the tier with equal chance, never a boss group", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1", "group.boss", "group.n2", "group.n3"] })]);
    const options = offersAt(ctx, seeds(300));
    expect(options.some((o) => combatData(o).tier === "boss" || combatData(o).group === "group.boss")).toBe(false);
    for (const g of ["group.n1", "group.n2", "group.n3"]) {
      const f = fraction(options, (o) => combatData(o).group === g);
      expect(f).toBeGreaterThan(0.25);
      expect(f).toBeLessThan(0.42);
    }
  });

  it("draws only from the act's own groups", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n2"] })]);
    for (const o of offersAt(ctx, seeds(30))) expect(combatData(o).group).toBe("group.n2");
  });

  it("can offer the same group twice at one step (two different nodes)", () => {
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.n1"] })]);
    const run = startCombatRun(ctx);
    expect(run.offer.map((o) => combatData(o).group)).toEqual(["group.n1", "group.n1", "group.n1"]);
  });
});

// =============================================================================================
// Fixed builds

describe("combat node: fixed nodes", () => {
  it("uses ref as the group, whatever its tier and whether or not the act lists it", () => {
    const run = startCombatRun(combatCtx([fightAct("group.trio")]));
    expect(run.offer).toHaveLength(1);
    const o = run.offer[0];
    expect(o).toMatchObject({ type: "combat", ref: "group.trio", fixed: true, text: "group.trio.text", tag: "node.tag.hard" });
    expect(o?.data).toMatchObject({ group: "group.trio", tier: "hard" });
  });

  it("builds the boss at the last step with tag node.tag.boss", () => {
    const ctx = combatCtx([combatAct()]);
    const run = startCombatRun(ctx);
    advanceTo(ctx, run, 3);
    expect(run.offer).toHaveLength(1);
    expect(run.offer[0]).toMatchObject({ type: "combat", ref: "group.boss", fixed: true, text: "group.boss.text", tag: "node.tag.boss" });
    expect(run.offer[0]?.data).toMatchObject({ group: "group.boss", tier: "boss" });
  });

  it("works in an act without groups or tiers (canAppear isn't asked for fixed nodes)", () => {
    const ctx = combatCtx([fightAct("group.dummy", { groups: undefined, tiers: undefined })]);
    const run = startCombatRun(ctx);
    expect(run.offer[0]?.data).toMatchObject({ group: "group.dummy", tier: "normal" });
  });

  it("throws RangeError without a ref (clarification 9)", () => {
    const act = fightAct("group.dummy", { fixed: [{ at: 1, type: "combat" }, { at: "last", type: "combat", ref: "group.boss" }] });
    expect(() => startCombatRun(combatCtx([act]))).toThrow(RangeError);
  });

  it("throws RangeError when ref isn't a group", () => {
    expect(() => startCombatRun(combatCtx([fightAct("enemy.dummy")]))).toThrow(RangeError);
    expect(() => startCombatRun(combatCtx([fightAct("group.nope")]))).toThrow(RangeError);
  });
});

// =============================================================================================
// The player unit

describe("playerUnitFromRun", () => {
  const cases: [string, LoadoutPicks, string | null][] = [
    ["the fight picks", FIGHT_PICKS, TECHNIQUE],
    ["stat floor, item HP and Shield", picks({ weapon: "weapon.heavy", armor: "armor.crushing", accessory: "accessory.locket" }), null],
    ["powers and traits from every slot", picks({ weapon: "weapon.fang", armor: "armor.thorned", accessory: "accessory.censer", path: "path.glutton" }), TECHNIQUE],
    ["a granted skill", picks({ accessory: "accessory.scroll_case" }), "skill.t_vit"],
  ];

  for (const [name, p, technique] of cases) {
    it(`matches loadout assembly at the start of a run (${name})`, () => {
      const ctx = combatCtx();
      const run = startRun(ctx, { seed: "s", picks: p, technique }).run;
      const expected = assemblePlayer(ctx.pack, p, technique).unit;
      const unit = playerUnitFromRun(ctx.pack, run);
      expect(unit.id).toBe("player");
      expect(unit.side).toBe("player");
      expect(unit.stats).toEqual(expected.stats);
      expect(unit.maxHp).toBe(expected.maxHp);
      expect(unit.maxHp).toBe(run.player.maxHp);
      expect(unit.hp).toBe(run.player.hp);
      expect(unit.maxShield ?? 0).toBe(expected.maxShield ?? 0);
      expect(unit.shield ?? unit.maxShield ?? 0).toBe(expected.maxShield ?? 0);
      for (const power of ["stunPower", "paralysisPower", "bleedPower", "burnPower", "poisonPower"] as const) {
        expect(unit[power] ?? 0).toBe(expected[power] ?? 0);
      }
      expect(unit.traits).toEqual(expected.traits);
      expect(unit.cards).toEqual(expected.cards);
    });
  }

  it("applies the item and path modifiers to the run's base stats (after level-ups), with the floor of 0", () => {
    const p = picks({ weapon: "weapon.heavy" }); // +5 Might, −3 Agility
    const ctx = combatCtx();
    const run = startRun(ctx, { seed: "s", picks: p, technique: null }).run;
    run.player.baseStats = { ...run.player.baseStats, might: 6, agility: 4, cunning: 1 };
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.stats).toMatchObject({ might: 11, agility: 1, cunning: 1, vitality: 3, wisdom: 2 });
    run.player.baseStats = { ...run.player.baseStats, agility: 1 };
    expect(playerUnitFromRun(ctx.pack, run).stats?.agility).toBe(0);
  });

  it("takes max HP from run.player.maxHp (clarification 3)", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    run.player.maxHp = 60;
    run.player.hp = 50;
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.maxHp).toBe(60);
    expect(unit.hp).toBe(50);
  });

  it("throws RangeError for an unknown card id in the run (clarification 10)", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    run.player.cards = [STRIKE, "skill.nope"];
    expect(() => playerUnitFromRun(ctx.pack, run)).toThrow(RangeError);
  });

  it("takes the run's current HP, with Shield full", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    run.player.hp = 9;
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.hp).toBe(9);
    expect(unit.maxHp).toBe(43);
    expect(unit.maxShield).toBe(1);
    expect(unit.shield ?? unit.maxShield).toBe(1);
  });

  it("takes the run's cards in order: the weapon id is Strike, skill and Word ids their cards", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    const start = assemblePlayer(ctx.pack, FIGHT_PICKS, TECHNIQUE).unit.cards ?? [];
    const strike = start.find((c) => c.id === STRIKE);
    expect(strike).toBeDefined();

    run.player.cards = [TECHNIQUE, "word.t_arc", STRIKE, "skill.t_vit"];
    const def = (id: string) => {
      const d = ctx.pack.byId.get(id);
      if (d?.kind !== "skill" && d?.kind !== "word") throw new Error(`${id} is not a skill`);
      return d;
    };
    const cards = playerUnitFromRun(ctx.pack, run).cards ?? [];
    expect(cards.map((c) => c.id)).toEqual([TECHNIQUE, "word.t_arc", STRIKE, "skill.t_vit"]);
    // Spec 1.11 "Rarity": everything starts grey; a held card with no recorded rarity counts as grey (clarification 2).
    expect(cards[0]).toEqual(cardWithRarity(cardFromSkill(def(TECHNIQUE)), "grey"));
    expect(cards[1]).toEqual(cardWithRarity(cardFromSkill(def("word.t_arc")), "grey"));
    expect(cards[2]).toEqual(strike);
    expect(cards[2]?.cooldown).toBe(0);
    expect(cards[3]).toEqual(cardWithRarity(cardFromSkill(def("skill.t_vit")), "grey"));
  });

  it("has no Strike once it is forgotten", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    run.player.cards = [TECHNIQUE];
    expect((playerUnitFromRun(ctx.pack, run).cards ?? []).map((c) => c.id)).toEqual([TECHNIQUE]);
  });

  it("starts with no statuses", () => {
    const ctx = combatCtx();
    const unit: UnitInit = playerUnitFromRun(ctx.pack, startCombatRun(ctx));
    expect(Object.values(unit.statuses ?? {}).every((n) => n === undefined || n === 0)).toBe(true);
  });
});

// =============================================================================================
// Starting a fight

describe("startFight", () => {
  it("throws RangeError outside a node", () => {
    const ctx = combatCtx([fightAct("group.dummy")]);
    const run = startCombatRun(ctx);
    expect(run.phase).toBe("choosing");
    expect(() => startFight(ctx, run)).toThrow(RangeError);
  });

  it("throws RangeError in a node that isn't a combat", () => {
    const { ctx, run } = runInFight("group.dummy");
    ok(completeNode(ctx, run, {}));
    ok(chooseOption(ctx, run, 0)); // step 2: a fake event
    expect(run.node?.type).toBe("event");
    expect(() => startFight(ctx, run)).toThrow(RangeError);
  });

  it("throws RangeError when the run has fallen", () => {
    const { ctx, run } = runInFight("group.dummy");
    ok(fallInNode(run));
    expect(() => startFight(ctx, run)).toThrow(RangeError);
  });

  it("doesn't change the run", () => {
    const { ctx, run } = runInFight("group.trio");
    const before = snapshot(run);
    startFight(ctx, run);
    expect(snapshot(run)).toEqual(before);
  });

  it('names the player "player" and the enemies enemy1..enemy3 in group order (repeats are separate units)', () => {
    const { session } = fightAgainst("group.trio");
    const ids = session.state.units.map((u) => u.id);
    expect([...ids].sort()).toEqual(["enemy1", "enemy2", "enemy3", "player"]);
    expect(enemiesOf(session).map((u) => u.id)).toEqual(["enemy1", "enemy2", "enemy3"]);
    expect(enemiesOf(session).map((u) => u.moves[0]?.card.id)).toEqual(["enemy.rich.bite", "enemy.dummy.poke", "enemy.rich.bite"]);
    expect(unitOf(session, "enemy1")).not.toBe(unitOf(session, "enemy3"));
  });

  it("builds every enemy from its file: stats (missing ones 2), HP, Shield full, powers, traits, starting statuses", () => {
    const { session } = fightAgainst("group.trio");
    const rich = unitOf(session, "enemy1");
    expect(rich.side).toBe("enemy");
    expect(rich.stats).toEqual({ might: 4, vitality: 2, cunning: 2, agility: 1, arcana: 2, intelligence: 2, wisdom: 5 });
    expect(rich.maxHp).toBe(25);
    expect(rich.hp).toBe(25);
    expect(rich.maxShield).toBe(6);
    expect(rich.shield).toBe(6);
    expect(rich.bleedPower).toBe(1);
    expect(rich.maxStunPower).toBe(2);
    expect(rich.traits.decayFloors).toMatchObject({ thorns: 1 });
    expect(rich.statuses.stacks("thorns")).toBe(2);
    expect(rich.statuses.stacks("warded")).toBe(1);

    const dummy = unitOf(session, "enemy2");
    expect(dummy.stats).toEqual({ might: 2, vitality: 2, cunning: 2, agility: 2, arcana: 2, intelligence: 2, wisdom: 2 });
    expect(dummy.maxHp).toBe(12);
    expect(dummy.maxShield).toBe(0);
    expect(hasAnyStatus(dummy)).toBe(false);
  });

  it("builds the enemy moves from data: card id <enemy id>.<move id>, weight, cooldown, effects, intent key", () => {
    const { session } = fightAgainst("group.trio");
    const rich = unitOf(session, "enemy1");
    expect(rich.moves.map((m) => ({ id: m.card.id, weight: m.weight, cooldown: m.card.cooldown, intent: m.intent }))).toEqual([
      { id: "enemy.rich.bite", weight: 3, cooldown: 0, intent: "enemy.rich.bite.intent" },
      { id: "enemy.rich.guard", weight: 1, cooldown: 2, intent: "enemy.rich.guard.intent" },
    ]);
    expect(rich.moves[0]?.card.effects).toEqual([{ type: "damage", damageType: "physical", amount: 2, target: "enemy", scaling: [{ stat: "might", per: 1 }] }]);
    expect(rich.moves[1]?.card.effects).toEqual([{ type: "restoreShield", amount: 4, target: "self" }]);
    for (const e of enemiesOf(session)) expect(e.moves.map((m) => m.card.id)).toContain(e.intent);
  });

  it("the fight's player has the run's max HP", () => {
    const { ctx, run } = runInFight("group.dummy");
    run.player.maxHp = 60;
    run.player.hp = 55;
    const p = playerOf(startFight(ctx, run));
    expect(p.maxHp).toBe(60);
    expect(p.hp).toBe(55);
  });

  it("builds the player from the run: the run's HP, Shield full, no statuses, the run's cards", () => {
    const { ctx, run } = runInFight("group.dummy");
    run.player.hp = 20;
    const expected = playerUnitFromRun(ctx.pack, run);
    const session = startFight(ctx, run);
    const p = playerOf(session);
    expect(p.side).toBe("player");
    expect(p.hp).toBe(20);
    expect(p.maxHp).toBe(43);
    expect(p.shield).toBe(1);
    expect(p.stats).toEqual(expected.stats);
    expect(p.cards.map((c) => c.id)).toEqual([STRIKE, TECHNIQUE]);
    expect(hasAnyStatus(p)).toBe(false);
  });

  it("stops at the player's first decision when the player is faster (ties go to the player)", () => {
    const { session } = fightAgainst("group.trio");
    expect(fightOutcome(session)).toBe("ongoing");
    expect(session.state.active?.id).toBe("player");
    expect(eventsOf(session).some((e) => e.type === "CardPlayed")).toBe(false);
    expect(fightPlay(session, STRIKE, "enemy2").ok).toBe(true);
  });

  it("runs the enemies' turns first when they are faster, then stops at the player's turn", () => {
    const { session } = fightAgainst("group.swift");
    const ev = eventsOf(session);
    const enemyAct = ev.findIndex((e) => e.type === "CardPlayed" && e["unit"] === "enemy1");
    const playerTurn = ev.findIndex((e) => e.type === "TurnStarted" && e["unit"] === "player");
    expect(enemyAct).toBeGreaterThanOrEqual(0);
    expect(playerTurn === -1 || playerTurn > enemyAct).toBe(true);
    expect(session.state.active?.id).toBe("player");
    expect(playerOf(session).hp + playerOf(session).shield).toBeLessThan(43 + 1);
    expect(fightPlay(session, STRIKE).ok).toBe(true);
  });
});

// =============================================================================================
// Commands

describe("fightPlay and fightPass", () => {
  it("fightPlay: the player's card, then the enemy turns, back to the player", () => {
    const { session } = fightAgainst("group.dummy");
    const from = eventsOf(session).length;
    expect(fightPlay(session, STRIKE).ok).toBe(true);
    const ev = eventsOf(session).slice(from);
    const mine = ev.findIndex((e) => e.type === "CardPlayed" && e["unit"] === "player" && e["card"] === STRIKE && e["target"] === "enemy1");
    const theirs = ev.findIndex((e) => e.type === "CardPlayed" && e["unit"] === "enemy1");
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(theirs).toBeGreaterThan(mine);
    expect(session.state.active?.id).toBe("player");
    expect(fightOutcome(session)).toBe("ongoing");
  });

  it("fightPlay with a target among several enemies", () => {
    const { session } = fightAgainst("group.pair");
    expect(fightPlay(session, STRIKE, "enemy2").ok).toBe(true);
    expect(eventsOf(session)).toContainEqual({ type: "CardPlayed", unit: "player", card: STRIKE, target: "enemy2" });
    expect(unitOf(session, "enemy2").hp).toBeLessThan(12);
    expect(unitOf(session, "enemy1").hp).toBe(12);
  });

  it("fightPass: Passed, then the enemy turns, back to the player", () => {
    const { session } = fightAgainst("group.dummy");
    const from = eventsOf(session).length;
    expect(fightPass(session).ok).toBe(true);
    const ev = eventsOf(session).slice(from);
    const passed = ev.findIndex((e) => e.type === "Passed" && e["unit"] === "player");
    const theirs = ev.findIndex((e) => e.type === "CardPlayed" && e["unit"] === "enemy1");
    expect(passed).toBeGreaterThanOrEqual(0);
    expect(theirs).toBeGreaterThan(passed);
    expect(session.state.active?.id).toBe("player");
  });

  it("refuses an unknown card, a card on cooldown and a bad target, changing nothing", () => {
    const { session } = fightAgainst("group.pair");
    const refused = (fn: () => { ok: boolean }) => {
      const before = fightSnapshot(session);
      expect(fn().ok).toBe(false);
      expect(fightSnapshot(session)).toBe(before);
    };
    refused(() => fightPlay(session, "skill.nope", "enemy1"));
    refused(() => fightPlay(session, STRIKE)); // two enemies: a target is needed
    refused(() => fightPlay(session, STRIKE, "enemy9"));
    refused(() => fightPlay(session, STRIKE, "player"));
    expect(fightPlay(session, TECHNIQUE, "enemy1").ok).toBe(true);
    refused(() => fightPlay(session, TECHNIQUE, "enemy1"));
  });

  it("refuses play and pass once the fight is over, changing nothing", () => {
    const { session } = fightAgainst("group.dummy");
    strikeUntilOver(session, STRIKE);
    expect(fightOutcome(session)).toBe("won");
    const before = fightSnapshot(session);
    expect(fightPlay(session, STRIKE).ok).toBe(false);
    expect(fightPass(session).ok).toBe(false);
    expect(fightSnapshot(session)).toBe(before);
  });

  it("commands don't change the run", () => {
    const { run, session } = fightAgainst("group.trio");
    const before = snapshot(run);
    scriptedFight(session);
    expect(snapshot(run)).toEqual(before);
  });
});

// =============================================================================================
// Winning

describe("winning a fight", () => {
  it('outcome "ongoing" until every enemy has fallen, then "won"', () => {
    const { session } = fightAgainst("group.dummy");
    expect(fightOutcome(session)).toBe("ongoing");
    strikeUntilOver(session, STRIKE);
    expect(fightOutcome(session)).toBe("won");
    expect(enemiesOf(session).every((u) => u.fallen)).toBe(true);
    expect(playerOf(session).fallen).toBe(false);
  });

  it("finishFight completes the node with the HP lost and no crowns, and the run moves on", () => {
    const { ctx, run, session } = fightAgainst("group.dummy");
    const hpBefore = run.player.hp;
    const crownsBefore = run.crowns;
    strikeUntilOver(session, STRIKE);
    const hpAfter = playerOf(session).hp;
    expect(hpAfter).toBeLessThan(hpBefore);

    const events = ok(finishFight(ctx, run, session));
    expect(events[0]).toEqual({ type: "NodeCompleted", nodeType: "combat", hpChange: hpAfter - hpBefore, crownsChange: 0, hp: hpAfter, crowns: crownsBefore });
    expect(run.player.hp).toBe(hpAfter);
    expect(run.crowns).toBe(crownsBefore);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.node).toBeNull();
  });

  it("finishFight is refused while the fight is ongoing, and after the node is done", () => {
    const { ctx, run, session } = fightAgainst("group.dummy");
    expectRefusedRun(run, () => finishFight(ctx, run, session), "wrong_phase");
    strikeUntilOver(session, STRIKE);
    ok(finishFight(ctx, run, session));
    expectRefusedRun(run, () => finishFight(ctx, run, session), "wrong_phase");
  });
});

// =============================================================================================
// Falling

describe("falling in a fight", () => {
  it('outcome "fallen" when the player falls', () => {
    const { session } = fightAgainst("group.brute");
    fallToBrute(session);
    expect(playerOf(session).fallen).toBe(true);
    expect(enemiesOf(session).some((u) => !u.fallen)).toBe(true);
  });

  it('both sides falling in the same hit: outcome "fallen" (the enemies win)', () => {
    const { session } = fightAgainst("group.spiky");
    expect(fightPlay(session, STRIKE).ok).toBe(true);
    expect(playerOf(session).fallen).toBe(true);
    expect(unitOf(session, "enemy1").fallen).toBe(true);
    expect(fightOutcome(session)).toBe("fallen");
  });

  it("finishFight after a fall: PlayerFell, phase fallen, HP 0, the node stays current", () => {
    const { ctx, run, session } = fightAgainst("group.brute");
    const node = snapshot(run).node;
    const step = run.step;
    fallToBrute(session);
    const events = ok(finishFight(ctx, run, session));
    expect(kinds(events)).toEqual(["PlayerFell"]);
    expect(run.phase).toBe("fallen");
    expect(run.player.hp).toBe(0);
    expect(run.node).toEqual(node);
    expect(run.step).toBe(step);
    expect(run.limits.used.revive).toBe(0);
  });

  it("finishFight after a both-fall is a fall", () => {
    const { ctx, run, session } = fightAgainst("group.spiky");
    fightPlay(session, STRIKE);
    expect(kinds(ok(finishFight(ctx, run, session)))).toEqual(["PlayerFell"]);
    expect(run.phase).toBe("fallen");
  });

  it("fallInNode: only in a node; sets HP 0, phase fallen, PlayerFell, keeps the node", () => {
    const ctx = combatCtx([fightAct("group.dummy")]);
    const run = startCombatRun(ctx);
    expectRefusedRun(run, () => fallInNode(run), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    const node = snapshot(run).node;
    expect(kinds(ok(fallInNode(run)))).toEqual(["PlayerFell"]);
    expect(run.phase).toBe("fallen");
    expect(run.player.hp).toBe(0);
    expect(run.node).toEqual(node);
    expectRefusedRun(run, () => fallInNode(run), "wrong_phase");
  });

  it("ending the tale after a fall in a fight: the run is lost", () => {
    const { ctx, run, session } = fightAgainst("group.brute");
    fallToBrute(session);
    ok(finishFight(ctx, run, session));
    expect(ok(endRun(run))).toEqual([{ type: "RunEnded", result: "lost" }]);
    expect(run.phase).toBe("lost");
    expect(run.node).toBeNull();
  });
});

// =============================================================================================
// Reviving into the fight

describe("reviving in the middle of a fight", () => {
  /** A run fallen to the brute, with the fight session. */
  function fallen() {
    const f = fightAgainst("group.brute");
    fallToBrute(f.session);
    ok(finishFight(f.ctx, f.run, f.session));
    return f;
  }

  it("goes back into the node at half max HP rounded up, with only a Revived event (no advance)", () => {
    const { ctx, run } = fallen();
    const node = snapshot(run).node;
    const step = run.step;
    const events = ok(revive(ctx, run, REVIVE));
    expect(events).toEqual([{ type: "Revived", hp: 22 }]); // ceil(43 / 2)
    expect(run.phase).toBe("inNode");
    expect(run.player.hp).toBe(22);
    expect(run.node).toEqual(node);
    expect(run.step).toBe(step);
    expect(run.offer).toEqual([]);
    expect(run.limits.used.revive).toBe(1);
  });

  it("the mid-fight fall survives a JSON round trip of the run", () => {
    const { ctx, run } = fallen();
    const copy = snapshot(run);
    ok(revive(ctx, copy, REVIVE));
    expect(copy.phase).toBe("inNode");
    expect(copy.node).toEqual(run.node);
  });

  it("resumeFightAfterRevive: the run's HP, Shield full, the player's statuses cleared, cooldowns kept", () => {
    const { ctx, run, session } = fallen();
    const p = playerOf(session);
    const cooldown = p.cooldowns.remaining(TECHNIQUE);
    expect(cooldown).toBeGreaterThan(0); // used on the turn the player fell
    expect(hasAnyStatus(p)).toBe(true); // Enfeebled from the smashes
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);

    const q = playerOf(session);
    expect(q.hp).toBe(run.player.hp);
    expect(q.fallen).toBe(false);
    expect(q.shield).toBe(q.maxShield);
    expect(q.shield).toBe(1);
    expect(hasAnyStatus(q)).toBe(false);
    expect(q.cooldowns.remaining(TECHNIQUE)).toBe(cooldown);
    expect(fightOutcome(session)).toBe("ongoing");
  });

  it("resumeFightAfterRevive: the enemies are unchanged (HP, Shield, statuses, intents, cooldowns)", () => {
    const { ctx, run, session } = fallen();
    const before = enemyState(session);
    expect(before[0]?.statuses["kindled"]).toBeGreaterThan(0);
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    expect(enemyState(session)).toEqual(before);
  });

  it("resumeFightAfterRevive: the player acts next, in a new round", () => {
    const { ctx, run, session } = fallen();
    const ev = eventsOf(session);
    const roundAtFall = Math.max(...ev.filter((e) => e.type === "TurnStarted").map((e) => Number(e["round"])));
    const from = ev.length;
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    expect(session.state.active?.id).toBe("player");
    expect(fightPlay(session, TECHNIQUE).ok).toBe(false); // still on cooldown
    expect(fightPlay(session, STRIKE).ok).toBe(true);
    const after = eventsOf(session).slice(from);
    const firstTurn = after.find((e) => e.type === "TurnStarted");
    expect(firstTurn?.["unit"]).toBe("player");
    expect(Number(firstTurn?.["round"])).toBeGreaterThan(roundAtFall);
    expect(after.find((e) => e.type === "CardPlayed")).toMatchObject({ unit: "player", card: STRIKE });
  });

  it("the fight can be lost again; the revive limit is 2 per run; then the tale ends", () => {
    expect(RUN_LIMITS.revive).toBe(2);
    const { ctx, run, session } = fallen();
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    strikeUntilOver(session, STRIKE, 10);
    expect(fightOutcome(session)).toBe("fallen");
    expect(kinds(ok(finishFight(ctx, run, session)))).toEqual(["PlayerFell"]);

    ok(revive(ctx, run, { action: "revive", source: "premium" }));
    expect(run.phase).toBe("inNode");
    resumeFightAfterRevive(run, session);
    strikeUntilOver(session, STRIKE, 10);
    expect(fightOutcome(session)).toBe("fallen");
    ok(finishFight(ctx, run, session));

    expectRefusedRun(run, () => revive(ctx, run, REVIVE), "limit_reached");
    ok(endRun(run));
    expect(run.phase).toBe("lost");
  });

  it("throws when the run isn't back in the node, or when the fight isn't fallen", () => {
    const { run, session } = fallen();
    expect(() => resumeFightAfterRevive(run, session)).toThrow(); // still "fallen"

    const other = fightAgainst("group.dummy");
    expect(() => resumeFightAfterRevive(other.run, other.session)).toThrow(); // ongoing
  });

  it("after a mid-node revive, finishing the node moves on, and a later ordinary fall revives by moving on", () => {
    const { ctx, run } = fallen();
    ok(revive(ctx, run, REVIVE));
    ok(completeNode(ctx, run, {}));
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);

    ok(chooseOption(ctx, run, 0)); // a fake event
    ok(completeNode(ctx, run, { hp: -1000 }));
    expect(run.phase).toBe("fallen");
    const events = ok(revive(ctx, run, REVIVE));
    expect(kinds(events)[0]).toBe("Revived");
    expect(kinds(events)).toContain("OptionsOffered");
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(3);
  });
});

// =============================================================================================
// Determinism and resume

describe("determinism", () => {
  it("same seed and same commands: identical combat events", () => {
    const a = fightAgainst("group.trio", "det");
    const b = fightAgainst("group.trio", "det");
    scriptedFight(a.session);
    scriptedFight(b.session);
    expect(eventsOf(a.session).length).toBeGreaterThan(10);
    expect(eventsOf(b.session)).toEqual(eventsOf(a.session));
    expect(fightOutcome(b.session)).toBe(fightOutcome(a.session));
  });

  it("the fight's stream depends on the option: three options against the same group don't all play the same", () => {
    // Every option is group.trio (enemy.rich picks between two weighted moves on the combat RNG).
    const ctx = combatCtx([combatAct("act.c", { groups: ["group.trio"], tiers: [{ from: 1, weights: { hard: 1 } }] })]);
    const run = startCombatRun(ctx, "opt");
    const logs = [0, 1, 2].map((i) => {
      const copy = snapshot(run);
      ok(chooseOption(ctx, copy, i));
      expect(copy.node?.data).toMatchObject({ group: "group.trio" });
      const session = startFight(ctx, copy);
      scriptedFight(session);
      return JSON.stringify(eventsOf(session));
    });
    expect(new Set(logs).size).toBeGreaterThan(1);
  });

  it("a JSON round trip of the run in a node, then startFight: the same fight from the start", () => {
    const { ctx, run } = runInFight("group.trio", "resume");
    const saved = snapshot(run);
    const first = startFight(ctx, run);
    scriptedFight(first, 4); // quit in the middle of the fight
    const again = startFight(ctx, saved);
    const fresh = startFight(ctx, snapshot(saved));
    expect(eventsOf(again)).toEqual(eventsOf(fresh));
    scriptedFight(again);
    scriptedFight(fresh);
    expect(eventsOf(again)).toEqual(eventsOf(fresh));
    // The quit fight's start matches too.
    const start = eventsOf(startFight(ctx, snapshot(saved)));
    expect(eventsOf(first).slice(0, start.length)).toEqual(start);
  });

  it("a fight resumed from a save after a revive restarts with the save's HP and revives", () => {
    const { ctx, run, session } = fightAgainst("group.brute");
    fallToBrute(session);
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    const saved = snapshot(run);
    const restarted = startFight(ctx, saved);
    expect(playerOf(restarted).hp).toBe(22);
    expect(unitOf(restarted, "enemy1").hp).toBe(200);
    expect(saved.limits.used.revive).toBe(1);
  });
});

// =============================================================================================
// The real base pack

describe("base pack: Act I combat", () => {
  const BASE_PICKS: LoadoutPicks = {
    character: "char.sellsword",
    weapon: "weapon.notched_longsword",
    armor: "armor.riveted_brigandine",
    accessory: "accessory.iron_locket",
    path: "path.sworn_road",
  };
  const BASE_STRIKE = "weapon.notched_longsword";

  const packFrom = (files: readonly ContentFile[]) => {
    const res = validatePack("base", files);
    if (!res.pack) throw new Error(`base pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
    return res.pack;
  };
  const baseCtx = (files: readonly ContentFile[] = BASE_FILES): RunContext => ({ pack: packFrom(files), registry: combatRegistry().registry });

  const actOne = () => {
    const def = packFrom(BASE_FILES).byId.get("act.drowned_marches");
    if (def?.kind !== "act") throw new Error("no Act I");
    return def;
  };

  it("validates, with enemies and groups", () => {
    const res = validatePack("base", BASE_FILES);
    expect(res.issues).toEqual([]);
    const kindsIn = [...(res.pack?.byId.values() ?? [])].map((d) => d.kind);
    expect(kindsIn).toContain("enemy");
    expect(kindsIn).toContain("group");
  });

  it("Act I has groups and tier bands from step 1", () => {
    const act = actOne();
    expect((act.groups ?? []).length).toBeGreaterThan(0);
    expect(act.tiers?.[0]?.from).toBe(1);
  });

  it('group.act1_boss exists with tier "boss"', () => {
    const def = packFrom(BASE_FILES).byId.get("group.act1_boss");
    expect(def).toMatchObject({ kind: "group", tier: "boss" });
  });

  it("builds Act I's drawn combat options", () => {
    const ctx = baseCtx();
    const act = actOne();
    const options = combatOptions(seeds(40).flatMap((seed) => startRun(ctx, { seed, picks: BASE_PICKS, technique: null }).run.offer));
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      const d = combatData(o);
      expect(act.groups).toContain(d.group);
      expect(["normal", "hard", "elite"]).toContain(d.tier);
      expect(packFrom(BASE_FILES).byId.get(d.group)).toMatchObject({ kind: "group", tier: d.tier });
      expect(o.tag).toBe(`node.tag.${d.tier}`);
    }
  });

  it("builds Act I's boss at the last step", () => {
    const ctx = baseCtx();
    const run = startRun(ctx, { seed: "boss", picks: BASE_PICKS, technique: null }).run;
    advanceTo(ctx, run, run.steps);
    expect(run.offer).toHaveLength(1);
    expect(run.offer[0]?.data).toMatchObject({ group: "group.act1_boss", tier: "boss" });
    expect(run.offer[0]?.tag).toBe("node.tag.boss");
  });

  it("every Act I group, and the boss, can be fought to an end with Strike every turn", () => {
    const groups = [...(actOne().groups ?? [])];
    if (!groups.includes("group.act1_boss")) groups.push("group.act1_boss");
    for (const group of groups) {
      // Act I with a fixed combat against this group at step 1.
      const files = BASE_FILES.map((f): ContentFile => {
        const data = f.data as { id?: string; fixed?: unknown[] };
        return data.id === "act.drowned_marches" ? { path: f.path, data: { ...data, fixed: [{ at: 1, type: "combat", ref: group }, ...(data.fixed ?? [])] } } : f;
      });
      const ctx = baseCtx(files);
      const run = startRun(ctx, { seed: `fight-${group}`, picks: BASE_PICKS, technique: null }).run;
      ok(chooseOption(ctx, run, 0));
      const session = startFight(ctx, run);
      strikeUntilOver(session, BASE_STRIKE, 300);
      const outcome = fightOutcome(session);
      expect([group, outcome === "ongoing" ? "unfinished" : "ended"]).toEqual([group, "ended"]);
      const events = ok(finishFight(ctx, run, session));
      expect(kinds(events)[0]).toBe(outcome === "won" ? "NodeCompleted" : "PlayerFell");
    }
  });
});

