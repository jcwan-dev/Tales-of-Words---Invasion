import { describe, expect, it } from "vitest";
import {
  chooseLevelUp,
  chooseOption,
  chooseRoute,
  completeNode,
  endRun,
  fallInNode,
  finishFight,
  forgetCard,
  leaveCard,
  loadoutTotals,
  playerUnitFromRun,
  rerollRewards,
  revive,
  RUN_LIMITS,
  skipReward,
  startFight,
  STAT_IDS,
  takeReward,
  type CommandResult,
  type ContentFile,
  type GroupTier,
  type RewardOption,
  type RunContext,
  type RunEvent,
  type RunState,
  type StatBlock,
  type StatId,
} from "../../src/index.ts";
import { combatCtx, fightAct, fightAgainst, groupFile, startCombatRun, STRIKE, strikeUntilOver } from "./combat-pack.ts";
import { CRUSHING, HEAVY } from "./loadout-pack.ts";
import { kinds, ok, snapshot } from "./run-pack.ts";
import {
  advancePlain,
  AMULET,
  BULWARK,
  C1,
  C2,
  C3,
  C4,
  C5,
  CHARM,
  DEFAULT_TABLE,
  TWIN_CHARM,
  GLAIVE,
  eventOf,
  evs,
  FULL_POOL,
  GRANTED,
  GRANTED2,
  indexOfId,
  itemIds,
  MAIL,
  optionId,
  R1,
  REROLL,
  REVIVE,
  rewardsAct,
  rewardsCtx,
  RING,
  screen,
  seeds,
  SIGIL,
  SKILL_FILES,
  skillIds,
  SPEAR,
  startRewardsRun,
  table,
  toRewards,
  U1,
  U2,
  U3,
  U4,
  U5,
  U6,
  skillFile,
  wordFile,
  type TableSpec,
} from "./rewards-pack.ts";

// Spec Draft 1.11, "Rewards, items and level-ups" (decided 12 Oct 2026), with "Skills" (changing weapon), "Base
// characters" (level-ups), "Loadout assembly" (Intelligence everywhere, max HP), "Run map", "Combat node" and
// "Monetisation architecture" (rerolls); brief M2.4 (public API, flow, rules notes):
//   After a won fight (a node result with rewardTier and HP > 0): NodeCompleted, then the rewards screen (phase
//     "rewards", RewardsOffered). A result without rewardTier behaves as before.
//   Screen: 3 + intelligenceBonusOptions(final Intelligence) options. The first 3: kind by the tier table's `kinds`
//     weights among kinds still drawable (crowns at most once; skill/item while something unoffered and unheld
//     exists); a skill/item option draws a rarity by the `rarity` weights among rarities with candidates of that kind
//     left, then a candidate uniformly. Bonus options: skills or Words only, same rarity rule; none left → shorter.
//     Crowns: uniform in [min, max]. Candidates: skills and Words not held and not on the screen; weapons, armor and
//     accessories not equipped and not on the screen. Rarity default "common".
//   takeReward: crowns → CrownsGained. Skill: < 5 cards → append (CardLearned, replaced null); 5 → phase "learning"
//     (CardOffered). Item: picks[slot] = id, stats and max HP recomputed (20 + 5 × final Vitality + items' HP), HP moves
//     by the max HP change, clamped to [1, max] (ItemEquipped); the old item's card leaves if held (CardRemoved); the
//     new item's card (weapon id; accessory grants) is gained like a skill. skipReward → straight on.
//   Learning: forgetCard(i) removes card i and appends the new one (CardLearned, replaced = old id; Strike may go);
//     leaveCard keeps the hand (CardLeft).
//   Level-up after elite and boss fights: 2 options, the first favoured, among stats with base value < 7; if no
//     favoured stat is eligible, two different eligible stats; shorter / none. +2 favoured, +1 other, cap 7 on base
//     stats; a Vitality gain raises max HP and HP by 5 per point. StatRaised.
//   Order: rewards → learning → level-up → the usual advance (next step, or ActCompleted + routes / won).
//   Rerolls: phase "rewards", consume(limits, "reroll", grant) (3 per run), redraw the whole screen on the stream
//     (seed, act position, act, step, reroll index); RewardsRerolled then RewardsOffered.
//   Refused commands (wrong_phase, no_such_option, limits' reasons) change nothing. JSON-safe in every phase.
// Brief "Clarifications" 1-13 and the spec's "Details" bullet: `rewards.rerolls` / RewardsOffered.rerolls count this
// screen's rerolls (0 first); a bad index → "no_such_option"; level-up options list the favoured stat first; a tier
// that isn't one, or has no table in the act → refused invalid_result; weight-0 rarities and kinds never drawn, and a
// kind whose drawable rarities are empty can't be drawn; nothing to offer → no rewards phase; a revive after a fall
// at a tiered node runs the same after-node flow; an incoming card already held isn't gained (no event); an
// accessory swap removes its granted card if held, whatever its origin; Vitality level-ups recompute max HP from
// final stats (0 floor), HP rises by the increase; rewards / learning / levelUp null outside their phases; the node
// stays current through them and is cleared on advance.

const TIERS: readonly GroupTier[] = ["normal", "hard", "elite", "boss"];
const SKILL_ONLY: TableSpec = table({ kinds: { skill: 1 } });
const ITEM_ONLY: TableSpec = table({ kinds: { item: 1 } });
const CROWNS_ONLY: TableSpec = table({ kinds: { crowns: 1 } });

function expectRefused(run: RunState, command: () => CommandResult, reason: string): void {
  const before = snapshot(run);
  const res = command();
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe(reason);
  expect(snapshot(run)).toEqual(before);
}

const only = <T>(xs: readonly T[]): T => {
  expect(xs).toHaveLength(1);
  const [x] = xs;
  if (x === undefined) throw new Error("empty");
  return x;
};

const ids = (options: readonly RewardOption[]): string[] => options.flatMap((o) => (o.kind === "crowns" ? [] : [o.id]));
const countKind = (options: readonly RewardOption[], kind: RewardOption["kind"]): number => options.filter((o) => o.kind === kind).length;

/** The screen after the first node of a fresh run with this seed and these picks. */
function firstScreen(ctx: RunContext, seed: string, picks: Parameters<typeof startRewardsRun>[2] = {}, tier: GroupTier = "normal"): readonly RewardOption[] {
  const run = startRewardsRun(ctx, seed, picks);
  toRewards(ctx, run, tier);
  return screen(run);
}

/** Every first screen over `n` seeds. */
const screensOver = (ctx: RunContext, n: number, picks: Parameters<typeof startRewardsRun>[2] = {}): (readonly RewardOption[])[] =>
  seeds(n).map((s) => firstScreen(ctx, s, picks));

/** A fresh run in the rewards phase (step 1), with the cards and base stats replaced first if given. */
function rewardsRun(
  ctx: RunContext,
  opts: { seed?: string; picks?: Parameters<typeof startRewardsRun>[2]; cards?: string[]; stats?: Partial<StatBlock>; tier?: GroupTier; hp?: number } = {},
): { run: RunState; events: readonly RunEvent[] } {
  const run = startRewardsRun(ctx, opts.seed ?? "seed", opts.picks ?? {});
  if (opts.cards !== undefined) run.player.cards = [...opts.cards];
  if (opts.stats !== undefined) run.player.baseStats = { ...run.player.baseStats, ...opts.stats };
  const events = toRewards(ctx, run, opts.tier ?? "normal", opts.hp ?? 0);
  return { run, events };
}

/** Base stats with every stat at 7 except the given ones. */
const capped = (except: Partial<StatBlock> = {}): Partial<StatBlock> => ({ ...Object.fromEntries(STAT_IDS.map((s) => [s, 7])), ...except });

/** A final stat (base + item and path modifiers) of the run's player unit. */
const finalStat = (ctx: RunContext, run: RunState, stat: StatId): number | undefined => playerUnitFromRun(ctx.pack, run).stats?.[stat];

/** The run without the parts a reroll may change. */
const withoutScreen = (run: RunState): unknown => ({ ...snapshot(run), rewards: null, limits: null });

const C_HAND = ["weapon.club", "skill.c1", "skill.c2", "skill.c3", "skill.c4"];

// =============================================================================================
// No rewardTier: as before

describe("rewards: a result without rewardTier", () => {
  it("a new run has no rewards screen, no learning and no level-up", () => {
    const run = startRewardsRun(rewardsCtx());
    expect(run.rewards).toBeNull();
    expect(run.learning).toBeNull();
    expect(run.levelUp).toBeNull();
  });

  it("completes the node and moves on exactly as before", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    ok(chooseOption(ctx, run, 0));
    const events = ok(completeNode(ctx, run, { hp: -3, crowns: 4 }));
    expect(kinds(events)).toEqual(["NodeCompleted", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.crowns).toBe(4);
  });
});

// =============================================================================================
// Entering the screen

describe("rewards: entering the screen", () => {
  it("NodeCompleted, then RewardsOffered; phase rewards; the step doesn't move yet", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    const events = toRewards(ctx, run, "normal", -5);
    expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(eventOf(events, "NodeCompleted")).toMatchObject({ hpChange: -5, hp: 30 });
    expect(run.phase).toBe("rewards");
    expect(run.step).toBe(1);
    expect(run.offer).toEqual([]);
    expect(run.player.hp).toBe(30);
    const r = run.rewards;
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.tier).toBe("normal");
    expect(r.rerolls).toBe(0);
    expect(r.options.length).toBe(3);
    expect(eventOf(events, "RewardsOffered")).toEqual({ type: "RewardsOffered", tier: "normal", options: r.options, rerolls: 0 });
  });

  it("records the result's tier, for every tier", () => {
    const ctx = rewardsCtx();
    for (const tier of TIERS) {
      const run = startRewardsRun(ctx, `tier-${tier}`);
      const events = toRewards(ctx, run, tier);
      expect(run.rewards?.tier).toBe(tier);
      expect(eventOf(events, "RewardsOffered")["tier"]).toBe(tier);
    }
  });

  it("a result with rewardTier that takes HP to 0 is a fall: no screen", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    const events = toRewards(ctx, run, "elite", -1000);
    expect(kinds(events)).toEqual(["NodeCompleted", "PlayerFell"]);
    expect(run.phase).toBe("fallen");
    expect(run.rewards).toBeNull();
  });

  it("the run state stays JSON-safe on the screen", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx);
    expect(snapshot(run)).toEqual(run);
  });
});

// =============================================================================================
// How many options

describe("rewards: how many options (3, +1 at Intelligence 4, +2 at 6, from the final stat)", () => {
  const cases: [string, Parameters<typeof startRewardsRun>[2], number][] = [
    ["Brute, Intelligence 2", {}, 3],
    ["Sage, Intelligence 3", { character: "char.sage" }, 3],
    ["Sage + path +1, Intelligence 4", { character: "char.sage", path: "path.study" }, 4],
    ["Sage + ring +2, Intelligence 5", { character: "char.sage", accessory: "accessory.ring" }, 4],
    ["Sage + path +3, Intelligence 6", { character: "char.sage", path: "path.deep_study" }, 5],
    ["Sage + path +3 + ring +2, Intelligence 8", { character: "char.sage", path: "path.deep_study", accessory: "accessory.ring" }, 5],
    ["Brute + path +3, Intelligence 5", { path: "path.deep_study" }, 4],
  ];
  for (const [name, picks, n] of cases) {
    it(`${name}: ${n} options`, () => {
      const ctx = rewardsCtx({ table: SKILL_ONLY });
      for (const s of seeds(5)) expect(firstScreen(ctx, s, picks)).toHaveLength(n);
    });
  }

  it("the bonus options are skills or Words, whatever the kinds weights", () => {
    const crowns = rewardsCtx({ table: CROWNS_ONLY });
    for (const options of screensOver(crowns, 15, { character: "char.sage", path: "path.deep_study" })) {
      expect(options).toHaveLength(3);
      expect(countKind(options, "crowns")).toBe(1);
      expect(countKind(options, "skill")).toBe(2);
    }
    const items = rewardsCtx({ table: ITEM_ONLY });
    for (const options of screensOver(items, 15, { character: "char.sage", path: "path.study" })) {
      expect(options).toHaveLength(4);
      expect(countKind(options, "item")).toBe(3);
      expect(countKind(options, "skill")).toBe(1);
    }
  });

  it("the bonus options follow the rarity weights", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { crowns: 1 }, rarity: { rare: 1 } }) });
    const rare = skillIds(FULL_POOL, "rare");
    for (const options of screensOver(ctx, 15, { character: "char.sage", path: "path.deep_study" })) {
      for (const id of ids(options)) expect(rare).toContain(id);
    }
  });

  it("uses the final Intelligence after an item swap", () => {
    // Sage + path +1 = 4. The only unequipped item is the ring (+2): one item + one bonus skill.
    const ctx = rewardsCtx({ table: ITEM_ONLY, pool: [RING, ...SKILL_FILES] });
    const { run } = rewardsRun(ctx, { picks: { character: "char.sage", path: "path.study" } });
    expect(countKind(screen(run), "item")).toBe(1);
    expect(countKind(screen(run), "skill")).toBe(1);
    ok(takeReward(ctx, run, indexOfId(run, "accessory.ring")));
    expect(finalStat(ctx, run, "intelligence")).toBe(6);
    // Next screen: Intelligence 6; the plain accessory is the only unequipped item now.
    toRewards(ctx, run, "normal");
    expect(ids(screen(run).filter((o) => o.kind === "item"))).toEqual(["accessory.plain"]);
    expect(countKind(screen(run), "skill")).toBe(2);
  });

  it("uses the final Intelligence after a level-up", () => {
    // Sage + path +1: Intelligence 3 + 1. Only Intelligence can be raised: +2 (favoured) → final 6.
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const { run } = rewardsRun(ctx, { picks: { character: "char.sage", path: "path.study" }, stats: capped({ intelligence: 3 }), tier: "elite" });
    expect(screen(run)).toHaveLength(4);
    ok(skipReward(ctx, run));
    expect(run.levelUp?.options).toEqual(["intelligence"]);
    ok(chooseLevelUp(ctx, run, 0));
    toRewards(ctx, run, "normal");
    expect(screen(run)).toHaveLength(5);
  });
});

// =============================================================================================
// What is offered

describe("rewards: what can be offered", () => {
  it("options have the brief's shapes and name real content of the right kind", () => {
    const ctx = rewardsCtx();
    for (const options of screensOver(ctx, 40)) {
      for (const o of options) {
        if (o.kind === "crowns") {
          expect(Object.keys(o).sort()).toEqual(["amount", "kind"]);
          continue;
        }
        const def = ctx.pack.byId.get(o.id);
        if (o.kind === "skill") {
          expect(Object.keys(o).sort()).toEqual(["id", "kind"]);
          expect(["skill", "word"]).toContain(def?.kind);
        } else {
          expect(Object.keys(o).sort()).toEqual(["id", "kind", "slot"]);
          expect(def?.kind).toBe(o.slot);
        }
      }
    }
  });

  it("never the same thing twice on one screen, and at most one purse", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1, item: 1, crowns: 5 } }) });
    for (const options of screensOver(ctx, 60, { character: "char.sage", path: "path.deep_study" })) {
      const named = ids(options);
      expect(new Set(named).size).toBe(named.length);
      expect(countKind(options, "crowns")).toBeLessThanOrEqual(1);
    }
  });

  it("a heavy purse weight still gives exactly one purse; the rest are other kinds", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { crowns: 100, skill: 1 } }) });
    for (const options of screensOver(ctx, 40)) {
      expect(options).toHaveLength(3);
      expect(countKind(options, "crowns")).toBe(1);
      expect(countKind(options, "skill")).toBe(2);
    }
  });

  it("a kind with weight 0 (or absent) is never drawn", () => {
    for (const options of screensOver(rewardsCtx({ table: SKILL_ONLY }), 30)) expect(options.every((o) => o.kind === "skill")).toBe(true);
    for (const options of screensOver(rewardsCtx({ table: ITEM_ONLY }), 30)) expect(options.every((o) => o.kind === "item")).toBe(true);
    const zero = rewardsCtx({ table: table({ kinds: { skill: 0, item: 1, crowns: 0 } }) });
    for (const options of screensOver(zero, 30)) expect(options.every((o) => o.kind === "item")).toBe(true);
  });

  it("never offers a skill or Word the player holds", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const held = ["weapon.club", "skill.c1", "skill.u1", "skill.r1", "word.c6"];
    for (const s of seeds(60)) {
      const { run } = rewardsRun(ctx, { seed: s, cards: held });
      for (const id of ids(screen(run))) expect(held).not.toContain(id);
    }
  });

  it("never offers the skill the worn accessory granted (held), nor the items worn", () => {
    const ctx = rewardsCtx();
    const worn = ["weapon.spear", "armor.mail", "accessory.charm"];
    const seen = new Set<string>();
    for (const s of seeds(80)) {
      const options = firstScreen(ctx, s, { weapon: "weapon.spear", armor: "armor.mail", accessory: "accessory.charm" });
      for (const id of ids(options)) {
        expect(worn).not.toContain(id);
        expect(id).not.toBe("skill.granted");
        seen.add(id);
      }
    }
    // Unworn items are offered, the old starting items included.
    expect(seen.has("weapon.club")).toBe(true);
  });

  it("every unworn item can be offered; worn items never", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { item: 1 }, rarity: { common: 1, uncommon: 1, rare: 1 } }) });
    const seen = new Set<string>();
    for (const options of screensOver(ctx, 150)) for (const id of ids(options)) seen.add(id);
    expect([...seen].sort()).toEqual(itemIds(FULL_POOL).sort());
  });

  it("a skill taken is not offered on later screens", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { common: 1 } }) });
    for (const s of seeds(10)) {
      const run = startRewardsRun(ctx, s);
      toRewards(ctx, run, "normal");
      const taken = screen(run)[0];
      if (taken === undefined) throw new Error("empty screen");
      ok(takeReward(ctx, run, 0));
      for (let step = 2; step <= 3; step++) {
        toRewards(ctx, run, "normal");
        expect(ids(screen(run))).not.toContain(optionId(taken));
        ok(skipReward(ctx, run));
      }
    }
  });

  it("the screen is shorter when the pools run out", () => {
    const two = rewardsCtx({ table: SKILL_ONLY, pool: [C1, C2] });
    for (const options of screensOver(two, 10)) expect(ids(options).sort()).toEqual(["skill.c1", "skill.c2"]);
    // Sage at Intelligence 6 wants 5, but only 4 skills exist.
    const four = rewardsCtx({ table: SKILL_ONLY, pool: [C1, C2, C3, C4] });
    for (const options of screensOver(four, 10, { character: "char.sage", path: "path.deep_study" })) expect(options).toHaveLength(4);
  });

  it("a kind with nothing left can't be drawn: the other kinds fill the screen", () => {
    // One unworn item: at most one item per screen; the screen is still full.
    const ctx = rewardsCtx({ table: table({ kinds: { item: 50, skill: 1 } }), pool: [SPEAR, ...SKILL_FILES] });
    for (const options of screensOver(ctx, 30)) {
      expect(options).toHaveLength(3);
      expect(ids(options.filter((o) => o.kind === "item"))).toEqual(["weapon.spear"]);
    }
    // Skills and one item only, no purse weight: two options.
    const tiny = rewardsCtx({ table: table({ kinds: { item: 1, skill: 1 } }), pool: [SPEAR, C1] });
    for (const options of screensOver(tiny, 10)) expect(ids(options).sort()).toEqual(["skill.c1", "weapon.spear"]);
  });

  it("purses are drawn in [min, max], both ends included", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { crowns: 1 }, crowns: { min: 5, max: 7 } }) });
    const amounts = new Set<number>();
    for (const options of screensOver(ctx, 80)) {
      const purse = only(options);
      expect(purse.kind).toBe("crowns");
      if (purse.kind !== "crowns") continue;
      expect(Number.isInteger(purse.amount)).toBe(true);
      amounts.add(purse.amount);
    }
    expect([...amounts].sort()).toEqual([5, 6, 7]);
  });

  it("each tier uses its own table", () => {
    const acts = [
      rewardsAct("act.r", DEFAULT_TABLE_FOR_TIERS.normal, {
        rewards: DEFAULT_TABLE_FOR_TIERS,
      }),
    ];
    const ctx = rewardsCtx({ acts });
    for (const s of seeds(10)) {
      expect(firstScreen(ctx, s, {}, "normal").every((o) => o.kind === "crowns")).toBe(true);
      expect(firstScreen(ctx, s, {}, "hard").every((o) => o.kind === "item")).toBe(true);
      expect(firstScreen(ctx, s, {}, "elite").every((o) => o.kind === "skill")).toBe(true);
      expect(firstScreen(ctx, s, {}, "boss").every((o) => o.kind === "skill" && skillIds(FULL_POOL, "rare").includes(o.id))).toBe(true);
    }
  });
});

/** normal: purses only; hard: items only; elite: skills only; boss: rare skills only. */
const DEFAULT_TABLE_FOR_TIERS = {
  normal: table({ kinds: { crowns: 1 } }),
  hard: table({ kinds: { item: 1 } }),
  elite: table({ kinds: { skill: 1 } }),
  boss: table({ kinds: { skill: 1 }, rarity: { rare: 1 } }),
};

// =============================================================================================
// Weights (statistical, generous tolerance)

describe("rewards: weights", () => {
  it("kinds follow the table's weights (skill 3 : item 1)", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 3, item: 1 } }) });
    const all = screensOver(ctx, 300).flat();
    expect(all).toHaveLength(900);
    expect(countKind(all, "skill") / all.length).toBeGreaterThan(0.68);
    expect(countKind(all, "skill") / all.length).toBeLessThan(0.82);
  });

  it("rarities follow the table's weights (common 1 : uncommon 3), and weight 0 is never drawn", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { common: 1, uncommon: 3, rare: 0 } }) });
    const named = screensOver(ctx, 300).flatMap(ids);
    const uncommon = skillIds(FULL_POOL, "uncommon");
    const rare = skillIds(FULL_POOL, "rare");
    expect(named.some((id) => rare.includes(id))).toBe(false);
    const share = named.filter((id) => uncommon.includes(id)).length / named.length;
    expect(share).toBeGreaterThan(0.68);
    expect(share).toBeLessThan(0.82);
  });

  it("a missing rarity field counts as common", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1, item: 1 }, rarity: { common: 1 } }) });
    const common = [...skillIds(FULL_POOL, "common"), ...itemIds(FULL_POOL, "common"), "weapon.club", "armor.plain", "accessory.plain"];
    const seen = new Set<string>();
    for (const options of screensOver(ctx, 150)) for (const id of ids(options)) seen.add(id);
    for (const id of seen) expect(common).toContain(id);
    // The files without a rarity field are offered too.
    for (const id of ["skill.c1", "skill.c2", "skill.c3", "word.c6", "skill.granted", "armor.crushing"]) expect(seen.has(id)).toBe(true);
  });

  it("the rarity is drawn among rarities with something left: a lone rare doesn't shorten the screen", () => {
    // Rare weight 1000 but only one rare skill: every screen has it, and the rest are common.
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { common: 1, rare: 1000 } }), pool: [R1, C1, C2, C3, C4, C5] });
    for (const options of screensOver(ctx, 30)) {
      expect(options).toHaveLength(3);
      expect(ids(options)).toContain("skill.r1");
    }
  });

  it("within a rarity, each candidate is equally likely", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { uncommon: 1 } }), pool: [U1, U2, U3, U4, U5, U6] });
    const counts = new Map<string, number>();
    for (const options of screensOver(ctx, 300)) for (const id of ids(options)) counts.set(id, (counts.get(id) ?? 0) + 1);
    // 3 of 6 per screen: each about 150 times.
    expect([...counts.keys()].sort()).toEqual(["skill.u1", "skill.u2", "skill.u3", "skill.u4", "word.u5", "word.u6"]);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(105);
      expect(n).toBeLessThan(195);
    }
  });
});

// =============================================================================================
// Taking and skipping

describe("rewards: taking and skipping", () => {
  it("a purse: RewardTaken, CrownsGained, then the next step", () => {
    const ctx = rewardsCtx({ table: CROWNS_ONLY });
    const { run } = rewardsRun(ctx);
    const purse = only(screen(run));
    if (purse.kind !== "crowns") throw new Error("expected a purse");
    const events = ok(takeReward(ctx, run, 0));
    expect(kinds(events)).toEqual(["RewardTaken", "CrownsGained", "OptionsOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", option: purse });
    expect(eventOf(events, "CrownsGained")).toEqual({ type: "CrownsGained", amount: purse.amount, crowns: purse.amount });
    expect(run.crowns).toBe(purse.amount);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
  });

  it("purses add up over the run", () => {
    const ctx = rewardsCtx({ table: CROWNS_ONLY });
    const run = startRewardsRun(ctx);
    let total = 0;
    for (let step = 1; step <= 3; step++) {
      toRewards(ctx, run, "normal");
      const purse = only(screen(run));
      if (purse.kind === "crowns") total += purse.amount;
      ok(takeReward(ctx, run, 0));
    }
    expect(run.crowns).toBe(total);
  });

  it("a skill with fewer than 5 cards: added at the end (CardLearned, replaced null)", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const { run } = rewardsRun(ctx, { cards: ["weapon.club", "skill.c1", "skill.c2", "skill.c3"] });
    const option = screen(run)[1];
    if (option === undefined || option.kind !== "skill") throw new Error("expected a skill");
    const events = ok(takeReward(ctx, run, 1));
    expect(kinds(events)).toEqual(["RewardTaken", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: option.id, replaced: null });
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1", "skill.c2", "skill.c3", option.id]);
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
  });

  it("a learned Word is a card in the next fight", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { rare: 1 } }), pool: [...SKILL_FILES] });
    const { run } = rewardsRun(ctx);
    ok(takeReward(ctx, run, indexOfId(run, "word.r3")));
    expect((playerUnitFromRun(ctx.pack, run).cards ?? []).map((c) => c.id)).toEqual(["weapon.club", "word.r3"]);
  });

  it("skipping: RewardSkipped, then the next step; nothing else changes", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx, { hp: -4 });
    const before = snapshot(run);
    const events = ok(skipReward(ctx, run));
    expect(kinds(events)).toEqual(["RewardSkipped", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.player).toEqual(before.player);
    expect(run.picks).toEqual(before.picks);
    expect(run.crowns).toBe(before.crowns);
    expect(run.limits).toEqual(before.limits);
  });

  it("a bad index is refused (no_such_option) and changes nothing", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx);
    const n = screen(run).length;
    for (const i of [-1, n, n + 3, 0.5, Number.NaN]) expectRefused(run, () => takeReward(ctx, run, i), "no_such_option");
  });

  it("takeReward and skipReward are refused outside the rewards phase", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    expectRefused(run, () => takeReward(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => skipReward(ctx, run), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => takeReward(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => skipReward(ctx, run), "wrong_phase");
    ok(completeNode(ctx, run, { rewardTier: "normal" }));
    ok(skipReward(ctx, run));
    expectRefused(run, () => takeReward(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => skipReward(ctx, run), "wrong_phase");
  });
});

// =============================================================================================
// Learning

describe("rewards: learning with a full hand", () => {
  function fullHandScreen(tier: GroupTier = "normal", seed = "seed") {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const { run } = rewardsRun(ctx, { cards: C_HAND, tier, seed });
    const option = screen(run)[0];
    if (option === undefined || option.kind !== "skill") throw new Error("expected a skill");
    return { ctx, run, card: option.id };
  }

  it("taking a skill with 5 cards: phase learning, CardOffered, the hand unchanged", () => {
    const { ctx, run, card } = fullHandScreen();
    const events = ok(takeReward(ctx, run, 0));
    expect(kinds(events)).toEqual(["RewardTaken", "CardOffered"]);
    expect(eventOf(events, "CardOffered")).toEqual({ type: "CardOffered", card });
    expect(run.phase).toBe("learning");
    expect(run.learning).toEqual({ card });
    expect(run.player.cards).toEqual(C_HAND);
    expect(run.step).toBe(1);
    expect(snapshot(run)).toEqual(run);
  });

  it("forgetCard(i): card i leaves, the new card goes at the end (CardLearned, replaced), then the next step", () => {
    const { ctx, run, card } = fullHandScreen();
    ok(takeReward(ctx, run, 0));
    const events = ok(forgetCard(ctx, run, 2));
    expect(kinds(events)).toEqual(["CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card, replaced: "skill.c2" });
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1", "skill.c3", "skill.c4", card]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.learning).toBeNull();
  });

  it("Strike can be forgotten; the weapon stays worn", () => {
    const { ctx, run, card } = fullHandScreen();
    ok(takeReward(ctx, run, 0));
    const events = ok(forgetCard(ctx, run, 0));
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card, replaced: "weapon.club" });
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "skill.c3", "skill.c4", card]);
    expect(run.picks.weapon).toBe("weapon.club");
  });

  it("leaveCard keeps the hand (CardLeft), then the next step", () => {
    const { ctx, run, card } = fullHandScreen();
    ok(takeReward(ctx, run, 0));
    const events = ok(leaveCard(ctx, run));
    expect(kinds(events)).toEqual(["CardLeft", "OptionsOffered"]);
    expect(eventOf(events, "CardLeft")).toEqual({ type: "CardLeft", card });
    expect(run.player.cards).toEqual(C_HAND);
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
  });

  it("a left card can be offered again later (it isn't held)", () => {
    // Only one skill in the pool besides the hand: it comes back on the next screen.
    const ctx = rewardsCtx({ table: SKILL_ONLY, pool: [C1, C2, C3, C4, C5] });
    const { run } = rewardsRun(ctx, { cards: C_HAND });
    expect(ids(screen(run))).toEqual(["skill.c5"]);
    ok(takeReward(ctx, run, 0));
    ok(leaveCard(ctx, run));
    toRewards(ctx, run, "normal");
    expect(ids(screen(run))).toEqual(["skill.c5"]);
  });

  it("a bad card index is refused (no_such_option) and changes nothing", () => {
    const { ctx, run } = fullHandScreen();
    ok(takeReward(ctx, run, 0));
    for (const i of [-1, 5, 7, 1.5]) expectRefused(run, () => forgetCard(ctx, run, i), "no_such_option");
  });

  it("forgetCard and leaveCard are refused outside the learning phase", () => {
    const { ctx, run } = fullHandScreen();
    expectRefused(run, () => forgetCard(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => leaveCard(ctx, run), "wrong_phase");
    ok(takeReward(ctx, run, 0));
    ok(leaveCard(ctx, run));
    expectRefused(run, () => forgetCard(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => leaveCard(ctx, run), "wrong_phase");
  });

  it("in the learning phase, the rewards commands and the map commands are refused", () => {
    const { ctx, run } = fullHandScreen();
    ok(takeReward(ctx, run, 0));
    expectRefused(run, () => takeReward(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => skipReward(ctx, run), "wrong_phase");
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
    expectRefused(run, () => chooseLevelUp(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, {}), "wrong_phase");
    expectRefused(run, () => revive(ctx, run, REVIVE), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => fallInNode(run), "wrong_phase");
  });
});

// =============================================================================================
// Items

describe("rewards: items", () => {
  /** Item-only screens; the pool is `items` plus C1-C5 and the granted skills (for hands). Brute: no bonus options. */
  const itemCtx = (items: readonly ContentFile[]): RunContext => rewardsCtx({ table: ITEM_ONLY, pool: [...items, C1, C2, C3, C4, C5, GRANTED, GRANTED2] });

  /** Takes item `id` from the first screen; returns the takeReward events. */
  function takeItem(
    items: readonly ContentFile[],
    id: string,
    opts: { picks?: Parameters<typeof startRewardsRun>[2]; cards?: string[]; hp?: number; tier?: GroupTier } = {},
  ): { ctx: RunContext; run: RunState; events: readonly RunEvent[] } {
    const ctx = itemCtx(items);
    const { run } = rewardsRun(ctx, opts);
    const events = ok(takeReward(ctx, run, indexOfId(run, id)));
    return { ctx, run, events };
  }

  it("armor: picks change, max HP = 20 + 5 × Vitality + items' HP, HP moves by the same amount", () => {
    const { ctx, run, events } = takeItem([MAIL], "armor.mail", { hp: -15 });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", option: { kind: "item", id: "armor.mail", slot: "armor" } });
    expect(eventOf(events, "ItemEquipped")).toEqual({ type: "ItemEquipped", slot: "armor", item: "armor.mail", previous: "armor.plain", maxHp: 45, hp: 30 });
    expect(run.picks.armor).toBe("armor.mail");
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(30);
    expect(run.player.cards).toEqual(["weapon.club"]);
    expect(playerUnitFromRun(ctx.pack, run).maxHp).toBe(45);
  });

  it("stats follow the new item at once; base stats don't change", () => {
    const { ctx, run } = takeItem([BULWARK], "armor.bulwark");
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(finalStat(ctx, run, "vitality")).toBe(5);
    expect(unit.maxShield).toBe(4);
    expect(run.player.baseStats.vitality).toBe(3);
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(45);
  });

  it("a lower max HP lowers HP by the same amount, never below 1", () => {
    // Crushing: −4 Vitality (3 → 0), +10 HP: max 20 + 0 + 10 = 30.
    const full = takeItem([CRUSHING], "armor.crushing");
    expect(full.run.player.maxHp).toBe(30);
    expect(full.run.player.hp).toBe(30);
    expect(finalStat(full.ctx, full.run, "vitality")).toBe(0);
    expect(playerUnitFromRun(full.ctx.pack, full.run).maxShield).toBe(3);
    const low = takeItem([CRUSHING], "armor.crushing", { hp: -31 });
    expect(low.run.player.hp).toBe(1);
    expect(eventOf(low.events, "ItemEquipped")).toMatchObject({ maxHp: 30, hp: 1 });
  });

  it("a weapon: the old Strike leaves (CardRemoved), the new Strike is added at the end", () => {
    const { ctx, run, events } = takeItem([SPEAR], "weapon.spear", { cards: ["weapon.club", "skill.c1", "skill.c2"] });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "ItemEquipped")).toMatchObject({ slot: "weapon", item: "weapon.spear", previous: "weapon.club" });
    expect(eventOf(events, "CardRemoved")).toEqual({ type: "CardRemoved", card: "weapon.club" });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "weapon.spear", replaced: null });
    expect(run.picks.weapon).toBe("weapon.spear");
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "weapon.spear"]);
    expect(finalStat(ctx, run, "agility")).toBe(3);
  });

  it("a weapon with 5 cards, Strike held: the old Strike's slot frees room for the new one", () => {
    const { run, events } = takeItem([SPEAR], "weapon.spear", { cards: C_HAND });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "CardLearned", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "skill.c3", "skill.c4", "weapon.spear"]);
  });

  it("a weapon after Strike was forgotten, with room: nothing leaves, the new Strike is added", () => {
    const { run, events } = takeItem([SPEAR], "weapon.spear", { cards: ["skill.c1", "skill.c2"] });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardLearned", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "weapon.spear"]);
  });

  it("a weapon after Strike was forgotten, hand full: learning for the new Strike; leaving it keeps the weapon", () => {
    const hand = ["skill.c1", "skill.c2", "skill.c3", "skill.c4", "skill.c5"];
    const { ctx, run, events } = takeItem([SPEAR], "weapon.spear", { cards: hand });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardOffered"]);
    expect(eventOf(events, "CardOffered")).toEqual({ type: "CardOffered", card: "weapon.spear" });
    expect(run.phase).toBe("learning");
    expect(run.learning).toEqual({ card: "weapon.spear" });
    expect(run.picks.weapon).toBe("weapon.spear");
    expect(kinds(ok(leaveCard(ctx, run)))).toEqual(["CardLeft", "OptionsOffered"]);
    expect(run.player.cards).toEqual(hand);
    expect(run.picks.weapon).toBe("weapon.spear");
  });

  it("a weapon after Strike was forgotten, hand full: forgetting a card takes the new Strike", () => {
    const hand = ["skill.c1", "skill.c2", "skill.c3", "skill.c4", "skill.c5"];
    const { ctx, run } = takeItem([SPEAR], "weapon.spear", { cards: hand });
    const events = ok(forgetCard(ctx, run, 4));
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "weapon.spear", replaced: "skill.c5" });
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "skill.c3", "skill.c4", "weapon.spear"]);
  });

  it("an accessory that grants a skill: the skill is gained like any new skill", () => {
    const { run, events } = takeItem([CHARM], "accessory.charm");
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "ItemEquipped")).toMatchObject({ slot: "accessory", item: "accessory.charm", previous: "accessory.plain" });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "skill.granted", replaced: null });
    expect(run.player.cards).toEqual(["weapon.club", "skill.granted"]);
  });

  it("replacing an accessory: its granted skill leaves with it (if held)", () => {
    const { run, events } = takeItem([CHARM, AMULET], "accessory.amulet", { picks: { accessory: "accessory.charm" } });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "OptionsOffered"]);
    expect(eventOf(events, "CardRemoved")).toEqual({ type: "CardRemoved", card: "skill.granted" });
    expect(eventOf(events, "ItemEquipped")).toMatchObject({ item: "accessory.amulet", previous: "accessory.charm", maxHp: 41, hp: 41 });
    expect(run.player.cards).toEqual(["weapon.club"]);
  });

  it("replacing an accessory whose granted skill was forgotten: nothing leaves", () => {
    const { run, events } = takeItem([CHARM, AMULET], "accessory.amulet", { picks: { accessory: "accessory.charm" }, cards: ["weapon.club", "skill.c1"] });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1"]);
  });

  it("accessory to accessory: the old grant leaves, then the new grant is added", () => {
    const { run, events } = takeItem([CHARM, SIGIL], "accessory.sigil", { picks: { accessory: "accessory.charm" }, cards: ["weapon.club", "skill.granted", "skill.c1"] });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "CardRemoved")).toEqual({ type: "CardRemoved", card: "skill.granted" });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "skill.granted2", replaced: null });
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1", "skill.granted2"]);
  });

  it("an accessory's grant with a full hand: learning", () => {
    const { ctx, run, events } = takeItem([CHARM], "accessory.charm", { cards: C_HAND });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardOffered"]);
    expect(run.learning).toEqual({ card: "skill.granted" });
    ok(forgetCard(ctx, run, 0));
    expect(run.player.cards).toEqual(["skill.c1", "skill.c2", "skill.c3", "skill.c4", "skill.granted"]);
    expect(run.picks.accessory).toBe("accessory.charm");
  });

  it("the replaced item can be offered again later (it is no longer worn)", () => {
    const { ctx, run } = takeItem([MAIL], "armor.mail");
    toRewards(ctx, run, "normal");
    expect(ids(screen(run))).toEqual(["armor.plain"]);
  });
});

// =============================================================================================
// Rerolls

describe("rewards: rerolls", () => {
  it("redraws the whole screen: RewardsRerolled, then RewardsOffered; one reroll used", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx);
    const events = ok(rerollRewards(ctx, run, REROLL));
    expect(kinds(events)).toEqual(["RewardsRerolled", "RewardsOffered"]);
    expect(eventOf(events, "RewardsRerolled")).toEqual({ type: "RewardsRerolled", rerollsUsed: 1 });
    expect(run.limits.used.reroll).toBe(1);
    expect(run.limits.used.revive).toBe(0);
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.rerolls).toBe(1);
    expect(run.rewards?.tier).toBe("normal");
    expect(eventOf(events, "RewardsOffered")).toEqual({ type: "RewardsOffered", tier: "normal", options: screen(run), rerolls: 1 });
  });

  it("changes only this screen and the reroll count", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx, { hp: -3 });
    const before = withoutScreen(run);
    ok(rerollRewards(ctx, run, REROLL));
    expect(withoutScreen(run)).toEqual(before);
  });

  it("a rerolled screen follows the same rules (size, exclusions)", () => {
    const ctx = rewardsCtx();
    const held = ["weapon.club", "skill.c1", "skill.u1", "skill.r1"];
    for (const s of seeds(20)) {
      const { run } = rewardsRun(ctx, { seed: s, cards: held, picks: { character: "char.sage", path: "path.study" } });
      for (let i = 0; i < 3; i++) {
        ok(rerollRewards(ctx, run, REROLL));
        const options = screen(run);
        expect(options).toHaveLength(4);
        const named = ids(options);
        expect(new Set(named).size).toBe(named.length);
        for (const id of named) expect([...held, "armor.plain", "accessory.plain"]).not.toContain(id);
        expect(countKind(options, "crowns")).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic per seed and reroll number, and does change screens", () => {
    const ctx = rewardsCtx();
    let changed = 0;
    for (const s of seeds(30)) {
      const a = rewardsRun(ctx, { seed: s }).run;
      const b = rewardsRun(ctx, { seed: s }).run;
      const first = screen(a);
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, b, REROLL));
      expect(screen(a)).toEqual(screen(b));
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, b, REROLL));
      expect(screen(a)).toEqual(screen(b));
      if (JSON.stringify(screen(a)) !== JSON.stringify(first)) changed++;
    }
    expect(changed).toBeGreaterThan(15);
  });

  it("nothing else in the run shifts: later steps, screens and level-ups are the same with or without rerolls", () => {
    const ctx = rewardsCtx();
    for (const s of seeds(10)) {
      const a = rewardsRun(ctx, { seed: s }).run;
      const b = rewardsRun(ctx, { seed: s }).run;
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, a, REROLL));
      const nextA = ok(skipReward(ctx, a));
      const nextB = ok(skipReward(ctx, b));
      expect(nextA).toEqual(nextB);
      expect({ ...snapshot(a), limits: null }).toEqual({ ...snapshot(b), limits: null });
      // The next screen (its own first draw) and the level-up after it are the same.
      const evA = toRewards(ctx, a, "elite");
      const evB = toRewards(ctx, b, "elite");
      expect(evA).toEqual(evB);
      expect(kinds(ok(skipReward(ctx, a)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
      ok(skipReward(ctx, b));
      expect(a.levelUp).toEqual(b.levelUp);
    }
  });

  it("3 per run, across screens; past the limit refused (limit_reached) and nothing changes", () => {
    expect(RUN_LIMITS.reroll).toBe(3);
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    toRewards(ctx, run, "normal");
    expect(eventOf(ok(rerollRewards(ctx, run, REROLL)), "RewardsRerolled")["rerollsUsed"]).toBe(1);
    expect(eventOf(ok(rerollRewards(ctx, run, { action: "reroll", source: "premium" })), "RewardsRerolled")["rerollsUsed"]).toBe(2);
    ok(skipReward(ctx, run));
    toRewards(ctx, run, "normal");
    expect(run.rewards?.rerolls).toBe(0);
    const third = ok(rerollRewards(ctx, run, { action: "reroll", source: "fallback" }));
    expect(eventOf(third, "RewardsRerolled")["rerollsUsed"]).toBe(3);
    expect(eventOf(third, "RewardsOffered")["rerolls"]).toBe(1);
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "limit_reached");
    ok(takeReward(ctx, run, 0));
    if (run.phase === "learning") ok(leaveCard(ctx, run));
    toRewards(ctx, run, "normal");
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "limit_reached");
    expect(run.limits.used.reroll).toBe(3);
  });

  it("a grant for another action is refused (wrong_action) and nothing changes", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx);
    expectRefused(run, () => rerollRewards(ctx, run, REVIVE), "wrong_action");
    expect(run.limits.used.reroll).toBe(0);
  });

  it("refused outside the rewards phase (wrong_phase)", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
    ok(completeNode(ctx, run, { rewardTier: "elite" }));
    ok(skipReward(ctx, run));
    expect(run.phase).toBe("levelUp");
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
  });

  it("rerolls and revives are counted apart", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    toRewards(ctx, run, "normal");
    ok(rerollRewards(ctx, run, REROLL));
    ok(skipReward(ctx, run));
    toRewards(ctx, run, "normal", -1000);
    ok(revive(ctx, run, REVIVE));
    expect(run.limits.used).toEqual({ revive: 1, reroll: 1 });
  });
});

// =============================================================================================
// Level-ups

describe("level-ups", () => {
  /** A run on the level-up after an elite node (screen skipped). */
  function levelUpRun(opts: { seed?: string; picks?: Parameters<typeof startRewardsRun>[2]; stats?: Partial<StatBlock>; hp?: number; tier?: GroupTier; extra?: ContentFile[] } = {}) {
    const ctx = rewardsCtx({ extra: opts.extra ?? [] });
    const { run } = rewardsRun(ctx, { seed: opts.seed ?? "seed", picks: opts.picks ?? {}, stats: opts.stats ?? {}, tier: opts.tier ?? "elite", hp: opts.hp ?? 0 });
    const events = ok(skipReward(ctx, run));
    return { ctx, run, events };
  }

  const optionsOf = (run: RunState): readonly StatId[] => {
    const l = run.levelUp;
    if (l === null) throw new Error(`no level-up (phase ${run.phase})`);
    return l.options;
  };

  it("only after elite and boss fights", () => {
    for (const tier of TIERS) {
      const { run, events } = levelUpRun({ tier });
      const levels = tier === "elite" || tier === "boss";
      expect(kinds(events)).toEqual(levels ? ["RewardSkipped", "LevelUpOffered"] : ["RewardSkipped", "OptionsOffered"]);
      expect(run.phase).toBe(levels ? "levelUp" : "choosing");
    }
  });

  it("offers 2 stats: the first favoured, the second another stat; LevelUpOffered matches the state", () => {
    for (const s of seeds(40)) {
      const { run, events } = levelUpRun({ seed: s });
      const [a, b] = optionsOf(run);
      expect(optionsOf(run)).toHaveLength(2);
      expect(["might", "vitality"]).toContain(a);
      expect(b).not.toBe(a);
      expect(STAT_IDS).toContain(b);
      expect(eventOf(events, "LevelUpOffered")).toEqual({ type: "LevelUpOffered", options: optionsOf(run) });
      expect(snapshot(run)).toEqual(run);
    }
  });

  it("the favoured option covers both favoured stats; the other covers the rest, the other favoured stat included", () => {
    const first = new Set<string>();
    const second = new Set<string>();
    for (const s of seeds(300)) {
      const { run } = levelUpRun({ seed: s });
      const [a, b] = optionsOf(run);
      if (a !== undefined) first.add(a);
      if (b !== undefined) second.add(b);
    }
    expect([...first].sort()).toEqual(["might", "vitality"]);
    expect([...second].sort()).toEqual([...STAT_IDS].sort());
  });

  it("only stats whose base value is below 7 are offered", () => {
    for (const s of seeds(40)) {
      const { run } = levelUpRun({ seed: s, stats: { might: 7, cunning: 7, arcana: 7 } });
      const [a, b] = optionsOf(run);
      expect(a).toBe("vitality");
      expect(["agility", "intelligence", "wisdom"]).toContain(b);
    }
  });

  it("no favoured stat below the cap: two different stats from the rest", () => {
    const seen = new Set<string>();
    for (const s of seeds(60)) {
      const { run } = levelUpRun({ seed: s, stats: capped({ cunning: 2, agility: 4, wisdom: 6 }) });
      const options = optionsOf(run);
      expect(options).toHaveLength(2);
      expect(options[0]).not.toBe(options[1]);
      for (const o of options) {
        expect(["cunning", "agility", "wisdom"]).toContain(o);
        seen.add(o);
      }
    }
    expect([...seen].sort()).toEqual(["agility", "cunning", "wisdom"]);
  });

  it("one eligible stat: a shorter offer", () => {
    expect(optionsOf(levelUpRun({ stats: capped({ agility: 5 }) }).run)).toEqual(["agility"]);
    expect(optionsOf(levelUpRun({ stats: capped({ vitality: 6 }) }).run)).toEqual(["vitality"]);
  });

  it("no eligible stat: no level-up, the run moves on", () => {
    const { run, events } = levelUpRun({ stats: capped() });
    expect(kinds(events)).toEqual(["RewardSkipped", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.levelUp).toBeNull();
  });

  it("the cap counts base stats only: an item above 7 doesn't stop a level-up", () => {
    // Heavy: +5 Might. Base Might 6 → final 11; Might can still be raised (to 7).
    const { ctx, run } = levelUpRun({ picks: { weapon: "weapon.heavy" }, stats: { might: 6, vitality: 7 }, extra: [HEAVY] });
    expect(optionsOf(run)[0]).toBe("might");
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(eventOf(events, "StatRaised")).toMatchObject({ stat: "might", gain: 1, value: 7 });
    expect(finalStat(ctx, run, "might")).toBe(12);
  });

  it("a favoured stat gains +2 (StatRaised), then the next step", () => {
    const { ctx, run } = levelUpRun({ stats: { vitality: 7 } });
    expect(optionsOf(run)[0]).toBe("might");
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(events)).toEqual(["StatRaised", "OptionsOffered"]);
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: "might", gain: 2, value: 5, maxHp: 35, hp: 35 });
    expect(run.player.baseStats.might).toBe(5);
    expect(run.player.maxHp).toBe(35);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.levelUp).toBeNull();
  });

  it("another stat gains +1; max HP doesn't change", () => {
    const { ctx, run } = levelUpRun({ stats: { vitality: 7 } });
    const other = optionsOf(run)[1];
    if (other === undefined) throw new Error("expected two options");
    const before = run.player.baseStats[other];
    const events = ok(chooseLevelUp(ctx, run, 1));
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: other, gain: 1, value: before + 1, maxHp: 35, hp: 35 });
    expect(run.player.baseStats[other]).toBe(before + 1);
  });

  it("the gain never takes a base stat above 7", () => {
    const { ctx, run } = levelUpRun({ stats: { might: 6, vitality: 7 } });
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(eventOf(events, "StatRaised")).toMatchObject({ stat: "might", gain: 1, value: 7 });
    expect(run.player.baseStats.might).toBe(7);
  });

  it("Vitality (favoured, +2): max HP and HP both rise by 10", () => {
    const { ctx, run } = levelUpRun({ stats: { might: 7 }, hp: -10 });
    expect(optionsOf(run)[0]).toBe("vitality");
    expect(run.player.hp).toBe(25);
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: "vitality", gain: 2, value: 5, maxHp: 45, hp: 35 });
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(35);
    expect(playerUnitFromRun(ctx.pack, run).maxHp).toBe(45);
  });

  it("Vitality capped (+1 of 2): max HP and HP rise by 5", () => {
    // Base Vitality 6 (max HP 20 + 30 = 50, set consistently), Might at the cap: Vitality is the favoured option.
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    run.player.baseStats = { ...run.player.baseStats, might: 7, vitality: 6 };
    run.player.maxHp = 50;
    run.player.hp = 50;
    toRewards(ctx, run, "elite");
    ok(skipReward(ctx, run));
    expect(run.levelUp?.options[0]).toBe("vitality");
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(eventOf(events, "StatRaised")).toMatchObject({ stat: "vitality", gain: 1, value: 7, maxHp: 55, hp: 55 });
  });

  it("Vitality as the other stat (+1): max HP and HP rise by 5", () => {
    // Sage (Intelligence, Wisdom favoured): only Intelligence and Vitality can be raised. Max HP 30.
    const { ctx, run } = levelUpRun({ picks: { character: "char.sage" }, stats: capped({ intelligence: 3, vitality: 2 }) });
    expect(optionsOf(run)).toEqual(["intelligence", "vitality"]);
    const events = ok(chooseLevelUp(ctx, run, 1));
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: "vitality", gain: 1, value: 3, maxHp: 35, hp: 35 });
  });

  it("drawn on its own stream: the same offer whatever reward was taken or rerolled", () => {
    for (const s of seeds(15)) {
      const ctx = rewardsCtx();
      const a = rewardsRun(ctx, { seed: s, tier: "elite" }).run;
      const b = rewardsRun(ctx, { seed: s, tier: "elite" }).run;
      ok(rerollRewards(ctx, a, REROLL));
      ok(takeReward(ctx, a, 0));
      ok(skipReward(ctx, b));
      expect(a.levelUp).toEqual(b.levelUp);
    }
  });

  it("a bad index is refused (no_such_option); chooseLevelUp is refused outside the phase", () => {
    const { ctx, run } = levelUpRun();
    for (const i of [-1, 2, 0.5]) expectRefused(run, () => chooseLevelUp(ctx, run, i), "no_such_option");
    for (const command of [
      () => takeReward(ctx, run, 0),
      () => skipReward(ctx, run),
      () => rerollRewards(ctx, run, REROLL),
      () => forgetCard(ctx, run, 0),
      () => leaveCard(ctx, run),
      () => chooseOption(ctx, run, 0),
      () => completeNode(ctx, run, {}),
      () => revive(ctx, run, REVIVE),
      () => endRun(run),
      () => chooseRoute(ctx, run, 0),
    ]) {
      expectRefused(run, command, "wrong_phase");
    }
    ok(chooseLevelUp(ctx, run, 0));
    expectRefused(run, () => chooseLevelUp(ctx, run, 0), "wrong_phase");
    const fresh = startRewardsRun(ctx);
    expectRefused(fresh, () => chooseLevelUp(ctx, fresh, 0), "wrong_phase");
  });
});

// =============================================================================================
// Order after a fight

describe("rewards: order after a fight", () => {
  it("rewards → learning → level-up → next step", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const { run } = rewardsRun(ctx, { cards: C_HAND, tier: "elite" });
    expect(kinds(ok(takeReward(ctx, run, 0)))).toEqual(["RewardTaken", "CardOffered"]);
    expect(run.phase).toBe("learning");
    expect(kinds(ok(forgetCard(ctx, run, 1)))).toEqual(["CardLearned", "LevelUpOffered"]);
    expect(run.phase).toBe("levelUp");
    expect(run.learning).toBeNull();
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
  });

  it("leaving the card also leads to the level-up", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const { run } = rewardsRun(ctx, { cards: C_HAND, tier: "boss" });
    ok(takeReward(ctx, run, 0));
    expect(kinds(ok(leaveCard(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
  });

  it("an item with a card when the hand is full: item, learning, then the level-up", () => {
    const ctx = rewardsCtx({ table: ITEM_ONLY, pool: [CHARM, GRANTED, C1, C2, C3, C4] });
    const { run } = rewardsRun(ctx, { cards: C_HAND, tier: "elite" });
    expect(kinds(ok(takeReward(ctx, run, indexOfId(run, "accessory.charm"))))).toEqual(["RewardTaken", "ItemEquipped", "CardOffered"]);
    expect(kinds(ok(leaveCard(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
  });

  it("taking a reward with room goes straight to the level-up", () => {
    const ctx = rewardsCtx({ table: CROWNS_ONLY });
    const { run } = rewardsRun(ctx, { tier: "elite" });
    expect(kinds(ok(takeReward(ctx, run, 0)))).toEqual(["RewardTaken", "CrownsGained", "LevelUpOffered"]);
  });

  it("after the boss: rewards, level-up, then ActCompleted and the end of the run (no routes)", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    advancePlain(ctx, run, 4);
    expect(run.offer[0]?.fixed).toBe(true);
    expect(kinds(toRewards(ctx, run, "boss"))).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(run.phase).toBe("rewards");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(events)).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
    expect(eventOf(events, "RunEnded")).toEqual({ type: "RunEnded", result: "won" });
    expect(run.phase).toBe("won");
    expect(run.node).toBeNull();
    expect(run.rewards).toBeNull();
    expect(run.levelUp).toBeNull();
  });

  it("after the boss with routes: the routes come after the level-up", () => {
    const acts = [rewardsAct("act.r", DEFAULT_TABLE_FOR_TIERS.elite, { routes: [{ to: "act.r2" }] }), rewardsAct("act.r2", DEFAULT_TABLE_FOR_TIERS.elite, { first: undefined })];
    const ctx = rewardsCtx({ acts });
    const run = startRewardsRun(ctx);
    advancePlain(ctx, run, 4);
    toRewards(ctx, run, "boss");
    ok(takeReward(ctx, run, 0));
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(events)).toEqual(["StatRaised", "ActCompleted", "RoutesOffered"]);
    expect(run.phase).toBe("route");
    expect(run.routes).toEqual(["act.r2"]);
    ok(chooseRoute(ctx, run, 0));
    expect(run.act).toBe("act.r2");
  });

  it("a normal-tier result at the last step: rewards, then the end of the act (no level-up)", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    advancePlain(ctx, run, 4);
    toRewards(ctx, run, "normal");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "ActCompleted", "RunEnded"]);
  });

  it("in the rewards phase the map, revive and end commands are refused", () => {
    const ctx = rewardsCtx();
    const { run } = rewardsRun(ctx);
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, { rewardTier: "normal" }), "wrong_phase");
    expectRefused(run, () => revive(ctx, run, REVIVE), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => fallInNode(run), "wrong_phase");
    expectRefused(run, () => forgetCard(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => leaveCard(ctx, run), "wrong_phase");
    expectRefused(run, () => chooseLevelUp(ctx, run, 0), "wrong_phase");
  });
});

// =============================================================================================
// Through a real fight

describe("rewards: after a real fight", () => {
  const WEAK_BOSS = groupFile("group.weak_boss", "boss", ["enemy.dummy"]);

  function winFight(group: string, extra: readonly ContentFile[] = []) {
    const ctx = combatCtx([fightAct(group), ...extra]);
    const run = startCombatRun(ctx);
    ok(chooseOption(ctx, run, 0));
    const session = startFight(ctx, run);
    strikeUntilOver(session, STRIKE);
    return { ctx, run, events: ok(finishFight(ctx, run, session)) };
  }

  it("a won normal fight opens the rewards screen with the group's tier", () => {
    const { ctx, run, events } = winFight("group.dummy");
    expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(eventOf(events, "NodeCompleted")).toMatchObject({ crownsChange: 0 });
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.tier).toBe("normal");
    expect(screen(run).length).toBe(3);
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "OptionsOffered"]);
  });

  it("a won elite fight: rewards, then a level-up", () => {
    const { ctx, run } = winFight("group.e1");
    expect(run.rewards?.tier).toBe("elite");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
  });

  it("a won boss-tier fight passes the boss tier", () => {
    const { ctx, run } = winFight("group.weak_boss", [WEAK_BOSS]);
    expect(run.rewards?.tier).toBe("boss");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
  });

  it("a lost fight opens no screen", () => {
    const { ctx, run, session } = fightAgainst("group.brute");
    strikeUntilOver(session, STRIKE);
    expect(kinds(ok(finishFight(ctx, run, session)))).toEqual(["PlayerFell"]);
    expect(run.rewards).toBeNull();
  });

  it("the HP after the fight is kept through the rewards and the level-up", () => {
    const { ctx, run, events } = winFight("group.e1");
    const hp = Number(eventOf(events, "NodeCompleted")["hp"]);
    expect(run.player.hp).toBe(hp);
    ok(skipReward(ctx, run));
    const stat = run.levelUp?.options[0];
    ok(chooseLevelUp(ctx, run, 0));
    expect(run.player.hp).toBe(stat === "vitality" ? hp + 10 : hp);
  });
});

// =============================================================================================
// Determinism and saves

/**
 * Plays a run through rewards with a fixed policy that depends only on the run's own state. Fake nodes report tiers
 * in turn; rerolls on odd steps while allowed (once per screen); takes an option or skips; learning forgets or
 * leaves; level-ups pick the last option. Stops when the run ends or after `max` commands.
 */
function playRewards(ctx: RunContext, run: RunState, max = 400, stopAt?: RunState["phase"]): RunEvent[] {
  const events: RunEvent[] = [];
  for (let n = 0; n < max; n++) {
    if (stopAt !== undefined && run.phase === stopAt) return events;
    let res: CommandResult;
    switch (run.phase) {
      case "choosing":
        res = chooseOption(ctx, run, run.step % run.offer.length);
        break;
      case "inNode":
        res = completeNode(ctx, run, { hp: -1, rewardTier: TIERS[(run.step + run.actNumber) % TIERS.length] ?? "normal" });
        break;
      case "rewards": {
        const r = run.rewards;
        const options = r?.options ?? [];
        if (r !== null && r.rerolls === 0 && run.step % 2 === 1 && run.limits.used.reroll < RUN_LIMITS.reroll) res = rerollRewards(ctx, run, REROLL);
        else if (options.length === 0 || run.step % 5 === 0) res = skipReward(ctx, run);
        else res = takeReward(ctx, run, (run.step + run.actNumber) % options.length);
        break;
      }
      case "learning":
        res = run.step % 2 === 0 ? forgetCard(ctx, run, (run.step + 1) % run.player.cards.length) : leaveCard(ctx, run);
        break;
      case "levelUp":
        res = chooseLevelUp(ctx, run, (run.levelUp?.options.length ?? 1) - 1);
        break;
      case "route":
        res = chooseRoute(ctx, run, 0);
        break;
      default:
        return events;
    }
    events.push(...ok(res));
  }
  return events;
}

describe("rewards: determinism and saves", () => {
  /** Per tier: the default table; items and purses; skills only; rare things only. */
  const MIXED = { normal: table(), hard: table({ kinds: { item: 1, crowns: 1 } }), elite: table({ kinds: { skill: 1 } }), boss: table({ rarity: { rare: 1 } }) };
  /** Two acts of 7 steps (act.r routes to act.r2). */
  const longCtx = (): RunContext =>
    rewardsCtx({
      acts: [
        rewardsAct("act.r", table(), { steps: { min: 7, max: 7 }, rewards: MIXED, routes: [{ to: "act.r2" }] }),
        rewardsAct("act.r2", table(), { first: undefined, steps: { min: 7, max: 7 }, rewards: MIXED }),
      ],
    });

  it("the policy run reaches every new phase and ends", () => {
    const ctx = longCtx();
    const run = startRewardsRun(ctx, "policy");
    const events = playRewards(ctx, run);
    const seen = new Set(kinds(events));
    for (const k of ["RewardsOffered", "RewardsRerolled", "RewardTaken", "RewardSkipped", "CardLearned", "CardOffered", "CrownsGained", "ItemEquipped", "LevelUpOffered", "StatRaised"]) {
      expect([k, seen.has(k)]).toEqual([k, true]);
    }
    expect(run.phase).toBe("won");
  });

  it("same seed, same commands: the same events and the same run", () => {
    const ctx = longCtx();
    for (const s of seeds(5, "det")) {
      const a = startRewardsRun(ctx, s);
      const b = startRewardsRun(ctx, s);
      expect(playRewards(ctx, a)).toEqual(playRewards(ctx, b));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it("different seeds give different screens", () => {
    const ctx = rewardsCtx();
    const distinct = new Set(seeds(20).map((s) => JSON.stringify(firstScreen(ctx, s))));
    expect(distinct.size).toBeGreaterThan(10);
  });

  for (const phase of ["rewards", "learning", "levelUp"] as const) {
    it(`a JSON round trip in phase ${phase} continues identically`, () => {
      const ctx = longCtx();
      let tested = 0;
      for (const s of seeds(8, "rt")) {
        const run = startRewardsRun(ctx, s);
        playRewards(ctx, run, 400, phase);
        if (run.phase !== phase) continue;
        tested++;
        const copy = snapshot(run);
        expect(copy).toEqual(run);
        expect(playRewards(ctx, copy)).toEqual(playRewards(ctx, run));
        expect(snapshot(copy)).toEqual(snapshot(run));
      }
      expect(tested).toBeGreaterThan(0);
    });
  }

  it("the events of a screen match the state", () => {
    const ctx = longCtx();
    const run = startRewardsRun(ctx, "match");
    for (let n = 0; n < 200 && run.phase !== "won"; n++) {
      const events = playRewards(ctx, run, 1);
      for (const e of evs(events)) {
        if (e.type === "RewardsOffered") {
          expect(e["options"]).toEqual(run.rewards?.options);
          expect(e["rerolls"]).toBe(run.rewards?.rerolls);
          expect(e["tier"]).toBe(run.rewards?.tier);
        }
        if (e.type === "CardOffered") expect(run.learning).toEqual({ card: e["card"] });
        if (e.type === "LevelUpOffered") expect(run.levelUp).toEqual({ options: e["options"] });
        if (e.type === "CrownsGained") expect(e["crowns"]).toBe(run.crowns);
      }
      expect(run.player.cards.length).toBeLessThanOrEqual(5);
      expect(new Set(run.player.cards).size).toBe(run.player.cards.length);
      expect(run.player.hp).toBeLessThanOrEqual(run.player.maxHp);
    }
  });
});

// =============================================================================================
// Clarifications 5-13 (brief "Clarifications"; spec "Rewards, items and level-ups", Details)

describe("rewards: invalid tiers (clarification 6)", () => {
  it("a rewardTier that isn't a tier is refused (invalid_result) and changes nothing", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    ok(chooseOption(ctx, run, 0));
    for (const tier of ["legendary", "", "Normal"]) {
      expectRefused(run, () => completeNode(ctx, run, { hp: -5, rewardTier: tier as unknown as GroupTier }), "invalid_result");
      expectRefused(run, () => completeNode(ctx, run, { hp: -1000, rewardTier: tier as unknown as GroupTier }), "invalid_result");
    }
  });

  it("a tier with no table in the act is refused (invalid_result) and changes nothing", () => {
    // An act without groups may give some tiers only.
    const ctx = rewardsCtx({ acts: [rewardsAct("act.r", DEFAULT_TABLE, { rewards: { normal: DEFAULT_TABLE } })] });
    const run = startRewardsRun(ctx);
    ok(chooseOption(ctx, run, 0));
    for (const tier of ["hard", "elite", "boss"] as const) expectRefused(run, () => completeNode(ctx, run, { hp: -2, rewardTier: tier }), "invalid_result");
    expect(kinds(ok(completeNode(ctx, run, { rewardTier: "normal" })))).toEqual(["NodeCompleted", "RewardsOffered"]);
  });

  it("an act with no rewards at all refuses any tier, and still takes results without one", () => {
    const ctx = rewardsCtx({ acts: [rewardsAct("act.r", DEFAULT_TABLE, { rewards: undefined })] });
    const run = startRewardsRun(ctx);
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => completeNode(ctx, run, { rewardTier: "normal" }), "invalid_result");
    expect(kinds(ok(completeNode(ctx, run, {})))).toEqual(["NodeCompleted", "OptionsOffered"]);
  });
});

describe("rewards: weight 0 (clarification 7)", () => {
  it("a rarity with weight 0 is never drawn, even when it is the only one with candidates of a kind", () => {
    // Rarity: rare only. Skills: common only → the skill kind can't be drawn; the one rare item fills one option.
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 5, item: 1 }, rarity: { common: 0, uncommon: 0, rare: 1 } }), pool: [C1, C2, C3, C4, C5, GLAIVE] });
    for (const options of screensOver(ctx, 20)) expect(options).toEqual([{ kind: "item", id: "weapon.glaive", slot: "weapon" }]);
  });

  it("bonus options need a drawable rarity too: none, the screen is shorter", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { crowns: 1 }, rarity: { rare: 1 } }), pool: [C1, C2, C3, U1, U2] });
    for (const options of screensOver(ctx, 10, { character: "char.sage", path: "path.deep_study" })) {
      expect(options).toHaveLength(1);
      expect(options[0]?.kind).toBe("crowns");
    }
  });

  it("weight-0 rarities next to positive ones never appear", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1, item: 1 }, rarity: { common: 0, uncommon: 1, rare: 0 } }) });
    const uncommon = [...skillIds(FULL_POOL, "uncommon"), ...itemIds(FULL_POOL, "uncommon")];
    for (const options of screensOver(ctx, 60)) for (const id of ids(options)) expect(uncommon).toContain(id);
  });
});

describe("rewards: nothing to offer (clarification 8)", () => {
  /** No unheld skill, no unworn item, no purse weight. */
  const emptyCtx = (): RunContext => rewardsCtx({ table: table({ kinds: { skill: 1, item: 1 } }), pool: [] });

  it("no rewards phase: straight to the next step", () => {
    const ctx = emptyCtx();
    const run = startRewardsRun(ctx);
    const events = toRewards(ctx, run, "normal", -3);
    expect(kinds(events)).toEqual(["NodeCompleted", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.node).toBeNull();
  });

  it("after an elite fight: straight to the level-up", () => {
    const ctx = emptyCtx();
    const run = startRewardsRun(ctx);
    expect(kinds(toRewards(ctx, run, "elite"))).toEqual(["NodeCompleted", "LevelUpOffered"]);
    expect(run.phase).toBe("levelUp");
    expect(run.rewards).toBeNull();
  });

  it("after the boss: straight to the level-up, then the end of the act", () => {
    const ctx = emptyCtx();
    const run = startRewardsRun(ctx);
    advancePlain(ctx, run, 4);
    expect(kinds(toRewards(ctx, run, "boss"))).toEqual(["NodeCompleted", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
  });
});

describe("rewards: a revive after a fall at a tiered node (clarification 9)", () => {
  it("opens the rewards screen for that tier", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    toRewards(ctx, run, "normal", -1000);
    expect(run.phase).toBe("fallen");
    const events = ok(revive(ctx, run, REVIVE));
    expect(kinds(events)).toEqual(["Revived", "RewardsOffered"]);
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.tier).toBe("normal");
    expect(run.rewards?.rerolls).toBe(0);
    expect(run.player.hp).toBe(18);
    expect(run.step).toBe(1);
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "OptionsOffered"]);
  });

  it("the same screen as without the fall (same stream)", () => {
    const ctx = rewardsCtx();
    for (const s of seeds(10)) {
      const fell = startRewardsRun(ctx, s);
      toRewards(ctx, fell, "hard", -1000);
      ok(revive(ctx, fell, REVIVE));
      const plain = startRewardsRun(ctx, s);
      toRewards(ctx, plain, "hard");
      expect(screen(fell)).toEqual(screen(plain));
    }
  });

  it("after an elite fall: rewards, learning, then the level-up", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const run = startRewardsRun(ctx);
    run.player.cards = [...C_HAND];
    toRewards(ctx, run, "elite", -1000);
    ok(revive(ctx, run, REVIVE));
    expect(kinds(ok(takeReward(ctx, run, 0)))).toEqual(["RewardTaken", "CardOffered"]);
    expect(kinds(ok(leaveCard(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "OptionsOffered"]);
  });

  it("with nothing to offer after an elite fall: Revived, then the level-up", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1, item: 1 } }), pool: [] });
    const run = startRewardsRun(ctx);
    toRewards(ctx, run, "elite", -1000);
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "LevelUpOffered"]);
  });

  it("at the boss: rewards and level-up come before the end of the act", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    advancePlain(ctx, run, 4);
    toRewards(ctx, run, "boss", -1000);
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "RewardsOffered"]);
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
  });

  it("a fall without a tier still revives by moving on; ending the tale still loses", () => {
    const ctx = rewardsCtx();
    const a = startRewardsRun(ctx);
    ok(chooseOption(ctx, a, 0));
    ok(completeNode(ctx, a, { hp: -1000 }));
    expect(kinds(ok(revive(ctx, a, REVIVE)))).toEqual(["Revived", "OptionsOffered"]);
    const b = startRewardsRun(ctx);
    toRewards(ctx, b, "elite", -1000);
    expect(ok(endRun(b))).toEqual([{ type: "RunEnded", result: "lost" }]);
    expect(b.rewards).toBeNull();
    expect(b.levelUp).toBeNull();
  });

  it("a later tierless fall doesn't reopen an old screen", () => {
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx);
    toRewards(ctx, run, "elite", -1000);
    ok(revive(ctx, run, REVIVE));
    ok(skipReward(ctx, run));
    ok(chooseLevelUp(ctx, run, 0));
    ok(chooseOption(ctx, run, 0));
    ok(completeNode(ctx, run, { hp: -1000 }));
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "OptionsOffered"]);
  });
});

describe("rewards: a card already held is not gained twice (clarification 10)", () => {
  const ctxWith = (items: readonly ContentFile[]): RunContext => rewardsCtx({ table: ITEM_ONLY, pool: [...items, C1, C2, C3, C4, C5, GRANTED, GRANTED2] });

  it("an accessory whose granted card is already held: equipped, no card event, the hand unchanged", () => {
    const ctx = ctxWith([CHARM]);
    const { run } = rewardsRun(ctx, { cards: ["weapon.club", "skill.granted", "skill.c1"] });
    const events = ok(takeReward(ctx, run, indexOfId(run, "accessory.charm")));
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(run.picks.accessory).toBe("accessory.charm");
    expect(run.player.cards).toEqual(["weapon.club", "skill.granted", "skill.c1"]);
  });

  it("with a full hand that holds it: no learning", () => {
    const ctx = ctxWith([CHARM]);
    const hand = ["weapon.club", "skill.c1", "skill.granted", "skill.c2", "skill.c3"];
    const { run } = rewardsRun(ctx, { cards: hand });
    expect(kinds(ok(takeReward(ctx, run, 0)))).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
    expect(run.player.cards).toEqual(hand);
  });

  it("swapping an accessory removes its granted card whatever its origin (e.g. learned later)", () => {
    const ctx = ctxWith([CHARM, AMULET]);
    const { run } = rewardsRun(ctx, { picks: { accessory: "accessory.charm" }, cards: ["weapon.club", "skill.c1", "skill.granted"] });
    const events = ok(takeReward(ctx, run, indexOfId(run, "accessory.amulet")));
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1"]);
  });

  it("an accessory granting the same card as the old one: removed, then gained again at the end", () => {
    const ctx = ctxWith([CHARM, TWIN_CHARM]);
    const { run } = rewardsRun(ctx, { picks: { accessory: "accessory.charm" }, cards: ["weapon.club", "skill.granted", "skill.c1"] });
    const events = ok(takeReward(ctx, run, indexOfId(run, "accessory.twin_charm")));
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardRemoved", "CardLearned", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["weapon.club", "skill.c1", "skill.granted"]);
  });
});

describe("level-ups: Vitality recomputes max HP from final stats (clarification 11)", () => {
  it("with an item flooring Vitality at 0: +2 base Vitality raises max HP by 5 only", () => {
    // Crushing: −4 Vitality, +10 HP. Base Vitality 3 → final 0, max 30. +2 → base 5, final 1, max 35.
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx, "seed", { armor: "armor.crushing" });
    expect(run.player.maxHp).toBe(30);
    run.player.baseStats = { ...run.player.baseStats, might: 7 };
    toRewards(ctx, run, "elite", -10);
    ok(skipReward(ctx, run));
    expect(run.levelUp?.options[0]).toBe("vitality");
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: "vitality", gain: 2, value: 5, maxHp: 35, hp: 25 });
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(25);
    expect(playerUnitFromRun(ctx.pack, run).maxHp).toBe(35);
  });

  it("with Vitality floored and still 0 after the gain: max HP and HP don't change", () => {
    // Base 1 → final 0 (−4); +1 (Sage: not favoured) → base 2, final 0.
    const ctx = rewardsCtx();
    const run = startRewardsRun(ctx, "seed", { character: "char.sage", armor: "armor.crushing" });
    run.player.baseStats = { ...run.player.baseStats, ...capped({ intelligence: 3, vitality: 1 }) };
    toRewards(ctx, run, "elite");
    ok(skipReward(ctx, run));
    expect(run.levelUp?.options).toEqual(["intelligence", "vitality"]);
    const before = { maxHp: run.player.maxHp, hp: run.player.hp };
    const events = ok(chooseLevelUp(ctx, run, 1));
    expect(eventOf(events, "StatRaised")).toMatchObject({ stat: "vitality", gain: 1, value: 2, maxHp: before.maxHp, hp: before.hp });
  });
});

describe("rewards: state fields and the node through the phases (clarification 13)", () => {
  /** Checks the clarification-13 invariants for the current phase; `node` is the node entered at this step. */
  function expectPhaseState(run: RunState, node: unknown): void {
    expect(run.rewards === null).toBe(run.phase !== "rewards");
    expect(run.learning === null).toBe(run.phase !== "learning");
    expect(run.levelUp === null).toBe(run.phase !== "levelUp");
    if (run.phase === "rewards" || run.phase === "learning" || run.phase === "levelUp") expect(run.node).toEqual(node);
    if (run.phase === "choosing" || run.phase === "won" || run.phase === "route") expect(run.node).toBeNull();
  }

  it("rewards → learning → level-up: each field only in its phase; the node kept until the run moves on", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY });
    const run = startRewardsRun(ctx);
    run.player.cards = [...C_HAND];
    ok(chooseOption(ctx, run, 0));
    const node = snapshot(run).node;
    expect(node).not.toBeNull();
    ok(completeNode(ctx, run, { rewardTier: "elite" }));
    expect(run.phase).toBe("rewards");
    expectPhaseState(run, node);
    ok(rerollRewards(ctx, run, REROLL));
    expectPhaseState(run, node);
    ok(takeReward(ctx, run, 0));
    expect(run.phase).toBe("learning");
    expectPhaseState(run, node);
    ok(forgetCard(ctx, run, 1));
    expect(run.phase).toBe("levelUp");
    expectPhaseState(run, node);
    ok(chooseLevelUp(ctx, run, 0));
    expect(run.phase).toBe("choosing");
    expectPhaseState(run, node);
  });

  it("the invariants hold all through a policy run, and in its saves", () => {
    const ctx = rewardsCtx({
      acts: [
        rewardsAct("act.r", table(), { steps: { min: 7, max: 7 }, routes: [{ to: "act.r2" }] }),
        rewardsAct("act.r2", table({ kinds: { skill: 1 } }), { first: undefined, steps: { min: 7, max: 7 } }),
      ],
    });
    for (const s of seeds(4, "inv")) {
      const run = startRewardsRun(ctx, s);
      let node: unknown = null;
      for (let n = 0; n < 400 && run.phase !== "won" && run.phase !== "lost"; n++) {
        playRewards(ctx, run, 1);
        if (run.phase === "inNode") node = snapshot(run).node;
        expectPhaseState(run, node);
        expect(snapshot(run)).toEqual(run);
        // Max HP always equals the loadout formula on the current picks and base stats (item swaps, level-ups).
        expect(run.player.maxHp).toBe(loadoutTotals(ctx.pack, run.picks, run.player.baseStats).maxHp);
      }
      expect(run.phase).toBe("won");
    }
  });
});

// =============================================================================================
// Spec 1.11 review fixes ("Details"): id order, upgrades

describe("rewards: candidates in id order (spec 1.11, Details)", () => {
  it("the same files in another load order give the same screens for the same seed", () => {
    const pool = [...FULL_POOL];
    const reversed = rewardsCtx({ pool: [...pool].reverse() });
    const shuffled = rewardsCtx({ pool: [...pool.filter((_, i) => i % 2 === 1), ...pool.filter((_, i) => i % 2 === 0)] });
    const plain = rewardsCtx({ pool });
    for (const s of seeds(30, "order")) {
      const picks = { character: "char.sage", path: "path.deep_study" };
      const a = firstScreen(plain, s, picks, "elite");
      expect(firstScreen(reversed, s, picks, "elite")).toEqual(a);
      expect(firstScreen(shuffled, s, picks, "elite")).toEqual(a);
    }
  });

  it("rerolled screens and later screens too", () => {
    const plain = rewardsCtx();
    const reversed = rewardsCtx({ pool: [...FULL_POOL].reverse() });
    for (const s of seeds(10, "order-r")) {
      const a = rewardsRun(plain, { seed: s }).run;
      const b = rewardsRun(reversed, { seed: s }).run;
      ok(rerollRewards(plain, a, REROLL));
      ok(rerollRewards(reversed, b, REROLL));
      expect(screen(b)).toEqual(screen(a));
      ok(takeReward(plain, a, 0));
      ok(takeReward(reversed, b, 0));
      expect(snapshot(b)).toEqual(snapshot(a));
    }
  });
});

describe("rewards: upgrades are never offered (spec 1.11, Details)", () => {
  const BASE = skillFile("skill.base", "common", { upgrade: "skill.base_plus" });
  const PLUS = skillFile("skill.base_plus", "common");
  const WORD = wordFile("word.w", "common", { upgrade: "word.w_plus" });
  const WORD_PLUS = wordFile("word.w_plus", "common");

  it("a skill or Word named as another's upgrade is never on a screen; its base is", () => {
    const ctx = rewardsCtx({ table: SKILL_ONLY, pool: [BASE, PLUS, WORD, WORD_PLUS, C1] });
    const seen = new Set<string>();
    for (const options of screensOver(ctx, 20, { character: "char.sage", path: "path.deep_study" })) {
      for (const id of ids(options)) seen.add(id);
      expect(options).toHaveLength(3);
    }
    expect([...seen].sort()).toEqual(["skill.base", "skill.c1", "word.w"]);
  });

  it("whatever the rarity weights: an upgrade alone in its rarity leaves that rarity empty", () => {
    const RARE_PLUS = skillFile("skill.rare_plus", "rare");
    const ctx = rewardsCtx({ table: table({ kinds: { skill: 1 }, rarity: { rare: 1 } }), pool: [skillFile("skill.x", "common", { upgrade: "skill.rare_plus" }), RARE_PLUS] });
    for (const s of seeds(5)) {
      const run = startRewardsRun(ctx, s);
      expect(kinds(toRewards(ctx, run, "normal"))).toEqual(["NodeCompleted", "OptionsOffered"]);
    }
  });
});
