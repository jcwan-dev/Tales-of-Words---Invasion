import { describe, expect, it } from "vitest";
import { GROUP_TIERS, validatePack, type ContentFile, type ValidationResult } from "../src/index.ts";

// Spec Draft 1.10, "Combat node" (decided 12 Oct 2026); brief M2.3, "Public API":
//   enemy (id `enemy.<name>`): name key; stats optional (missing stats are 2); hp = max HP, integer >= 1; shield
//     optional integer >= 0; powers, traits optional (as on items); statuses optional, status id → starting stacks;
//     moves: at least 1, each { id, weight > 0, cooldown integer >= 0, effects (as in skills), intent key }, move ids
//     unique within the enemy.
//   group (id `group.<name>`): tier normal | hard | elite | boss; enemies: 1 to 3 enemy ids (repeats allowed);
//     text: a story text key.
//   act: `groups` optional, group ids of this pack (a boss-tier group may be listed; it is never drawn);
//     `tiers` optional, a list of bands { from, weights }: the first from = 1, `from` strictly increasing
//     integers, weights non-negative integers with at least one > 0 per band, keys normal / hard / elite only.
//   Fixed combat nodes: nothing new in validation (the module checks the ref when it builds).
// Brief clarifications 4–8 (spec "Combat node", Details): enemy stats integers >= 0; starting stacks integers >= 1;
//   move weight integer >= 1, cooldown integer >= 0; move id ^[a-z][a-z0-9_]*$, unique within the enemy; an act has
//   groups and tiers together or neither; tiers non-empty; no duplicate id in groups; every groups id a group.

type Obj = Record<string, unknown>;

const strip = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const MOVE: Obj = {
  id: "hit",
  weight: 1,
  cooldown: 0,
  effects: [{ type: "damage", damageType: "physical", amount: 3, target: "enemy" }],
  intent: "enemy.e.hit.intent",
};

/** An enemy; `over` replaces whole fields, `undefined` drops one. */
const enemy = (id: string, over: Obj = {}, path = `${id}.json`): ContentFile => ({
  path,
  data: strip({ kind: "enemy", id, name: `${id}.name`, hp: 10, moves: [MOVE], ...over }),
});

const group = (id: string, over: Obj = {}, path = `${id}.json`): ContentFile => ({
  path,
  data: strip({ kind: "group", id, name: `${id}.name`, tier: "normal", enemies: ["enemy.e"], text: `${id}.text`, ...over }),
});

const act = (id: string, over: Obj = {}, path = `${id}.json`): ContentFile => ({
  path,
  data: strip({
    kind: "act",
    id,
    name: `${id}.name`,
    steps: { min: 3, max: 5 },
    weights: { event: 50, combat: 35, merchant: 15 },
    fixed: [{ at: "last", type: "combat", ref: "group.boss" }],
    ...over,
  }),
});

/** The default enemy and groups other files can refer to. */
const BASE: readonly ContentFile[] = [
  enemy("enemy.e"),
  group("group.g"),
  group("group.h", { tier: "hard" }),
  group("group.boss", { tier: "boss" }),
];

const check = (...files: ContentFile[]): ValidationResult => validatePack("test", [...BASE, ...files]);

const fieldIssues = (res: ValidationResult, file: string, field: string): string[] =>
  res.issues.filter((i) => i.path.startsWith(`${file}#${field}`)).map((i) => `${i.path} ${i.message}`);

function expectValid(res: ValidationResult): void {
  expect(res.issues).toEqual([]);
  expect(res.pack).toBeDefined();
}

/** Some issue in `file`, whatever the field. */
function expectFileIssue(res: ValidationResult, file: string): void {
  expect(res.issues.some((i) => i.path.startsWith(`${file}#`))).toBe(true);
  expect(res.pack).toBeUndefined();
}

function expectIssue(res: ValidationResult, file: string, field: string): void {
  expect(fieldIssues(res, file, field).length).toBeGreaterThan(0);
  expect(res.pack).toBeUndefined();
}

/** One enemy in "x.json". */
const oneEnemy = (over: Obj): ValidationResult => check(enemy("enemy.x", over, "x.json"));
/** One group in "x.json". */
const oneGroup = (over: Obj): ValidationResult => check(group("group.x", over, "x.json"));
/** One act in "x.json". */
const oneAct = (over: Obj): ValidationResult => check(act("act.x", over, "x.json"));
/** One enemy with moves `moves`. */
const withMoves = (...moves: Obj[]): ValidationResult => oneEnemy({ moves });
const moveWith = (over: Obj): Obj => strip({ ...MOVE, ...over });

describe("GROUP_TIERS", () => {
  it("lists normal, hard, elite and boss", () => {
    expect([...GROUP_TIERS].sort()).toEqual(["boss", "elite", "hard", "normal"]);
  });
});

describe("enemy validation", () => {
  it("accepts a minimal enemy (name, hp, one move) and puts it in the pack", () => {
    const res = oneEnemy({});
    expectValid(res);
    expect(res.pack?.byId.get("enemy.x")).toMatchObject({ kind: "enemy", id: "enemy.x", hp: 10 });
  });

  it("accepts every optional field: stats, shield, powers, traits, statuses, several moves", () => {
    expectValid(
      oneEnemy({
        stats: { might: 4, agility: 1, wisdom: 5 },
        shield: 6,
        powers: { bleedPower: 1, stunPower: 2 },
        traits: { decayFloors: { thorns: 1 }, converts: [{ on: "attacked", gain: "thorns", stacks: 1 }] },
        statuses: { thorns: 2, warded: 1 },
        moves: [MOVE, moveWith({ id: "guard", weight: 2, cooldown: 3, effects: [{ type: "restoreShield", amount: 4, target: "self" }] })],
      }),
    );
  });

  it("accepts shield 0 and cooldown 0", () => {
    expectValid(oneEnemy({ shield: 0, moves: [moveWith({ cooldown: 0, weight: 5 })] }));
  });

  it("requires the id prefix enemy.", () => {
    expectIssue(check(enemy("foe.x", {}, "x.json")), "x.json", "id");
  });

  it("requires a name", () => {
    expectIssue(oneEnemy({ name: undefined }), "x.json", "name");
  });

  it("requires hp, an integer >= 1", () => {
    expectIssue(oneEnemy({ hp: undefined }), "x.json", "hp");
    expectIssue(oneEnemy({ hp: 0 }), "x.json", "hp");
    expectIssue(oneEnemy({ hp: 2.5 }), "x.json", "hp");
    expectIssue(oneEnemy({ hp: "10" }), "x.json", "hp");
    expectValid(oneEnemy({ hp: 1 }));
  });

  it("rejects a negative or fractional shield", () => {
    expectIssue(oneEnemy({ shield: -1 }), "x.json", "shield");
    expectIssue(oneEnemy({ shield: 1.5 }), "x.json", "shield");
  });

  it("rejects unknown stats and non-integer stat values", () => {
    expectIssue(oneEnemy({ stats: { strength: 3 } }), "x.json", "stats");
    expectIssue(oneEnemy({ stats: { might: 2.5 } }), "x.json", "stats");
  });

  it("requires stats to be >= 0 (they are values, not bonuses)", () => {
    expectIssue(oneEnemy({ stats: { agility: -1 } }), "x.json", "stats");
    expectValid(oneEnemy({ stats: { agility: 0, might: 9 } }));
  });

  it("checks powers and traits as on items", () => {
    expectIssue(oneEnemy({ powers: { rage: 1 } }), "x.json", "powers");
    expectIssue(oneEnemy({ powers: { bleedPower: -1 } }), "x.json", "powers");
    expectIssue(oneEnemy({ traits: { wings: true } }), "x.json", "traits");
    expectIssue(oneEnemy({ traits: { decayFloors: { madness: 1 } } }), "x.json", "traits");
  });

  it("rejects unknown status ids and bad stack counts in starting statuses", () => {
    expectIssue(oneEnemy({ statuses: { madness: 2 } }), "x.json", "statuses");
    expectIssue(oneEnemy({ statuses: { thorns: -1 } }), "x.json", "statuses");
    expectIssue(oneEnemy({ statuses: { thorns: 0 } }), "x.json", "statuses");
    expectIssue(oneEnemy({ statuses: { thorns: 1.5 } }), "x.json", "statuses");
    expectIssue(oneEnemy({ statuses: ["thorns"] }), "x.json", "statuses");
  });

  it("requires at least one move", () => {
    expectIssue(oneEnemy({ moves: undefined }), "x.json", "moves");
    expectIssue(oneEnemy({ moves: [] }), "x.json", "moves");
    expectIssue(oneEnemy({ moves: MOVE }), "x.json", "moves");
  });

  it("requires every move to have a non-empty id, unique within the enemy", () => {
    expectIssue(withMoves(moveWith({ id: undefined })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ id: "" })), "x.json", "moves");
    expectIssue(withMoves(MOVE, moveWith({ effects: [{ type: "heal", amount: 2, target: "self" }] })), "x.json", "moves");
    expectValid(withMoves(MOVE, moveWith({ id: "other" })));
  });

  it("requires a lowercase move id: [a-z][a-z0-9_]*", () => {
    for (const id of ["Hit", "1hit", "_hit", "hit-2", "hit.2", "hit 2"]) expectIssue(withMoves(moveWith({ id })), "x.json", "moves");
    expectValid(withMoves(moveWith({ id: "hit_2" })));
    expectValid(withMoves(moveWith({ id: "h" })));
  });

  it("allows the same move id on two different enemies", () => {
    expectValid(check(enemy("enemy.x", {}, "x.json"), enemy("enemy.y", {}, "y.json")));
  });

  it("requires a move weight above 0", () => {
    expectIssue(withMoves(moveWith({ weight: 0 })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ weight: -1 })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ weight: undefined })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ weight: "1" })), "x.json", "moves");
  });

  it("requires an integer move weight >= 1", () => {
    expectIssue(withMoves(moveWith({ weight: 0.5 })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ weight: 1.5 })), "x.json", "moves");
    expectValid(withMoves(moveWith({ weight: 1 })));
  });

  it("requires a move cooldown, an integer >= 0", () => {
    expectIssue(withMoves(moveWith({ cooldown: -1 })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ cooldown: 1.5 })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ cooldown: undefined })), "x.json", "moves");
    expectValid(withMoves(moveWith({ cooldown: 2 })));
  });

  it("requires move effects, checked as skill effects", () => {
    expectIssue(withMoves(moveWith({ effects: [] })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ effects: undefined })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ effects: [{ type: "explode", target: "enemy" }] })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ effects: [{ type: "status", status: "madness", stacks: 1, target: "enemy" }] })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ effects: [{ type: "damage", damageType: "fire", amount: 1, target: "enemy" }] })), "x.json", "moves");
  });

  it("requires a non-empty intent key on every move", () => {
    expectIssue(withMoves(moveWith({ intent: undefined })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ intent: "" })), "x.json", "moves");
    expectIssue(withMoves(moveWith({ intent: 3 })), "x.json", "moves");
  });
});

describe("group validation", () => {
  it("accepts a group of one enemy and puts it in the pack", () => {
    const res = oneGroup({});
    expectValid(res);
    expect(res.pack?.byId.get("group.x")).toMatchObject({ kind: "group", id: "group.x", tier: "normal", enemies: ["enemy.e"], text: "group.x.text" });
  });

  it("accepts every tier", () => {
    for (const tier of ["normal", "hard", "elite", "boss"]) expectValid(oneGroup({ tier }));
  });

  it("accepts three enemies, with repeats", () => {
    expectValid(check(enemy("enemy.f", {}, "f.json"), group("group.x", { enemies: ["enemy.e", "enemy.f", "enemy.e"] }, "x.json")));
    expectValid(oneGroup({ enemies: ["enemy.e", "enemy.e", "enemy.e"] }));
  });

  it("requires the id prefix group.", () => {
    expectIssue(check(group("pack.x", {}, "x.json")), "x.json", "id");
  });

  it("requires a name", () => {
    expectIssue(oneGroup({ name: undefined }), "x.json", "name");
  });

  it("rejects a missing or unknown tier", () => {
    expectIssue(oneGroup({ tier: undefined }), "x.json", "tier");
    expectIssue(oneGroup({ tier: "legendary" }), "x.json", "tier");
    expectIssue(oneGroup({ tier: "Normal" }), "x.json", "tier");
  });

  it("requires 1 to 3 enemies", () => {
    expectIssue(oneGroup({ enemies: undefined }), "x.json", "enemies");
    expectIssue(oneGroup({ enemies: [] }), "x.json", "enemies");
    expectIssue(oneGroup({ enemies: ["enemy.e", "enemy.e", "enemy.e", "enemy.e"] }), "x.json", "enemies");
    expectIssue(oneGroup({ enemies: "enemy.e" }), "x.json", "enemies");
  });

  it("rejects an enemy id that isn't an enemy in the pack", () => {
    expectIssue(oneGroup({ enemies: ["enemy.nobody"] }), "x.json", "enemies");
    expectIssue(oneGroup({ enemies: ["enemy.e", "group.g"] }), "x.json", "enemies");
  });

  it("requires a non-empty text key", () => {
    expectIssue(oneGroup({ text: undefined }), "x.json", "text");
    expectIssue(oneGroup({ text: "" }), "x.json", "text");
  });
});

describe("act validation: groups", () => {
  it("accepts an act without groups or tiers (as before)", () => {
    expectValid(oneAct({}));
  });

  it("accepts groups of this pack, a boss-tier group among them", () => {
    expectValid(oneAct({ groups: ["group.g", "group.h", "group.boss"], tiers: [{ from: 1, weights: { normal: 1 } }] }));
  });

  it("rejects groups that isn't an array of strings", () => {
    expectIssue(oneAct({ groups: "group.g", tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json", "groups");
    expectIssue(oneAct({ groups: [3], tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json", "groups");
  });

  it("rejects a group id that isn't a group in the pack", () => {
    expectIssue(oneAct({ groups: ["group.nope"], tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json", "groups");
    expectIssue(oneAct({ groups: ["group.g", "enemy.e"], tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json", "groups");
  });

  it("rejects a group id listed twice", () => {
    expectIssue(oneAct({ groups: ["group.g", "group.h", "group.g"], tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json", "groups");
  });

  it("requires groups and tiers together or neither", () => {
    expectFileIssue(oneAct({ groups: ["group.g"] }), "x.json");
    expectFileIssue(oneAct({ tiers: [{ from: 1, weights: { normal: 1 } }] }), "x.json");
    expectValid(oneAct({ groups: ["group.g"], tiers: [{ from: 1, weights: { normal: 1 } }] }));
  });

  it("doesn't check a fixed combat node's ref (the module does)", () => {
    expectValid(oneAct({ fixed: [{ at: 1, type: "combat", ref: "group.nope" }, { at: "last", type: "combat", ref: "enemy.e" }] }));
  });
});

describe("act validation: tiers", () => {
  const withTiers = (tiers: unknown): ValidationResult => oneAct({ groups: ["group.g", "group.h"], tiers });

  it("accepts bands from step 1 with increasing starts", () => {
    expectValid(
      withTiers([
        { from: 1, weights: { normal: 80, hard: 20 } },
        { from: 5, weights: { normal: 50, hard: 35, elite: 15 } },
        { from: 9, weights: { normal: 30, hard: 45, elite: 25 } },
      ]),
    );
  });

  it("accepts zero weights next to a positive one in a band", () => {
    expectValid(withTiers([{ from: 1, weights: { normal: 0, hard: 1, elite: 0 } }]));
  });

  it("rejects tiers that isn't an array, and tiers: []", () => {
    expectIssue(withTiers({ from: 1, weights: { normal: 1 } }), "x.json", "tiers");
    expectIssue(withTiers([]), "x.json", "tiers");
  });

  it("requires the first band to start at step 1", () => {
    expectIssue(withTiers([{ from: 2, weights: { normal: 1 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 0, weights: { normal: 1 } }, { from: 3, weights: { hard: 1 } }]), "x.json", "tiers");
  });

  it("requires from to be strictly increasing integers", () => {
    expectIssue(withTiers([{ from: 1, weights: { normal: 1 } }, { from: 1, weights: { hard: 1 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1 } }, { from: 5, weights: { hard: 1 } }, { from: 3, weights: { elite: 1 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1 } }, { from: 2.5, weights: { hard: 1 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ weights: { normal: 1 } }]), "x.json", "tiers");
  });

  it("requires non-negative integer weights", () => {
    expectIssue(withTiers([{ from: 1, weights: { normal: -1, hard: 2 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1.5 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: "1" } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1 }]), "x.json", "tiers");
  });

  it("requires at least one weight above 0 in every band", () => {
    expectIssue(withTiers([{ from: 1, weights: { normal: 0, hard: 0 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: {} }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1 } }, { from: 4, weights: { elite: 0 } }]), "x.json", "tiers");
  });

  it("rejects a boss weight (boss groups are never drawn) and unknown tiers", () => {
    expectIssue(withTiers([{ from: 1, weights: { normal: 1, boss: 1 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1, boss: 0 } }]), "x.json", "tiers");
    expectIssue(withTiers([{ from: 1, weights: { normal: 1, legendary: 1 } }]), "x.json", "tiers");
  });
});
