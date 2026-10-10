import { describe, expect, it } from "vitest";
import { startingStats, validatePack, maxHpFromVitality } from "../src/index.ts";

const strike = { damage: 4, damageType: "physical", scaling: [{ stat: "might", per: 2 }] };

describe("content validation", () => {
  it("accepts a valid pack", () => {
    const res = validatePack("test", [
      { path: "c.json", data: { kind: "character", id: "char.sellsword", name: "char.sellsword.name", favoured: ["might", "vitality"], eventTags: ["soldier"] } },
      { path: "w.json", data: { kind: "weapon", id: "weapon.sword", name: "n", stats: { might: 1 }, attack: strike } },
      { path: "a.json", data: { kind: "accessory", id: "accessory.charm", name: "n", grants: "word.huo" } },
      {
        path: "huo.json",
        data: { kind: "word", id: "word.huo", name: "n", glyph: "火", spoken: "Huo", meaning: "word.huo.meaning", cost: 1, cooldown: 1, effects: [{ type: "damage", damageType: "arcane", amount: 3, target: "enemy", scaling: [{ stat: "arcana", per: 3 }] }, { type: "status", status: "burning", stacks: 2, target: "enemy" }] },
      },
    ]);
    expect(res.issues).toEqual([]);
    expect(res.pack?.byId.size).toBe(4);
  });

  it("rejects a skill without a cooldown (only Strike has none)", () => {
    const res = validatePack("test", [
      { path: "s.json", data: { kind: "skill", id: "skill.free", name: "n", cost: 0, cooldown: 0, effects: [{ type: "heal", amount: 1, target: "self" }] } },
    ]);
    expect(res.issues.map((i) => i.path)).toContain("s.json#cooldown");
  });

  it("rejects unknown stats, statuses and broken references", () => {
    const res = validatePack("test", [
      { path: "w.json", data: { kind: "weapon", id: "weapon.x", name: "n", stats: { charisma: 1 }, attack: strike } },
      { path: "s.json", data: { kind: "skill", id: "skill.x", name: "n", cost: 1, cooldown: 1, effects: [{ type: "status", status: "frozen", stacks: 1, target: "enemy" }] } },
      { path: "a.json", data: { kind: "accessory", id: "accessory.x", name: "n", grants: "word.missing" } },
    ]);
    const paths = res.issues.map((i) => i.path);
    expect(paths).toContain("w.json#stats.charisma");
    expect(paths).toContain("s.json#effects[0].status");
    expect(paths).toContain("a.json#grants");
    expect(res.pack).toBeUndefined();
  });

  it("rejects duplicate ids and wrong id prefixes", () => {
    const res = validatePack("test", [
      { path: "a.json", data: { kind: "armor", id: "armor.coat", name: "n" } },
      { path: "b.json", data: { kind: "armor", id: "armor.coat", name: "n" } },
      { path: "c.json", data: { kind: "armor", id: "weapon.coat", name: "n" } },
    ]);
    const msgs = res.issues.map((i) => `${i.path} ${i.message}`).join("\n");
    expect(msgs).toContain("duplicate id");
    expect(msgs).toContain('must start with "armor."');
  });
});

describe("stats (spec: Base characters, Shield and HP)", () => {
  it("starts at 2, favoured at 3", () => {
    expect(startingStats(["might", "vitality"])).toEqual({
      might: 3, vitality: 3, cunning: 2, agility: 2, arcana: 2, intelligence: 2, wisdom: 2,
    });
  });

  it("max HP is 20 + 5 per Vitality", () => {
    expect(maxHpFromVitality(4)).toBe(40);
  });
});
