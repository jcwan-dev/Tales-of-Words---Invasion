// Test content and helpers for the rewards tests (not a test file itself).
// Spec Draft 1.11, "Rewards, items and level-ups"; brief M2.4. A small pack whose reward pool is known exactly
// (skills, Words and items of each rarity), acts with `rewards` tables, and fake node types (run-pack.ts) whose
// results carry a `rewardTier`, so the rewards phase is reached without fighting.
import {
  chooseOption,
  completeNode,
  startRun,
  validatePack,
  type CommandResult,
  type ContentFile,
  type ContentPack,
  type GroupTier,
  type LoadoutPicks,
  type RewardOption,
  type RunContext,
  type RunEvent,
  type RunState,
} from "../../src/index.ts";
import { BRUTE, CLUB, CRUSHING, DEEP_STUDY, PLAIN_ACCESSORY, PLAIN_ARMOR, PLAIN_PATH, SAGE, STUDY } from "./loadout-pack.ts";
import { actFile, BOSS, makeRegistry, ok } from "./run-pack.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

/** `rarity` only when given, so some files rely on the default (common). */
const withRarity = (rarity: string | undefined): Obj => (rarity === undefined ? {} : { rarity });

/** A one-effect skill (cooldown 1, 1 + Might physical damage on the chosen enemy). */
export const skillFile = (id: string, rarity?: string, over: Obj = {}): ContentFile =>
  file({
    kind: "skill",
    id,
    name: `${id}.name`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "physical", amount: 1, target: "enemy", scaling: [{ stat: "might", per: 1 }] }],
    ...withRarity(rarity),
    ...over,
  });

/** A one-effect Word (cooldown 1, 1 + Arcana arcane damage). */
export const wordFile = (id: string, rarity?: string, over: Obj = {}): ContentFile =>
  file({
    kind: "word",
    id,
    name: `${id}.name`,
    glyph: "火",
    spoken: "Huo",
    meaning: `${id}.meaning`,
    cooldown: 1,
    effects: [{ type: "damage", damageType: "arcane", amount: 1, target: "enemy", scaling: [{ stat: "arcana", per: 1 }] }],
    ...withRarity(rarity),
    ...over,
  });

export const weaponFile = (id: string, rarity?: string, over: Obj = {}): ContentFile =>
  file({
    kind: "weapon",
    id,
    name: `${id}.name`,
    attack: { damage: 2, damageType: "physical", scaling: [{ stat: "might", per: 1 }] },
    ...withRarity(rarity),
    ...over,
  });

export const armorFile = (id: string, rarity?: string, over: Obj = {}): ContentFile =>
  file({ kind: "armor", id, name: `${id}.name`, ...withRarity(rarity), ...over });

export const accessoryFile = (id: string, rarity?: string, over: Obj = {}): ContentFile =>
  file({ kind: "accessory", id, name: `${id}.name`, ...withRarity(rarity), ...over });

// ---------------------------------------------------------------------------------------------
// The reward pool

// Skills and Words. c1-c3 and word.c6 have no rarity field (common by default); c4, c5 say "common".
export const C1 = skillFile("skill.c1");
export const C2 = skillFile("skill.c2");
export const C3 = skillFile("skill.c3");
export const C4 = skillFile("skill.c4", "common");
export const C5 = skillFile("skill.c5", "common");
export const C6 = wordFile("word.c6");
export const U1 = skillFile("skill.u1", "uncommon");
export const U2 = skillFile("skill.u2", "uncommon");
export const U3 = skillFile("skill.u3", "uncommon");
export const U4 = skillFile("skill.u4", "uncommon");
export const U5 = wordFile("word.u5", "uncommon");
export const U6 = wordFile("word.u6", "uncommon");
export const R1 = skillFile("skill.r1", "rare");
export const R2 = skillFile("skill.r2", "rare");
export const R3 = wordFile("word.r3", "rare");
/** Granted by accessory.charm (common) and accessory.sigil (uncommon); also in the skill pool. */
export const GRANTED = skillFile("skill.granted");
export const GRANTED2 = skillFile("skill.granted2", "uncommon");

export const SKILL_FILES: readonly ContentFile[] = [C1, C2, C3, C4, C5, C6, U1, U2, U3, U4, U5, U6, R1, R2, R3, GRANTED, GRANTED2];

// Items (the loadout picks use club, plain armor and plain accessory, which are items too).
/** +1 Agility. */
export const SPEAR = weaponFile("weapon.spear", "common", { stats: { agility: 1 } });
/** +2 Might. */
export const AXE = weaponFile("weapon.axe", "uncommon", { stats: { might: 2 } });
/** +1 Might, +5 HP, +2 Shield. */
export const GLAIVE = weaponFile("weapon.glaive", "rare", { stats: { might: 1 }, hp: 5, shield: 2 });
/** +10 HP. */
export const MAIL = armorFile("armor.mail", "common", { hp: 10 });
/** +2 Vitality, +4 Shield. */
export const BULWARK = armorFile("armor.bulwark", "uncommon", { stats: { vitality: 2 }, shield: 4 });
/** Grants skill.granted. */
export const CHARM = accessoryFile("accessory.charm", "common", { grants: "skill.granted" });
/** +2 Intelligence. */
export const RING = accessoryFile("accessory.ring", "uncommon", { stats: { intelligence: 2 } });
/** Grants skill.granted2. */
export const SIGIL = accessoryFile("accessory.sigil", "rare", { grants: "skill.granted2" });
/** Grants skill.granted, like the charm (not in FULL_POOL). */
export const TWIN_CHARM = accessoryFile("accessory.twin_charm", "common", { grants: "skill.granted" });
/** +6 HP. */
export const AMULET = accessoryFile("accessory.amulet", "rare", { hp: 6 });

/** Reward items. CRUSHING (loadout-pack: −4 Vitality, +10 HP, +3 Shield, no rarity field) is common. */
export const ITEM_FILES: readonly ContentFile[] = [SPEAR, AXE, GLAIVE, MAIL, BULWARK, CRUSHING, CHARM, RING, SIGIL, AMULET];

export const FULL_POOL: readonly ContentFile[] = [...SKILL_FILES, ...ITEM_FILES];

/** Characters, the starting items and paths: always in the pack. Club, plain armor and plain accessory are items too. */
export const BASE_REWARD_FILES: readonly ContentFile[] = [BRUTE, SAGE, CLUB, PLAIN_ARMOR, PLAIN_ACCESSORY, PLAIN_PATH, STUDY, DEEP_STUDY];

/** The rarity of a pool file, as the spec reads it (missing = common). */
export const rarityOf = (f: ContentFile): string => {
  const r = (f.data as Obj)["rarity"];
  return typeof r === "string" ? r : "common";
};
export const idOf = (f: ContentFile): string => String((f.data as Obj)["id"]);
export const kindOf = (f: ContentFile): string => String((f.data as Obj)["kind"]);

/** Ids of the skill/Word (or item) files of `files` with this rarity. */
export const skillIds = (files: readonly ContentFile[], rarity?: string): string[] =>
  files.filter((f) => (kindOf(f) === "skill" || kindOf(f) === "word") && (rarity === undefined || rarityOf(f) === rarity)).map(idOf);
export const itemIds = (files: readonly ContentFile[], rarity?: string): string[] =>
  files.filter((f) => ["weapon", "armor", "accessory"].includes(kindOf(f)) && (rarity === undefined || rarityOf(f) === rarity)).map(idOf);

// ---------------------------------------------------------------------------------------------
// Tables and acts

export interface TableSpec {
  readonly kinds: Obj;
  readonly rarity: Obj;
  readonly crowns: { readonly min: number; readonly max: number };
}

/** Skill 2 / item 1 / crowns 1; common 3 / uncommon 2 / rare 1; crowns 10-20. */
export const DEFAULT_TABLE: TableSpec = {
  kinds: { skill: 2, item: 1, crowns: 1 },
  rarity: { common: 3, uncommon: 2, rare: 1 },
  crowns: { min: 10, max: 20 },
};

/** A table with the default rarity and crowns, and the given kinds (or other fields). */
export const table = (over: Partial<TableSpec> = {}): TableSpec => ({ ...DEFAULT_TABLE, ...over });

/** The same table for all four tiers. */
export const allTiers = (t: TableSpec): Obj => ({ normal: t, hard: t, elite: t, boss: t });

/**
 * The rewards test act: first, steps 4-4, weights { event: 1 } (every drawn option is a fake event), the fake boss
 * (type "combat", run-pack's BOSS) at the last step, no routes, `rewards` = the same table for every tier.
 * `over` replaces whole fields.
 */
export function rewardsAct(id = "act.r", t: TableSpec = DEFAULT_TABLE, over: Obj = {}): ContentFile {
  return actFile(id, { first: true, steps: { min: 4, max: 4 }, weights: { event: 1 }, fixed: [BOSS], rewards: allTiers(t), ...over });
}

export interface RewardsCtxOptions {
  /** The table for every tier (default DEFAULT_TABLE). Ignored when `acts` is given. */
  readonly table?: TableSpec;
  /** The reward pool files (default FULL_POOL). BASE_REWARD_FILES are always added. */
  readonly pool?: readonly ContentFile[];
  /** More files (other items, acts...). */
  readonly extra?: readonly ContentFile[];
  /** The act files (default [rewardsAct("act.r", table)]). */
  readonly acts?: readonly ContentFile[];
}

export function rewardsPack(opts: RewardsCtxOptions = {}): ContentPack {
  const acts = opts.acts ?? [rewardsAct("act.r", opts.table ?? DEFAULT_TABLE)];
  const res = validatePack("rewards", [...BASE_REWARD_FILES, ...(opts.pool ?? FULL_POOL), ...(opts.extra ?? []), ...acts]);
  if (!res.pack) throw new Error(`rewards test pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
  return res.pack;
}

/** A run context over `rewardsPack(opts)` and the fake registry (event, combat, merchant). */
export function rewardsCtx(opts: RewardsCtxOptions = {}): RunContext {
  return { pack: rewardsPack(opts), registry: makeRegistry().registry };
}

/** Brute (Might and Vitality favoured, Intelligence 2), club, plain armor and accessory, plain path. Max HP 35. */
export const REWARD_PICKS: LoadoutPicks = {
  character: "char.brute",
  weapon: "weapon.club",
  armor: "armor.plain",
  accessory: "accessory.plain",
  path: "path.plain",
};

/** Starts a run (no technique). Brute by default: cards ["weapon.club"], max HP 35. */
export function startRewardsRun(ctx: RunContext, seed = "seed", over: Partial<LoadoutPicks> = {}): RunState {
  return startRun(ctx, { seed, picks: { ...REWARD_PICKS, ...over }, technique: null }).run;
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

/** The current screen's options (throws if there is no screen). */
export function screen(run: RunState): readonly RewardOption[] {
  const r = run.rewards;
  if (r === null) throw new Error(`no rewards screen (phase ${run.phase})`);
  return r.options;
}

/** The id an option names (skill or item), or null for a purse. */
export const optionId = (o: RewardOption): string | null => (o.kind === "crowns" ? null : o.id);

/** Index of the first option matching `pred` (throws if none). */
export function indexWhere(run: RunState, pred: (o: RewardOption) => boolean): number {
  const i = screen(run).findIndex(pred);
  if (i < 0) throw new Error(`no matching option on the screen: ${JSON.stringify(screen(run))}`);
  return i;
}

export const indexOfId = (run: RunState, id: string): number => indexWhere(run, (o) => optionId(o) === id);

/** Events as loose records, for field checks. */
export type Ev = { readonly type: string } & Record<string, unknown>;
export const evs = (events: readonly RunEvent[]): Ev[] => events as unknown as Ev[];

/** The one event of this type (throws if there isn't exactly one). */
export function eventOf(events: readonly RunEvent[], type: string): Ev {
  const found = evs(events).filter((e) => e.type === type);
  if (found.length !== 1) throw new Error(`expected one ${type} event, got ${found.length}: ${JSON.stringify(events)}`);
  const [e] = found;
  if (e === undefined) throw new Error("unreachable");
  return e;
}

export const REROLL = { action: "reroll", source: "ad" } as const;
export const REVIVE = { action: "revive", source: "ad" } as const;

/** A seed list. */
export const seeds = (n: number, prefix = "s"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Asserts a command was refused for `reason`, as a value (no expect here: callers assert). */
export const refusedFor = (res: CommandResult): string | null => (res.ok ? null : res.reason);
