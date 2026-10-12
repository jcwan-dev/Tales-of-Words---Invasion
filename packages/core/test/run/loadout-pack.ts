// Test content for the loadout tests (not a test file itself). Hand-built packs with exact numbers, so
// every expected value in loadout.test.ts can be computed by hand from the spec.
import { validatePack, type ContentFile, type ContentPack, type LoadoutPicks } from "../../src/index.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

const character = (id: string, favoured: readonly string[], eventTags: readonly string[] = []): ContentFile =>
  file({ kind: "character", id, name: `${id}.name`, favoured, eventTags });

const weapon = (id: string, extra: Obj = {}): ContentFile =>
  file({
    kind: "weapon",
    id,
    name: `${id}.name`,
    attack: { damage: 2, damageType: "physical", scaling: [{ stat: "might", per: 1 }] },
    ...extra,
  });

const armor = (id: string, extra: Obj = {}): ContentFile => file({ kind: "armor", id, name: `${id}.name`, ...extra });
const accessory = (id: string, extra: Obj = {}): ContentFile => file({ kind: "accessory", id, name: `${id}.name`, ...extra });
const path = (id: string, extra: Obj = {}): ContentFile => file({ kind: "path", id, name: `${id}.name`, ...extra });

/** A one-effect skill scaling with one stat. `tags` defaults to ["technique"]; null for no tags field. */
const skill = (id: string, stat: string, tags: readonly string[] | null = ["technique"]): ContentFile =>
  file({
    kind: "skill",
    id,
    name: `${id}.name`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy", scaling: [{ stat, per: 1 }] }],
    ...(tags === null ? {} : { tags }),
  });

const word = (id: string, stat: string, tags: readonly string[] = ["technique"]): ContentFile =>
  file({
    kind: "word",
    id,
    name: `${id}.name`,
    glyph: "火",
    spoken: "Huo",
    meaning: `${id}.meaning`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "arcane", amount: 1, target: "enemy", scaling: [{ stat, per: 1 }] }],
    tags,
  });

// Characters. Brute: Might and Vitality favoured (3), others 2. Sage: Intelligence and Wisdom favoured.
export const BRUTE = character("char.brute", ["might", "vitality"], ["brute", "strong"]);
export const SAGE = character("char.sage", ["intelligence", "wisdom"], ["sage"]);

// Neutral picks: no stats, HP, Shield, powers or traits.
export const CLUB = weapon("weapon.club");
export const PLAIN_ARMOR = armor("armor.plain");
export const PLAIN_ACCESSORY = accessory("accessory.plain");
export const PLAIN_PATH = path("path.plain");

// Stat floor and run cap.
/** +5 Might, −3 Agility: Brute Might 3 + 5 = 8 (above the run cap of 7); Agility 2 − 3 = −1, floored at 0. */
export const HEAVY = weapon("weapon.heavy", { stats: { might: 5, agility: -3 } });
/** −4 Vitality (Brute 3 − 4 → 0), +10 HP, +3 Shield. */
export const CRUSHING = armor("armor.crushing", { stats: { vitality: -4 }, hp: 10, shield: 3 });
/** +2 HP, +6 Shield (a weapon that gives both, like a buckler). */
export const BUCKLER = weapon("weapon.buckler", { hp: 2, shield: 6 });
/** +8 HP, +1 Shield. */
export const LOCKET = accessory("accessory.locket", { hp: 8, shield: 1 });

// Intelligence.
export const TOME = accessory("accessory.tome", { stats: { intelligence: 2 } });
export const STUDY = path("path.study", { stats: { intelligence: 1 } });
export const DEEP_STUDY = path("path.deep_study", { stats: { intelligence: 3 } });
export const DULLING = armor("armor.dulling", { stats: { intelligence: -1 } });

// Powers and traits, one of each slot. Every slot has a convert and a slow-decay entry, so the combined lists
// show the slot order (spec: Loadout assembly, Details: weapon, armor, accessory, path).
export const FANG = weapon("weapon.fang", {
  powers: { bleedPower: 1, stunPower: 2 },
  traits: {
    converts: [{ on: "deflect", gain: "thorns", stacks: 1 }],
    slowDecay: [{ statuses: ["bleeding"], whose: "enemies" }],
  },
});
export const THORNED = armor("armor.thorned", {
  powers: { bleedPower: 2 },
  traits: {
    decayFloors: { leeching: 1, burning: 2 },
    slowDecay: [{ statuses: ["leeching"], whose: "own" }],
    converts: [{ on: "tookDamage", gain: "thorns", stacks: 2 }],
  },
});
export const CENSER = accessory("accessory.censer", {
  powers: { burnPower: 1 },
  traits: {
    slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }],
    decayFloors: { leeching: 3 },
    converts: [{ on: "dealtDamage", gain: "kindled", stacks: 1 }],
  },
});
export const GLUTTON = path("path.glutton", {
  powers: { bleedPower: 1, poisonPower: 2 },
  traits: {
    decayFloors: { leeching: 2 },
    converts: [
      { on: "attacked", gain: "warded", stacks: 1 },
      { on: "deflect", gain: "emboldened", stacks: 1 },
    ],
    slowDecay: [{ statuses: ["emboldened"], whose: "own" }],
  },
});

// Floor once, after all modifiers: Brute Cunning 2 − 3 (Sapping) + 2 (Recovery) = 1, not 0 + 2 = 2.
export const SAPPING = weapon("weapon.sapping", { stats: { cunning: -3 } });
export const RECOVERY = path("path.recovery", { stats: { cunning: 2 } });

// Technique pool. Brute-favoured (Might or Vitality): MIGHT_A, MIGHT_B, VIT. Sage-favoured: WIS only.
export const T_MIGHT_A = skill("skill.t_might_a", "might");
export const T_MIGHT_B = skill("skill.t_might_b", "might");
export const T_VIT = skill("skill.t_vit", "vitality");
export const T_CUN = skill("skill.t_cun", "cunning");
export const T_AGI = skill("skill.t_agi", "agility");
export const T_WIS = skill("skill.t_wis", "wisdom");
/** A Word in the technique pool, scaling with Arcana. */
export const T_ARC = word("word.t_arc", "arcana");
/** Not techniques: no tags, or other tags only. */
export const UNTAGGED = skill("skill.untagged", "might", null);
export const SCROLL_ONLY = skill("skill.scroll_only", "might", ["scroll"]);
/** An accessory granting a technique (so that technique is already held). */
export const SCROLL_CASE = accessory("accessory.scroll_case", { grants: "skill.t_might_a" });
/**
 * A two-effect technique: the first effect scales with Cunning, only the second with Vitality. It "scales with"
 * Vitality (spec: Loadout assembly, Details: any scaling entry in any effect), so it is Brute-favoured.
 * Not in ALL_FILES; used in its own pack.
 */
export const T_TWO = file({
  kind: "skill",
  id: "skill.t_two",
  name: "skill.t_two.name",
  cooldown: 1,
  effects: [
    { type: "damage", damageType: "physical", amount: 1, target: "enemy", scaling: [{ stat: "cunning", per: 1 }] },
    { type: "heal", amount: 1, target: "self", scaling: [{ stat: "vitality", per: 1 }] },
  ],
  tags: ["technique"],
});

export const BRUTE_FAVOURED = ["skill.t_might_a", "skill.t_might_b", "skill.t_vit"] as const;
export const TECHNIQUES = [...BRUTE_FAVOURED, "skill.t_cun", "skill.t_agi", "skill.t_wis", "word.t_arc"] as const;

export const ALL_FILES: readonly ContentFile[] = [
  BRUTE, SAGE,
  CLUB, HEAVY, BUCKLER, FANG, SAPPING,
  PLAIN_ARMOR, CRUSHING, DULLING, THORNED,
  PLAIN_ACCESSORY, LOCKET, TOME, CENSER, SCROLL_CASE,
  PLAIN_PATH, STUDY, DEEP_STUDY, GLUTTON, RECOVERY,
  T_MIGHT_A, T_MIGHT_B, T_VIT, T_CUN, T_AGI, T_WIS, T_ARC, UNTAGGED, SCROLL_ONLY,
];

/** A validated pack from the given files; throws with the issues if invalid. */
export function packOf(files: readonly ContentFile[], id = "test"): ContentPack {
  const res = validatePack(id, files);
  if (!res.pack) throw new Error(`test pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
  return res.pack;
}

/** Picks with the neutral items by default. */
export const picks = (over: Partial<LoadoutPicks> = {}): LoadoutPicks => ({
  character: "char.brute",
  weapon: "weapon.club",
  armor: "armor.plain",
  accessory: "accessory.plain",
  path: "path.plain",
  ...over,
});
