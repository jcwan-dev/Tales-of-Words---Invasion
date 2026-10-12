import { describe, expect, it } from "vitest";
import { RARITIES, validatePack, type ContentFile, type ValidationResult } from "../src/index.ts";
import { basePack } from "./combat/base-pack.ts";

// Spec Draft 1.11, "Rewards and level-ups": "A relic (content kind `relic`) is a passive held for the rest of the run
//   with no slot limit: stats, powers, traits, starting statuses in every fight, HP or Shield (e.g. Pilgrim's Bell:
//   start every fight Warded 1)."
// Spec Draft 1.11, "Rarity": "items and paths (later companions) can name cards to start at a higher rarity
//   (`startRarity`, e.g. the weapon's Strike at blue). Several sources: the highest counts."
// Brief M2.4a, public API:
//   RelicDef: kind "relic", id prefix "relic.", optional stats, hp, shield, powers, traits (as on items), statuses
//     (stacks at the start of every fight, integers >= 1).
//   Weapons, armor, accessories and paths gain `startRarity?: Record<string, Rarity>`; keys: a skill or Word id, or
//     the weapon id of some weapon (its Strike); values in RARITIES.
//   Placeholder content: relic.pilgrims_bell (Warded 1 at fight start), relic.iron_heart (+10 HP),
//     relic.whetstone (+1 Might), and one startRarity example in the base pack.

type Obj = Record<string, unknown>;

const strip = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const def = (kind: string, id: string, over: Obj = {}, path = `${id}.json`): ContentFile => ({
  path,
  data: strip({ kind, id, name: `${id}.name`, ...over }),
});

const relic = (id: string, over: Obj = {}, path = `${id}.json`): ContentFile => def("relic", id, over, path);

/** Content startRarity keys can refer to. */
const BASE: readonly ContentFile[] = [
  def("weapon", "weapon.sword", { attack: { damage: 4, damageType: "physical", scaling: [{ stat: "might", per: 2 }] } }),
  def("weapon", "weapon.other", { attack: { damage: 2, damageType: "physical", scaling: [] } }),
  def("skill", "skill.cut", { cooldown: 1, effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy" }] }),
  def("word", "word.fire", {
    glyph: "火",
    spoken: "Huo",
    meaning: "word.fire.meaning",
    cooldown: 1,
    effects: [{ type: "damage", damageType: "arcane", amount: 1, target: "enemy" }],
  }),
  def("armor", "armor.plain"),
  def("character", "char.c", { favoured: ["might"], eventTags: [] }),
  relic("relic.other"),
];

const check = (...files: ContentFile[]): ValidationResult => validatePack("test", [...BASE, ...files]);
const oneRelic = (over: Obj): ValidationResult => check(relic("relic.x", over, "x.json"));

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

// ---------------------------------------------------------------------------------------------
describe("relic validation", () => {
  it("accepts a minimal relic (kind, id, name) and puts it in the pack", () => {
    const res = oneRelic({});
    expectValid(res);
    expect(res.pack?.byId.get("relic.x")).toMatchObject({ kind: "relic", id: "relic.x", name: "relic.x.name" });
  });

  it("accepts every optional field: stats, hp, shield, powers, traits, statuses", () => {
    expectValid(
      oneRelic({
        stats: { might: 1, agility: -1 },
        hp: 10,
        shield: 4,
        powers: { bleedPower: 1, stunPower: 2 },
        traits: {
          converts: [{ on: "deflect", gain: "emboldened", stacks: 1 }],
          slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }],
          decayFloors: { leeching: 2 },
        },
        statuses: { warded: 1, thorns: 3 },
      }),
    );
  });

  it("accepts hp 0 and shield 0", () => {
    expectValid(oneRelic({ hp: 0, shield: 0 }));
  });

  it('requires the id prefix "relic."', () => {
    expectIssue(check(relic("charm.x", {}, "x.json")), "x.json", "id");
    expectIssue(check(def("relic", "accessory.x", {}, "x.json")), "x.json", "id");
  });

  it("an id with the relic prefix but another kind is rejected", () => {
    expectIssue(check(def("accessory", "relic.y", {}, "y.json")), "y.json", "id");
  });

  it("requires a name", () => {
    expectIssue(oneRelic({ name: undefined }), "x.json", "name");
  });

  it("checks stats as on items: known stat ids, integers", () => {
    expectIssue(oneRelic({ stats: { luck: 1 } }), "x.json", "stats");
    expectIssue(oneRelic({ stats: { might: 1.5 } }), "x.json", "stats");
    expectIssue(oneRelic({ stats: 3 }), "x.json", "stats");
  });

  it("hp and shield are integers >= 0", () => {
    expectIssue(oneRelic({ hp: -1 }), "x.json", "hp");
    expectIssue(oneRelic({ hp: 2.5 }), "x.json", "hp");
    expectIssue(oneRelic({ hp: "10" }), "x.json", "hp");
    expectIssue(oneRelic({ shield: -2 }), "x.json", "shield");
    expectIssue(oneRelic({ shield: 1.5 }), "x.json", "shield");
  });

  it("checks powers as on items: known power ids, integers >= 0", () => {
    expectIssue(oneRelic({ powers: { fooPower: 1 } }), "x.json", "powers");
    expectIssue(oneRelic({ powers: { bleedPower: -1 } }), "x.json", "powers");
    expectIssue(oneRelic({ powers: { bleedPower: 0.5 } }), "x.json", "powers");
  });

  it("checks traits as on items", () => {
    expectIssue(oneRelic({ traits: { converts: [{ on: "deflect", gain: "nope", stacks: 1 }] } }), "x.json", "traits");
    expectIssue(oneRelic({ traits: { converts: [{ on: "deflect", gain: "thorns", stacks: 0 }] } }), "x.json", "traits");
    expectIssue(oneRelic({ traits: { unknownTrait: [] } }), "x.json", "traits");
  });

  it("starting statuses: known status ids, integers >= 1", () => {
    expectIssue(oneRelic({ statuses: { shiny: 1 } }), "x.json", "statuses");
    expectIssue(oneRelic({ statuses: { warded: 0 } }), "x.json", "statuses");
    expectIssue(oneRelic({ statuses: { warded: -1 } }), "x.json", "statuses");
    expectIssue(oneRelic({ statuses: { warded: 1.5 } }), "x.json", "statuses");
    expectIssue(oneRelic({ statuses: [] }), "x.json", "statuses");
    expectValid(oneRelic({ statuses: { warded: 1 } }));
  });

  it("a duplicate relic id is rejected", () => {
    const res = check(relic("relic.dup", {}, "a.json"), relic("relic.dup", {}, "b.json"));
    expect(res.pack).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe("startRarity validation (weapons, armor, accessories, paths)", () => {
  const holders: readonly [string, (over: Obj) => ContentFile][] = [
    ["weapon", (over) => def("weapon", "weapon.x", { attack: { damage: 1, damageType: "physical", scaling: [] }, ...over }, "x.json")],
    ["armor", (over) => def("armor", "armor.x", over, "x.json")],
    ["accessory", (over) => def("accessory", "accessory.x", over, "x.json")],
    ["path", (over) => def("path", "path.x", over, "x.json")],
  ];

  for (const [kind, make] of holders) {
    describe(kind, () => {
      it("accepts no startRarity, or an empty one", () => {
        expectValid(check(make({})));
        expectValid(check(make({ startRarity: {} })));
      });

      it("accepts skill, Word and weapon ids (a weapon id is its Strike) with every rarity", () => {
        for (const r of RARITIES) {
          expectValid(check(make({ startRarity: { "skill.cut": r, "word.fire": r, "weapon.sword": r } })));
        }
      });

      it("a weapon id other than its own is accepted (any weapon of the pack)", () => {
        expectValid(check(make({ startRarity: { "weapon.other": "purple" } })));
      });

      it("rejects an unknown rarity", () => {
        expectIssue(check(make({ startRarity: { "skill.cut": "gold" } })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: { "skill.cut": "Grey" } })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: { "skill.cut": 2 } })), "x.json", "startRarity");
      });

      it("rejects an id that is not a skill, Word or weapon of the pack", () => {
        expectIssue(check(make({ startRarity: { "skill.nope": "green" } })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: { "armor.plain": "green" } })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: { "relic.other": "green" } })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: { "char.c": "green" } })), "x.json", "startRarity");
      });

      it("rejects a startRarity that isn't an object", () => {
        expectIssue(check(make({ startRarity: ["skill.cut"] })), "x.json", "startRarity");
        expectIssue(check(make({ startRarity: "green" })), "x.json", "startRarity");
      });
    });
  }

  it("a weapon may name its own Strike", () => {
    expectValid(check(def("weapon", "weapon.self", { attack: { damage: 1, damageType: "physical", scaling: [] }, startRarity: { "weapon.self": "blue" } })));
  });
});

// ---------------------------------------------------------------------------------------------
describe("base pack: placeholder relics and a startRarity example", () => {
  const pack = basePack();

  it("relic.pilgrims_bell: start every fight Warded 1", () => {
    expect(pack.byId.get("relic.pilgrims_bell")).toMatchObject({ kind: "relic", statuses: { warded: 1 } });
  });

  it("relic.iron_heart: +10 HP", () => {
    expect(pack.byId.get("relic.iron_heart")).toMatchObject({ kind: "relic", hp: 10 });
  });

  it("relic.whetstone: +1 Might", () => {
    expect(pack.byId.get("relic.whetstone")).toMatchObject({ kind: "relic", stats: { might: 1 } });
  });

  it("at least one item or path has a startRarity entry", () => {
    const withStart = [...pack.byId.values()].filter((d) => {
      const sr = (d as { readonly startRarity?: Readonly<Record<string, string>> }).startRarity;
      return sr !== undefined && Object.keys(sr).length > 0;
    });
    expect(withStart.length).toBeGreaterThan(0);
  });
});
