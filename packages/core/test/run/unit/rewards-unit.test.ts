import { describe, expect, it } from "vitest";
import {
  chooseOption,
  completeNode,
  createRng,
  drawRewardScreen,
  LEVEL_UP_TIERS,
  loadoutFinalStats,
  pickWeighted,
  RELIC_CARD_TIERS,
  startRun,
  takeReward,
  validatePack,
  type ContentPack,
  type RewardDrawInput,
  type RewardTableDef,
} from "../../../src/index.ts";
import { ok } from "../run-pack.ts";
import { HEART, ITEM_FILES, MIND, rsAct, rsCtx, rsFiles, rsRun, RS_PICKS, S1, S2, screen } from "../reward-screen-pack.ts";

// Builder unit tests for run/rewards (the pure draw), loadoutFinalStats, the generic pickWeighted and reward-table
// validation messages.

const pack = (): ContentPack => rsCtx().pack;

const TABLE: RewardTableDef = { kinds: { skill: 1, item: 1, crowns: 1 }, rarity: { grey: 1, green: 1, blue: 1 }, crowns: { min: 10, max: 20 } };

const input = (over: Partial<RewardDrawInput> = {}): RewardDrawInput => ({
  cards: ["weapon.club"],
  rarities: {},
  picks: RS_PICKS,
  relics: [],
  table: TABLE,
  bonus: 0,
  relicCard: false,
  ...over,
});

describe("drawRewardScreen", () => {
  it("is deterministic for the same rng seed and doesn't change its input", () => {
    const i = input({ bonus: 2 });
    const before = JSON.stringify(i);
    expect(drawRewardScreen(pack(), i, createRng("x"))).toEqual(drawRewardScreen(pack(), i, createRng("x")));
    expect(JSON.stringify(i)).toBe(before);
  });

  it("an empty pool and no purse weight give an empty screen", () => {
    const empty = validatePack("e", rsFiles({ skills: [], items: [], relics: [] }));
    if (!empty.pack) throw new Error("invalid");
    expect(drawRewardScreen(empty.pack, input({ table: { ...TABLE, kinds: { skill: 1, item: 1 } }, bonus: 2 }), createRng("x"))).toEqual([]);
  });

  it("the relic card only at position 3; without relicCard there is none", () => {
    for (let n = 0; n < 20; n++) {
      const withRelic = drawRewardScreen(pack(), input({ relicCard: true }), createRng(`r${n}`));
      expect(withRelic[2]?.kind).toBe("relic");
      expect(drawRewardScreen(pack(), input(), createRng(`r${n}`)).some((c) => c.kind === "relic")).toBe(false);
    }
  });

  it("bonus cards stop when no skill or Word is left", () => {
    const small = validatePack("s", rsFiles({ skills: [S1, S2], items: [] }));
    if (!small.pack) throw new Error("invalid");
    const cards = drawRewardScreen(small.pack, input({ table: { ...TABLE, kinds: { crowns: 1 } }, bonus: 5 }), createRng("b"));
    expect(cards.map((c) => c.kind)).toEqual(["crowns", "skill", "skill"]);
  });

  it("tier constants: boss has the relic card; elite and boss level up", () => {
    expect([...RELIC_CARD_TIERS]).toEqual(["boss"]);
    expect([...LEVEL_UP_TIERS].sort()).toEqual(["boss", "elite"]);
  });
});

describe("loadoutFinalStats", () => {
  it("adds item, path and relic modifiers to base stats", () => {
    const p = rsCtx({ items: [...ITEM_FILES], relics: [MIND, HEART] }).pack;
    const run = startRun({ pack: p, registry: rsCtx().registry }, { seed: "s", picks: { ...RS_PICKS, accessory: "accessory.ring" }, technique: null }).run;
    expect(loadoutFinalStats(p, run.picks, run.player.baseStats, []).intelligence).toBe(4);
    expect(loadoutFinalStats(p, run.picks, run.player.baseStats, ["relic.mind"]).intelligence).toBe(6);
    expect(() => loadoutFinalStats(p, run.picks, run.player.baseStats, ["relic.nope"])).toThrow(RangeError);
  });
});

describe("pickWeighted (generic)", () => {
  it("returns the item's own type", () => {
    const t: "a" | "b" = pickWeighted(createRng("w"), [
      { type: "a", weight: 1 },
      { type: "b", weight: 1 },
    ]);
    expect(["a", "b"]).toContain(t);
  });
});

describe("reward table validation messages", () => {
  const issuesFor = (rewards: unknown): string[] => {
    const res = validatePack("v", rsFiles({ acts: [rsAct("act.r", rewards as Record<string, unknown>)] }));
    return res.issues.map((i) => i.path);
  };

  it("names the field: unknown tier, kind, rarity, table and purse keys", () => {
    const t = { kinds: { skill: 1 }, rarity: { grey: 1 }, crowns: { min: 0, max: 1 } };
    expect(issuesFor({ legendary: t })).toContain("act.r.json#rewards.legendary");
    expect(issuesFor({ normal: { ...t, kinds: { relic: 1 } } })).toContain("act.r.json#rewards.normal.kinds.relic");
    expect(issuesFor({ normal: { ...t, rarity: { rare: 1 } } })).toContain("act.r.json#rewards.normal.rarity.rare");
    expect(issuesFor({ normal: { ...t, extra: 1 } })).toContain("act.r.json#rewards.normal.extra");
    expect(issuesFor({ normal: { ...t, crowns: { min: 0, max: 1, step: 1 } } })).toContain("act.r.json#rewards.normal.crowns.step");
  });
});

describe("the flow", () => {
  it("an upgrade card held at a lower rarity rises in place; the screen is gone afterwards", () => {
    const ctx = rsCtx({ table: { kinds: { skill: 1 }, rarity: { blue: 1 }, crowns: { min: 0, max: 0 } }, skills: [S1] });
    const { run } = rsRun(ctx, { hand: ["weapon.club", "skill.s1"] });
    expect(screen(run)).toEqual([{ kind: "skill", id: "skill.s1", rarity: "blue", upgrade: true }]);
    ok(takeReward(ctx, run, 0));
    expect(run.player.rarities["skill.s1"]).toBe("blue");
    expect(run.rewards).toBeNull();
  });

  it("a rewardTier like an Object prototype key is refused, not looked up", () => {
    const ctx = rsCtx();
    const run = startRun(ctx, { seed: "p", picks: RS_PICKS, technique: null }).run;
    ok(chooseOption(ctx, run, 0));
    for (const t of ["constructor", "__proto__", "toString"]) {
      const res = completeNode(ctx, run, { rewardTier: t as unknown as "normal" });
      expect(res.ok ? "accepted" : res.reason).toBe("invalid_result");
    }
  });
});
