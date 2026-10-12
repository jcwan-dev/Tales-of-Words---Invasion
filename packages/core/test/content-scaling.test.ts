import { describe, expect, it } from "vitest";
import { validatePack } from "../src/index.ts";

// Builder unit tests: the validator accepts the three Scaling shapes (spec 1.5, Synergy effects) and
// rejects anything else.
const skill = (scaling: unknown) => ({
  path: "s.json",
  data: { kind: "skill", id: "skill.fester", name: "n", cost: 1, cooldown: 1, effects: [{ type: "damage", damageType: "physical", amount: 0, target: "enemy", scaling }] },
});
const issuesFor = (scaling: unknown) => validatePack("test", [skill(scaling)]).issues.map((i) => i.path);

describe("content validation: scaling shapes", () => {
  it("accepts { stat, per }, { afflictions: true, per } and { stacksOfTag, per }", () => {
    expect(issuesFor([{ stat: "might", per: 2 }, { afflictions: true, per: 4 }, { stacksOfTag: "dot", per: 1 }])).toEqual([]);
  });

  it("rejects an unknown stat or tag, and afflictions other than true", () => {
    expect(issuesFor([{ stat: "charisma", per: 1 }])).toEqual(["s.json#effects[0].scaling[0].stat"]);
    expect(issuesFor([{ stacksOfTag: "curse", per: 1 }])).toEqual(["s.json#effects[0].scaling[0].stacksOfTag"]);
    expect(issuesFor([{ afflictions: 1, per: 1 }])).toEqual(["s.json#effects[0].scaling[0].afflictions"]);
  });

  it("rejects a term with no kind, two kinds, or no numeric per", () => {
    expect(issuesFor([{ per: 1 }])).toEqual(["s.json#effects[0].scaling[0]"]);
    expect(issuesFor([{ stat: "might", afflictions: true, per: 1 }])).toEqual(["s.json#effects[0].scaling[0]"]);
    expect(issuesFor([{ stat: "might" }])).toEqual(["s.json#effects[0].scaling[0]"]);
  });

  it("accepts per values with at most 2 decimals (spec: Rarity)", () => {
    expect(issuesFor([{ stat: "might", per: 0.05 }, { afflictions: true, per: 1.25 }, { stacksOfTag: "dot", per: 0.1 }])).toEqual([]);
    expect(issuesFor([{ stat: "might", per: 0.07 }, { stat: "agility", per: 2.33 }, { stat: "cunning", per: -0.01 }])).toEqual([]);
  });

  it("rejects per values with more than 2 decimals, for every term kind", () => {
    expect(issuesFor([{ stat: "might", per: 0.333 }])).toEqual(["s.json#effects[0].scaling[0].per"]);
    expect(issuesFor([{ afflictions: true, per: 1.005 }])).toEqual(["s.json#effects[0].scaling[0].per"]);
    expect(issuesFor([{ stacksOfTag: "dot", per: 0.001 }])).toEqual(["s.json#effects[0].scaling[0].per"]);
  });
});

describe("content validation: per decimals wherever scaling appears", () => {
  const per = 0.125;
  const files = [
    {
      path: "w.json",
      data: { kind: "word", id: "word.w", name: "n", glyph: "火", spoken: "Huo", meaning: "m", cooldown: 1, effects: [{ type: "heal", amount: 1, target: "self", scaling: [{ stat: "wisdom", per }] }] },
    },
    { path: "k.json", data: { kind: "weapon", id: "weapon.k", name: "n", attack: { damage: 1, damageType: "physical", scaling: [{ stat: "agility", per }] } } },
    {
      path: "e.json",
      data: {
        kind: "enemy",
        id: "enemy.e",
        name: "n",
        hp: 10,
        moves: [{ id: "bite", weight: 1, cooldown: 0, intent: "i", effects: [{ type: "restoreShield", amount: 1, target: "self", scaling: [{ stat: "might", per }] }] }],
      },
    },
  ];

  it("Words, weapon attacks and enemy moves are checked too", () => {
    const paths = validatePack("test", files).issues.map((i) => i.path);
    expect(paths).toEqual(["w.json#effects[0].scaling[0].per", "k.json#attack.scaling[0].per", "e.json#moves[0].effects[0].scaling[0].per"]);
  });

  it("the same files with 2-decimal values are valid", () => {
    const fixed = files.map((f) => ({ ...f, data: JSON.parse(JSON.stringify(f.data).replaceAll("0.125", "0.12")) as unknown }));
    expect(validatePack("test", fixed).issues).toEqual([]);
  });
});
