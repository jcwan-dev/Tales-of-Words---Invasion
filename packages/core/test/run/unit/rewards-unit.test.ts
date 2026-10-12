import { describe, expect, it } from "vitest";
import {
  assemblePlayer,
  createRng,
  drawRewards,
  equipItem,
  gainCard,
  itemCard,
  levelsUp,
  levelUpOptions,
  loadoutTotals,
  STAT_IDS,
  takeReward,
  type RewardTableDef,
  type RunEvent,
  type RunPlayer,
  type StatBlock,
} from "../../../src/index.ts";
import { ok, snapshot } from "../run-pack.ts";
import { C1, C2, CHARM, GRANTED, MAIL, REWARD_PICKS, rewardsCtx, rewardsPack, screen, SPEAR, startRewardsRun, table, toRewards } from "../rewards-pack.ts";

// Builder unit tests for M2.4 (run/rewards, run/learning, run/items, run/levelup internals).

const TABLE: RewardTableDef = { kinds: { skill: 1, item: 1, crowns: 1 }, rarity: { common: 1 }, crowns: { min: 4, max: 4 } };

const player = (cards: string[]): RunPlayer => ({ hp: 10, maxHp: 10, cards, baseStats: block(2), eventTags: [], rules: [] });
const block = (n: number): StatBlock => Object.fromEntries(STAT_IDS.map((s) => [s, n])) as StatBlock;

describe("drawRewards", () => {
  it("is empty when nothing can be offered, and doesn't touch the rng then", () => {
    const pack = rewardsPack({ pool: [] });
    const rng = createRng("e");
    const before = rng.state();
    const noPurse: RewardTableDef = { ...TABLE, kinds: { skill: 1, item: 1 } };
    expect(drawRewards(pack, { cards: ["weapon.club"], picks: REWARD_PICKS, table: noPurse, bonus: 2 }, rng)).toEqual([]);
    expect(rng.state()).toEqual(before);
  });

  it("is deterministic in its rng and never repeats", () => {
    const pack = rewardsPack();
    for (const seed of ["a", "b", "c", "d"]) {
      const draw = () => drawRewards(pack, { cards: [], picks: REWARD_PICKS, table: TABLE, bonus: 2 }, createRng(seed));
      const options = draw();
      expect(draw()).toEqual(options);
      const ids = options.flatMap((o) => (o.kind === "crowns" ? [] : [o.id]));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("a purse of a single-value range has that amount", () => {
    const pack = rewardsPack();
    const only: RewardTableDef = { ...TABLE, kinds: { crowns: 1 } };
    expect(drawRewards(pack, { cards: [], picks: REWARD_PICKS, table: only, bonus: 0 }, createRng("p"))).toEqual([{ kind: "crowns", amount: 4 }]);
  });
});

describe("gainCard", () => {
  it("a held card: nothing, no event", () => {
    const p = player(["a", "b"]);
    const events: RunEvent[] = [];
    expect(gainCard(p, "a", events)).toBe(false);
    expect(p.cards).toEqual(["a", "b"]);
    expect(events).toEqual([]);
  });

  it("a full hand: unchanged, CardOffered, true", () => {
    const p = player(["a", "b", "c", "d", "e"]);
    const events: RunEvent[] = [];
    expect(gainCard(p, "f", events)).toBe(true);
    expect(p.cards).toEqual(["a", "b", "c", "d", "e"]);
    expect(events).toEqual([{ type: "CardOffered", card: "f" }]);
  });
});

describe("items", () => {
  it("itemCard: weapon id, accessory grant, otherwise null", () => {
    const pack = rewardsPack();
    expect(itemCard(pack.byId.get("weapon.spear"))).toBe("weapon.spear");
    expect(itemCard(pack.byId.get("accessory.charm"))).toBe("skill.granted");
    expect(itemCard(pack.byId.get("accessory.ring"))).toBeNull();
    expect(itemCard(pack.byId.get("armor.mail"))).toBeNull();
    expect(itemCard(undefined)).toBeNull();
  });

  it("equipItem throws RangeError for an id that isn't an item of that slot, and changes nothing", () => {
    const ctx = rewardsCtx({ pool: [SPEAR, MAIL, CHARM, GRANTED, C1, C2] });
    const run = startRewardsRun(ctx);
    const before = snapshot(run);
    expect(() => equipItem(ctx.pack, run, "armor", "weapon.spear", [])).toThrow(RangeError);
    expect(() => equipItem(ctx.pack, run, "weapon", "weapon.nope", [])).toThrow(RangeError);
    expect(snapshot(run)).toEqual(before);
  });

  it("loadoutTotals matches assembly's max HP", () => {
    const pack = rewardsPack();
    for (const armor of ["armor.plain", "armor.mail", "armor.bulwark", "armor.crushing"]) {
      const picks = { ...REWARD_PICKS, armor };
      const a = assemblePlayer(pack, picks, null);
      expect(loadoutTotals(pack, picks, a.baseStats).maxHp).toBe(a.unit.maxHp);
    }
  });
});

describe("levelUpOptions", () => {
  it("favoured first, never the same stat twice, and only stats below the cap", () => {
    for (const seed of ["1", "2", "3", "4", "5", "6"]) {
      const options = levelUpOptions(["arcana"], { ...block(7), arcana: 3, wisdom: 2 }, createRng(seed));
      expect(options).toEqual(["arcana", "wisdom"]);
    }
  });

  it("nothing eligible: [] without drawing", () => {
    const rng = createRng("n");
    const before = rng.state();
    expect(levelUpOptions(["might"], block(7), rng)).toEqual([]);
    expect(rng.state()).toEqual(before);
  });

  it("levelsUp: elite and boss only", () => {
    expect(levelsUp("normal")).toBe(false);
    expect(levelsUp("hard")).toBe(false);
    expect(levelsUp("elite")).toBe(true);
    expect(levelsUp("boss")).toBe(true);
  });
});

describe("events don't share objects with the run state", () => {
  it("RewardsOffered and RewardTaken carry copies of the options", () => {
    const ctx = rewardsCtx({ table: table({ kinds: { crowns: 1 } }) });
    const run = startRewardsRun(ctx);
    const events = toRewards(ctx, run, "normal");
    const offered = events.find((e) => e.type === "RewardsOffered");
    if (offered?.type !== "RewardsOffered") throw new Error("no RewardsOffered");
    expect(offered.options).toEqual(screen(run));
    expect(offered.options[0]).not.toBe(screen(run)[0]);
    const taken = ok(takeReward(ctx, run, 0)).find((e) => e.type === "RewardTaken");
    expect(taken).toBeDefined();
  });
});
