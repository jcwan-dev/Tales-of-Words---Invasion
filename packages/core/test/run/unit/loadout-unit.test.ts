import { describe, expect, it } from "vitest";
import { createRng, strikeCard, techniqueOffer, validatePack, weaponStrikeCard, type ContentFile, type WeaponDef } from "../../../src/index.ts";

// Builder unit tests for run/loadout: the Strike card id, and offers independent of file order.

const longsword: WeaponDef = {
  kind: "weapon",
  id: "weapon.notched_longsword",
  name: "n",
  attack: { damage: 4, damageType: "physical", scaling: [{ stat: "might", per: 2 }] },
};

const skill = (id: string, stat: string): ContentFile => ({
  path: `${id}.json`,
  data: { kind: "skill", id, name: "n", cooldown: 1, tags: ["technique"], effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy", scaling: [{ stat, per: 1 }] }] },
});
const slots: ContentFile[] = [
  { path: "c.json", data: { kind: "character", id: "char.c", name: "n", favoured: ["might"], eventTags: [] } },
  { path: "w.json", data: { kind: "weapon", id: "weapon.w", name: "n", attack: { damage: 1, damageType: "physical", scaling: [] } } },
  { path: "a.json", data: { kind: "armor", id: "armor.a", name: "n" } },
  { path: "x.json", data: { kind: "accessory", id: "accessory.x", name: "n" } },
  { path: "p.json", data: { kind: "path", id: "path.p", name: "n" } },
];
const techniques = [skill("skill.m1", "might"), skill("skill.m2", "might"), skill("skill.m3", "might"), skill("skill.c1", "cunning"), skill("skill.c2", "cunning")];
const picks = { character: "char.c", weapon: "weapon.w", armor: "armor.a", accessory: "accessory.x", path: "path.p" };

const packFrom = (files: readonly ContentFile[]) => {
  const res = validatePack("t", files);
  if (!res.pack) throw new Error(res.issues.map((i) => i.message).join("\n"));
  return res.pack;
};

describe("weaponStrikeCard (builder unit tests)", () => {
  it("is the weapon's Strike with the weapon's content id as card id", () => {
    const c = weaponStrikeCard(longsword);
    expect(c.id).toBe("weapon.notched_longsword");
    expect(c.cooldown).toBe(0);
    expect(c.effects).toEqual(strikeCard(longsword).effects);
  });
});

describe("techniqueOffer (builder unit tests)", () => {
  it("the same content in any file order gives the same offer for the same seed", () => {
    const forward = packFrom([...slots, ...techniques]);
    const backward = packFrom([...slots, ...[...techniques].reverse()]);
    for (let i = 0; i < 30; i++) {
      expect(techniqueOffer(backward, picks, createRng(`order-${i}`))).toEqual(techniqueOffer(forward, picks, createRng(`order-${i}`)));
    }
  });

  it("uses only the rng it is given: the same rng state gives the same offer, and it advances that rng", () => {
    const pack = packFrom([...slots, ...techniques]);
    const a = createRng("only");
    const b = createRng("only");
    expect(techniqueOffer(pack, picks, a)).toEqual(techniqueOffer(pack, picks, b));
    expect(a.state()).toEqual(b.state());
    expect(a.state()).not.toEqual(createRng("only").state());
  });
});
