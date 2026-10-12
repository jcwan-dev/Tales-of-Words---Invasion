import { describe, expect, it } from "vitest";
import { RARITIES, REWARD_KINDS, validatePack, type ContentFile, type ValidationResult } from "../src/index.ts";
import { BASE_FILES } from "./combat/base-pack.ts";

// Spec Draft 1.11, "Rewards, items and level-ups"; brief M2.4, "Public API" and "Content":
//   Skills, Words, weapons, armor and accessories gain an optional `rarity`: "common" | "uncommon" | "rare"
//     (default common). RARITIES and REWARD_KINDS ("skill" | "item" | "crowns") are exported.
//   An act gains `rewards`: tier (normal / hard / elite / boss) → table { kinds, rarity, crowns }:
//     kinds: reward kind → non-negative integer, at least one > 0; rarity: rarity → non-negative integer, at least
//     one > 0; crowns: { min, max } integers with 0 ≤ min ≤ max. No unknown keys.
//   If the act has `groups`, `rewards` is required, with an entry for all four tiers (brief clarification 5; spec
//     "Details"). Acts without groups may leave `rewards` out or give some tiers only.
// Base content: Act I has rewards for normal, hard, elite and boss; elite and boss lean to better rarities; a few
//   skills, Words or items are uncommon or rare.

type Obj = Record<string, unknown>;

const strip = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const TABLE: Obj = { kinds: { skill: 35, item: 25, crowns: 40 }, rarity: { common: 85, uncommon: 15 }, crowns: { min: 15, max: 30 } };
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

/** An act with groups g and h (normal, hard), tiers and rewards for every tier. `over` replaces whole fields. */
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

// =============================================================================================
// Rarity

describe("rarity", () => {
  it("exports RARITIES and REWARD_KINDS", () => {
    expect([...RARITIES]).toEqual(["common", "uncommon", "rare"]);
    expect([...REWARD_KINDS].sort()).toEqual(["crowns", "item", "skill"]);
  });

  const files: Record<string, (rarity: unknown) => ContentFile> = {
    skill: (rarity) => ({
      path: "x.json",
      data: strip({ kind: "skill", id: "skill.x", name: "n", cooldown: 1, effects: [{ type: "heal", amount: 1, target: "self" }], rarity }),
    }),
    word: (rarity) => ({
      path: "x.json",
      data: strip({ kind: "word", id: "word.x", name: "n", glyph: "火", spoken: "Huo", meaning: "m", cooldown: 1, effects: [{ type: "heal", amount: 1, target: "self" }], rarity }),
    }),
    weapon: (rarity) => ({ path: "x.json", data: strip({ kind: "weapon", id: "weapon.x", name: "n", attack: { damage: 1, damageType: "physical", scaling: [] }, rarity }) }),
    armor: (rarity) => ({ path: "x.json", data: strip({ kind: "armor", id: "armor.x", name: "n", rarity }) }),
    accessory: (rarity) => ({ path: "x.json", data: strip({ kind: "accessory", id: "accessory.x", name: "n", rarity }) }),
  };

  for (const [kind, make] of Object.entries(files)) {
    it(`${kind}: accepts every rarity, and no rarity (common by default)`, () => {
      for (const r of ["common", "uncommon", "rare", undefined]) {
        const res = check(make(r));
        expectValid(res);
        const def = [...(res.pack?.byId.values() ?? [])].find((d) => d.kind === kind);
        expect(def).toBeDefined();
      }
    });

    it(`${kind}: rejects an unknown or malformed rarity`, () => {
      for (const r of ["epic", "Common", "", 1, null, ["rare"]]) expectIssue(check(make(r)), "x.json", "rarity");
    });
  }
});

// =============================================================================================
// Act rewards

describe("act rewards: the table", () => {
  it("accepts a valid table for every tier", () => {
    const res = check(act());
    expectValid(res);
    expect(res.pack?.byId.get("act.a")).toMatchObject({ rewards: { normal: TABLE, elite: TABLE, boss: TABLE } });
  });

  it("accepts weights of 0 next to a positive one, absent kinds and rarities, and a purse range of a single value or 0", () => {
    expectValid(check(withNormal({ kinds: { skill: 0, item: 0, crowns: 1 }, rarity: { rare: 1 }, crowns: { min: 0, max: 0 } })));
    expectValid(check(withNormal({ kinds: { item: 3 }, rarity: { common: 0, uncommon: 2 }, crowns: { min: 7, max: 7 } })));
  });

  it("rejects rewards that isn't an object of tier → table", () => {
    for (const r of ["x", 3, [TABLE], null]) expectIssue(check(act({ rewards: r })), "a.json", "rewards");
  });

  it("rejects an unknown tier key", () => {
    expectIssue(check(act({ rewards: { ...ALL_TIERS, legendary: TABLE } })), "a.json", "rewards");
  });

  it("rejects a table that isn't an object", () => {
    for (const t of ["x", 3, null, [TABLE]]) expectIssue(check(withNormal(t)), "a.json", "rewards");
  });

  it("rejects missing kinds, rarity or crowns", () => {
    expectIssue(check(withNormal({ ...TABLE, kinds: undefined })), "a.json", "rewards");
    expectIssue(check(withNormal(strip({ ...TABLE, kinds: undefined }))), "a.json", "rewards");
    expectIssue(check(withNormal(strip({ ...TABLE, rarity: undefined }))), "a.json", "rewards");
    expectIssue(check(withNormal(strip({ ...TABLE, crowns: undefined }))), "a.json", "rewards");
  });

  it("rejects unknown keys in a table", () => {
    expectIssue(check(withNormal({ ...TABLE, levelUp: true })), "a.json", "rewards");
  });

  it("kinds: unknown kinds, negative or non-integer weights, all zero, not an object", () => {
    for (const kinds of [{ skill: 1, relic: 1 }, { skill: -1, item: 1 }, { skill: 1.5 }, { skill: "1" }, { skill: 0, item: 0, crowns: 0 }, {}, "skill", [1]]) {
      expectIssue(check(withNormal({ ...TABLE, kinds })), "a.json", "rewards");
    }
  });

  it("rarity: unknown rarities, negative or non-integer weights, all zero, not an object", () => {
    for (const rarity of [{ common: 1, epic: 1 }, { common: -2, rare: 1 }, { rare: 0.5 }, { common: null }, { common: 0, uncommon: 0, rare: 0 }, {}, "common", [1]]) {
      expectIssue(check(withNormal({ ...TABLE, rarity })), "a.json", "rewards");
    }
  });

  it("crowns: integers with 0 ≤ min ≤ max", () => {
    for (const crowns of [{ min: -1, max: 5 }, { min: 6, max: 5 }, { min: 1.5, max: 5 }, { min: 1, max: 5.5 }, { min: 1 }, { max: 5 }, { min: "1", max: 5 }, 10, null]) {
      expectIssue(check(withNormal({ ...TABLE, crowns })), "a.json", "rewards");
    }
  });

  it("every tier's table is checked, not just one", () => {
    expectIssue(check(act({ rewards: { ...ALL_TIERS, boss: { ...TABLE, kinds: {} } } })), "a.json", "rewards");
    expectIssue(check(act({ rewards: { ...ALL_TIERS, hard: { ...TABLE, crowns: { min: 3, max: 1 } } } })), "a.json", "rewards");
  });
});

describe("act rewards: which tiers are required", () => {
  it("an act without groups may leave rewards out, or give some tiers only", () => {
    expectValid(check(act({ groups: undefined, tiers: undefined, rewards: undefined })));
    expectValid(check(act({ groups: undefined, tiers: undefined, rewards: { elite: TABLE } })));
  });

  it("an act with groups needs rewards", () => {
    expectIssue(check(act({ rewards: undefined })), "a.json", "rewards");
  });

  it("needs a table for all four tiers, whatever tiers its groups have (clarification 5)", () => {
    // Groups g (normal) and h (hard) only: elite and boss are still required.
    for (const missing of ["normal", "hard", "elite", "boss"]) {
      const rewards = Object.fromEntries(Object.entries(ALL_TIERS).filter(([tier]) => tier !== missing));
      expectIssue(check(act({ rewards })), "a.json", "rewards");
    }
    expectIssue(check(act({ rewards: { normal: TABLE, hard: TABLE } })), "a.json", "rewards");
    expectValid(check(act({ rewards: ALL_TIERS })));
  });

  it("the same with boss and elite groups listed", () => {
    const groups = ["group.g", "group.e", "group.b"];
    const tiers = [{ from: 1, weights: { normal: 1, elite: 1 } }];
    expectIssue(check(act({ groups, tiers, rewards: { normal: TABLE, elite: TABLE, boss: TABLE } })), "a.json", "rewards");
    expectValid(check(act({ groups, tiers, rewards: ALL_TIERS })));
  });
});

// =============================================================================================
// Base content

describe("base pack: rewards content", () => {
  const res = validatePack("base", BASE_FILES);

  it("validates", () => {
    expect(res.issues).toEqual([]);
  });

  it("Act I has a reward table for normal, hard, elite and boss", () => {
    const actOne = res.pack?.byId.get("act.drowned_marches");
    if (actOne?.kind !== "act") throw new Error("no Act I");
    for (const tier of ["normal", "hard", "elite", "boss"] as const) expect(actOne.rewards?.[tier]).toBeDefined();
  });

  it("elite and boss tables lean to better rarities than the normal one", () => {
    const actOne = res.pack?.byId.get("act.drowned_marches");
    if (actOne?.kind !== "act") throw new Error("no Act I");
    const better = (tier: "normal" | "elite" | "boss"): number => {
      const r = actOne.rewards?.[tier]?.rarity ?? {};
      const total = (r.common ?? 0) + (r.uncommon ?? 0) + (r.rare ?? 0);
      return total === 0 ? 0 : ((r.uncommon ?? 0) + (r.rare ?? 0)) / total;
    };
    expect(better("elite")).toBeGreaterThan(better("normal"));
    expect(better("boss")).toBeGreaterThan(better("normal"));
  });

  it("some skills, Words or items are uncommon or rare; the pool can fill a 5-option skill screen", () => {
    const defs = [...(res.pack?.byId.values() ?? [])];
    const rarities = new Set(defs.map((d) => ("rarity" in d ? d.rarity : undefined)).filter((r) => r !== undefined));
    expect(rarities.has("uncommon")).toBe(true);
    expect(rarities.has("rare")).toBe(true);
    expect(defs.filter((d) => d.kind === "skill" || d.kind === "word").length).toBeGreaterThanOrEqual(5 + 5);
  });
});
