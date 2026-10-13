// Test content and helpers for the reward screen tests (not a test file itself).
// Spec Draft 1.11, "Rewards and level-ups" incl. "After-fight flow (decided 12 Oct 2026, M2.4b)", "Rarity", "Run map",
// "Combat node"; brief M2.4b. A small pack whose reward pool is known exactly (skills and Words, items, relics), acts
// with `rewards` tables, and two ways to reach the after-fight flow: fake nodes (run-pack.ts) whose results carry a
// `rewardTier`, and real fights (combat-pack.ts).
import {
  chooseOption,
  completeNode,
  finishFight,
  startFight,
  startRun,
  validatePack,
  type CommandResult,
  type ContentFile,
  type ContentPack,
  type GroupTier,
  type LoadoutPicks,
  type Rarity,
  type RewardCard,
  type RunContext,
  type RunEvent,
  type RunState,
} from "../../src/index.ts";
import { COMBAT_FILES, combatRegistry, groupFile, STRIKE, strikeUntilOver } from "./combat-pack.ts";
import { BRUTE, CLUB, DEEP_STUDY, PLAIN_ACCESSORY, PLAIN_ARMOR, PLAIN_PATH, SAGE, STUDY } from "./loadout-pack.ts";
import { actFile, BOSS, makeRegistry, ok, runPack } from "./run-pack.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

/** A one-effect skill (cooldown 1, 1 + Might physical damage on the chosen enemy). Content has no rarity field. */
export const skillFile = (id: string, over: Obj = {}): ContentFile =>
  file({
    kind: "skill",
    id,
    name: `${id}.name`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy", scaling: [{ stat: "might", per: 1 }] }],
    ...over,
  });

/** A one-effect Word (cooldown 1, 1 + Arcana arcane damage). */
export const wordFile = (id: string, over: Obj = {}): ContentFile =>
  file({
    kind: "word",
    id,
    name: `${id}.name`,
    glyph: "火",
    spoken: "Huo",
    meaning: `${id}.meaning`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "arcane", amount: 1, target: "enemy", scaling: [{ stat: "arcana", per: 1 }] }],
    ...over,
  });

export const weaponFile = (id: string, over: Obj = {}): ContentFile =>
  file({ kind: "weapon", id, name: `${id}.name`, attack: { damage: 2, damageType: "physical", scaling: [{ stat: "might", per: 1 }] }, ...over });
export const armorFile = (id: string, over: Obj = {}): ContentFile => file({ kind: "armor", id, name: `${id}.name`, ...over });
export const accessoryFile = (id: string, over: Obj = {}): ContentFile => file({ kind: "accessory", id, name: `${id}.name`, ...over });
export const relicFile = (id: string, over: Obj = {}): ContentFile => file({ kind: "relic", id, name: `${id}.name`, ...over });

// ---------------------------------------------------------------------------------------------
// The reward pool

/** Six skills and three Words (ids in a known order: skill.s1..s6 < word.w1..w3). */
export const S1 = skillFile("skill.s1");
export const S2 = skillFile("skill.s2");
export const S3 = skillFile("skill.s3");
export const S4 = skillFile("skill.s4");
export const S5 = skillFile("skill.s5");
export const S6 = skillFile("skill.s6");
export const W1 = wordFile("word.w1");
export const W2 = wordFile("word.w2");
export const W3 = wordFile("word.w3");
/** Granted by accessory.charm (which starts it purple) and accessory.twin (no startRarity). */
export const GRANTED = skillFile("skill.granted");

export const SKILL_FILES: readonly ContentFile[] = [S1, S2, S3, S4, S5, S6, W1, W2, W3];
export const SKILL_IDS = ["skill.s1", "skill.s2", "skill.s3", "skill.s4", "skill.s5", "skill.s6", "word.w1", "word.w2", "word.w3"] as const;

/** +1 Agility. */
export const SPEAR = weaponFile("weapon.spear", { stats: { agility: 1 } });
/** Its own Strike starts green (startRarity keyed by its own id). */
export const BLESSED = weaponFile("weapon.blessed", { startRarity: { "weapon.blessed": "green" } });
/** +10 HP. */
export const MAIL = armorFile("armor.mail", { hp: 10 });
/** +2 Vitality, +4 Shield. */
export const BULWARK = armorFile("armor.bulwark", { stats: { vitality: 2 }, shield: 4 });
/** Grants skill.granted and starts it purple. */
export const CHARM = accessoryFile("accessory.charm", { grants: "skill.granted", startRarity: { "skill.granted": "purple" } });
/** Grants skill.granted too, no startRarity. */
export const TWIN = accessoryFile("accessory.twin", { grants: "skill.granted" });
/** +2 Intelligence. */
export const RING = accessoryFile("accessory.ring", { stats: { intelligence: 2 } });
/** +6 HP. */
export const AMULET = accessoryFile("accessory.amulet", { hp: 6 });

/**
 * Reward items (the starting club, plain armor and plain accessory are items too, but equipped). The charm and the
 * twin are left out by default: they bring skill.granted into the skill pool; tests pass them in `items`.
 */
export const ITEM_FILES: readonly ContentFile[] = [SPEAR, BLESSED, MAIL, BULWARK, RING, AMULET];
export const ITEM_IDS = ["weapon.spear", "weapon.blessed", "armor.mail", "armor.bulwark", "accessory.ring", "accessory.amulet"] as const;

/** +10 HP. */
export const HEART = relicFile("relic.heart", { hp: 10 });
/** +2 Intelligence. */
export const MIND = relicFile("relic.mind", { stats: { intelligence: 2 } });
/** Start every fight Warded 1. */
export const BELL = relicFile("relic.bell", { statuses: { warded: 1 } });

export const RELIC_FILES: readonly ContentFile[] = [HEART, MIND, BELL];
export const RELIC_IDS = ["relic.bell", "relic.heart", "relic.mind"] as const;

/** Characters, starting items and paths: always in the pack. Brute Intelligence 2; Sage 3 (+1 Study, +3 Deep Study). */
export const BASE_RS_FILES: readonly ContentFile[] = [BRUTE, SAGE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, STUDY, DEEP_STUDY];

// ---------------------------------------------------------------------------------------------
// Tables and acts

export interface TableSpec {
  readonly kinds: Obj;
  readonly rarity: Obj;
  readonly crowns: { readonly min: number; readonly max: number };
}

/** Skill 2 / item 1 / crowns 1; grey 3 / green 2 / blue 1; crowns 10-20. */
export const DEFAULT_TABLE: TableSpec = {
  kinds: { skill: 2, item: 1, crowns: 1 },
  rarity: { grey: 3, green: 2, blue: 1 },
  crowns: { min: 10, max: 20 },
};

export const table = (over: Partial<TableSpec> = {}): TableSpec => ({ ...DEFAULT_TABLE, ...over });

/** The same table for all four tiers. */
export const allTiers = (t: TableSpec): Obj => ({ normal: t, hard: t, elite: t, boss: t });

export const SKILL_ONLY: TableSpec = table({ kinds: { skill: 1 } });
export const ITEM_ONLY: TableSpec = table({ kinds: { item: 1 } });
export const CROWNS_ONLY: TableSpec = table({ kinds: { crowns: 1 } });
/** Every rarity at the same weight. */
export const ALL_RARITIES: Obj = { grey: 1, green: 1, blue: 1, purple: 1, orange: 1 };

/**
 * The reward test act: first, steps 4-4, weights { event: 1 } (every drawn option is a fake event), run-pack's fake
 * boss (type "combat", ref group.boss, which isn't in these packs, so the act can't fight) at the last step, no
 * routes, `rewards` = `rewards` (default: DEFAULT_TABLE for every tier; null: no rewards). `over` replaces whole fields.
 */
export function rsAct(id = "act.r", rewards: Obj | null = allTiers(DEFAULT_TABLE), over: Obj = {}): ContentFile {
  return actFile(id, { first: true, steps: { min: 4, max: 4 }, weights: { event: 1 }, fixed: [BOSS], rewards: rewards ?? undefined, ...over });
}

export interface RsOptions {
  /** The table for every tier (default DEFAULT_TABLE). Ignored when `acts` or `rewards` is given. */
  readonly table?: TableSpec;
  /** `rewards` of the default act (tier → table). Ignored when `acts` is given. */
  readonly rewards?: Obj;
  /** Skills and Words (default SKILL_FILES). */
  readonly skills?: readonly ContentFile[];
  /** Reward items (default ITEM_FILES; GRANTED joins the skills when CHARM or TWIN is in). */
  readonly items?: readonly ContentFile[];
  /** Relics (default RELIC_FILES). */
  readonly relics?: readonly ContentFile[];
  /** More files. */
  readonly extra?: readonly ContentFile[];
  /** The act files (default [rsAct("act.r", rewards)]). */
  readonly acts?: readonly ContentFile[];
  /** Load the files in reverse order. */
  readonly reverse?: boolean;
  /** Load the files in a scrambled (but fixed) order: sorted by their path read backwards. */
  readonly shuffle?: boolean;
}

export function rsFiles(opts: RsOptions = {}): ContentFile[] {
  const items = opts.items ?? ITEM_FILES;
  const needsGranted = items.includes(CHARM) || items.includes(TWIN);
  const skills = opts.skills ?? SKILL_FILES;
  const granted = needsGranted && !skills.includes(GRANTED) ? [GRANTED] : [];
  const acts = opts.acts ?? [rsAct("act.r", opts.rewards ?? allTiers(opts.table ?? DEFAULT_TABLE))];
  const files = [...BASE_RS_FILES, ...skills, ...granted, ...items, ...(opts.relics ?? RELIC_FILES), ...(opts.extra ?? []), ...acts];
  if (opts.shuffle === true) {
    const key = (f: ContentFile): string => [...f.path].reverse().join("");
    return files.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  return opts.reverse === true ? files.reverse() : files;
}

export function rsPack(opts: RsOptions = {}): ContentPack {
  const res = validatePack("rewards", rsFiles(opts));
  if (!res.pack) throw new Error(`reward test pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
  return res.pack;
}

/** A run context over `rsPack(opts)` and the fake registry (event, combat, merchant). */
export function rsCtx(opts: RsOptions = {}): RunContext {
  return { pack: rsPack(opts), registry: makeRegistry().registry };
}

/** Brute (Might and Vitality favoured, Intelligence 2), club, plain armor and accessory, plain path. Max HP 35. */
export const RS_PICKS: LoadoutPicks = {
  character: "char.brute",
  weapon: "weapon.club",
  armor: "armor.plain",
  accessory: "accessory.plain",
  path: "path.plain",
};

/** Sage + Study: Intelligence 4 (4 cards). */
export const SAGE_4: Partial<LoadoutPicks> = { character: "char.sage", path: "path.study" };
/** Sage + Deep Study: Intelligence 6 (5 cards). */
export const SAGE_6: Partial<LoadoutPicks> = { character: "char.sage", path: "path.deep_study" };

/** Starts a run (no technique). Brute by default: cards ["weapon.club"], max HP 35. */
export function startRs(ctx: RunContext, seed = "seed", over: Partial<LoadoutPicks> = {}): RunState {
  return startRun(ctx, { seed, picks: { ...RS_PICKS, ...over }, technique: null }).run;
}

/** Replaces the held cards (and their rarities: grey when not given). */
export function setHand(run: RunState, cards: readonly string[], rarities: Readonly<Record<string, Rarity>> = {}): void {
  run.player.cards = [...cards];
  const r: Record<string, Rarity> = {};
  for (const id of cards) r[id] = rarities[id] ?? "grey";
  run.player.rarities = r;
}

/** Enters option 0 of the current step and completes it with `rewardTier` and an HP change. Returns the events. */
export function toRewards(ctx: RunContext, run: RunState, tier: GroupTier, hp = 0): readonly RunEvent[] {
  ok(chooseOption(ctx, run, 0));
  return ok(completeNode(ctx, run, { hp, rewardTier: tier }));
}

/** Moves on with plain results (no rewardTier) until the run is at `step` in phase "choosing". */
export function advancePlain(ctx: RunContext, run: RunState, step: number): void {
  while (run.step < step) {
    ok(chooseOption(ctx, run, 0));
    ok(completeNode(ctx, run, {}));
  }
}

/** A fresh run in its first after-fight flow (step 1, `tier`), with hand and stats prepared first. */
export function rsRun(
  ctx: RunContext,
  opts: { seed?: string; picks?: Partial<LoadoutPicks>; hand?: readonly string[]; rarities?: Readonly<Record<string, Rarity>>; tier?: GroupTier; hp?: number; prepare?: (run: RunState) => void } = {},
): { run: RunState; events: readonly RunEvent[] } {
  const run = startRs(ctx, opts.seed ?? "seed", opts.picks ?? {});
  if (opts.hand !== undefined) setHand(run, opts.hand, opts.rarities ?? {});
  opts.prepare?.(run);
  const events = toRewards(ctx, run, opts.tier ?? "normal", opts.hp ?? 0);
  return { run, events };
}

// ---------------------------------------------------------------------------------------------
// Reading a screen

/** The current screen's cards (throws if there is no screen). */
export function screen(run: RunState): readonly RewardCard[] {
  const r = run.rewards;
  if (r === null) throw new Error(`no rewards screen (phase ${run.phase})`);
  return r.cards;
}

/** The id a card names, or null for a purse. */
export const cardId = (c: RewardCard): string | null => (c.kind === "crowns" ? null : c.id);

/** The ids the cards name (purses left out). */
export const ids = (cards: readonly RewardCard[]): string[] => cards.flatMap((c) => (c.kind === "crowns" ? [] : [c.id]));

export const countKind = (cards: readonly RewardCard[], kind: RewardCard["kind"]): number => cards.filter((c) => c.kind === kind).length;

/** Index of the first card matching `pred` (throws if none). */
export function indexWhere(run: RunState, pred: (c: RewardCard) => boolean): number {
  const i = screen(run).findIndex(pred);
  if (i < 0) throw new Error(`no matching card on the screen: ${JSON.stringify(screen(run))}`);
  return i;
}

export const indexOfId = (run: RunState, id: string): number => indexWhere(run, (c) => cardId(c) === id);

/** Events as loose records, for field checks. */
export type Ev = { readonly type: string } & Record<string, unknown>;
export const evs = (events: readonly RunEvent[]): Ev[] => events as unknown as Ev[];

/** The one event of this type (throws if there isn't exactly one). */
export function eventOf(events: readonly RunEvent[], type: string): Ev {
  const found = evs(events).filter((e) => e.type === type);
  const [e] = found;
  if (found.length !== 1 || e === undefined) throw new Error(`expected one ${type} event, got ${found.length}: ${JSON.stringify(events)}`);
  return e;
}

export const REROLL = { action: "reroll", source: "ad" } as const;
export const REVIVE = { action: "revive", source: "ad" } as const;

export const seeds = (n: number, prefix = "s"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

export const reasonOf = (res: CommandResult): string | null => (res.ok ? null : res.reason);

// ---------------------------------------------------------------------------------------------
// Real fights

/** A one-dummy boss-tier group, beatable with Strike. */
export const WEAK_BOSS = groupFile("group.weak_boss", "boss", ["enemy.dummy"]);

/** One table for every tier, for the real-fight acts: skills, items and purses, grey to blue. */
export const FIGHT_TABLE: TableSpec = DEFAULT_TABLE;

/**
 * An act for real fights: first, steps 2-2, filler fake events, a fixed combat at `at` against `group`, the weak boss
 * last (unless `group` is fought last), groups n1 (tier band normal), rewards for every tier.
 */
export function fightRsAct(group: string, at: number | "last" = 1, over: Obj = {}): ContentFile {
  const fixed = at === "last" ? [{ at: "last", type: "combat", ref: group }] : [{ at, type: "combat", ref: group }, { at: "last", type: "combat", ref: "group.weak_boss" }];
  return actFile("act.rf", {
    first: true,
    steps: { min: 2, max: 2 },
    weights: { event: 1 },
    fixed,
    groups: ["group.n1"],
    tiers: [{ from: 1, weights: { normal: 1 } }],
    rewards: allTiers(FIGHT_TABLE),
    ...over,
  });
}

/** A context with the real combat module over the loadout and combat test content, the reward pool and `acts`. */
export function fightRsCtx(acts: readonly ContentFile[]): RunContext {
  return { pack: runPack([...COMBAT_FILES, WEAK_BOSS, ...SKILL_FILES, ...RELIC_FILES, ...acts]), registry: combatRegistry().registry };
}

/**
 * Plays the fixed fight against `group` (at step 1, or at the last step after a filler event) with Strike every turn
 * and hands it to the run. The player: Brute, club, locket, ruled path (combat-pack's FIGHT_PICKS), no technique.
 */
export function winFight(group: string, at: 1 | "last" = 1, seed = "seed"): { ctx: RunContext; run: RunState; events: readonly RunEvent[] } {
  const ctx = fightRsCtx([fightRsAct(group, at)]);
  const run = startRun(ctx, { seed, picks: { ...RS_PICKS, accessory: "accessory.locket", path: "path.ruled" }, technique: null }).run;
  if (at === "last") advancePlain(ctx, run, run.steps);
  ok(chooseOption(ctx, run, 0));
  const session = startFight(ctx, run);
  strikeUntilOver(session, STRIKE);
  return { ctx, run, events: ok(finishFight(ctx, run, session)) };
}
