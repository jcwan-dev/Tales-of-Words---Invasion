// Test content for the rarity, relic and progress tests (not a test file itself).
// Spec Draft 1.11, "Rarity" and "Rewards and level-ups"; brief M2.4a. Builds on the loadout test content
// (loadout-pack.ts), the run test content (run-pack.ts) and the combat test content (combat-pack.ts).
import {
  chooseOption,
  startFight,
  startRun,
  type ContentFile,
  type FightSession,
  type LoadoutPicks,
  type RunContext,
  type RunState,
} from "../../src/index.ts";
import { COMBAT_FILES, combatAct, combatRegistry, enemyFile, fightAct, groupFile, move } from "./combat-pack.ts";
import { picks } from "./loadout-pack.ts";
import { ok, runPack } from "./run-pack.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

/** A weapon: Strike `damage` physical + `per` per Might (defaults: Club-like 2 + 1 per Might). */
const weapon = (id: string, extra: Obj = {}, damage = 2, per = 1): ContentFile =>
  file({ kind: "weapon", id, name: `${id}.name`, attack: { damage, damageType: "physical", scaling: [{ stat: "might", per }] }, ...extra });
const armor = (id: string, extra: Obj = {}): ContentFile => file({ kind: "armor", id, name: `${id}.name`, ...extra });
const accessory = (id: string, extra: Obj = {}): ContentFile => file({ kind: "accessory", id, name: `${id}.name`, ...extra });
const path = (id: string, extra: Obj = {}): ContentFile => file({ kind: "path", id, name: `${id}.name`, ...extra });
export const relic = (id: string, extra: Obj = {}): ContentFile => file({ kind: "relic", id, name: `${id}.name`, ...extra });

// ---------------------------------------------------------------------------------------------
// Items and paths

/** The spec's Strike: "4 damage +2 per Might", +1 Might (Brute Might 3 + 1 = 4). No startRarity. */
export const LONGSWORD = weapon("weapon.longsword", { stats: { might: 1 } }, 4, 2);
/** The same Strike, but its own Strike starts green (startRarity on the weapon, keyed by its own id). */
export const BLESSED = weapon("weapon.blessed", { stats: { might: 1 }, startRarity: { "weapon.blessed": "green" } }, 4, 2);
/** A weapon giving 4 Shield, for Shield recomputation on a swap. */
export const KNIFE = weapon("weapon.knife", { shield: 4 });

/** startRarity: t_might_a purple, the Club's Strike blue. */
export const TUTOR = armor("armor.tutor", { startRarity: { "skill.t_might_a": "purple", "weapon.club": "blue" } });
/** +25 HP (Brute: 35 + 25 = 60). */
export const QUILTED = armor("armor.quilted", { hp: 25 });
/** +35 HP (Brute: 35 + 35 = 70). */
export const PLATE = armor("armor.plate", { hp: 35 });
/** +2 Vitality, +10 HP, +5 Shield (Brute: 20 + 5 × 5 + 10 = 55). */
export const MAIL = armor("armor.mail", { stats: { vitality: 2 }, hp: 10, shield: 5 });

/** Grants t_vit and starts it orange. */
export const CHARM = accessory("accessory.charm", { grants: "skill.t_vit", startRarity: { "skill.t_vit": "orange" } });
/** Grants t_cun, no startRarity. */
export const FOCUS = accessory("accessory.focus", { grants: "skill.t_cun" });

/** startRarity: t_might_a green, the Club's Strike orange. */
export const MENTOR = path("path.mentor", { startRarity: { "skill.t_might_a": "green", "weapon.club": "orange" } });

// ---------------------------------------------------------------------------------------------
// Relics

/** Start every fight Warded 1 (the spec's Pilgrim's Bell). */
export const BELL = relic("relic.bell", { statuses: { warded: 1 } });
/** +10 HP. */
export const HEART = relic("relic.heart", { hp: 10 });
/** +1 Might. */
export const STONE = relic("relic.stone", { stats: { might: 1 } });
/** +1 Vitality (max HP +5). */
export const VIGOUR = relic("relic.vigour", { stats: { vitality: 1 } });
/** Every field: stats, Shield, powers, traits, starting statuses. */
export const RICH = relic("relic.rich", {
  stats: { agility: 1, cunning: 2 },
  shield: 4,
  powers: { bleedPower: 2, paralysisPower: 1 },
  traits: {
    converts: [{ on: "deflect", gain: "emboldened", stacks: 1 }],
    slowDecay: [{ statuses: ["poisoned"], whose: "enemies" }],
    decayFloors: { leeching: 5, thorns: 1 },
  },
  statuses: { warded: 2, thorns: 3 },
});
/** A second traits relic, so relic order shows in the combined lists. */
export const SECOND = relic("relic.second", {
  powers: { bleedPower: 1 },
  traits: { converts: [{ on: "attacked", gain: "thorns", stacks: 2 }], slowDecay: [{ statuses: ["thorns"], whose: "own" }] },
});

export const RELIC_IDS = ["relic.bell", "relic.heart", "relic.stone", "relic.vigour", "relic.rich", "relic.second"] as const;

// ---------------------------------------------------------------------------------------------
// A sturdy enemy for damage readings

/** 500 HP, no Shield, all stats 2; "tap": 1 damage. */
export const POST = enemyFile("enemy.post", { hp: 500, moves: [move("enemy.post", "tap", 1)] });
export const POST_GROUP = groupFile("group.post", "normal", ["enemy.post"]);

export const PROGRESS_FILES: readonly ContentFile[] = [
  LONGSWORD, BLESSED, KNIFE,
  TUTOR, QUILTED, PLATE, MAIL,
  CHARM, FOCUS,
  MENTOR,
  BELL, HEART, STONE, VIGOUR, RICH, SECOND,
  POST, POST_GROUP,
];

/**
 * A run context over the loadout test content (Brute: Might and Vitality favoured), the combat test content, the
 * progress content and `acts` (default: the combat test act), with the real combat module.
 */
export function progressCtx(acts: readonly ContentFile[] = [combatAct()]): RunContext {
  return { pack: runPack([...COMBAT_FILES, ...PROGRESS_FILES, ...acts]), registry: combatRegistry().registry };
}

/** Starts a run (Brute, neutral items unless overridden; technique t_might_a unless given). */
export function startProgressRun(ctx: RunContext, over: Partial<LoadoutPicks> = {}, technique: string | null = "skill.t_might_a", seed = "seed"): RunState {
  return startRun(ctx, { seed, picks: picks(over), technique }).run;
}

/** A run whose step 1 is a fight against group.post (500 HP), with the fight started. */
export function postFight(over: Partial<LoadoutPicks>, prepare: (ctx: RunContext, run: RunState) => void = () => {}): { ctx: RunContext; run: RunState; session: FightSession } {
  const ctx = progressCtx([fightAct("group.post")]);
  const run = startProgressRun(ctx, over, null);
  prepare(ctx, run);
  ok(chooseOption(ctx, run, 0));
  return { ctx, run, session: startFight(ctx, run) };
}

/** JSON copy, for before/after comparisons. */
export const snap = (run: RunState): string => JSON.stringify(run);
