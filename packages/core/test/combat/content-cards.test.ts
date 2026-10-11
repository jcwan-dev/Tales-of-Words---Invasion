import { describe, expect, it } from "vitest";
import { validatePack, type ContentFile } from "../../src/index.ts";
import { BASE_FILES, basePack, weaponDef } from "./base-pack.ts";

// Spec 1.7, "Skills": "There is no energy and skills have no cost; cooldowns are the only limit."
//   "A skill is a list of effects built from a small set of building blocks: damage (physical or arcane, with a
//    number of hits), heal, restore Shield, apply status, consume, ... Each effect targets the user, the chosen
//    enemy, or all enemies."
// Spec 1.7, "Cards in combat": "Heal and restore Shield scale only with the user's stats and statuses, never the
//   target's." Sample skills: "Strike | Twin Knives (basic) | none | 3 damage, 2 hits | +2 per Agility".
// Brief M1.4: cost removed from skills and Words; damage effects gain hits? (integer >= 1, default 1); targets
//   "self" | "enemy" | "allEnemies"; the weapon attack gains hits?; validation rejects bad hits, unknown targets, and
//   heal/restoreShield scaling that reads the target.

type Obj = Record<string, unknown>;

const skillFile = (effects: readonly Obj[], extra: Obj = {}): ContentFile => ({
  path: "s.json",
  data: { kind: "skill", id: "skill.test", name: "skill.test.name", cooldown: 1, effects, ...extra },
});
const wordFile = (extra: Obj = {}): ContentFile => ({
  path: "w.json",
  data: {
    kind: "word",
    id: "word.test",
    name: "word.test.name",
    glyph: "火",
    spoken: "Huo",
    meaning: "word.test.meaning",
    cooldown: 1,
    effects: [{ type: "damage", damageType: "arcane", amount: 3, target: "enemy" }],
    ...extra,
  },
});
const weaponFile = (attack: Obj): ContentFile => ({
  path: "k.json",
  data: { kind: "weapon", id: "weapon.test", name: "weapon.test.name", attack },
});
const paths = (files: readonly ContentFile[]): string[] => validatePack("test", files).issues.map((i) => i.path);

const damage = (extra: Obj = {}): Obj => ({ type: "damage", damageType: "physical", amount: 3, target: "enemy", ...extra });

describe("Skills and Words have no cost", () => {
  it("a skill without cost validates", () => {
    expect(paths([skillFile([damage()])])).toEqual([]);
  });

  it("a Word without cost validates", () => {
    expect(paths([wordFile()])).toEqual([]);
  });

  it("the cooldown is still required and at least 1", () => {
    expect(paths([skillFile([damage()], { cooldown: undefined })])).toContain("s.json#cooldown");
    expect(paths([skillFile([damage()], { cooldown: 0 })])).toContain("s.json#cooldown");
  });
});

describe("Damage effects: hits", () => {
  it("hits is optional (default 1)", () => {
    expect(paths([skillFile([damage()])])).toEqual([]);
  });

  it("accepts integers >= 1", () => {
    expect(paths([skillFile([damage({ hits: 1 })])])).toEqual([]);
    expect(paths([skillFile([damage({ hits: 2 })])])).toEqual([]);
    expect(paths([skillFile([damage({ hits: 5 })])])).toEqual([]);
  });

  for (const bad of [0, -1, 1.5, "2", null, Number.NaN]) {
    it(`rejects hits ${String(bad)}`, () => {
      expect(paths([skillFile([damage({ hits: bad })])])).toEqual(["s.json#effects[0].hits"]);
    });
  }

  it("reports the effect's index", () => {
    expect(paths([skillFile([damage(), damage({ hits: 0 })])])).toEqual(["s.json#effects[1].hits"]);
  });
});

describe("Weapon attack: hits", () => {
  const attack = { damage: 3, damageType: "physical", scaling: [{ stat: "agility", per: 2 }] };

  it("optional; integers >= 1 accepted", () => {
    expect(paths([weaponFile(attack)])).toEqual([]);
    expect(paths([weaponFile({ ...attack, hits: 2 })])).toEqual([]);
  });

  for (const bad of [0, 2.5, "2"]) {
    it(`rejects attack.hits ${String(bad)}`, () => {
      expect(paths([weaponFile({ ...attack, hits: bad })])).toEqual(["k.json#attack.hits"]);
    });
  }
});

describe("Effect targets: self, enemy or allEnemies", () => {
  it("accepts allEnemies on damage, status and consume", () => {
    expect(
      paths([
        skillFile([
          damage({ target: "allEnemies" }),
          { type: "status", status: "burning", stacks: 1, target: "allEnemies" },
          { type: "consume", status: "burning", multiplier: 2, damageType: "arcane", target: "allEnemies" },
        ]),
      ]),
    ).toEqual([]);
  });

  it("still accepts self and enemy", () => {
    expect(paths([skillFile([damage({ target: "enemy" }), { type: "heal", amount: 2, target: "self" }])])).toEqual([]);
  });

  for (const bad of ["all", "ally", "player", "", undefined]) {
    it(`rejects target ${JSON.stringify(bad) ?? "undefined"}`, () => {
      expect(paths([skillFile([damage({ target: bad })])])).toEqual(["s.json#effects[0].target"]);
    });
  }
});

describe("Heal and restore Shield scale only with the user", () => {
  for (const type of ["heal", "restoreShield"] as const) {
    it(`${type}: stat scaling is accepted`, () => {
      expect(paths([skillFile([{ type, amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 3 }] }])])).toEqual([]);
    });

    it(`${type}: afflictions scaling (reads the target) is rejected`, () => {
      const p = paths([skillFile([{ type, amount: 4, target: "self", scaling: [{ afflictions: true, per: 1 }] }])]);
      expect(p.length).toBeGreaterThan(0);
      expect(p.every((x) => x.startsWith("s.json#effects[0].scaling"))).toBe(true);
    });

    it(`${type}: stacksOfTag scaling (reads the target) is rejected`, () => {
      const p = paths([skillFile([{ type, amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 1 }, { stacksOfTag: "dot", per: 1 }] }])]);
      expect(p.length).toBeGreaterThan(0);
      expect(p.every((x) => x.startsWith("s.json#effects[0].scaling"))).toBe(true);
    });
  }

  it("damage may still scale with the target (Fester)", () => {
    expect(paths([skillFile([damage({ amount: 0, scaling: [{ afflictions: true, per: 4 }, { stacksOfTag: "dot", per: 1 }] })])])).toEqual([]);
  });
});

describe("The real base pack after the content update", () => {
  it("validates with no issues", () => {
    expect(validatePack("base", BASE_FILES).issues).toEqual([]);
  });

  it("no skill or Word has a cost field", () => {
    const withCost = BASE_FILES.filter((f) => typeof f.data === "object" && f.data !== null && "cost" in f.data).map((f) => f.path);
    expect(withCost).toEqual([]);
  });

  it("Twin Knives' Strike has 2 hits; the other weapons have 1", () => {
    expect(weaponDef("weapon.twin_knives").attack.hits).toBe(2);
    expect(weaponDef("weapon.notched_longsword").attack.hits ?? 1).toBe(1);
    expect(weaponDef("weapon.ashwood_staff").attack.hits ?? 1).toBe(1);
  });

  it("every skill and Word keeps a cooldown of at least 1", () => {
    for (const def of basePack().byId.values()) {
      if (def.kind === "skill" || def.kind === "word") expect(def.cooldown).toBeGreaterThanOrEqual(1);
    }
  });
});
