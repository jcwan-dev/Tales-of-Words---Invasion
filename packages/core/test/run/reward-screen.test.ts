import { describe, expect, it } from "vitest";
import {
  chooseLevelUp,
  chooseOption,
  chooseRoute,
  completeNode,
  endRun,
  fallInNode,
  gainRelic,
  learnForget,
  learnLeave,
  levelUpOffer,
  playerUnitFromRun,
  RARITIES,
  rarityRank,
  rerollRewards,
  revive,
  RngStreams,
  RUN_LIMITS,
  skipReward,
  STAT_IDS,
  takeReward,
  type CommandResult,
  type ContentFile,
  type GroupTier,
  type LoadoutPicks,
  type Rarity,
  type RewardCard,
  type RunContext,
  type RunEvent,
  type RunState,
  type StatBlock,
  fightOutcome,
  finishFight,
  resumeFightAfterRevive,
  startFight,
  startRun,
  validatePack,
} from "../../src/index.ts";
import { BASE_FILES } from "../combat/base-pack.ts";
import { eventsOf, fightAgainst, STRIKE, strikeUntilOver } from "./combat-pack.ts";
import { kinds, makeRegistry, ok, snapshot } from "./run-pack.ts";
import {
  advancePlain,
  ALL_RARITIES,
  AMULET,
  BULWARK,
  CHARM,
  countKind,
  CROWNS_ONLY,
  DEFAULT_TABLE,
  eventOf,
  evs,
  fightRsAct,
  fightRsCtx,
  ids,
  indexOfId,
  indexWhere,
  HEART,
  ITEM_IDS,
  ITEM_ONLY,
  MAIL,
  MIND,
  RELIC_IDS,
  REROLL,
  REVIVE,
  RING,
  rsAct,
  rsCtx,
  rsFiles,
  rsRun,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  SAGE_4,
  SAGE_6,
  screen,
  seeds,
  setHand,
  SKILL_ONLY,
  skillFile,
  SPEAR,
  BLESSED,
  startRs,
  table,
  toRewards,
  TWIN,
  allTiers,
  W1,
  winFight,
  wordFile,
} from "./reward-screen-pack.ts";

// Spec Draft 1.11, "Rewards and level-ups" incl. "After-fight flow (decided 12 Oct 2026, M2.4b)", with "Rarity",
// "Run map", "Combat node" and "Monetisation architecture"; brief M2.4b (public API, flow, drawing a screen):
//   completeNode with `rewardTier` (a tier with a table in the act, else invalid_result and nothing changes): HP,
//     NodeCompleted, run.rewardTier set, then the after-fight flow; at 0 HP the flow waits and a revive runs it.
//   Order: rewards → learning (a card arriving with 5 held) → level-up (elite and boss) → the next step, or after the
//     boss the routes (or victory). The node stays current until the run moves on.
//   Screen: 3 cards + Intelligence bonus (+1 at 4, +2 at 6, final Intelligence incl. items, path and relics); bonus
//     cards are skills or Words. At the boss card 3 is a relic (equal chance among relics not held; none left: drawn
//     like any card). Nothing at all to offer: no screen.
//   A card: kind by `kinds` weights among kinds with something left (at most one purse per screen); a skill or Word
//     card draws a rarity by `rarity` weights among rarities with a candidate, then a candidate with equal chance: not
//     held, or held at a lower rarity (upgrade card). Items: not equipped. Crowns: uniform in [min, max]. No two
//     cards name the same thing. Weight 0 never drawn. Candidates in id order. An `upgrade` target is never offered.
//   Taking: held skill → rarity rises; new skill → appended (< 5) or learning (5): forget one (same position) or leave
//     it. Item → equipped; the card it offers (at the item's start rarity) learned the same way, unless held; cards
//     from the old item stay. Purse → crowns. Relic → gained. Or take nothing.
//   Rerolls: redraw the screen (the boss relic card stays a relic card); 3 per run, through a grant; the stream is per
//     node and reroll number of this screen, so nothing else shifts.
//   Level-up choices must be one of the stats offered (levelUpOffer on derive("levelup", actNumber, act, step)).
// Assertions are about properties, not specific RNG values; statistical checks use generous margins.

const TIERS: readonly GroupTier[] = ["normal", "hard", "elite", "boss"];

function expectRefused(run: RunState, command: () => CommandResult, reason: string): void {
  const before = snapshot(run);
  const res = command();
  expect(res.ok ? "accepted" : res.reason).toBe(reason);
  expect(snapshot(run)).toEqual(before);
}

const only = <T>(xs: readonly T[]): T => {
  expect(xs).toHaveLength(1);
  const [x] = xs;
  if (x === undefined) throw new Error("empty");
  return x;
};

/** The screen after the first node of a fresh run. */
function firstScreen(ctx: RunContext, seed: string, picks: Partial<LoadoutPicks> = {}, tier: GroupTier = "normal"): readonly RewardCard[] {
  return screen(rsRun(ctx, { seed, picks, tier }).run);
}

const screensOver = (ctx: RunContext, n: number, picks: Partial<LoadoutPicks> = {}, tier: GroupTier = "normal"): (readonly RewardCard[])[] =>
  seeds(n).map((s) => firstScreen(ctx, s, picks, tier));

/** A run at the last step (the boss), in its after-fight flow with tier boss. */
function bossRun(ctx: RunContext, seed = "seed", opts: { picks?: Partial<LoadoutPicks>; hp?: number; prepare?: (run: RunState) => void } = {}): { run: RunState; events: readonly RunEvent[] } {
  const run = startRs(ctx, seed, opts.picks ?? {});
  opts.prepare?.(run);
  advancePlain(ctx, run, run.steps);
  expect(run.offer[0]?.fixed).toBe(true);
  const events = toRewards(ctx, run, "boss", opts.hp ?? 0);
  return { run, events };
}

const skillCards = (cards: readonly RewardCard[]) => cards.flatMap((c) => (c.kind === "skill" ? [c] : []));

/** Base stats with every stat at 7 except the given ones. */
const capped = (except: Partial<StatBlock> = {}): StatBlock => ({ ...(Object.fromEntries(STAT_IDS.map((s) => [s, 7])) as StatBlock), ...except });

/** The rewards state without the screen and the limits (what a reroll may change). */
const withoutScreen = (run: RunState): unknown => ({ ...snapshot(run), rewards: null, limits: null });

const S_HAND = ["weapon.club", "skill.s1", "skill.s2", "skill.s3", "skill.s4"];

// =============================================================================================
// Without rewardTier

describe("after-fight flow: a result without rewardTier", () => {
  it("a new run has no rewards, learning, level-up or pending tier", () => {
    const run = startRs(rsCtx());
    expect(run.rewards).toBeNull();
    expect(run.learning).toBeNull();
    expect(run.levelUp).toBeNull();
    expect(run.rewardTier).toBeNull();
  });

  it("completes the node and moves on exactly as before", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    ok(chooseOption(ctx, run, 0));
    const events = ok(completeNode(ctx, run, { hp: -3, crowns: 4 }));
    expect(kinds(events)).toEqual(["NodeCompleted", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.rewardTier).toBeNull();
    expect(run.crowns).toBe(4);
  });
});

// =============================================================================================
// Entering the screen

describe("after-fight flow: entering the rewards screen", () => {
  it("NodeCompleted, then RewardsOffered; phase rewards; the step doesn't move; the node stays", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    ok(chooseOption(ctx, run, 0));
    const node = snapshot(run).node;
    const events = ok(completeNode(ctx, run, { hp: -5, rewardTier: "normal" }));
    expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(eventOf(events, "NodeCompleted")).toMatchObject({ hpChange: -5, hp: 30 });
    expect(run.phase).toBe("rewards");
    expect(run.step).toBe(1);
    expect(run.offer).toEqual([]);
    expect(run.node).toEqual(node);
    expect(run.rewardTier).toBe("normal");
    expect(run.player.hp).toBe(30);
    const r = run.rewards;
    if (r === null) throw new Error("no screen");
    expect(r.tier).toBe("normal");
    expect(r.rerolls).toBe(0);
    expect(r.cards).toHaveLength(3);
    expect(eventOf(events, "RewardsOffered")).toEqual({ type: "RewardsOffered", tier: "normal", cards: r.cards, rerolls: 0 });
  });

  it("records the result's tier, for every tier", () => {
    const ctx = rsCtx();
    for (const tier of TIERS) {
      const { run, events } = rsRun(ctx, { seed: `tier-${tier}`, tier });
      expect(run.rewards?.tier).toBe(tier);
      expect(run.rewardTier).toBe(tier);
      expect(eventOf(events, "RewardsOffered")["tier"]).toBe(tier);
    }
  });

  it("the event's cards are a copy: changing them doesn't change the run", () => {
    const ctx = rsCtx();
    const { run, events } = rsRun(ctx);
    const before = snapshot(run);
    const cards = eventOf(events, "RewardsOffered")["cards"] as RewardCard[];
    cards.pop();
    cards.push({ kind: "crowns", amount: 999 });
    expect(snapshot(run)).toEqual(before);
  });

  it("the run state stays JSON-safe on the screen", () => {
    const { run } = rsRun(rsCtx());
    expect(snapshot(run)).toEqual(run);
  });
});

// =============================================================================================
// Invalid tiers

describe("after-fight flow: tiers the act has no table for are refused", () => {
  it("a rewardTier that isn't a tier is refused (invalid_result), even when HP would hit 0", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    ok(chooseOption(ctx, run, 0));
    for (const tier of ["legendary", "", "Normal", "BOSS"]) {
      expectRefused(run, () => completeNode(ctx, run, { hp: -5, rewardTier: tier as unknown as GroupTier }), "invalid_result");
      expectRefused(run, () => completeNode(ctx, run, { hp: -1000, rewardTier: tier as unknown as GroupTier }), "invalid_result");
    }
  });

  it("a tier with no table in the act is refused (invalid_result) and changes nothing", () => {
    // An act that can't fight may give some tiers only.
    const ctx = rsCtx({ rewards: { normal: DEFAULT_TABLE } });
    const run = startRs(ctx);
    ok(chooseOption(ctx, run, 0));
    for (const tier of ["hard", "elite", "boss"] as const) {
      expectRefused(run, () => completeNode(ctx, run, { hp: -2, crowns: 3, setFlags: ["x"], rewardTier: tier }), "invalid_result");
      expectRefused(run, () => completeNode(ctx, run, { hp: -1000, rewardTier: tier }), "invalid_result");
    }
    expect(kinds(ok(completeNode(ctx, run, { rewardTier: "normal" })))).toEqual(["NodeCompleted", "RewardsOffered"]);
  });

  it("an act with no rewards at all refuses any tier, and still takes results without one", () => {
    const ctx = rsCtx({ acts: [rsAct("act.r", null)] });
    const run = startRs(ctx);
    ok(chooseOption(ctx, run, 0));
    for (const tier of TIERS) expectRefused(run, () => completeNode(ctx, run, { rewardTier: tier }), "invalid_result");
    expect(kinds(ok(completeNode(ctx, run, {})))).toEqual(["NodeCompleted", "OptionsOffered"]);
  });
});

// =============================================================================================
// Screen size

describe("screen size: 3 cards, +1 at Intelligence 4, +2 at 6 (final Intelligence)", () => {
  const cases: [string, Partial<LoadoutPicks>, number][] = [
    ["Brute, Intelligence 2", {}, 3],
    ["Sage, Intelligence 3", { character: "char.sage" }, 3],
    ["Sage + Study, Intelligence 4", SAGE_4, 4],
    ["Sage + Ring, Intelligence 5", { character: "char.sage", accessory: "accessory.ring" }, 4],
    ["Sage + Deep Study, Intelligence 6", SAGE_6, 5],
    ["Sage + Deep Study + Ring, Intelligence 8", { ...SAGE_6, accessory: "accessory.ring" }, 5],
    ["Brute + Deep Study, Intelligence 5", { path: "path.deep_study" }, 4],
  ];
  for (const [name, picks, n] of cases) {
    it(`${name}: ${n} cards`, () => {
      const ctx = rsCtx({ table: SKILL_ONLY });
      for (const s of seeds(5)) expect(firstScreen(ctx, s, picks)).toHaveLength(n);
    });
  }

  it("relics count: Sage + a +2 Intelligence relic is 5 (4 cards); Sage + Study + the relic is 6 (5 cards)", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    const withMind = (run: RunState): void => gainRelic(ctx.pack, run, "relic.mind");
    for (const s of seeds(5)) {
      expect(screen(rsRun(ctx, { seed: s, picks: { character: "char.sage" }, prepare: withMind }).run)).toHaveLength(4);
      expect(screen(rsRun(ctx, { seed: s, picks: SAGE_4, prepare: withMind }).run)).toHaveLength(5);
    }
  });

  it("the bonus cards are skills or Words whatever the kinds weights (purses only: 1 purse + 2 skills)", () => {
    const ctx = rsCtx({ table: CROWNS_ONLY });
    for (const cards of screensOver(ctx, 15, SAGE_6)) {
      expect(cards).toHaveLength(3);
      expect(countKind(cards, "crowns")).toBe(1);
      expect(countKind(cards, "skill")).toBe(2);
    }
  });

  it("items only: the 3 base cards are items, the bonus card after them is a skill", () => {
    const ctx = rsCtx({ table: ITEM_ONLY });
    for (const cards of screensOver(ctx, 15, SAGE_4)) {
      expect(cards.map((c) => c.kind)).toEqual(["item", "item", "item", "skill"]);
    }
  });

  it("the bonus cards follow the rarity weights", () => {
    const ctx = rsCtx({ table: table({ kinds: { crowns: 1 }, rarity: { purple: 1 } }) });
    for (const cards of screensOver(ctx, 15, SAGE_6)) {
      const skills = skillCards(cards);
      expect(skills).toHaveLength(2);
      for (const c of skills) expect(c.rarity).toBe("purple");
    }
  });

  it("uses the final Intelligence after an item swap", () => {
    // Sage + Study = 4, items only, the Ring (+2) the only unequipped item: [ring, one bonus skill].
    const ctx = rsCtx({ table: ITEM_ONLY, items: [RING] });
    const { run } = rsRun(ctx, { picks: SAGE_4 });
    expect(screen(run).map((c) => c.kind)).toEqual(["item", "skill"]);
    ok(takeReward(ctx, run, indexOfId(run, "accessory.ring")));
    expect(playerUnitFromRun(ctx.pack, run).stats?.intelligence).toBe(6);
    // Intelligence 6: the plain accessory (now unequipped) and two bonus skills.
    toRewards(ctx, run, "normal");
    expect(screen(run).map((c) => c.kind)).toEqual(["item", "skill", "skill"]);
    expect(ids(screen(run))[0]).toBe("accessory.plain");
  });

  it("uses the final Intelligence after a relic taken from the boss screen", () => {
    // Sage + Study (4): relic.mind (+2) is the only relic; taking it makes 6 for the next act's screens.
    const acts = [rsAct("act.r", allTiers(SKILL_ONLY), { routes: [{ to: "act.r2" }] }), rsAct("act.r2", allTiers(SKILL_ONLY), { first: undefined })];
    const ctx = rsCtx({ acts, relics: [MIND] });
    const { run } = bossRun(ctx, "seed", { picks: SAGE_4 });
    expect(screen(run)).toHaveLength(4);
    ok(takeReward(ctx, run, indexWhere(run, (c) => c.kind === "relic")));
    ok(chooseLevelUp(ctx, run, 0));
    ok(chooseRoute(ctx, run, 0));
    toRewards(ctx, run, "normal");
    expect(screen(run)).toHaveLength(5);
  });

  it("uses the final Intelligence after a level-up", () => {
    // Sage + Study, every stat at the cap but Intelligence 3: the level-up offers Intelligence only (+2 → final 6).
    const ctx = rsCtx({ table: SKILL_ONLY });
    const { run } = rsRun(ctx, {
      picks: SAGE_4,
      tier: "elite",
      prepare: (r) => {
        r.player.baseStats = capped({ intelligence: 3 });
      },
    });
    expect(screen(run)).toHaveLength(4);
    ok(skipReward(ctx, run));
    expect(run.levelUp?.options).toEqual(["intelligence"]);
    ok(chooseLevelUp(ctx, run, 0));
    toRewards(ctx, run, "normal");
    expect(screen(run)).toHaveLength(5);
  });
});

// =============================================================================================
// What a card can be

describe("drawing: what can be offered", () => {
  it("cards have the brief's shapes and name real content of the right kind", () => {
    const ctx = rsCtx();
    const checkCard = (c: RewardCard): void => {
      if (c.kind === "crowns") {
        expect(Object.keys(c).sort()).toEqual(["amount", "kind"]);
        expect(Number.isInteger(c.amount)).toBe(true);
        expect(c.amount).toBeGreaterThanOrEqual(10);
        expect(c.amount).toBeLessThanOrEqual(20);
        return;
      }
      const def = ctx.pack.byId.get(c.id);
      if (c.kind === "skill") {
        expect(Object.keys(c).sort()).toEqual(["id", "kind", "rarity", "upgrade"]);
        expect(["skill", "word"]).toContain(def?.kind);
        expect(RARITIES).toContain(c.rarity);
        expect(typeof c.upgrade).toBe("boolean");
      } else if (c.kind === "item") {
        expect(Object.keys(c).sort()).toEqual(["id", "kind", "slot"]);
        expect(def?.kind).toBe(c.slot);
      } else {
        expect(Object.keys(c).sort()).toEqual(["id", "kind"]);
        expect(def?.kind).toBe("relic");
      }
    };
    for (const cards of screensOver(ctx, 40, SAGE_6)) for (const c of cards) checkCard(c);
    for (const s of seeds(10)) for (const c of screen(bossRun(ctx, s).run)) checkCard(c);
  });

  it("no two cards name the same thing, and at most one purse", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1, item: 1, crowns: 5 }, rarity: ALL_RARITIES }) });
    for (const cards of screensOver(ctx, 60, SAGE_6)) {
      const named = ids(cards);
      expect(new Set(named).size).toBe(named.length);
      expect(countKind(cards, "crowns")).toBeLessThanOrEqual(1);
    }
  });

  it("a heavy purse weight still gives exactly one purse; the rest are other kinds", () => {
    const ctx = rsCtx({ table: table({ kinds: { crowns: 100, skill: 1 } }) });
    for (const cards of screensOver(ctx, 40)) {
      expect(cards).toHaveLength(3);
      expect(countKind(cards, "crowns")).toBe(1);
      expect(countKind(cards, "skill")).toBe(2);
    }
  });

  it("a kind with weight 0 (or absent) is never drawn", () => {
    for (const cards of screensOver(rsCtx({ table: SKILL_ONLY }), 30)) expect(cards.every((c) => c.kind === "skill")).toBe(true);
    for (const cards of screensOver(rsCtx({ table: ITEM_ONLY }), 30)) expect(cards.every((c) => c.kind === "item")).toBe(true);
    const zero = rsCtx({ table: table({ kinds: { skill: 0, item: 1, crowns: 0 } }) });
    for (const cards of screensOver(zero, 30)) expect(cards.every((c) => c.kind === "item")).toBe(true);
  });

  it("a kind with nothing left can't be drawn: the other kinds fill the screen", () => {
    // One unequipped item: at most one item card; the screen is still full.
    const ctx = rsCtx({ table: table({ kinds: { item: 50, skill: 1 } }), items: [SPEAR] });
    for (const cards of screensOver(ctx, 30)) {
      expect(cards).toHaveLength(3);
      expect(ids(cards.filter((c) => c.kind === "item"))).toEqual(["weapon.spear"]);
    }
  });

  it("when every kind runs out the screen is shorter", () => {
    const tiny = rsCtx({ table: table({ kinds: { item: 1, skill: 1 } }), items: [SPEAR], skills: [S1] });
    for (const cards of screensOver(tiny, 10)) expect(ids(cards).sort()).toEqual(["skill.s1", "weapon.spear"]);
    // Sage at Intelligence 6 wants 5 skills, but only 4 exist.
    const four = rsCtx({ table: SKILL_ONLY, skills: [S1, S2, S3, S4] });
    for (const cards of screensOver(four, 10, SAGE_6)) expect(ids(cards).sort()).toEqual(["skill.s1", "skill.s2", "skill.s3", "skill.s4"]);
  });

  it("equipped items are never offered; every other item can be", () => {
    const ctx = rsCtx({ table: ITEM_ONLY });
    const seen = new Set<string>();
    for (const cards of screensOver(ctx, 150)) for (const id of ids(cards)) seen.add(id);
    expect([...seen].sort()).toEqual([...ITEM_IDS].sort());
    // With other items worn, the starting ones come back as candidates.
    const worn = { weapon: "weapon.spear", armor: "armor.mail", accessory: "accessory.ring" };
    const seenWorn = new Set<string>();
    for (const cards of screensOver(ctx, 150, worn)) for (const id of ids(cards)) seenWorn.add(id);
    for (const id of Object.values(worn)) expect(seenWorn.has(id)).toBe(false);
    for (const id of ["weapon.club", "armor.plain", "accessory.plain"]) expect(seenWorn.has(id)).toBe(true);
  });

  it("purses are drawn in [min, max], both ends included", () => {
    const ctx = rsCtx({ table: table({ kinds: { crowns: 1 }, crowns: { min: 5, max: 7 } }) });
    const amounts = new Set<number>();
    for (const cards of screensOver(ctx, 80)) {
      const purse = only(cards);
      if (purse.kind !== "crowns") throw new Error("expected a purse");
      amounts.add(purse.amount);
    }
    expect([...amounts].sort()).toEqual([5, 6, 7]);
    const fixed = rsCtx({ table: table({ kinds: { crowns: 1 }, crowns: { min: 12, max: 12 } }) });
    for (const cards of screensOver(fixed, 10)) expect(cards).toEqual([{ kind: "crowns", amount: 12 }]);
  });

  it("each tier uses its own table", () => {
    const rewards = {
      normal: table({ kinds: { crowns: 1 } }),
      hard: table({ kinds: { item: 1 } }),
      elite: table({ kinds: { skill: 1 }, rarity: { purple: 1 } }),
      boss: table({ kinds: { skill: 1 }, rarity: { orange: 1 } }),
    };
    const ctx = rsCtx({ rewards });
    for (const s of seeds(10)) {
      expect(firstScreen(ctx, s, {}, "normal").every((c) => c.kind === "crowns")).toBe(true);
      expect(firstScreen(ctx, s, {}, "hard").every((c) => c.kind === "item")).toBe(true);
      expect(firstScreen(ctx, s, {}, "elite").every((c) => c.kind === "skill" && c.rarity === "purple")).toBe(true);
      const boss = screen(bossRun(ctx, s).run);
      expect(skillCards(boss).every((c) => c.rarity === "orange")).toBe(true);
      expect(skillCards(boss).length).toBeGreaterThan(0);
    }
  });

  it("the weapon's Strike is never a skill card (held or not)", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }) });
    for (const cards of screensOver(ctx, 40, SAGE_6)) {
      for (const c of skillCards(cards)) expect(ctx.pack.byId.get(c.id)?.kind).not.toBe("weapon");
    }
  });
});

// =============================================================================================
// Rarity and upgrade cards

describe("drawing: rarity weights and upgrade cards", () => {
  it("kinds follow the table's weights (skill 3 : item 1)", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 3, item: 1 } }) });
    const all = screensOver(ctx, 300).flat();
    expect(all).toHaveLength(900);
    const share = countKind(all, "skill") / all.length;
    expect(share).toBeGreaterThan(0.68);
    expect(share).toBeLessThan(0.82);
  });

  it("rarities follow the table's weights (grey 1 : blue 3); weight 0 (green) and absent rarities are never drawn", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1, green: 0, blue: 3 } }) });
    const cards = screensOver(ctx, 300).flatMap(skillCards);
    expect(cards).toHaveLength(900);
    for (const c of cards) expect(["grey", "blue"]).toContain(c.rarity);
    const share = cards.filter((c) => c.rarity === "blue").length / cards.length;
    expect(share).toBeGreaterThan(0.68);
    expect(share).toBeLessThan(0.82);
  });

  it("every rarity can be drawn", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }) });
    const seen = new Set(screensOver(ctx, 60).flatMap(skillCards).map((c) => c.rarity));
    expect([...seen].sort()).toEqual([...RARITIES].sort());
  });

  it("within a rarity, each candidate is equally likely", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { green: 1 } }), skills: [S1, S2, S3, S4, S5, S6] });
    const counts = new Map<string, number>();
    for (const cards of screensOver(ctx, 300)) for (const id of ids(cards)) counts.set(id, (counts.get(id) ?? 0) + 1);
    // 3 of 6 per screen: each about 150 times.
    expect([...counts.keys()].sort()).toEqual(["skill.s1", "skill.s2", "skill.s3", "skill.s4", "skill.s5", "skill.s6"]);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(105);
      expect(n).toBeLessThan(195);
    }
  });

  it("new cards are upgrade: false; a held skill is only offered above its rarity, as upgrade: true", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }) });
    const held: Record<string, Rarity> = { "skill.s1": "grey", "skill.s2": "green", "skill.s3": "blue", "word.w1": "purple" };
    let upgrades = 0;
    for (const s of seeds(150)) {
      const { run } = rsRun(ctx, { seed: s, picks: SAGE_6, hand: ["weapon.club", ...Object.keys(held)], rarities: held });
      for (const c of skillCards(screen(run))) {
        const was = held[c.id];
        expect(c.upgrade).toBe(was !== undefined);
        if (was !== undefined) {
          upgrades++;
          expect(rarityRank(c.rarity)).toBeGreaterThan(rarityRank(was));
        }
      }
    }
    expect(upgrades).toBeGreaterThan(0);
  });

  it("a held skill is never offered at the same or a lower rarity", () => {
    // Held grey, table grey only: never offered. Table green only: offered as an upgrade to green.
    const grey = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1 } }), skills: [S1, S2, S3, S4] });
    for (const s of seeds(20)) expect(ids(screen(rsRun(grey, { seed: s, hand: ["weapon.club", "skill.s1"] }).run))).not.toContain("skill.s1");
    const green = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { green: 1 } }), skills: [S1] });
    for (const s of seeds(5)) {
      expect(screen(rsRun(green, { seed: s, hand: ["weapon.club", "skill.s1"] }).run)).toEqual([{ kind: "skill", id: "skill.s1", rarity: "green", upgrade: true }]);
    }
  });

  it("a held card with no recorded rarity counts as grey", () => {
    const greenOnly = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { green: 1 } }), skills: [S1] });
    const greyOnly = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1 } }), skills: [S1] });
    const noEntry = (run: RunState): void => {
      run.player.cards = ["weapon.club", "skill.s1"];
      run.player.rarities = {};
    };
    expect(screen(rsRun(greenOnly, { prepare: noEntry }).run)).toEqual([{ kind: "skill", id: "skill.s1", rarity: "green", upgrade: true }]);
    const run = startRs(greyOnly);
    noEntry(run);
    expect(kinds(toRewards(greyOnly, run, "normal"))).toEqual(["NodeCompleted", "OptionsOffered"]);
  });

  it("a skill held at orange is never offered", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }), skills: [S1, S2, S3, S4] });
    for (const s of seeds(30)) {
      expect(ids(screen(rsRun(ctx, { seed: s, hand: ["weapon.club", "skill.s1"], rarities: { "skill.s1": "orange" } }).run))).not.toContain("skill.s1");
    }
  });

  it("the rarity is drawn among rarities with a candidate: a heavy weight with none doesn't empty the card", () => {
    // Only skill.s1 exists, held at purple: grey (weight 1000) has no candidate, orange (weight 1) has it.
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1000, orange: 1 } }), skills: [S1] });
    for (const s of seeds(10)) {
      const { run } = rsRun(ctx, { seed: s, hand: ["weapon.club", "skill.s1"], rarities: { "skill.s1": "purple" } });
      expect(screen(run)).toEqual([{ kind: "skill", id: "skill.s1", rarity: "orange", upgrade: true }]);
    }
  });

  it("weight 0 is never drawn, even when it is the only rarity with a candidate", () => {
    // skill.s1 held at purple: only orange has a candidate, and orange has weight 0 → no skill card, no screen.
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1, orange: 0 } }), skills: [S1] });
    for (const s of seeds(5)) {
      const run = startRs(ctx, s);
      setHand(run, ["weapon.club", "skill.s1"], { "skill.s1": "purple" });
      expect(kinds(toRewards(ctx, run, "normal"))).toEqual(["NodeCompleted", "OptionsOffered"]);
    }
  });

  it("a kind whose rarities have no candidate can't be drawn: the other kinds fill in", () => {
    // Skills: only s1, held at orange. Kinds skill 50 / item 1: every card is an item.
    const ctx = rsCtx({ table: table({ kinds: { skill: 50, item: 1 }, rarity: ALL_RARITIES }), skills: [S1] });
    for (const s of seeds(10)) {
      const cards = screen(rsRun(ctx, { seed: s, hand: ["weapon.club", "skill.s1"], rarities: { "skill.s1": "orange" } }).run);
      expect(cards).toHaveLength(3);
      expect(cards.every((c) => c.kind === "item")).toBe(true);
    }
  });

  describe("upgrade targets are never offered", () => {
    const BASE = skillFile("skill.base", { upgrade: "skill.base_plus" });
    const PLUS = skillFile("skill.base_plus");
    const WORD = wordFile("word.wb", { upgrade: "word.wb_plus" });
    const WORD_PLUS = wordFile("word.wb_plus");

    it("a skill or Word named as another's upgrade is never on a screen; its base is", () => {
      const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }), skills: [BASE, PLUS, WORD, WORD_PLUS, S1] });
      const seen = new Set<string>();
      for (const cards of screensOver(ctx, 30, SAGE_6)) {
        for (const id of ids(cards)) seen.add(id);
        expect(cards).toHaveLength(3);
      }
      expect([...seen].sort()).toEqual(["skill.base", "skill.s1", "word.wb"]);
    });

    it("not even as an upgrade card when held below the drawn rarity", () => {
      const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { orange: 1 } }), skills: [BASE, PLUS, S1] });
      for (const s of seeds(10)) {
        const cards = screen(rsRun(ctx, { seed: s, hand: ["weapon.club", "skill.base_plus"] }).run);
        expect(ids(cards)).not.toContain("skill.base_plus");
      }
    });

    it("an upgrade target alone leaves nothing to offer: no screen", () => {
      const ctx = rsCtx({ table: SKILL_ONLY, skills: [skillFile("skill.x", { upgrade: "skill.x_plus" }), skillFile("skill.x_plus")], items: [] });
      for (const s of seeds(5)) {
        const run = startRs(ctx, s);
        setHand(run, ["weapon.club", "skill.x"], { "skill.x": "orange" });
        expect(kinds(toRewards(ctx, run, "normal"))).toEqual(["NodeCompleted", "OptionsOffered"]);
      }
    });
  });

  it("candidates are taken in id order: the same files in another load order give the same screens and outcomes", () => {
    const plain = rsCtx();
    const reversed = rsCtx({ reverse: true });
    const shuffled = rsCtx({ shuffle: true });
    expect(rsFiles({ shuffle: true }).map((f) => f.path)).not.toEqual(rsFiles().map((f) => f.path));
    for (const s of seeds(30, "order")) {
      for (const tier of TIERS) {
        expect(firstScreen(reversed, s, SAGE_6, tier)).toEqual(firstScreen(plain, s, SAGE_6, tier));
        expect(firstScreen(shuffled, s, SAGE_6, tier)).toEqual(firstScreen(plain, s, SAGE_6, tier));
      }
      expect(screen(bossRun(reversed, s).run)).toEqual(screen(bossRun(plain, s).run));
      expect(screen(bossRun(shuffled, s).run)).toEqual(screen(bossRun(plain, s).run));
    }
    for (const s of seeds(10, "order-r")) {
      const a = rsRun(plain, { seed: s }).run;
      const b = rsRun(reversed, { seed: s }).run;
      ok(rerollRewards(plain, a, REROLL));
      ok(rerollRewards(reversed, b, REROLL));
      expect(screen(b)).toEqual(screen(a));
      expect(ok(takeReward(reversed, b, 0))).toEqual(ok(takeReward(plain, a, 0)));
      expect(snapshot(b)).toEqual(snapshot(a));
    }
  });
});

// =============================================================================================
// The boss relic card

describe("the boss reward: the third card is a relic", () => {
  it("card 3 is a relic card, the only one; cards 1 and 2 are drawn as usual", () => {
    const ctx = rsCtx();
    for (const s of seeds(20)) {
      const cards = screen(bossRun(ctx, s).run);
      expect(cards).toHaveLength(3);
      expect(cards[2]?.kind).toBe("relic");
      expect(countKind(cards, "relic")).toBe(1);
      const relic = cards[2];
      if (relic?.kind === "relic") expect(RELIC_IDS).toContain(relic.id);
    }
  });

  it("with an Intelligence bonus the relic is still card 3; the bonus cards are skills", () => {
    const ctx = rsCtx({ table: ITEM_ONLY });
    for (const s of seeds(10)) {
      const cards = screen(bossRun(ctx, s, { picks: SAGE_6 }).run);
      expect(cards.map((c) => c.kind)).toEqual(["item", "item", "relic", "skill", "skill"]);
    }
  });

  it("other tiers never offer a relic", () => {
    const ctx = rsCtx();
    for (const tier of ["normal", "hard", "elite"] as const) for (const cards of screensOver(ctx, 20, SAGE_6, tier)) expect(countKind(cards, "relic")).toBe(0);
  });

  it("each relic not held is equally likely", () => {
    const ctx = rsCtx();
    const counts = new Map<string, number>();
    for (const s of seeds(240, "relic")) {
      const relic = screen(bossRun(ctx, s).run).find((c) => c.kind === "relic");
      if (relic?.kind === "relic") counts.set(relic.id, (counts.get(relic.id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...RELIC_IDS]);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(50);
      expect(n).toBeLessThan(110);
    }
  });

  it("a relic already held is never offered", () => {
    const ctx = rsCtx();
    for (const s of seeds(30)) {
      const { run } = bossRun(ctx, s, { prepare: (r) => gainRelic(ctx.pack, r, "relic.heart") });
      const relic = screen(run)[2];
      expect(relic?.kind).toBe("relic");
      if (relic?.kind === "relic") expect(["relic.bell", "relic.mind"]).toContain(relic.id);
    }
  });

  it("with every relic held, card 3 is drawn like any card", () => {
    const ctx = rsCtx({ table: CROWNS_ONLY });
    const holdAll = (r: RunState): void => {
      for (const id of RELIC_IDS) gainRelic(ctx.pack, r, id);
    };
    // relic.mind (+2) takes the Brute to Intelligence 4: one bonus card.
    for (const s of seeds(10)) {
      const cards = screen(bossRun(ctx, s, { prepare: holdAll }).run);
      // Purses only: card 1 a purse, cards 2 and 3 can't be drawn, then the bonus skill.
      expect(cards.map((c) => c.kind)).toEqual(["crowns", "skill"]);
    }
    const mixed = rsCtx();
    for (const s of seeds(10)) {
      const cards = screen(bossRun(mixed, s, { prepare: holdAll }).run);
      expect(cards).toHaveLength(4);
      expect(countKind(cards, "relic")).toBe(0);
    }
  });

  it("a reroll keeps card 3 a relic card", () => {
    const ctx = rsCtx();
    for (const s of seeds(5)) {
      const { run } = bossRun(ctx, s);
      for (let i = 0; i < 3; i++) {
        ok(rerollRewards(ctx, run, REROLL));
        expect(screen(run)[2]?.kind).toBe("relic");
        expect(countKind(screen(run), "relic")).toBe(1);
      }
    }
  });

  it("taking the relic: RewardTaken, RelicGained (max HP and HP rise together), then the level-up", () => {
    const ctx = rsCtx({ relics: [HEART] });
    const { run } = bossRun(ctx, "seed", { hp: -5 });
    expect(run.player.hp).toBe(30);
    const card = screen(run)[2];
    expect(card).toEqual({ kind: "relic", id: "relic.heart" });
    const events = ok(takeReward(ctx, run, 2));
    expect(kinds(events)).toEqual(["RewardTaken", "RelicGained", "LevelUpOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", card: { kind: "relic", id: "relic.heart" } });
    expect(eventOf(events, "RelicGained")).toEqual({ type: "RelicGained", relic: "relic.heart", maxHp: 45, hp: 40 });
    expect(run.relics).toEqual(["relic.heart"]);
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(40);
  });
});

// =============================================================================================
// Taking and skipping

describe("taking and skipping a card", () => {
  it("a purse: RewardTaken, CrownsGained, then the next step", () => {
    const ctx = rsCtx({ table: CROWNS_ONLY });
    const { run } = rsRun(ctx);
    const purse = only(screen(run));
    if (purse.kind !== "crowns") throw new Error("expected a purse");
    const events = ok(takeReward(ctx, run, 0));
    expect(kinds(events)).toEqual(["RewardTaken", "CrownsGained", "OptionsOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", card: purse });
    expect(eventOf(events, "CrownsGained")).toEqual({ type: "CrownsGained", amount: purse.amount, crowns: purse.amount });
    expect(run.crowns).toBe(purse.amount);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
  });

  it("purses add up over the run", () => {
    const ctx = rsCtx({ table: CROWNS_ONLY });
    const run = startRs(ctx);
    let total = 0;
    for (let step = 1; step <= 3; step++) {
      toRewards(ctx, run, "normal");
      const purse = only(screen(run));
      if (purse.kind === "crowns") total += purse.amount;
      ok(takeReward(ctx, run, 0));
    }
    expect(run.crowns).toBe(total);
  });

  it("a new skill with fewer than 5 cards: added at the end at the card's rarity (CardLearned, replaced null)", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: ALL_RARITIES }) });
    const { run } = rsRun(ctx, { hand: ["weapon.club", "skill.s1", "skill.s2"], rarities: { "weapon.club": "blue" } });
    const i = indexWhere(run, (c) => c.kind === "skill" && !c.upgrade);
    const card = screen(run)[i];
    if (card?.kind !== "skill") throw new Error("expected a skill");
    const events = ok(takeReward(ctx, run, i));
    expect(kinds(events)).toEqual(["RewardTaken", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", card });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: card.id, rarity: card.rarity, replaced: null });
    expect(run.player.cards).toEqual(["weapon.club", "skill.s1", "skill.s2", card.id]);
    expect(run.player.rarities).toEqual({ "weapon.club": "blue", "skill.s1": "grey", "skill.s2": "grey", [card.id]: card.rarity });
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
  });

  it("a learned Word is a card in the next fight, at its rarity", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { purple: 1 } }), skills: [W1] });
    const { run } = rsRun(ctx);
    ok(takeReward(ctx, run, 0));
    expect(run.player.cards).toEqual(["weapon.club", "word.w1"]);
    expect(run.player.rarities["word.w1"]).toBe("purple");
    expect((playerUnitFromRun(ctx.pack, run).cards ?? []).map((c) => c.id)).toEqual(["weapon.club", "word.w1"]);
  });

  it("an upgrade card: the held card's rarity rises in its slot (CardUpgraded), no forgetting, even with 5 cards", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { blue: 1 } }), skills: [S1, S2, S3, S4] });
    // s1, s3, s4 held at orange (nothing above), s2 at green: the only card is s2 at blue.
    const { run } = rsRun(ctx, { hand: S_HAND, rarities: { "skill.s1": "orange", "skill.s2": "green", "skill.s3": "orange", "skill.s4": "orange" } });
    expect(screen(run)).toEqual([{ kind: "skill", id: "skill.s2", rarity: "blue", upgrade: true }]);
    const i = 0;
    const events = ok(takeReward(ctx, run, i));
    expect(kinds(events)).toEqual(["RewardTaken", "CardUpgraded", "OptionsOffered"]);
    expect(eventOf(events, "CardUpgraded")).toEqual({ type: "CardUpgraded", card: "skill.s2", rarity: "blue" });
    expect(run.player.cards).toEqual(S_HAND);
    expect(run.player.rarities["skill.s2"]).toBe("blue");
    expect(run.learning).toBeNull();
  });

  it("skipping: RewardSkipped, then the next step; nothing else changes", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx, { hp: -4 });
    const before = snapshot(run);
    const events = ok(skipReward(ctx, run));
    expect(kinds(events)).toEqual(["RewardSkipped", "OptionsOffered"]);
    expect(eventOf(events, "RewardSkipped")).toEqual({ type: "RewardSkipped" });
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.player).toEqual(before.player);
    expect(run.picks).toEqual(before.picks);
    expect(run.relics).toEqual(before.relics);
    expect(run.crowns).toBe(before.crowns);
    expect(run.limits).toEqual(before.limits);
  });

  it("a bad index is refused (no_such_option) and changes nothing", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx);
    const n = screen(run).length;
    for (const i of [-1, n, n + 3, 0.5, Number.NaN]) expectRefused(run, () => takeReward(ctx, run, i), "no_such_option");
  });

  it("takeReward and skipReward are refused outside the rewards phase", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
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
// Learning with a full hand

describe("learning a card with 5 held", () => {
  function fullHand(tier: GroupTier = "normal", seed = "seed") {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { green: 1 } }) });
    const { run } = rsRun(ctx, { hand: S_HAND, tier, seed, rarities: { "weapon.club": "blue", "skill.s2": "purple" } });
    const i = indexWhere(run, (c) => c.kind === "skill" && !c.upgrade);
    const card = screen(run)[i];
    if (card?.kind !== "skill") throw new Error("expected a skill");
    return { ctx, run, i, card: card.id };
  }

  it("taking a new skill: phase learning, CardOffered, the hand unchanged", () => {
    const { ctx, run, i, card } = fullHand();
    const events = ok(takeReward(ctx, run, i));
    expect(kinds(events)).toEqual(["RewardTaken", "CardOffered"]);
    expect(eventOf(events, "CardOffered")).toEqual({ type: "CardOffered", card, rarity: "green" });
    expect(run.phase).toBe("learning");
    expect(run.learning).toEqual({ card, rarity: "green", queue: [] });
    expect(run.rewards).toBeNull();
    expect(run.player.cards).toEqual(S_HAND);
    expect(run.step).toBe(1);
    expect(snapshot(run)).toEqual(run);
  });

  it("learnForget: the new card takes the forgotten card's place (CardLearned, replaced), then the next step", () => {
    const { ctx, run, i, card } = fullHand();
    ok(takeReward(ctx, run, i));
    const events = ok(learnForget(ctx, run, "skill.s2"));
    expect(kinds(events)).toEqual(["CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card, rarity: "green", replaced: "skill.s2" });
    expect(run.player.cards).toEqual(["weapon.club", "skill.s1", card, "skill.s3", "skill.s4"]);
    expect(run.player.rarities).toEqual({ "weapon.club": "blue", "skill.s1": "grey", [card]: "green", "skill.s3": "grey", "skill.s4": "grey" });
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.learning).toBeNull();
  });

  it("Strike can be forgotten; the weapon stays equipped", () => {
    const { ctx, run, i, card } = fullHand();
    ok(takeReward(ctx, run, i));
    const events = ok(learnForget(ctx, run, "weapon.club"));
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card, rarity: "green", replaced: "weapon.club" });
    expect(run.player.cards).toEqual([card, "skill.s1", "skill.s2", "skill.s3", "skill.s4"]);
    expect(Object.hasOwn(run.player.rarities, "weapon.club")).toBe(false);
    expect(run.picks.weapon).toBe("weapon.club");
  });

  it("learnLeave keeps the hand (CardLeft), then the next step", () => {
    const { ctx, run, i, card } = fullHand();
    ok(takeReward(ctx, run, i));
    const before = snapshot(run).player;
    const events = ok(learnLeave(ctx, run));
    expect(kinds(events)).toEqual(["CardLeft", "OptionsOffered"]);
    expect(eventOf(events, "CardLeft")).toEqual({ type: "CardLeft", card });
    expect(run.player).toEqual(before);
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
  });

  it("a left card can be offered again later (it isn't held)", () => {
    // Grey only: the held grey cards have no upgrade; s5 is the only candidate.
    const ctx = rsCtx({ table: table({ kinds: { skill: 1 }, rarity: { grey: 1 } }), skills: [S1, S2, S3, S4, S5] });
    const { run } = rsRun(ctx, { hand: S_HAND });
    expect(ids(screen(run))).toEqual(["skill.s5"]);
    ok(takeReward(ctx, run, 0));
    ok(learnLeave(ctx, run));
    toRewards(ctx, run, "normal");
    expect(ids(screen(run))).toEqual(["skill.s5"]);
  });

  it("learnForget of a card not held (the offered card included) is refused (no_such_option)", () => {
    const { ctx, run, i, card } = fullHand();
    ok(takeReward(ctx, run, i));
    for (const id of [card, "skill.s6", "weapon.spear", "", "nothing"]) expectRefused(run, () => learnForget(ctx, run, id), "no_such_option");
  });

  it("learnForget and learnLeave are refused outside the learning phase", () => {
    const { ctx, run, i } = fullHand();
    expectRefused(run, () => learnForget(ctx, run, "skill.s1"), "wrong_phase");
    expectRefused(run, () => learnLeave(ctx, run), "wrong_phase");
    ok(takeReward(ctx, run, i));
    ok(learnLeave(ctx, run));
    expectRefused(run, () => learnForget(ctx, run, "skill.s1"), "wrong_phase");
    expectRefused(run, () => learnLeave(ctx, run), "wrong_phase");
  });

  it("in the learning phase every other command is refused", () => {
    const { ctx, run, i } = fullHand();
    ok(takeReward(ctx, run, i));
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

describe("item cards", () => {
  /** Item-only screens over `items`; skills s1-s4 (and skill.granted when needed) for hands. Brute: no bonus cards. */
  const itemCtx = (items: readonly ContentFile[]): RunContext => rsCtx({ table: ITEM_ONLY, items, skills: [S1, S2, S3, S4, S5] });

  function takeItem(
    items: readonly ContentFile[],
    id: string,
    opts: { picks?: Partial<LoadoutPicks>; hand?: readonly string[]; rarities?: Readonly<Record<string, Rarity>>; hp?: number; tier?: GroupTier } = {},
  ): { ctx: RunContext; run: RunState; events: readonly RunEvent[] } {
    const ctx = itemCtx(items);
    const { run } = rsRun(ctx, opts);
    const events = ok(takeReward(ctx, run, indexOfId(run, id)));
    return { ctx, run, events };
  }

  it("armor: equipped; max HP recomputed; the HP you were missing stays missing", () => {
    const { ctx, run, events } = takeItem([MAIL], "armor.mail", { hp: -5 });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(eventOf(events, "RewardTaken")).toEqual({ type: "RewardTaken", card: { kind: "item", id: "armor.mail", slot: "armor" } });
    expect(eventOf(events, "ItemEquipped")).toEqual({ type: "ItemEquipped", slot: "armor", item: "armor.mail", previous: "armor.plain", maxHp: 45, hp: 40 });
    expect(run.picks.armor).toBe("armor.mail");
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(40);
    expect(run.player.cards).toEqual(["weapon.club"]);
    expect(playerUnitFromRun(ctx.pack, run).maxHp).toBe(45);
  });

  it("stats and Shield follow the new item; base stats don't change", () => {
    const { ctx, run } = takeItem([BULWARK], "armor.bulwark");
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.stats?.vitality).toBe(5);
    expect(unit.maxShield).toBe(4);
    expect(run.player.baseStats.vitality).toBe(3);
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(45);
  });

  it("a weapon: its Strike is learned at the end (grey, no startRarity); the old Strike stays", () => {
    const { ctx, run, events } = takeItem([SPEAR], "weapon.spear", { hand: ["weapon.club", "skill.s1"] });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "ItemEquipped")).toMatchObject({ slot: "weapon", item: "weapon.spear", previous: "weapon.club" });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "weapon.spear", rarity: "grey", replaced: null });
    expect(run.picks.weapon).toBe("weapon.spear");
    expect(run.player.cards).toEqual(["weapon.club", "skill.s1", "weapon.spear"]);
    expect(run.player.rarities["weapon.spear"]).toBe("grey");
    expect(playerUnitFromRun(ctx.pack, run).stats?.agility).toBe(3);
  });

  it("the offered card comes at the item's start rarity (a weapon naming its own Strike green)", () => {
    const { run, events } = takeItem([BLESSED], "weapon.blessed");
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "weapon.blessed", rarity: "green", replaced: null });
    expect(run.player.rarities["weapon.blessed"]).toBe("green");
  });

  it("an accessory: its granted skill is learned at the accessory's start rarity (purple)", () => {
    const { run, events } = takeItem([CHARM], "accessory.charm");
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardLearned", "OptionsOffered"]);
    expect(eventOf(events, "ItemEquipped")).toMatchObject({ slot: "accessory", item: "accessory.charm", previous: "accessory.plain" });
    expect(eventOf(events, "CardLearned")).toEqual({ type: "CardLearned", card: "skill.granted", rarity: "purple", replaced: null });
    expect(run.player.cards).toEqual(["weapon.club", "skill.granted"]);
  });

  it("with 5 cards: the item is equipped, then learning one card at a time (queue empty for a single offer)", () => {
    const { ctx, run, events } = takeItem([SPEAR], "weapon.spear", { hand: S_HAND });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "CardOffered"]);
    expect(eventOf(events, "CardOffered")).toEqual({ type: "CardOffered", card: "weapon.spear", rarity: "grey" });
    expect(run.phase).toBe("learning");
    expect(run.learning).toEqual({ card: "weapon.spear", rarity: "grey", queue: [] });
    expect(run.picks.weapon).toBe("weapon.spear");
    const learned = ok(learnForget(ctx, run, "skill.s3"));
    expect(kinds(learned)).toEqual(["CardLearned", "OptionsOffered"]);
    expect(eventOf(learned, "CardLearned")).toEqual({ type: "CardLearned", card: "weapon.spear", rarity: "grey", replaced: "skill.s3" });
    expect(run.player.cards).toEqual(["weapon.club", "skill.s1", "skill.s2", "weapon.spear", "skill.s4"]);
  });

  it("with 5 cards, leaving the offered card keeps the new item", () => {
    const { ctx, run } = takeItem([CHARM], "accessory.charm", { hand: S_HAND });
    expect(run.learning).toEqual({ card: "skill.granted", rarity: "purple", queue: [] });
    expect(kinds(ok(learnLeave(ctx, run)))).toEqual(["CardLeft", "OptionsOffered"]);
    expect(run.player.cards).toEqual(S_HAND);
    expect(run.picks.accessory).toBe("accessory.charm");
  });

  it("an offered card already held is not added (no card event, its rarity unchanged), even with 5 cards", () => {
    const hand = ["weapon.club", "skill.s1", "skill.granted", "skill.s2", "skill.s3"];
    const { run, events } = takeItem([CHARM], "accessory.charm", { hand });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.learning).toBeNull();
    expect(run.player.cards).toEqual(hand);
    expect(run.player.rarities["skill.granted"]).toBe("grey");
    const re = takeItem([SPEAR], "weapon.spear", { picks: {}, hand: ["weapon.spear", "skill.s1"] });
    expect(kinds(re.events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
  });

  it("cards from the old item stay: swapping the charm keeps its granted skill", () => {
    const { run, events } = takeItem([CHARM, AMULET], "accessory.amulet", { picks: { accessory: "accessory.charm" } });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(eventOf(events, "ItemEquipped")).toEqual({ type: "ItemEquipped", slot: "accessory", item: "accessory.amulet", previous: "accessory.charm", maxHp: 41, hp: 41 });
    expect(run.player.cards).toEqual(["weapon.club", "skill.granted"]);
  });

  it("an accessory granting the same card as the old one, still held: nothing to learn", () => {
    const { run, events } = takeItem([CHARM, TWIN], "accessory.twin", { picks: { accessory: "accessory.charm" } });
    expect(kinds(events)).toEqual(["RewardTaken", "ItemEquipped", "OptionsOffered"]);
    expect(run.player.cards).toEqual(["weapon.club", "skill.granted"]);
  });

  it("the replaced item can be offered again later (it is no longer equipped)", () => {
    const { ctx, run } = takeItem([MAIL], "armor.mail");
    toRewards(ctx, run, "normal");
    expect(ids(screen(run))).toEqual(["armor.plain"]);
  });
});

// =============================================================================================
// Rerolls

describe("rerolls", () => {
  it("redraw the whole screen: RewardsRerolled, then RewardsOffered; one reroll used", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx);
    const events = ok(rerollRewards(ctx, run, REROLL));
    expect(kinds(events)).toEqual(["RewardsRerolled", "RewardsOffered"]);
    expect(eventOf(events, "RewardsRerolled")).toEqual({ type: "RewardsRerolled", rerollsUsed: 1 });
    expect(run.limits.used.reroll).toBe(1);
    expect(run.limits.used.revive).toBe(0);
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.rerolls).toBe(1);
    expect(run.rewards?.tier).toBe("normal");
    expect(eventOf(events, "RewardsOffered")).toEqual({ type: "RewardsOffered", tier: "normal", cards: screen(run), rerolls: 1 });
  });

  it("change only this screen and the reroll count", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx, { hp: -3 });
    const before = withoutScreen(run);
    ok(rerollRewards(ctx, run, REROLL));
    expect(withoutScreen(run)).toEqual(before);
  });

  it("a rerolled screen follows the same rules (size, exclusions, one purse)", () => {
    const ctx = rsCtx();
    const held = ["weapon.club", "skill.s1", "skill.s2", "word.w1"];
    for (const s of seeds(20)) {
      const { run } = rsRun(ctx, { seed: s, hand: held, picks: SAGE_4, rarities: { "skill.s1": "orange", "skill.s2": "orange", "word.w1": "orange" } });
      for (let i = 0; i < 3; i++) {
        ok(rerollRewards(ctx, run, REROLL));
        const cards = screen(run);
        expect(cards).toHaveLength(4);
        const named = ids(cards);
        expect(new Set(named).size).toBe(named.length);
        for (const id of named) expect([...held, "armor.plain", "accessory.plain"]).not.toContain(id);
        expect(countKind(cards, "crowns")).toBeLessThanOrEqual(1);
      }
    }
  });

  it("are deterministic per seed and reroll number, and do change screens", () => {
    const ctx = rsCtx();
    let changed = 0;
    for (const s of seeds(30)) {
      const a = rsRun(ctx, { seed: s }).run;
      const b = rsRun(ctx, { seed: s }).run;
      const first = screen(a);
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, b, { action: "reroll", source: "premium" }));
      expect(screen(a)).toEqual(screen(b));
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, b, REROLL));
      expect(screen(a)).toEqual(screen(b));
      if (JSON.stringify(screen(a)) !== JSON.stringify(first)) changed++;
    }
    expect(changed).toBeGreaterThan(15);
  });

  it("the reroll number counts this screen's rerolls: each new screen starts at 0 and draws as if never rerolled", () => {
    const ctx = rsCtx();
    for (const s of seeds(10)) {
      const a = rsRun(ctx, { seed: s }).run;
      const b = rsRun(ctx, { seed: s }).run;
      ok(rerollRewards(ctx, a, REROLL));
      ok(skipReward(ctx, a));
      ok(skipReward(ctx, b));
      toRewards(ctx, a, "hard");
      toRewards(ctx, b, "hard");
      expect(a.rewards?.rerolls).toBe(0);
      expect(screen(a)).toEqual(screen(b));
      // Rerolled once on this screen: the same as the other run's first reroll here.
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, b, REROLL));
      expect(a.rewards?.rerolls).toBe(1);
      expect(screen(a)).toEqual(screen(b));
    }
  });

  it("nothing else in the run shifts: later steps, screens and level-ups are the same with or without rerolls", () => {
    const ctx = rsCtx();
    for (const s of seeds(10)) {
      const a = rsRun(ctx, { seed: s }).run;
      const b = rsRun(ctx, { seed: s }).run;
      ok(rerollRewards(ctx, a, REROLL));
      ok(rerollRewards(ctx, a, REROLL));
      expect(ok(skipReward(ctx, a))).toEqual(ok(skipReward(ctx, b)));
      expect({ ...snapshot(a), limits: null }).toEqual({ ...snapshot(b), limits: null });
      expect(toRewards(ctx, a, "elite")).toEqual(toRewards(ctx, b, "elite"));
      expect(kinds(ok(skipReward(ctx, a)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
      ok(skipReward(ctx, b));
      expect(a.levelUp).toEqual(b.levelUp);
    }
  });

  it("3 per run, across screens; past the limit refused (limit_reached) and nothing changes", () => {
    expect(RUN_LIMITS.reroll).toBe(3);
    const ctx = rsCtx({ table: CROWNS_ONLY });
    const run = startRs(ctx);
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
    expectRefused(run, () => rerollRewards(ctx, run, { action: "reroll", source: "premium" }), "limit_reached");
    ok(takeReward(ctx, run, 0));
    toRewards(ctx, run, "normal");
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "limit_reached");
    expect(run.limits.used.reroll).toBe(3);
  });

  it("a grant for another action is refused (wrong_action) and nothing changes", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx);
    expectRefused(run, () => rerollRewards(ctx, run, REVIVE), "wrong_action");
    expect(run.limits.used.reroll).toBe(0);
  });

  it("refused outside the rewards phase (wrong_phase)", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
    ok(completeNode(ctx, run, { rewardTier: "elite" }));
    ok(skipReward(ctx, run));
    expect(run.phase).toBe("levelUp");
    expectRefused(run, () => rerollRewards(ctx, run, REROLL), "wrong_phase");
  });

  it("rerolls and revives are counted apart", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
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

describe("level-ups after elite and boss fights", () => {
  function levelUpRun(opts: { seed?: string; picks?: Partial<LoadoutPicks>; stats?: Partial<StatBlock>; hp?: number; tier?: GroupTier } = {}) {
    const ctx = rsCtx();
    const { run } = rsRun(ctx, {
      seed: opts.seed ?? "seed",
      picks: opts.picks ?? {},
      tier: opts.tier ?? "elite",
      hp: opts.hp ?? 0,
      prepare: (r) => {
        r.player.baseStats = { ...r.player.baseStats, ...opts.stats };
      },
    });
    const events = ok(skipReward(ctx, run));
    return { ctx, run, events };
  }

  const optionsOf = (run: RunState) => {
    const l = run.levelUp;
    if (l === null) throw new Error(`no level-up (phase ${run.phase})`);
    return l.options;
  };

  it("only after elite and boss tiers", () => {
    for (const tier of TIERS) {
      const { run, events } = levelUpRun({ tier });
      const levels = tier === "elite" || tier === "boss";
      expect([tier, kinds(events)]).toEqual([tier, levels ? ["RewardSkipped", "LevelUpOffered"] : ["RewardSkipped", "OptionsOffered"]]);
      expect(run.phase).toBe(levels ? "levelUp" : "choosing");
    }
  });

  it("offers levelUpOffer on the stream derive('levelup', act position, act, step); LevelUpOffered matches the state", () => {
    for (const s of seeds(30)) {
      const { ctx, run, events } = levelUpRun({ seed: s });
      const expected = levelUpOffer(ctx.pack, run, new RngStreams(run.seed).derive("levelup", run.actNumber, run.act, run.step));
      expect(optionsOf(run)).toEqual([...expected]);
      expect(optionsOf(run)).toHaveLength(2);
      expect(eventOf(events, "LevelUpOffered")).toEqual({ type: "LevelUpOffered", options: optionsOf(run) });
      expect(snapshot(run)).toEqual(run);
    }
  });

  it("the same offer whatever reward was taken or rerolled", () => {
    for (const s of seeds(15)) {
      const ctx = rsCtx({ table: CROWNS_ONLY });
      const a = rsRun(ctx, { seed: s, tier: "elite" }).run;
      const b = rsRun(ctx, { seed: s, tier: "elite" }).run;
      ok(rerollRewards(ctx, a, REROLL));
      ok(takeReward(ctx, a, 0));
      ok(skipReward(ctx, b));
      expect(a.levelUp).toEqual(b.levelUp);
    }
  });

  it("choosing a favoured stat: +2 (StatRaised); Vitality raises max HP and HP by 10", () => {
    const { ctx, run } = levelUpRun({ stats: { might: 7 }, hp: -10 });
    expect(optionsOf(run)[0]).toBe("vitality");
    expect(run.player.hp).toBe(25);
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(events)).toEqual(["StatRaised", "OptionsOffered"]);
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: "vitality", value: 5, maxHp: 45, hp: 35 });
    expect(run.player.baseStats.vitality).toBe(5);
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(35);
    expect(run.levelUp).toBeNull();
  });

  it("choosing another stat: +1; max HP unchanged", () => {
    const { ctx, run } = levelUpRun({ stats: { might: 7 } });
    const other = optionsOf(run)[1];
    if (other === undefined) throw new Error("expected two options");
    // Might at the cap: the favoured option is Vitality; the other is a non-favoured stat below the cap (+1).
    expect(optionsOf(run)[0]).toBe("vitality");
    expect(["might", "vitality"]).not.toContain(other);
    const before = run.player.baseStats[other];
    const events = ok(chooseLevelUp(ctx, run, 1));
    expect(eventOf(events, "StatRaised")).toEqual({ type: "StatRaised", stat: other, value: before + 1, maxHp: 35, hp: 35 });
    expect(run.player.baseStats[other]).toBe(before + 1);
  });

  it("the choice must be one of the stats offered: a bad index is refused (no_such_option)", () => {
    const { ctx, run } = levelUpRun();
    for (const i of [-1, 2, 7, 0.5, Number.NaN]) expectRefused(run, () => chooseLevelUp(ctx, run, i), "no_such_option");
  });

  it("an offer of one stat accepts index 0 only", () => {
    const { ctx, run } = levelUpRun({ stats: capped({ vitality: 3 }) });
    expect(optionsOf(run)).toEqual(["vitality"]);
    expectRefused(run, () => chooseLevelUp(ctx, run, 1), "no_such_option");
    ok(chooseLevelUp(ctx, run, 0));
  });

  it("no stat below the cap: no level-up phase, the run moves on", () => {
    const { run, events } = levelUpRun({ stats: capped() });
    expect(kinds(events)).toEqual(["RewardSkipped", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.levelUp).toBeNull();
  });

  it("in the level-up phase every other command is refused; chooseLevelUp is refused outside it", () => {
    const { ctx, run } = levelUpRun();
    for (const command of [
      () => takeReward(ctx, run, 0),
      () => skipReward(ctx, run),
      () => rerollRewards(ctx, run, REROLL),
      () => learnForget(ctx, run, "weapon.club"),
      () => learnLeave(ctx, run),
      () => chooseOption(ctx, run, 0),
      () => completeNode(ctx, run, {}),
      () => revive(ctx, run, REVIVE),
      () => endRun(run),
      () => chooseRoute(ctx, run, 0),
      () => fallInNode(run),
    ]) {
      expectRefused(run, command, "wrong_phase");
    }
    ok(chooseLevelUp(ctx, run, 0));
    expectRefused(run, () => chooseLevelUp(ctx, run, 0), "wrong_phase");
    const fresh = startRs(ctx);
    expectRefused(fresh, () => chooseLevelUp(ctx, fresh, 0), "wrong_phase");
  });
});

// =============================================================================================
// Order after a fight

describe("after-fight order", () => {
  it("rewards → learning → level-up → next step", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    const { run } = rsRun(ctx, { hand: S_HAND, tier: "elite" });
    const i = indexWhere(run, (c) => c.kind === "skill" && !c.upgrade);
    expect(kinds(ok(takeReward(ctx, run, i)))).toEqual(["RewardTaken", "CardOffered"]);
    expect(run.phase).toBe("learning");
    expect(kinds(ok(learnForget(ctx, run, "skill.s1")))).toEqual(["CardLearned", "LevelUpOffered"]);
    expect(run.phase).toBe("levelUp");
    expect(run.learning).toBeNull();
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
  });

  it("leaving the card also leads to the level-up", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    const { run } = rsRun(ctx, { hand: S_HAND, tier: "elite" });
    ok(takeReward(ctx, run, indexWhere(run, (c) => c.kind === "skill" && !c.upgrade)));
    expect(kinds(ok(learnLeave(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
  });

  it("an item whose card arrives with 5 held: item, learning, then the level-up", () => {
    const ctx = rsCtx({ table: ITEM_ONLY, items: [CHARM], skills: [S1, S2, S3, S4] });
    const { run } = rsRun(ctx, { hand: S_HAND, tier: "elite" });
    expect(kinds(ok(takeReward(ctx, run, indexOfId(run, "accessory.charm"))))).toEqual(["RewardTaken", "ItemEquipped", "CardOffered"]);
    expect(kinds(ok(learnLeave(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
  });

  it("taking a card with room goes straight to the level-up", () => {
    const ctx = rsCtx({ table: CROWNS_ONLY });
    const { run } = rsRun(ctx, { tier: "elite" });
    expect(kinds(ok(takeReward(ctx, run, 0)))).toEqual(["RewardTaken", "CrownsGained", "LevelUpOffered"]);
  });

  it("after the boss: rewards (with the relic card), level-up, then ActCompleted and victory (no routes)", () => {
    const ctx = rsCtx();
    const { run, events } = bossRun(ctx);
    expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(run.phase).toBe("rewards");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
    const end = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(end)).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
    expect(eventOf(end, "RunEnded")).toEqual({ type: "RunEnded", result: "won" });
    expect(run.phase).toBe("won");
    expect(run.node).toBeNull();
    expect(run.rewards).toBeNull();
    expect(run.levelUp).toBeNull();
    expect(run.rewardTier).toBeNull();
  });

  it("after the boss with routes: the routes come after the level-up", () => {
    const acts = [rsAct("act.r", allTiers(DEFAULT_TABLE), { routes: [{ to: "act.r2" }] }), rsAct("act.r2", allTiers(DEFAULT_TABLE), { first: undefined })];
    const ctx = rsCtx({ acts });
    const { run } = bossRun(ctx);
    ok(takeReward(ctx, run, 2));
    const events = ok(chooseLevelUp(ctx, run, 0));
    expect(kinds(events)).toEqual(["StatRaised", "ActCompleted", "RoutesOffered"]);
    expect(run.phase).toBe("route");
    expect(run.routes).toEqual(["act.r2"]);
    expect(run.node).toBeNull();
    ok(chooseRoute(ctx, run, 0));
    expect(run.act).toBe("act.r2");
  });

  it("a normal-tier result at the last step: rewards, then the end of the act (no level-up)", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    advancePlain(ctx, run, 4);
    toRewards(ctx, run, "normal");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "ActCompleted", "RunEnded"]);
  });

  it("in the rewards phase the map, revive, learning and level-up commands are refused", () => {
    const ctx = rsCtx();
    const { run } = rsRun(ctx);
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, { rewardTier: "normal" }), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, {}), "wrong_phase");
    expectRefused(run, () => revive(ctx, run, REVIVE), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => fallInNode(run), "wrong_phase");
    expectRefused(run, () => learnForget(ctx, run, "weapon.club"), "wrong_phase");
    expectRefused(run, () => learnLeave(ctx, run), "wrong_phase");
    expectRefused(run, () => chooseLevelUp(ctx, run, 0), "wrong_phase");
  });
});

// =============================================================================================
// Nothing to offer

describe("an empty screen is skipped", () => {
  /** No skills, no unequipped items, no purse weight, no relics. */
  const emptyCtx = (): RunContext => rsCtx({ table: table({ kinds: { skill: 1, item: 1 } }), skills: [], items: [], relics: [] });

  it("no rewards phase: straight to the next step", () => {
    const ctx = emptyCtx();
    const run = startRs(ctx);
    const events = toRewards(ctx, run, "normal", -3);
    expect(kinds(events)).toEqual(["NodeCompleted", "OptionsOffered"]);
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.rewards).toBeNull();
    expect(run.node).toBeNull();
    expect(run.rewardTier).toBeNull();
  });

  it("after an elite fight: straight to the level-up", () => {
    const ctx = emptyCtx();
    const run = startRs(ctx);
    expect(kinds(toRewards(ctx, run, "elite"))).toEqual(["NodeCompleted", "LevelUpOffered"]);
    expect(run.phase).toBe("levelUp");
    expect(run.rewards).toBeNull();
  });

  it("after the boss: straight to the level-up, then the end of the act", () => {
    const ctx = emptyCtx();
    const run = startRs(ctx);
    advancePlain(ctx, run, 4);
    expect(kinds(toRewards(ctx, run, "boss"))).toEqual(["NodeCompleted", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
  });
});

// =============================================================================================
// Falling and reviving

describe("a fall at a node with a reward tier", () => {
  it("the flow waits: NodeCompleted, PlayerFell; the tier is kept, no screen yet", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    const events = toRewards(ctx, run, "elite", -1000);
    expect(kinds(events)).toEqual(["NodeCompleted", "PlayerFell"]);
    expect(run.phase).toBe("fallen");
    expect(run.rewardTier).toBe("elite");
    expect(run.rewards).toBeNull();
    expect(run.levelUp).toBeNull();
    expect(snapshot(run)).toEqual(run);
  });

  it("a revive runs it: Revived, then the rewards screen for that tier", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    toRewards(ctx, run, "normal", -1000);
    const events = ok(revive(ctx, run, REVIVE));
    expect(kinds(events)).toEqual(["Revived", "RewardsOffered"]);
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.tier).toBe("normal");
    expect(run.rewards?.rerolls).toBe(0);
    expect(run.player.hp).toBe(18);
    expect(run.step).toBe(1);
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "OptionsOffered"]);
    expect(run.rewardTier).toBeNull();
  });

  it("the same screen as without the fall (same stream), and after a JSON round trip of the fallen run", () => {
    const ctx = rsCtx();
    for (const s of seeds(10)) {
      const fell = startRs(ctx, s);
      toRewards(ctx, fell, "hard", -1000);
      const saved = snapshot(fell);
      ok(revive(ctx, fell, REVIVE));
      ok(revive(ctx, saved, REVIVE));
      const plain = startRs(ctx, s);
      toRewards(ctx, plain, "hard");
      expect(screen(fell)).toEqual(screen(plain));
      expect(screen(saved)).toEqual(screen(plain));
    }
  });

  it("after an elite fall: rewards, learning, then the level-up", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    const run = startRs(ctx);
    setHand(run, S_HAND);
    toRewards(ctx, run, "elite", -1000);
    ok(revive(ctx, run, REVIVE));
    expect(kinds(ok(takeReward(ctx, run, indexWhere(run, (c) => c.kind === "skill" && !c.upgrade))))).toEqual(["RewardTaken", "CardOffered"]);
    expect(kinds(ok(learnLeave(ctx, run)))).toEqual(["CardLeft", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "OptionsOffered"]);
  });

  it("with nothing to offer after an elite fall: Revived, then the level-up", () => {
    const ctx = rsCtx({ table: table({ kinds: { skill: 1, item: 1 } }), skills: [], items: [], relics: [] });
    const run = startRs(ctx);
    toRewards(ctx, run, "elite", -1000);
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "LevelUpOffered"]);
  });

  it("at the boss: rewards (relic card) and level-up come before the end of the act", () => {
    const ctx = rsCtx();
    const { run } = bossRun(ctx, "seed", { hp: -1000 });
    expect(run.phase).toBe("fallen");
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "RewardsOffered"]);
    expect(screen(run)[2]?.kind).toBe("relic");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
  });

  it("a fall without a tier still revives by moving on; ending the tale after a tiered fall loses", () => {
    const ctx = rsCtx();
    const a = startRs(ctx);
    ok(chooseOption(ctx, a, 0));
    ok(completeNode(ctx, a, { hp: -1000 }));
    expect(kinds(ok(revive(ctx, a, REVIVE)))).toEqual(["Revived", "OptionsOffered"]);
    const b = startRs(ctx);
    toRewards(ctx, b, "elite", -1000);
    expect(ok(endRun(b))).toEqual([{ type: "RunEnded", result: "lost" }]);
    expect(b.phase).toBe("lost");
    expect(b.rewards).toBeNull();
    expect(b.levelUp).toBeNull();
    expect(b.node).toBeNull();
  });

  it("a later tierless fall doesn't reopen an old screen", () => {
    const ctx = rsCtx();
    const run = startRs(ctx);
    toRewards(ctx, run, "elite", -1000);
    ok(revive(ctx, run, REVIVE));
    ok(skipReward(ctx, run));
    ok(chooseLevelUp(ctx, run, 0));
    ok(chooseOption(ctx, run, 0));
    ok(completeNode(ctx, run, { hp: -1000 }));
    expect(run.rewardTier).toBeNull();
    expect(kinds(ok(revive(ctx, run, REVIVE)))).toEqual(["Revived", "OptionsOffered"]);
  });
});

// =============================================================================================
// State fields

describe("state fields through the phases", () => {
  /** rewards / learning / levelUp only in their phase; the node and the tier kept until the run moves on. */
  function expectPhaseState(run: RunState, node: unknown, tier: GroupTier | null): void {
    expect(run.rewards === null).toBe(run.phase !== "rewards");
    expect(run.learning === null).toBe(run.phase !== "learning");
    expect(run.levelUp === null).toBe(run.phase !== "levelUp");
    if (run.phase === "rewards" || run.phase === "learning" || run.phase === "levelUp") {
      expect(run.node).toEqual(node);
      expect(run.rewardTier).toBe(tier);
      expect(run.offer).toEqual([]);
    }
    if (run.phase === "choosing" || run.phase === "won" || run.phase === "route") {
      expect(run.node).toBeNull();
      expect(run.rewardTier).toBeNull();
    }
  }

  it("rewards → learning → level-up: each field only in its phase; the node kept until the run moves on", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    const run = startRs(ctx);
    setHand(run, S_HAND);
    ok(chooseOption(ctx, run, 0));
    const node = snapshot(run).node;
    expect(node).not.toBeNull();
    expect(run.rewardTier).toBeNull();
    ok(completeNode(ctx, run, { rewardTier: "elite" }));
    expect(run.phase).toBe("rewards");
    expectPhaseState(run, node, "elite");
    ok(rerollRewards(ctx, run, REROLL));
    expectPhaseState(run, node, "elite");
    ok(takeReward(ctx, run, indexWhere(run, (c) => c.kind === "skill" && !c.upgrade)));
    expect(run.phase).toBe("learning");
    expectPhaseState(run, node, "elite");
    ok(learnForget(ctx, run, "skill.s2"));
    expect(run.phase).toBe("levelUp");
    expectPhaseState(run, node, "elite");
    ok(chooseLevelUp(ctx, run, 0));
    expect(run.phase).toBe("choosing");
    expectPhaseState(run, node, null);
  });

  it("the invariants hold all through a policy run, and in its saves", () => {
    const ctx = longCtx();
    for (const s of seeds(4, "inv")) {
      const run = startRs(ctx, s);
      let node: unknown = null;
      let tier: GroupTier | null = null;
      for (let n = 0; n < 500 && run.phase !== "won" && run.phase !== "lost"; n++) {
        const events = playRs(ctx, run, 1);
        if (run.phase === "inNode") node = snapshot(run).node;
        const done = evs(events).find((e) => e.type === "NodeCompleted");
        if (done !== undefined) tier = run.rewardTier;
        expectPhaseState(run, node, tier);
        expect(snapshot(run)).toEqual(run);
        expect(run.player.cards.length).toBeLessThanOrEqual(5);
        expect(new Set(run.player.cards).size).toBe(run.player.cards.length);
        expect(Object.keys(run.player.rarities).sort()).toEqual([...run.player.cards].sort());
        expect(run.player.hp).toBeLessThanOrEqual(run.player.maxHp);
      }
      expect(run.phase).toBe("won");
    }
  });
});

// =============================================================================================
// Determinism, saves, events

/**
 * Plays a run with a fixed policy that depends only on the run's own state. Fake nodes report tiers in turn (the
 * last step boss); rerolls on odd steps while allowed (once per screen); takes a card or skips; learning forgets or
 * leaves; level-ups pick the last option. Stops when the run ends, at `stopAt`, or after `max` commands.
 */
function playRs(ctx: RunContext, run: RunState, max = 500, stopAt?: RunState["phase"]): RunEvent[] {
  const events: RunEvent[] = [];
  for (let n = 0; n < max; n++) {
    if (stopAt !== undefined && run.phase === stopAt) return events;
    let res: CommandResult;
    switch (run.phase) {
      case "choosing":
        res = chooseOption(ctx, run, run.step % run.offer.length);
        break;
      case "inNode": {
        const tier: GroupTier = run.step === run.steps ? "boss" : (TIERS[(run.step + run.actNumber) % 3] ?? "normal");
        res = completeNode(ctx, run, { hp: run.step === 3 && run.actNumber === 1 ? -1000 : -1, rewardTier: tier });
        break;
      }
      case "fallen":
        res = revive(ctx, run, REVIVE);
        break;
      case "rewards": {
        const r = run.rewards;
        const cards = r?.cards ?? [];
        if (r !== null && r.rerolls === 0 && run.step % 2 === 1 && run.limits.used.reroll < RUN_LIMITS.reroll) res = rerollRewards(ctx, run, REROLL);
        else if (cards.length === 0 || run.step % 5 === 0) res = skipReward(ctx, run);
        else if (cards[2]?.kind === "relic") res = takeReward(ctx, run, 2);
        else if (run.step === 2 && cards.some((c) => c.kind === "crowns")) res = takeReward(ctx, run, cards.findIndex((c) => c.kind === "crowns"));
        else res = takeReward(ctx, run, (run.step + run.actNumber) % cards.length);
        break;
      }
      case "learning":
        res = run.step % 2 === 0 ? learnForget(ctx, run, run.player.cards[(run.step + 1) % run.player.cards.length] ?? "") : learnLeave(ctx, run);
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

/** Per tier: the default table; items and purses; skills only at higher rarities; anything. */
const MIXED = {
  normal: DEFAULT_TABLE,
  hard: table({ kinds: { item: 1, crowns: 1 } }),
  elite: table({ kinds: { skill: 1 }, rarity: { green: 1, blue: 1, purple: 1 } }),
  boss: table({ rarity: ALL_RARITIES }),
};

/** Two acts of 7 steps (act.r routes to act.r2). */
function longCtx(): RunContext {
  return rsCtx({
    acts: [
      rsAct("act.r", MIXED, { steps: { min: 7, max: 7 }, routes: [{ to: "act.r2" }] }),
      rsAct("act.r2", MIXED, { first: undefined, steps: { min: 7, max: 7 } }),
    ],
  });
}

describe("determinism, saves and events", () => {
  it("policy runs reach every new phase and event, and end", () => {
    const ctx = longCtx();
    const seen = new Set<string>();
    for (const s of seeds(8, "policy")) {
      const run = startRs(ctx, s, SAGE_4);
      for (const k of kinds(playRs(ctx, run))) seen.add(k);
      expect(run.phase).toBe("won");
    }
    for (const k of [
      "RewardsOffered",
      "RewardsRerolled",
      "RewardTaken",
      "RewardSkipped",
      "CardOffered",
      "CardLearned",
      "CardLeft",
      "CrownsGained",
      "ItemEquipped",
      "RelicGained",
      "LevelUpOffered",
      "StatRaised",
    ]) {
      expect([k, seen.has(k)]).toEqual([k, true]);
    }
  });

  it("same seed, same commands: the same events and the same run", () => {
    const ctx = longCtx();
    for (const s of seeds(5, "det")) {
      const a = startRs(ctx, s);
      const b = startRs(ctx, s);
      expect(playRs(ctx, a)).toEqual(playRs(ctx, b));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it("different seeds give different screens", () => {
    const ctx = rsCtx();
    const distinct = new Set(seeds(20).map((s) => JSON.stringify(firstScreen(ctx, s))));
    expect(distinct.size).toBeGreaterThan(10);
  });

  for (const phase of ["rewards", "learning", "levelUp", "fallen"] as const) {
    it(`a JSON round trip in phase ${phase} continues identically`, () => {
      const ctx = longCtx();
      let tested = 0;
      for (const s of seeds(10, "rt")) {
        const run = startRs(ctx, s);
        playRs(ctx, run, 500, phase);
        if (run.phase !== phase) continue;
        tested++;
        const copy = snapshot(run);
        expect(copy).toEqual(run);
        expect(playRs(ctx, copy)).toEqual(playRs(ctx, run));
        expect(snapshot(copy)).toEqual(snapshot(run));
      }
      expect(tested).toBeGreaterThan(0);
    });
  }

  it("event payloads are copies: changing them doesn't change the run", () => {
    const ctx = rsCtx({ table: SKILL_ONLY });
    // A reroll's RewardsOffered.
    const { run } = rsRun(ctx, { hand: S_HAND, tier: "elite" });
    const rerolled = ok(rerollRewards(ctx, run, REROLL));
    const before = snapshot(run);
    const offered = eventOf(rerolled, "RewardsOffered");
    const cards = offered["cards"] as RewardCard[];
    const first = cards[0];
    if (first?.kind !== "skill") throw new Error("expected a skill card");
    (first as { id: string }).id = "skill.changed";
    cards.push({ kind: "crowns", amount: 1 });
    expect(snapshot(run)).toEqual(before);
    // RewardTaken's card, while the taken card waits in "learning".
    const taken = ok(takeReward(ctx, run, indexWhere(run, (c) => c.kind === "skill" && !c.upgrade)));
    const inLearning = snapshot(run);
    const card = eventOf(taken, "RewardTaken")["card"] as { id: string; rarity: string };
    card.id = "skill.changed";
    card.rarity = "orange";
    expect(snapshot(run)).toEqual(inLearning);
    // LevelUpOffered's options.
    const levelUp = ok(learnLeave(ctx, run));
    const atLevelUp = snapshot(run);
    const options = eventOf(levelUp, "LevelUpOffered")["options"] as string[];
    options.reverse();
    options.push("luck");
    options[0] = "nothing";
    expect(snapshot(run)).toEqual(atLevelUp);
  });

  it("the events match the state", () => {
    const ctx = longCtx();
    const run = startRs(ctx, "match", SAGE_4);
    for (let n = 0; n < 300 && run.phase !== "won"; n++) {
      const crownsBefore = run.crowns;
      const events = playRs(ctx, run, 1);
      for (const e of evs(events)) {
        if (e.type === "RewardsOffered") {
          expect(e["cards"]).toEqual(run.rewards?.cards);
          expect(e["rerolls"]).toBe(run.rewards?.rerolls);
          expect(e["tier"]).toBe(run.rewards?.tier);
        }
        if (e.type === "CardOffered") expect(run.learning).toMatchObject({ card: e["card"], rarity: e["rarity"] });
        if (e.type === "LevelUpOffered") expect(run.levelUp).toEqual({ options: e["options"] });
        if (e.type === "CrownsGained") {
          expect(e["crowns"]).toBe(run.crowns);
          expect(run.crowns - crownsBefore).toBe(e["amount"]);
        }
        if (e.type === "CardLearned") expect(run.player.rarities[String(e["card"])]).toBe(e["rarity"]);
        if (e.type === "CardUpgraded") expect(run.player.rarities[String(e["card"])]).toBe(e["rarity"]);
        if (e.type === "ItemEquipped") expect(run.player.maxHp).toBe(e["maxHp"]);
        if (e.type === "RelicGained") expect(run.relics).toContain(e["relic"]);
      }
    }
  });
});

// =============================================================================================
// Through real fights

describe("after a real fight: finishFight passes the group's tier", () => {
  it("a won normal fight opens the rewards screen with tier normal", () => {
    const { ctx, run, events } = winFight("group.dummy");
    expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(eventOf(events, "NodeCompleted")).toMatchObject({ nodeType: "combat", crownsChange: 0 });
    expect(run.phase).toBe("rewards");
    expect(run.rewards?.tier).toBe("normal");
    expect(run.rewardTier).toBe("normal");
    expect(screen(run)).toHaveLength(3);
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "OptionsOffered"]);
  });

  it("a won hard fight: tier hard, no level-up", () => {
    const { ctx, run } = winFight("group.h1");
    expect(run.rewards?.tier).toBe("hard");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "OptionsOffered"]);
  });

  it("a won elite fight: rewards, then a level-up", () => {
    const { ctx, run } = winFight("group.e1");
    expect(run.rewards?.tier).toBe("elite");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
  });

  it("the won act boss: tier boss, a relic card, a level-up, then victory", () => {
    const { ctx, run } = winFight("group.weak_boss", "last");
    expect(run.rewards?.tier).toBe("boss");
    expect(screen(run)[2]?.kind).toBe("relic");
    expect(kinds(ok(skipReward(ctx, run)))).toEqual(["RewardSkipped", "LevelUpOffered"]);
    expect(kinds(ok(chooseLevelUp(ctx, run, 0)))).toEqual(["StatRaised", "ActCompleted", "RunEnded"]);
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

  it("a lost fight opens no screen and sets no tier", () => {
    const { ctx, run, session } = fightAgainst("group.brute");
    strikeUntilOver(session, STRIKE);
    expect(kinds(ok(finishFight(ctx, run, session)))).toEqual(["PlayerFell"]);
    expect(run.rewards).toBeNull();
    expect(run.rewardTier).toBeNull();
  });

  it("rerolls don't shift later fights: the next fight plays out the same", () => {
    // Step 1 a won fight (rewards rerolled twice in one run, not in the other), step 2 a fight with weighted moves.
    const act = fightRsAct("group.dummy", 1, {
      fixed: [
        { at: 1, type: "combat", ref: "group.dummy" },
        { at: "last", type: "combat", ref: "group.trio" },
      ],
    });
    const ctx = fightRsCtx([act]);
    for (const s of seeds(4, "fight")) {
      const play = (rerolls: number) => {
        const run = startRs(ctx, s, { accessory: "accessory.locket", path: "path.ruled" });
        ok(chooseOption(ctx, run, 0));
        const first = startFight(ctx, run);
        strikeUntilOver(first, STRIKE);
        expect(kinds(ok(finishFight(ctx, run, first)))).toEqual(["NodeCompleted", "RewardsOffered"]);
        for (let i = 0; i < rerolls; i++) ok(rerollRewards(ctx, run, REROLL));
        ok(skipReward(ctx, run));
        const offer = snapshot(run).offer;
        ok(chooseOption(ctx, run, 0));
        const second = startFight(ctx, run);
        strikeUntilOver(second, STRIKE, 40);
        return { offer, fight: JSON.stringify(eventsOf(second)) };
      };
      expect(play(2)).toEqual(play(0));
    }
  });

  it("a fight won after a mid-fight revive opens the screen", () => {
    // Both sides fall on the first Strike (Thorns); the revived player has won.
    const ctx = fightRsCtx([fightRsAct("group.spiky")]);
    const run = startRs(ctx, "spiky", { accessory: "accessory.locket" });
    ok(chooseOption(ctx, run, 0));
    const session = startFight(ctx, run);
    strikeUntilOver(session, STRIKE, 1);
    expect(fightOutcome(session)).toBe("fallen");
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    expect(fightOutcome(session)).toBe("won");
    expect(kinds(ok(finishFight(ctx, run, session)))).toEqual(["NodeCompleted", "RewardsOffered"]);
    expect(run.rewards?.tier).toBe("normal");
  });
});

// =============================================================================================
// The real base pack

describe("base pack: Act I's after-fight flow", () => {
  const BASE_PICKS: LoadoutPicks = {
    character: "char.sellsword",
    weapon: "weapon.notched_longsword",
    armor: "armor.riveted_brigandine",
    accessory: "accessory.iron_locket",
    path: "path.sworn_road",
  };
  const baseCtx = (): RunContext => {
    const res = validatePack("base", BASE_FILES);
    if (!res.pack) throw new Error(`base pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
    return { pack: res.pack, registry: makeRegistry().registry };
  };
  /** The phase, read through a call (commands change it, which TypeScript's narrowing can't see). */
  const phaseOf = (run: RunState): RunState["phase"] => run.phase;
  const startBase = (ctx: RunContext, seed: string): RunState => startRun(ctx, { seed, picks: BASE_PICKS, technique: null }).run;

  /** Takes card `index` (or skips with -1), leaves a learned card, raises the first stat offered. Returns all events. */
  function finishFlow(ctx: RunContext, run: RunState, index: number): string[] {
    const seen: string[] = [];
    seen.push(...kinds(index < 0 ? ok(skipReward(ctx, run)) : ok(takeReward(ctx, run, index))));
    if (run.phase === "learning") seen.push(...kinds(ok(learnLeave(ctx, run))));
    if (run.phase === "levelUp") seen.push(...kinds(ok(chooseLevelUp(ctx, run, 0))));
    return seen;
  }

  it("normal, hard and elite results open a screen of at least 3 cards; elite adds a level-up; the run moves on", () => {
    const ctx = baseCtx();
    for (const tier of ["normal", "hard", "elite"] as const) {
      for (const s of seeds(6, `base-${tier}`)) {
        const run = startBase(ctx, s);
        const events = toRewards(ctx, run, tier, -2);
        expect(kinds(events)).toEqual(["NodeCompleted", "RewardsOffered"]);
        const cards = screen(run);
        expect(cards.length).toBeGreaterThanOrEqual(3);
        expect(countKind(cards, "relic")).toBe(0);
        const seen = finishFlow(ctx, run, Number(s.slice(-1)) % cards.length);
        expect([tier, seen.includes("LevelUpOffered")]).toEqual([tier, tier === "elite"]);
        expect(run.phase).toBe("choosing");
        expect(run.step).toBe(2);
        expect(run.rewardTier).toBeNull();
      }
    }
  });

  it("the boss: card 3 is one of the base relics; taking it, then the level-up, ends Act I", () => {
    const ctx = baseCtx();
    const relics = [...ctx.pack.byId.values()].filter((d) => d.kind === "relic").map((d) => d.id);
    for (const s of seeds(4, "base-boss")) {
      const run = startBase(ctx, s);
      advancePlain(ctx, run, run.steps);
      expect(kinds(toRewards(ctx, run, "boss"))).toEqual(["NodeCompleted", "RewardsOffered"]);
      const relic = screen(run)[2];
      if (relic?.kind !== "relic") throw new Error("expected a relic card");
      expect(relics).toContain(relic.id);
      const seen = finishFlow(ctx, run, 2);
      expect(seen.slice(0, 3)).toEqual(["RewardTaken", "RelicGained", "LevelUpOffered"]);
      expect(seen).toContain("ActCompleted");
      expect(run.relics).toEqual([relic.id]);
      expect(run.phase).toBe("won");
    }
  });

  it("a whole Act I with a reward after every node, rerolls included, ends", () => {
    const ctx = baseCtx();
    const run = startBase(ctx, "base-act");
    for (let n = 0; n < 200 && run.phase === "choosing"; n++) {
      ok(chooseOption(ctx, run, 0));
      const tier: GroupTier = run.step === run.steps ? "boss" : (TIERS[run.step % 3] ?? "normal");
      ok(completeNode(ctx, run, { hp: -1, rewardTier: tier }));
      if (phaseOf(run) === "fallen") ok(revive(ctx, run, REVIVE));
      if (phaseOf(run) === "rewards" && run.limits.used.reroll < RUN_LIMITS.reroll) ok(rerollRewards(ctx, run, REROLL));
      if (phaseOf(run) === "rewards") finishFlow(ctx, run, run.step % screen(run).length);
      else if (phaseOf(run) === "levelUp") ok(chooseLevelUp(ctx, run, 0));
      expect(run.player.cards.length).toBeLessThanOrEqual(5);
    }
    expect(run.phase).toBe("won");
    expect(run.limits.used.reroll).toBe(3);
  });
});
