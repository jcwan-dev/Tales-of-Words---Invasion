import { describe, expect, it } from "vitest";
import {
  assemblePlayer,
  cardFromSkill,
  createRng,
  createUnit,
  intelligenceBonusOptions,
  POWER_IDS,
  RngStreams,
  STAT_IDS,
  strikeCard,
  techniqueOffer,
  validatePack,
  type CardSpec,
  type ContentFile,
  type ContentPack,
  type Effect,
  type LoadoutPicks,
  type PowerId,
  type SkillDef,
  type StatBlock,
  type StatId,
  type WeaponDef,
  type WordDef,
} from "../../src/index.ts";
import { basePack } from "../combat/base-pack.ts";
import {
  ALL_FILES,
  BRUTE,
  BRUTE_FAVOURED,
  CLUB,
  PLAIN_ACCESSORY,
  PLAIN_ARMOR,
  PLAIN_PATH,
  SAGE,
  SCROLL_CASE,
  T_AGI,
  T_CUN,
  T_ARC,
  T_MIGHT_A,
  T_TWO,
  T_VIT,
  T_WIS,
  TECHNIQUES,
  packOf,
  picks,
} from "./loadout-pack.ts";

// Spec Draft 1.8, "Loadout assembly" (decided 12 Oct 2026):
//   Stats: every stat starts at 2, the character's favoured stats at 3. Then the stat modifiers of the weapon, armor,
//     accessory and path are added. A stat never goes below 0.
//   Run cap: level-ups can't raise a stat above 7, but items and paths can push it higher (Might 7 + Longsword = 8).
//     The cap counts the stat without item and path bonuses.
//   HP: max HP = 20 + 5 × Vitality (after modifiers) + the HP the items give. A run starts at full HP.
//   Shield: max Shield = the sum of the items' Shield.
//   Powers and traits: items and paths can give powers (they add up) and traits (converts, slow decay, decay
//     floors). Several decay floors on the same status: the highest counts.
//   Starting cards, in this order: the weapon's Strike, the skill or Word the accessory grants (if any), then the
//     starting technique.
//   Starting technique offer: 1 of 3 skills from the technique pool (skills tagged `technique`). Two of the three
//     scale with one of the character's favoured stats, the third is drawn from the whole pool. Intelligence (after
//     modifiers) adds options: 4 at Intelligence 4, 5 at Intelligence 6, the extra ones drawn from the whole pool.
//     Offers never repeat a skill or offer one already held. If the pool is too small, the offer is shorter.
//     Drawn on its own RNG stream.
//   Intelligence everywhere: +1 option at 4, +2 at 6.
//   Story tags: the character's event tags and the path's rules travel with the run.
// Worked example ("Sample skills"): Sellsword, Longsword, Brigandine, Sworn Road: Might 4, Vitality 4, Agility 1,
//   Arcana 2, Wisdom 3, 50 HP, 8 Shield. Strike 12, Cleave 15, Huo 9, Mend 13.
// Brief M2.1: the Strike card id is the weapon id or "<weapon id>.strike"; skills and Words use their content id.
//   Base pack tags Cleave, Dirty Trick, Mend and Shore Up with `technique`.
// Spec "Loadout assembly", Details: the floor of 0 applies once, after all modifiers (weapon −3 then path +2 on a
//   stat of 2 gives 1). Modifiers, powers and traits are read in slot order: weapon, armor, accessory, path;
//   combined converts and slow-decay entries keep that order. Only items give HP and Shield. A skill "scales with" a
//   stat when any scaling entry in any of its effects uses it. A technique already held can't be picked. A convert
//   gives at least 1 stack.

const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

const stats = (over: Partial<Record<StatId, number>>): StatBlock => {
  const block = {} as Record<StatId, number>;
  for (const s of STAT_IDS) block[s] = over[s] ?? 2;
  return block;
};

/** The number a card shows: amount + per × stat for every stat term (spec: Sample skills, worked example). */
const shown = (effect: Effect | undefined, s: StatBlock): number => {
  if (effect === undefined || !("amount" in effect)) throw new Error("effect has no amount");
  let n = effect.amount;
  for (const term of effect.scaling ?? []) if ("stat" in term) n += term.per * s[term.stat];
  return n;
};

const def = <K extends string>(pack: ContentPack, id: string, kinds: readonly K[]) => {
  const d = pack.byId.get(id);
  if (d === undefined || !(kinds as readonly string[]).includes(d.kind)) throw new Error(`${id} is not a ${kinds.join("/")}`);
  return d;
};
const weaponOf = (pack: ContentPack, id: string) => def(pack, id, ["weapon"]) as WeaponDef;
const skillOf = (pack: ContentPack, id: string) => def(pack, id, ["skill", "word"]) as SkillDef | WordDef;

const expectStrike = (card: CardSpec | undefined, weapon: WeaponDef): void => {
  expect(card).toBeDefined();
  expect([weapon.id, `${weapon.id}.strike`]).toContain(card?.id);
  expect(card?.cooldown).toBe(0);
  expect(card?.effects).toEqual(strikeCard(weapon).effects);
};

const power = (unit: Record<string, unknown>, id: PowerId): number => {
  const v = unit[id];
  return typeof v === "number" ? v : 0;
};

const offerSet = (pack: ContentPack, p: LoadoutPicks, seed: string) => techniqueOffer(pack, p, createRng(seed));

// ---------------------------------------------------------------------------------------------------------------

describe("loadout assembly: the spec's worked example (Sellsword)", () => {
  const pack = basePack();
  const sellsword: LoadoutPicks = {
    character: "char.sellsword",
    weapon: "weapon.notched_longsword",
    armor: "armor.riveted_brigandine",
    accessory: "accessory.ember_charm",
    path: "path.sworn_road",
  };

  it("final stats: Might 4, Vitality 4, Agility 1, Arcana 2, Wisdom 3, Cunning 2, Intelligence 2", () => {
    const p = assemblePlayer(pack, sellsword, "skill.cleave");
    expect(p.unit.stats).toEqual(stats({ might: 4, vitality: 4, agility: 1, arcana: 2, wisdom: 3, cunning: 2, intelligence: 2 }));
  });

  it("base stats are 2 / favoured 3, without item and path bonuses", () => {
    const p = assemblePlayer(pack, sellsword, "skill.cleave");
    expect(p.baseStats).toEqual(stats({ might: 3, vitality: 3 }));
  });

  it("50 HP (20 + 5 × 4 + 10) at full, 8 Shield at full", () => {
    const p = assemblePlayer(pack, sellsword, "skill.cleave");
    expect(p.unit.maxHp).toBe(50);
    expect(p.unit.hp ?? p.unit.maxHp).toBe(50);
    expect(p.unit.maxShield).toBe(8);
    expect(p.unit.shield ?? p.unit.maxShield).toBe(8);
  });

  it("is the player: id \"player\", side \"player\"", () => {
    const p = assemblePlayer(pack, sellsword, null);
    expect(p.unit.id).toBe("player");
    expect(p.unit.side).toBe("player");
  });

  it("cards in order: Strike (Longsword), Huo (Ember Charm), then the technique", () => {
    const p = assemblePlayer(pack, sellsword, "skill.cleave");
    const cards = p.unit.cards ?? [];
    expect(cards).toHaveLength(3);
    expectStrike(cards[0], weaponOf(pack, "weapon.notched_longsword"));
    expect(cards[1]).toEqual(cardFromSkill(skillOf(pack, "word.huo")));
    expect(cards[2]).toEqual(cardFromSkill(skillOf(pack, "skill.cleave")));
  });

  it("the cards show the spec's numbers: Strike 12, Huo 9, Cleave 15, Mend 13", () => {
    const cleave = assemblePlayer(pack, sellsword, "skill.cleave");
    const s = cleave.unit.stats as StatBlock;
    const cards = cleave.unit.cards ?? [];
    expect(shown(cards[0]?.effects[0], s)).toBe(12);
    expect(shown(cards[1]?.effects[0], s)).toBe(9);
    expect(shown(cards[2]?.effects[0], s)).toBe(15);
    const mend = assemblePlayer(pack, sellsword, "skill.mend");
    expect(mend.unit.cards?.[2]?.id).toBe("skill.mend");
    expect(shown(mend.unit.cards?.[2]?.effects[0], mend.unit.stats as StatBlock)).toBe(13);
  });

  it("without a technique: Strike then Huo", () => {
    const p = assemblePlayer(pack, sellsword, null);
    const cards = p.unit.cards ?? [];
    expect(cards).toHaveLength(2);
    expectStrike(cards[0], weaponOf(pack, "weapon.notched_longsword"));
    expect(cards[1]?.id).toBe("word.huo");
  });

  it("carries the character's event tags and the path's rules", () => {
    const p = assemblePlayer(pack, sellsword, null);
    expect(p.eventTags).toEqual(["soldier", "mercenary_company", "bounty"]);
    expect(p.rules).toEqual(["no_dishonest_choices"]);
  });

  it("no powers or traits from the base items", () => {
    const p = assemblePlayer(pack, sellsword, null);
    for (const id of POWER_IDS) expect(power(p.unit as unknown as Record<string, unknown>, id)).toBe(0);
    expect(p.unit.traits?.converts ?? []).toEqual([]);
    expect(p.unit.traits?.slowDecay ?? []).toEqual([]);
    expect(p.unit.traits?.decayFloors ?? {}).toEqual({});
  });

  it("is a valid UnitInit: createUnit builds it unchanged", () => {
    const p = assemblePlayer(pack, sellsword, "skill.cleave");
    const u = createUnit(p.unit);
    expect(u.stats).toEqual(p.unit.stats);
    expect(u.maxHp).toBe(50);
    expect(u.hp).toBe(50);
    expect(u.maxShield).toBe(8);
    expect(u.shield).toBe(8);
    expect(u.cards.map((c) => c.id)).toEqual((p.unit.cards ?? []).map((c) => c.id));
  });

  it("an accessory without a grant: Strike then the technique (Iron Locket: +8 HP)", () => {
    const p = assemblePlayer(pack, { ...sellsword, accessory: "accessory.iron_locket" }, "skill.shore_up");
    const cards = p.unit.cards ?? [];
    expect(cards.map((c) => c.id).slice(1)).toEqual(["skill.shore_up"]);
    expectStrike(cards[0], weaponOf(pack, "weapon.notched_longsword"));
    // 20 + 5 × 4 + 10 (Brigandine) + 8 (Locket)
    expect(p.unit.maxHp).toBe(58);
  });

  it("Urchin + Twin Knives + Ward-stitched Robe + Lodestone Ring + Sworn Road", () => {
    const p = assemblePlayer(
      pack,
      { character: "char.urchin", weapon: "weapon.twin_knives", armor: "armor.ward_stitched_robe", accessory: "accessory.lodestone_ring", path: "path.sworn_road" },
      "skill.dirty_trick",
    );
    // Cunning 3, Agility 3 + 1, Arcana 2 + 1, Intelligence 2 + 1, Wisdom 2 + 1 (Robe) + 1 (Sworn Road).
    expect(p.unit.stats).toEqual(stats({ cunning: 3, agility: 4, arcana: 3, intelligence: 3, wisdom: 4 }));
    expect(p.baseStats).toEqual(stats({ cunning: 3, agility: 3 }));
    expect(p.unit.maxHp).toBe(30); // 20 + 5 × 2
    expect(p.unit.maxShield).toBe(10);
    expect((p.unit.cards ?? []).map((c) => c.id).slice(1)).toEqual(["skill.dirty_trick"]);
    expect(p.eventTags).toEqual(["street", "thieves_signs"]);
  });
});

describe("loadout assembly: stats", () => {
  const pack = packOf(ALL_FILES);

  it("neutral items: 2 everywhere, favoured 3; final equals base", () => {
    const p = assemblePlayer(pack, picks(), null);
    expect(p.unit.stats).toEqual(stats({ might: 3, vitality: 3 }));
    expect(p.baseStats).toEqual(stats({ might: 3, vitality: 3 }));
  });

  it("a malus never takes a stat below 0 (Agility 2 − 3 → 0)", () => {
    const p = assemblePlayer(pack, picks({ weapon: "weapon.heavy" }), null);
    expect(p.unit.stats?.agility).toBe(0);
    expect(p.baseStats.agility).toBe(2);
  });

  it("the floor applies once, after all modifiers: Cunning 2 − 3 (weapon) + 2 (path) = 1", () => {
    const p = assemblePlayer(pack, picks({ weapon: "weapon.sapping", path: "path.recovery" }), null);
    expect(p.unit.stats?.cunning).toBe(1);
    expect(p.baseStats.cunning).toBe(2);
    // The weapon alone still floors at 0.
    expect(assemblePlayer(pack, picks({ weapon: "weapon.sapping" }), null).unit.stats?.cunning).toBe(0);
  });

  it("items can push a stat above the run cap of 7 (Might 3 + 5 = 8); base stats stay without bonuses", () => {
    const p = assemblePlayer(pack, picks({ weapon: "weapon.heavy" }), null);
    expect(p.unit.stats?.might).toBe(8);
    expect(p.baseStats.might).toBe(3);
  });

  it("modifiers of all four slots add up", () => {
    // Sage: Intelligence 3 + 2 (Tome) + 1 (Study) − 1 (Dulling) = 5.
    const p = assemblePlayer(pack, picks({ character: "char.sage", armor: "armor.dulling", accessory: "accessory.tome", path: "path.study" }), null);
    expect(p.unit.stats).toEqual(stats({ intelligence: 5, wisdom: 3 }));
    expect(p.baseStats).toEqual(stats({ intelligence: 3, wisdom: 3 }));
  });

  it("event tags and rules: the character's tags; a path without rules gives none", () => {
    const p = assemblePlayer(pack, picks(), null);
    expect(p.eventTags).toEqual(["brute", "strong"]);
    expect(p.rules).toEqual([]);
  });
});

describe("loadout assembly: HP and Shield", () => {
  const pack = packOf(ALL_FILES);

  it("no item HP or Shield: max HP 20 + 5 × 3 = 35, Shield 0", () => {
    const p = assemblePlayer(pack, picks(), null);
    expect(p.unit.maxHp).toBe(35);
    expect(p.unit.hp ?? p.unit.maxHp).toBe(35);
    expect(p.unit.maxShield ?? 0).toBe(0);
    expect(p.unit.shield ?? p.unit.maxShield ?? 0).toBe(0);
  });

  it("HP uses Vitality after modifiers (floored at 0) plus every item's HP; Shield is the items' sum", () => {
    // Brute Vitality 3 − 4 → 0. HP = 20 + 0 + 2 (Buckler) + 10 (Crushing) + 8 (Locket) = 40.
    // Shield = 6 (Buckler) + 3 (Crushing) + 1 (Locket) = 10.
    const p = assemblePlayer(pack, picks({ weapon: "weapon.buckler", armor: "armor.crushing", accessory: "accessory.locket" }), null);
    expect(p.unit.stats?.vitality).toBe(0);
    expect(p.unit.maxHp).toBe(40);
    expect(p.unit.hp ?? p.unit.maxHp).toBe(40);
    expect(p.unit.maxShield).toBe(10);
    expect(p.unit.shield ?? p.unit.maxShield).toBe(10);
  });

  it("createUnit starts the run at full HP and Shield", () => {
    const u = createUnit(assemblePlayer(pack, picks({ weapon: "weapon.buckler", armor: "armor.crushing", accessory: "accessory.locket" }), null).unit);
    expect(u.hp).toBe(40);
    expect(u.maxHp).toBe(40);
    expect(u.shield).toBe(10);
    expect(u.maxShield).toBe(10);
  });
});

describe("loadout assembly: powers and traits", () => {
  const pack = packOf(ALL_FILES);
  const all = picks({ weapon: "weapon.fang", armor: "armor.thorned", accessory: "accessory.censer", path: "path.glutton" });

  it("powers add up across the weapon, armor, accessory and path", () => {
    const p = assemblePlayer(pack, all, null);
    const u = p.unit as unknown as Record<string, unknown>;
    // Bleed 1 + 2 + 1; Stun 2 (Fang); Burn 1 (Censer); Poison 2 (Glutton); Paralysis none.
    expect(power(u, "bleedPower")).toBe(4);
    expect(power(u, "stunPower")).toBe(2);
    expect(power(u, "burnPower")).toBe(1);
    expect(power(u, "poisonPower")).toBe(2);
    expect(power(u, "paralysisPower")).toBe(0);
  });

  it("powers reach the combat unit", () => {
    const u = createUnit(assemblePlayer(pack, all, null).unit);
    expect(u.bleedPower).toBe(4);
    expect(u.maxStunPower).toBe(2);
    expect(u.burnPower).toBe(1);
    expect(u.poisonPower).toBe(2);
    expect(u.paralysisPower).toBe(0);
  });

  it("converts concatenate in slot order: weapon, armor, accessory, path (each source's own order kept)", () => {
    const t = assemblePlayer(pack, all, null).unit.traits;
    expect(t?.converts).toEqual([
      { on: "deflect", gain: "thorns", stacks: 1 }, // Fang (weapon)
      { on: "tookDamage", gain: "thorns", stacks: 2 }, // Thorned (armor)
      { on: "dealtDamage", gain: "kindled", stacks: 1 }, // Censer (accessory)
      { on: "attacked", gain: "warded", stacks: 1 }, // Glutton (path)
      { on: "deflect", gain: "emboldened", stacks: 1 }, // Glutton (path)
    ]);
  });

  it("slow decay entries concatenate in slot order: weapon, armor, accessory, path", () => {
    const t = assemblePlayer(pack, all, null).unit.traits;
    expect(t?.slowDecay).toEqual([
      { statuses: ["bleeding"], whose: "enemies" }, // Fang
      { statuses: ["leeching"], whose: "own" }, // Thorned
      { statuses: { tag: "dot" }, whose: "enemies" }, // Censer
      { statuses: ["emboldened"], whose: "own" }, // Glutton
    ]);
  });

  it("slot order holds whichever slots carry traits (armor and path only)", () => {
    const t = assemblePlayer(pack, picks({ armor: "armor.thorned", path: "path.glutton" }), null).unit.traits;
    expect((t?.converts ?? []).map((c) => c.gain)).toEqual(["thorns", "warded", "emboldened"]);
    expect(t?.slowDecay).toEqual([
      { statuses: ["leeching"], whose: "own" },
      { statuses: ["emboldened"], whose: "own" },
    ]);
  });

  it("decay floors merge by max: Leeching max(1, 3, 2) = 3, Burning 2", () => {
    const t = assemblePlayer(pack, all, null).unit.traits;
    expect(t?.decayFloors).toEqual({ leeching: 3, burning: 2 });
  });

  it("a single source's traits pass through", () => {
    const t = assemblePlayer(pack, picks({ path: "path.glutton" }), null).unit.traits;
    expect(t?.converts).toEqual([
      { on: "attacked", gain: "warded", stacks: 1 },
      { on: "deflect", gain: "emboldened", stacks: 1 },
    ]);
    expect(t?.decayFloors).toEqual({ leeching: 2 });
    expect(t?.slowDecay).toEqual([{ statuses: ["emboldened"], whose: "own" }]);
  });

  it("the traits reach the combat unit", () => {
    const u = createUnit(assemblePlayer(pack, all, null).unit);
    expect(u.traits.decayFloors).toEqual({ leeching: 3, burning: 2 });
    expect((u.traits.converts ?? []).map((c) => c.gain)).toEqual(["thorns", "thorns", "kindled", "warded", "emboldened"]);
    expect(u.traits.slowDecay ?? []).toHaveLength(4);
  });
});

describe("loadout assembly: starting cards", () => {
  const pack = packOf(ALL_FILES);

  it("Strike, the accessory's grant, then the technique (a Word technique works too)", () => {
    const p = assemblePlayer(pack, picks({ accessory: "accessory.scroll_case" }), "word.t_arc");
    const cards = p.unit.cards ?? [];
    expect(cards.map((c) => c.id).slice(1)).toEqual(["skill.t_might_a", "word.t_arc"]);
    expectStrike(cards[0], weaponOf(pack, "weapon.club"));
    expect(cards[1]).toEqual(cardFromSkill(skillOf(pack, "skill.t_might_a")));
    expect(cards[2]).toEqual(cardFromSkill(skillOf(pack, "word.t_arc")));
  });

  it("no grant and no technique: Strike only", () => {
    const cards = assemblePlayer(pack, picks(), null).unit.cards ?? [];
    expect(cards).toHaveLength(1);
    expectStrike(cards[0], weaponOf(pack, "weapon.club"));
  });

  it("rejects a technique not tagged `technique` with a RangeError", () => {
    expect(() => assemblePlayer(pack, picks(), "skill.untagged")).toThrow(RangeError);
    expect(() => assemblePlayer(pack, picks(), "skill.scroll_only")).toThrow(RangeError);
    expect(() => assemblePlayer(basePack(), { character: "char.sellsword", weapon: "weapon.notched_longsword", armor: "armor.riveted_brigandine", accessory: "accessory.ember_charm", path: "path.sworn_road" }, "skill.bloodletter")).toThrow(RangeError);
  });

  it("rejects a technique already held (the accessory's grant) with a RangeError", () => {
    expect(() => assemblePlayer(pack, picks({ accessory: "accessory.scroll_case" }), "skill.t_might_a")).toThrow(RangeError);
    // The same technique is fine when not held.
    expect((assemblePlayer(pack, picks(), "skill.t_might_a").unit.cards ?? []).map((c) => c.id).slice(1)).toEqual(["skill.t_might_a"]);
  });

  it("rejects an unknown technique id, or one that is not a skill or Word, with a RangeError", () => {
    expect(() => assemblePlayer(pack, picks(), "skill.nope")).toThrow(RangeError);
    expect(() => assemblePlayer(pack, picks(), "weapon.club")).toThrow(RangeError);
    expect(() => assemblePlayer(pack, picks(), "char.brute")).toThrow(RangeError);
  });
});

describe("loadout assembly: unknown ids and wrong kinds", () => {
  const pack = packOf(ALL_FILES);
  const bad: readonly [string, Partial<LoadoutPicks>][] = [
    ["unknown character", { character: "char.nobody" }],
    ["unknown weapon", { weapon: "weapon.nothing" }],
    ["unknown armor", { armor: "armor.nothing" }],
    ["unknown accessory", { accessory: "accessory.nothing" }],
    ["unknown path", { path: "path.nothing" }],
    ["a weapon as the character", { character: "weapon.club" }],
    ["an armor as the weapon", { weapon: "armor.plain" }],
    ["a weapon as the armor", { armor: "weapon.club" }],
    ["a path as the accessory", { accessory: "path.plain" }],
    ["a character as the path", { path: "char.brute" }],
    ["a skill as the accessory", { accessory: "skill.t_cun" }],
  ];
  for (const [what, over] of bad) {
    it(`assemblePlayer throws RangeError for ${what}`, () => {
      expect(() => assemblePlayer(pack, picks(over), null)).toThrow(RangeError);
    });
    it(`techniqueOffer throws RangeError for ${what}`, () => {
      expect(() => techniqueOffer(pack, picks(over), createRng("x"))).toThrow(RangeError);
    });
  }
});

describe("intelligenceBonusOptions", () => {
  const table: readonly [number, number][] = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 1], [5, 1], [6, 2], [7, 2], [8, 2],
  ];
  for (const [int, extra] of table) {
    it(`Intelligence ${int} → +${extra}`, () => expect(intelligenceBonusOptions(int)).toBe(extra));
  }
});

describe("starting technique offer: base pack", () => {
  const pack = basePack();
  const base = ["skill.cleave", "skill.dirty_trick", "skill.mend", "skill.shore_up"];

  it("the technique pool is Cleave, Dirty Trick, Mend and Shore Up (tagged `technique`)", () => {
    const pool = [...pack.byId.values()]
      .filter((d) => (d.kind === "skill" || d.kind === "word") && (d.tags ?? []).includes("technique"))
      .map((d) => d.id)
      .sort();
    expect(pool).toEqual(base);
  });

  it("Sellsword (Might, Vitality; Intelligence 2): Cleave and Shore Up, plus Dirty Trick or Mend", () => {
    const p: LoadoutPicks = { character: "char.sellsword", weapon: "weapon.notched_longsword", armor: "armor.riveted_brigandine", accessory: "accessory.ember_charm", path: "path.sworn_road" };
    const thirds = new Set<string>();
    for (const seed of SEEDS) {
      const offer = offerSet(pack, p, seed);
      expect(offer).toHaveLength(3);
      expect(offer).toContain("skill.cleave");
      expect(offer).toContain("skill.shore_up");
      const third = offer.find((id) => id !== "skill.cleave" && id !== "skill.shore_up");
      expect(["skill.dirty_trick", "skill.mend"]).toContain(third);
      thirds.add(third ?? "");
    }
    expect([...thirds].sort()).toEqual(["skill.dirty_trick", "skill.mend"]);
  });

  it("Urchin (Cunning, Agility): Cleave (Agility) and Dirty Trick, plus Mend or Shore Up", () => {
    const p: LoadoutPicks = { character: "char.urchin", weapon: "weapon.twin_knives", armor: "armor.ward_stitched_robe", accessory: "accessory.iron_locket", path: "path.sworn_road" };
    for (const seed of SEEDS.slice(0, 50)) {
      const offer = offerSet(pack, p, seed);
      expect(offer).toHaveLength(3);
      expect(offer).toContain("skill.cleave");
      expect(offer).toContain("skill.dirty_trick");
    }
  });

  it("Scholar + Lodestone Ring (Intelligence 4): 4 options, here the whole pool", () => {
    const p: LoadoutPicks = { character: "char.scholar", weapon: "weapon.ashwood_staff", armor: "armor.ward_stitched_robe", accessory: "accessory.lodestone_ring", path: "path.sworn_road" };
    for (const seed of SEEDS.slice(0, 50)) expect([...offerSet(pack, p, seed)].sort()).toEqual(base);
  });

  it("Scholar without the ring (Intelligence 3): 3 distinct options", () => {
    const p: LoadoutPicks = { character: "char.scholar", weapon: "weapon.ashwood_staff", armor: "armor.ward_stitched_robe", accessory: "accessory.iron_locket", path: "path.sworn_road" };
    for (const seed of SEEDS.slice(0, 50)) {
      const offer = offerSet(pack, p, seed);
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) expect(base).toContain(id);
    }
  });
});

describe("starting technique offer: rules", () => {
  const pack = packOf(ALL_FILES);

  it("size 3; at least two scale with a favoured stat; no repeats; only techniques", () => {
    for (const seed of SEEDS) {
      const offer = offerSet(pack, picks(), seed);
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) expect(TECHNIQUES as readonly string[]).toContain(id);
      expect(offer.filter((id) => (BRUTE_FAVOURED as readonly string[]).includes(id)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the favoured picks vary among the favoured techniques, and the third comes from the whole pool", () => {
    const seen = new Set<string>();
    let allFavoured = 0;
    let oneOther = 0;
    for (const seed of SEEDS) {
      const offer = offerSet(pack, picks(), seed);
      for (const id of offer) seen.add(id);
      const fav = offer.filter((id) => (BRUTE_FAVOURED as readonly string[]).includes(id)).length;
      if (fav === 3) allFavoured++;
      else oneOther++;
    }
    // Third from the 5 left (1 favoured + 4 others): both cases occur over 200 seeds.
    expect(allFavoured).toBeGreaterThan(0);
    expect(oneOther).toBeGreaterThan(0);
    expect([...seen].sort()).toEqual([...TECHNIQUES].sort());
  });

  it("never offers a skill already held (the accessory's grant)", () => {
    // Scroll Case grants T_MIGHT_A: the two favoured left are T_MIGHT_B and T_VIT, always offered.
    for (const seed of SEEDS) {
      const offer = offerSet(pack, picks({ accessory: "accessory.scroll_case" }), seed);
      expect(offer).toHaveLength(3);
      expect(offer).not.toContain("skill.t_might_a");
      expect(offer).toContain("skill.t_might_b");
      expect(offer).toContain("skill.t_vit");
    }
  });

  it("Intelligence after modifiers: 4 → 4 options, 6 → 5 options; extras from the whole pool", () => {
    const sage = (over: Partial<LoadoutPicks>) => picks({ character: "char.sage", ...over });
    for (const seed of SEEDS.slice(0, 50)) {
      expect(offerSet(pack, sage({}), seed)).toHaveLength(3); // 3
      expect(offerSet(pack, sage({ path: "path.study" }), seed)).toHaveLength(4); // 3 + 1
      expect(offerSet(pack, sage({ accessory: "accessory.tome" }), seed)).toHaveLength(4); // 3 + 2 = 5
      expect(offerSet(pack, sage({ accessory: "accessory.tome", path: "path.study" }), seed)).toHaveLength(5); // 6
      expect(offerSet(pack, sage({ path: "path.deep_study" }), seed)).toHaveLength(5); // 6
      expect(offerSet(pack, sage({ armor: "armor.dulling", path: "path.study" }), seed)).toHaveLength(3); // 3
      expect(offerSet(pack, sage({ armor: "armor.dulling", accessory: "accessory.tome", path: "path.study" }), seed)).toHaveLength(4); // 5
    }
  });

  it("fewer than two favoured techniques: the one there is offered, the rest from the whole pool", () => {
    // Sage favours Intelligence and Wisdom: only T_WIS scales with either.
    for (const seed of SEEDS.slice(0, 50)) {
      const offer = offerSet(pack, picks({ character: "char.sage", path: "path.deep_study" }), seed);
      expect(offer).toHaveLength(5);
      expect(new Set(offer).size).toBe(5);
      expect(offer).toContain("skill.t_wis");
    }
    const one = packOf([BRUTE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, T_VIT, T_CUN, T_AGI, T_WIS]);
    for (const seed of SEEDS.slice(0, 50)) {
      const offer = offerSet(one, picks(), seed);
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      expect(offer).toContain("skill.t_vit");
    }
  });

  it("\"scales with\" reads every effect: a technique whose second effect scales with Vitality is favoured", () => {
    // Brute-favoured: T_TWO (second effect, Vitality) and T_VIT. Both are always offered; the third is one of
    // the four others. Reading only the first effect would leave T_TWO out of some offers.
    const two = packOf([BRUTE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, T_TWO, T_VIT, T_CUN, T_AGI, T_WIS, T_ARC]);
    for (const seed of SEEDS) {
      const offer = offerSet(two, picks(), seed);
      expect(offer).toHaveLength(3);
      expect(offer).toContain("skill.t_two");
      expect(offer).toContain("skill.t_vit");
    }
  });

  it("a small pool gives a shorter offer", () => {
    const two = packOf([BRUTE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, T_CUN, T_WIS]);
    expect([...offerSet(two, picks(), "a")].sort()).toEqual(["skill.t_cun", "skill.t_wis"]);
    const sage = packOf([SAGE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, T_CUN, T_WIS, T_AGI, ...ALL_FILES.filter((f) => f.path === "path.deep_study.json")]);
    expect([...offerSet(sage, picks({ character: "char.sage", path: "path.deep_study" }), "a")].sort()).toEqual(["skill.t_agi", "skill.t_cun", "skill.t_wis"]);
  });

  it("an empty pool, or one fully held, gives an empty offer", () => {
    const none = packOf([BRUTE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH]);
    expect(offerSet(none, picks(), "a")).toEqual([]);
    const held = packOf([BRUTE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, SCROLL_CASE, PLAIN_PATH, T_MIGHT_A]);
    expect(offerSet(held, picks({ accessory: "accessory.scroll_case" }), "a")).toEqual([]);
  });

  it("untagged skills and skills with other tags are never offered", () => {
    for (const seed of SEEDS) {
      const offer = offerSet(pack, picks({ character: "char.sage", path: "path.deep_study" }), seed);
      expect(offer).not.toContain("skill.untagged");
      expect(offer).not.toContain("skill.scroll_only");
    }
  });

  it("deterministic for the same seed, and on a derived stream", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(offerSet(pack, picks(), seed)).toEqual(offerSet(pack, picks(), seed));
      const a = techniqueOffer(pack, picks(), new RngStreams(seed).derive("loadout", "technique"));
      const b = techniqueOffer(pack, picks(), new RngStreams(seed).derive("loadout", "technique"));
      expect(a).toEqual(b);
    }
    const distinct = new Set(SEEDS.map((s) => [...offerSet(pack, picks(), s)].sort().join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("every offered id can be assembled", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const id of offerSet(pack, picks({ accessory: "accessory.scroll_case" }), seed)) {
        const cards = assemblePlayer(pack, picks({ accessory: "accessory.scroll_case" }), id).unit.cards ?? [];
        expect(cards.map((c) => c.id).slice(1)).toEqual(["skill.t_might_a", id]);
      }
    }
  });
});

describe("content: tags, powers and traits", () => {
  type Obj = Record<string, unknown>;
  const issuePaths = (files: readonly ContentFile[]) => validatePack("t", files).issues.map((i) => i.path);
  const strike = { damage: 1, damageType: "physical", scaling: [] };
  const slot = (kind: "weapon" | "armor" | "accessory" | "path", extra: Obj): ContentFile => ({
    path: "x.json",
    data: { kind, id: `${kind}.x`, name: "n", ...(kind === "weapon" ? { attack: strike } : {}), ...extra },
  });
  const skillWith = (extra: Obj, kind: "skill" | "word" = "skill"): ContentFile => ({
    path: "x.json",
    data: {
      kind,
      id: `${kind}.x`,
      name: "n",
      cooldown: 1,
      effects: [{ type: "heal", amount: 1, target: "self" }],
      ...(kind === "word" ? { glyph: "火", spoken: "Huo", meaning: "m" } : {}),
      ...extra,
    },
  });
  const rejectedAt = (files: readonly ContentFile[], field: string): void => {
    const res = validatePack("t", files);
    expect(res.pack).toBeUndefined();
    expect(res.issues.some((i) => i.path.startsWith(`x.json#${field}`))).toBe(true);
  };

  it("the loadout test pack (tags, powers and traits on every slot kind) validates", () => {
    expect(issuePaths(ALL_FILES)).toEqual([]);
  });

  it("the base pack validates and tags exactly the four starting techniques", () => {
    const pack = basePack();
    for (const id of ["skill.cleave", "skill.dirty_trick", "skill.mend", "skill.shore_up"]) {
      const d = pack.byId.get(id);
      expect(d?.kind === "skill" || d?.kind === "word" ? d.tags ?? [] : []).toContain("technique");
    }
    const bl = pack.byId.get("skill.bloodletter");
    expect(bl?.kind === "skill" ? bl.tags ?? [] : ["?"]).not.toContain("technique");
  });

  it("accepts tags on skills and Words", () => {
    expect(issuePaths([skillWith({ tags: ["technique", "scroll"] })])).toEqual([]);
    expect(issuePaths([skillWith({ tags: ["technique"] }, "word")])).toEqual([]);
    expect(issuePaths([skillWith({ tags: [] })])).toEqual([]);
  });

  it("rejects bad tags", () => {
    rejectedAt([skillWith({ tags: "technique" })], "tags");
    rejectedAt([skillWith({ tags: [1] })], "tags");
    rejectedAt([skillWith({ tags: [""] })], "tags");
    rejectedAt([skillWith({ tags: [3] }, "word")], "tags");
  });

  for (const kind of ["weapon", "armor", "accessory", "path"] as const) {
    it(`accepts powers and traits on a ${kind}`, () => {
      expect(
        issuePaths([
          slot(kind, {
            powers: { bleedPower: 1, burnPower: 0, poisonPower: 2, stunPower: 3, paralysisPower: 1 },
            traits: {
              converts: [{ on: "tookDamage", gain: "emboldened", stacks: 1 }],
              slowDecay: [{ statuses: ["burning", "poisoned"], whose: "enemies" }],
              decayFloors: { leeching: 1 },
            },
          }),
        ]),
      ).toEqual([]);
    });
    it(`rejects a negative power on a ${kind}`, () => rejectedAt([slot(kind, { powers: { bleedPower: -1 } })], "powers"));
    it(`rejects a bad trait on a ${kind}`, () => rejectedAt([slot(kind, { traits: { converts: [{ on: "explode", gain: "thorns", stacks: 1 }] } })], "traits"));
  }

  const badPowers: readonly [string, unknown][] = [
    ["negative", { bleedPower: -1 }],
    ["not an integer", { burnPower: 1.5 }],
    ["not a number", { poisonPower: "2" }],
    ["an unknown power id", { frostPower: 1 }],
    ["not an object", [1]],
  ];
  for (const [what, powers] of badPowers) {
    it(`rejects powers: ${what}`, () => rejectedAt([slot("armor", { powers })], "powers"));
  }

  const badTraits: readonly [string, unknown][] = [
    ["traits not an object", "x"],
    ["converts not an array", { converts: { on: "deflect", gain: "thorns", stacks: 1 } }],
    ["convert with an unknown trigger", { converts: [{ on: "explode", gain: "thorns", stacks: 1 }] }],
    ["convert gaining an unknown status", { converts: [{ on: "deflect", gain: "glory", stacks: 1 }] }],
    ["convert with non-numeric stacks", { converts: [{ on: "deflect", gain: "thorns", stacks: "1" }] }],
    ["convert with 0 stacks (a convert gives at least 1)", { converts: [{ on: "deflect", gain: "thorns", stacks: 0 }] }],
    ["convert with negative stacks", { converts: [{ on: "deflect", gain: "thorns", stacks: -1 }] }],
    ["slowDecay not an array", { slowDecay: { statuses: ["burning"], whose: "own" } }],
    ["slowDecay with an unknown status", { slowDecay: [{ statuses: ["glory"], whose: "own" }] }],
    ["slowDecay with an unknown tag", { slowDecay: [{ statuses: { tag: "fire" }, whose: "own" }] }],
    ["slowDecay with a bad whose", { slowDecay: [{ statuses: ["burning"], whose: "allies" }] }],
    ["decayFloors with an unknown status", { decayFloors: { glory: 1 } }],
    ["decayFloors negative", { decayFloors: { leeching: -1 } }],
    ["decayFloors not a number", { decayFloors: { leeching: "1" } }],
  ];
  for (const [what, traits] of badTraits) {
    it(`rejects traits: ${what}`, () => rejectedAt([slot("accessory", { traits })], "traits"));
  }

  it("rejects HP or Shield on a path (only items give them)", () => {
    rejectedAt([slot("path", { hp: 5 })], "hp");
    rejectedAt([slot("path", { shield: 5 })], "shield");
  });

  it("accepts a convert with 1 stack", () => {
    expect(issuePaths([slot("accessory", { traits: { converts: [{ on: "deflect", gain: "thorns", stacks: 1 }] } })])).toEqual([]);
  });
});
