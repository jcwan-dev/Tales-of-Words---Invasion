import { describe, expect, it } from "vitest";
import { RARITIES, REWARD_KINDS, validatePack, type ContentFile, type ValidationResult } from "../src/index.ts";
import { BASE_FILES } from "./combat/base-pack.ts";

// Spec Draft 1.11, "Rewards and level-ups" (Act data; After-fight flow, "Tables"); brief M2.4b, "Public API":
//   RewardKind = "skill" | "item" | "crowns" (REWARD_KINDS exported).
//   ActDef gains `rewards?`: tier (normal / hard / elite / boss) → table { kinds, rarity, crowns }:
//     kinds: reward kind → non-negative integer, at least one > 0;
//     rarity: grey..orange → non-negative integer, at least one > 0;
//     crowns: { min, max } integers, 0 ≤ min ≤ max, no other keys.
//   An act that can fight (it has `groups`, or a fixed node whose `ref` is a def of kind `group`) needs a table for
//   all four tiers. No unknown keys at any level.
// Base content (brief "Content"): Act I has tables for all four tiers; Act I leans grey to blue; elite fights draw
//   from higher rarities than normal and hard fights (spec "Act data").

type Obj = Record<string, unknown>;

const strip = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const TABLE: Obj = { kinds: { skill: 35, item: 25, crowns: 40 }, rarity: { grey: 60, green: 30, blue: 10 }, crowns: { min: 15, max: 30 } };
const ALL_TIERS: Obj = { normal: TABLE, hard: TABLE, elite: TABLE, boss: TABLE };

const MOVE: Obj = { id: "hit", weight: 1, cooldown: 0, effects: [{ type: "damage", damageType: "physical", amount: 3, target: "enemy" }], intent: "enemy.e.hit.intent" };

/** The enemy and groups acts can refer to: normal g, hard h, elite e, boss b. */
const SUPPORT: readonly ContentFile[] = [
  { path: "enemy.e.json", data: { kind: "enemy", id: "enemy.e", name: "enemy.e.name", hp: 10, moves: [MOVE] } },
  ...(
    [
      ["group.g", "normal"],
      ["group.h", "hard"],
      ["group.e", "elite"],
      ["group.b", "boss"],
    ] as const
  ).map(([id, tier]): ContentFile => ({ path: `${id}.json`, data: { kind: "group", id, name: `${id}.name`, tier, enemies: ["enemy.e"], text: `${id}.text` } })),
];

/** An act with groups g and h (normal, hard), the boss b last, tiers and rewards for every tier. `over` replaces whole fields. */
const act = (over: Obj = {}): ContentFile => ({
  path: "a.json",
  data: strip({
    kind: "act",
    id: "act.a",
    name: "act.a.name",
    steps: { min: 3, max: 5 },
    weights: { event: 50, combat: 35, merchant: 15 },
    fixed: [{ at: "last", type: "combat", ref: "group.b" }],
    groups: ["group.g", "group.h"],
    tiers: [{ from: 1, weights: { normal: 1, hard: 1 } }],
    rewards: ALL_TIERS,
    ...over,
  }),
});

/** The act with rewards.normal replaced by `t` (the other tiers stay valid). */
const withNormal = (t: unknown): ContentFile => act({ rewards: { ...ALL_TIERS, normal: t } });

const check = (...files: ContentFile[]): ValidationResult => validatePack("test", [...SUPPORT, ...files]);

const fieldIssues = (res: ValidationResult, file: string, field: string): string[] =>
  res.issues.filter((i) => i.path.startsWith(`${file}#${field}`)).map((i) => `${i.path} ${i.message}`);

function expectValid(res: ValidationResult): void {
  expect(res.issues).toEqual([]);
  expect(res.pack).toBeDefined();
}

function expectIssue(res: ValidationResult, file: string, field: string): void {
  expect(fieldIssues(res, file, field).length).toBeGreaterThan(0);
  expect(res.pack).toBeUndefined();
}

/** A fixed list of tiers without one. */
const without = (tier: string): Obj => Object.fromEntries(Object.entries(ALL_TIERS).filter(([t]) => t !== tier));

describe("reward kinds", () => {
  it("exports REWARD_KINDS: skill, item, crowns (the relic card is not a table kind)", () => {
    expect([...REWARD_KINDS].sort()).toEqual(["crowns", "item", "skill"]);
    expect([...RARITIES]).toEqual(["grey", "green", "blue", "purple", "orange"]);
  });
});

// =============================================================================================
// The table

describe("act rewards: the table", () => {
  it("accepts a valid table for every tier and keeps it on the act", () => {
    const res = check(act());
    expectValid(res);
    expect(res.pack?.byId.get("act.a")).toMatchObject({ rewards: { normal: TABLE, hard: TABLE, elite: TABLE, boss: TABLE } });
  });

  it("accepts every rarity, weights of 0 next to a positive one, absent kinds and rarities, a single-value purse and 0", () => {
    expectValid(check(withNormal({ kinds: { skill: 0, item: 0, crowns: 1 }, rarity: { orange: 1 }, crowns: { min: 0, max: 0 } })));
    expectValid(check(withNormal({ kinds: { item: 3 }, rarity: { grey: 0, green: 2, purple: 0 }, crowns: { min: 7, max: 7 } })));
    expectValid(check(withNormal({ kinds: { skill: 1, item: 1, crowns: 1 }, rarity: { grey: 1, green: 1, blue: 1, purple: 1, orange: 1 }, crowns: { min: 0, max: 100 } })));
  });

  it("rejects rewards that isn't an object of tier → table", () => {
    for (const r of ["x", 3, [TABLE], null]) expectIssue(check(act({ rewards: r })), "a.json", "rewards");
  });

  it("rejects an unknown tier key", () => {
    expectIssue(check(act({ rewards: { ...ALL_TIERS, legendary: TABLE } })), "a.json", "rewards");
    expectIssue(check(act({ rewards: { ...ALL_TIERS, Boss: TABLE } })), "a.json", "rewards");
  });

  it("rejects a table that isn't an object", () => {
    for (const t of ["x", 3, null, [TABLE]]) expectIssue(check(withNormal(t)), "a.json", "rewards");
  });

  it("rejects a table missing kinds, rarity or crowns", () => {
    expectIssue(check(withNormal(strip({ ...TABLE, kinds: undefined }))), "a.json", "rewards");
    expectIssue(check(withNormal(strip({ ...TABLE, rarity: undefined }))), "a.json", "rewards");
    expectIssue(check(withNormal(strip({ ...TABLE, crowns: undefined }))), "a.json", "rewards");
  });

  it("rejects unknown keys in a table", () => {
    expectIssue(check(withNormal({ ...TABLE, levelUp: true })), "a.json", "rewards");
    expectIssue(check(withNormal({ ...TABLE, relic: 1 })), "a.json", "rewards");
  });

  it("kinds: unknown kinds (relic included), negative or non-integer weights, all zero, empty, not an object", () => {
    for (const kinds of [{ skill: 1, relic: 1 }, { skill: 1, word: 1 }, { skill: -1, item: 1 }, { skill: 1.5 }, { skill: "1" }, { skill: null }, { skill: 0, item: 0, crowns: 0 }, {}, "skill", [1], null]) {
      expectIssue(check(withNormal({ ...TABLE, kinds })), "a.json", "rewards");
    }
  });

  it("rarity: unknown rarities (the old common/uncommon/rare), negative or non-integer weights, all zero, empty, not an object", () => {
    for (const rarity of [
      { grey: 1, common: 1 },
      { uncommon: 1 },
      { rare: 1 },
      { Grey: 1 },
      { grey: -2, blue: 1 },
      { orange: 0.5 },
      { grey: null },
      { grey: "1" },
      { grey: 0, green: 0, blue: 0, purple: 0, orange: 0 },
      {},
      "grey",
      [1],
      null,
    ]) {
      expectIssue(check(withNormal({ ...TABLE, rarity })), "a.json", "rewards");
    }
  });

  it("crowns: integers with 0 ≤ min ≤ max", () => {
    for (const crowns of [{ min: -1, max: 5 }, { min: 6, max: 5 }, { min: 1.5, max: 5 }, { min: 1, max: 5.5 }, { min: 1 }, { max: 5 }, { min: "1", max: 5 }, {}, 10, null, [1, 5]]) {
      expectIssue(check(withNormal({ ...TABLE, crowns })), "a.json", "rewards");
    }
  });

  it("crowns: no other keys", () => {
    expectIssue(check(withNormal({ ...TABLE, crowns: { min: 1, max: 5, step: 1 } })), "a.json", "rewards");
    expectIssue(check(withNormal({ ...TABLE, crowns: { min: 1, max: 5, Max: 6 } })), "a.json", "rewards");
  });

  it("every tier's table is checked, not just the first", () => {
    expectIssue(check(act({ rewards: { ...ALL_TIERS, boss: { ...TABLE, kinds: {} } } })), "a.json", "rewards");
    expectIssue(check(act({ rewards: { ...ALL_TIERS, hard: { ...TABLE, crowns: { min: 3, max: 1 } } } })), "a.json", "rewards");
    expectIssue(check(act({ rewards: { ...ALL_TIERS, elite: { ...TABLE, rarity: { violet: 1 } } } })), "a.json", "rewards");
  });
});

// =============================================================================================
// Which acts need tables

describe("act rewards: acts that can fight need all four tiers", () => {
  it("an act with groups needs rewards", () => {
    expectIssue(check(act({ rewards: undefined })), "a.json", "rewards");
  });

  it("an act with groups needs a table for all four tiers, whatever tiers its groups have", () => {
    // Groups g (normal) and h (hard) only: elite and boss are still required.
    for (const missing of ["normal", "hard", "elite", "boss"]) expectIssue(check(act({ rewards: without(missing) })), "a.json", "rewards");
    expectIssue(check(act({ rewards: { normal: TABLE, hard: TABLE } })), "a.json", "rewards");
    expectIssue(check(act({ rewards: {} })), "a.json", "rewards");
    expectValid(check(act({ rewards: ALL_TIERS })));
  });

  it("an act without groups whose fixed node's ref is a group needs all four tiers", () => {
    const fights = { groups: undefined, tiers: undefined, fixed: [{ at: "last", type: "combat", ref: "group.b" }] };
    expectIssue(check(act({ ...fights, rewards: undefined })), "a.json", "rewards");
    expectIssue(check(act({ ...fights, rewards: { boss: TABLE } })), "a.json", "rewards");
    for (const missing of ["normal", "hard", "elite", "boss"]) expectIssue(check(act({ ...fights, rewards: without(missing) })), "a.json", "rewards");
    expectValid(check(act({ ...fights, rewards: ALL_TIERS })));
  });

  it("decided by the ref's kind, whatever the node type, the step or the group's tier", () => {
    const base = { groups: undefined, tiers: undefined };
    expectIssue(check(act({ ...base, fixed: [{ at: 1, type: "event", ref: "group.g" }, { at: "last", type: "merchant" }], rewards: undefined })), "a.json", "rewards");
    expectIssue(check(act({ ...base, fixed: [{ at: 2, type: "combat", ref: "group.e" }, { at: "last", type: "event", ref: "event.end" }], rewards: undefined })), "a.json", "rewards");
  });

  it("an act that can't fight (no groups, no fixed ref naming a group) may leave rewards out, or give some tiers only", () => {
    // Brief: only acts that can fight need all four tiers; tables given are still checked (next test).
    const noFight = { groups: undefined, tiers: undefined, fixed: [{ at: "last", type: "event", ref: "event.finale" }] };
    expectValid(check(act({ ...noFight, rewards: undefined })));
    expectValid(check(act({ ...noFight, rewards: { elite: TABLE } })));
    expectValid(check(act({ ...noFight, rewards: ALL_TIERS })));
    // A ref naming nothing in the pack, or another kind, or no ref: the act still can't fight.
    expectValid(check(act({ ...noFight, fixed: [{ at: "last", type: "combat", ref: "group.missing" }], rewards: undefined })));
    expectValid(check(act({ ...noFight, fixed: [{ at: "last", type: "combat", ref: "enemy.e" }], rewards: undefined })));
    expectValid(check(act({ ...noFight, fixed: [{ at: "last", type: "merchant" }], rewards: undefined })));
  });

  it("an act that can't fight still has its tables checked", () => {
    const noFight = { groups: undefined, tiers: undefined, fixed: [{ at: "last", type: "event", ref: "event.finale" }] };
    expectIssue(check(act({ ...noFight, rewards: { elite: { ...TABLE, kinds: {} } } })), "a.json", "rewards");
    expectIssue(check(act({ ...noFight, rewards: { mythic: TABLE } })), "a.json", "rewards");
    expectIssue(check(act({ ...noFight, rewards: "lots" })), "a.json", "rewards");
  });
});

// =============================================================================================
// Base content

describe("base pack: Act I reward tables", () => {
  const res = validatePack("base", BASE_FILES);
  const actOne = () => {
    const def = res.pack?.byId.get("act.drowned_marches");
    if (def?.kind !== "act") throw new Error("no Act I");
    return def;
  };
  /** The table's mean rarity rank (grey 0 .. orange 4). */
  const meanRank = (tier: "normal" | "hard" | "elite" | "boss"): number => {
    const r = actOne().rewards?.[tier]?.rarity ?? {};
    let total = 0;
    let sum = 0;
    RARITIES.forEach((rarity, rank) => {
      const w = r[rarity] ?? 0;
      total += w;
      sum += w * rank;
    });
    return total === 0 ? 0 : sum / total;
  };

  it("validates", () => {
    expect(res.issues).toEqual([]);
  });

  it("Act I has a table for normal, hard, elite and boss, each offering skills, items and purses", () => {
    for (const tier of ["normal", "hard", "elite", "boss"] as const) {
      const t = actOne().rewards?.[tier];
      expect([tier, t !== undefined]).toEqual([tier, true]);
      expect(t?.kinds.skill ?? 0).toBeGreaterThan(0);
      expect(t?.kinds.item ?? 0).toBeGreaterThan(0);
      expect(t?.kinds.crowns ?? 0).toBeGreaterThan(0);
      expect(t?.crowns.max ?? 0).toBeGreaterThan(0);
    }
  });

  it("Act I's normal and hard fights lean grey to blue (no purple or orange)", () => {
    for (const tier of ["normal", "hard"] as const) {
      const r = actOne().rewards?.[tier]?.rarity ?? {};
      expect([tier, r.purple ?? 0, r.orange ?? 0]).toEqual([tier, 0, 0]);
    }
  });

  it("elite fights draw from higher rarities than normal and hard fights; the boss too", () => {
    expect(meanRank("elite")).toBeGreaterThan(meanRank("normal"));
    expect(meanRank("elite")).toBeGreaterThan(meanRank("hard"));
    expect(meanRank("boss")).toBeGreaterThan(meanRank("normal"));
  });

  it("the base pack has relics for the boss card and enough skills and Words for a 5-card screen", () => {
    const defs = [...(res.pack?.byId.values() ?? [])];
    expect(defs.filter((d) => d.kind === "relic").length).toBeGreaterThan(0);
    expect(defs.filter((d) => d.kind === "skill" || d.kind === "word").length).toBeGreaterThanOrEqual(5);
  });
});
