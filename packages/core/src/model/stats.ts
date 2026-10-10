/** The seven stats. Order matters for display (MIG VIT CUN AGI ARC INT WIS). */
export const STAT_IDS = [
  "might",
  "vitality",
  "cunning",
  "agility",
  "arcana",
  "intelligence",
  "wisdom",
] as const;

export type StatId = (typeof STAT_IDS)[number];

export type StatBlock = Readonly<Record<StatId, number>>;

export const isStatId = (value: unknown): value is StatId =>
  typeof value === "string" && (STAT_IDS as readonly string[]).includes(value);

/** Every character starts at 2 in all stats and 3 in its favoured stats (spec: Base characters). */
export const BASE_STAT = 2;
export const FAVOURED_START = 3;

/** Run cap for any stat (spec: Base characters). */
export const STAT_CAP = 7;

/** Level-up gain: favoured stats +2, others +1. */
export const LEVEL_UP_GAIN = { favoured: 2, other: 1 } as const;

/** Max HP = 20 + 5 per Vitality, plus HP from items (spec: Shield and HP). */
export const maxHpFromVitality = (vitality: number): number => 20 + 5 * vitality;

export function startingStats(favoured: readonly StatId[]): StatBlock {
  const block = {} as Record<StatId, number>;
  for (const id of STAT_IDS) block[id] = favoured.includes(id) ? FAVOURED_START : BASE_STAT;
  return block;
}
