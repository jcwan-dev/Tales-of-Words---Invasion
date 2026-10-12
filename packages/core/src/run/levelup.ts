/**
 * Level-ups (spec: Base characters; Rewards, items and level-ups, "Level-ups"; ADR 0012): after elite and boss
 * fights, two stats are offered (a favoured one first) among those whose base value is below the run cap; a favoured
 * stat gains +2, any other +1, never above the cap. Base stats only: items and paths can still push the final stat
 * higher. Randomness only from the rng passed in, normally `derive("levelup", actNumber, act, step)`.
 */
import type { ContentPack, GroupTier } from "../content/types.ts";
import { LEVEL_UP_GAIN, STAT_CAP, STAT_IDS, type StatId } from "../model/stats.ts";
import type { Rng } from "../rng/rng.ts";
import { loadoutTotals } from "./loadout.ts";
import type { RunEvent, RunState } from "./run.ts";

/** The fight tiers followed by a level-up: elite and each act's boss. */
export const LEVEL_UP_TIERS: readonly GroupTier[] = ["elite", "boss"];

/** Does a won fight of this tier give a level-up? */
export const levelsUp = (tier: GroupTier): boolean => LEVEL_UP_TIERS.includes(tier);

/** The character's favoured stats (throws RangeError if the pick isn't a character). */
export function favouredStats(pack: ContentPack, run: RunState): readonly StatId[] {
  const def = pack.byId.get(run.picks.character);
  if (def?.kind !== "character") throw new RangeError(`run: "${run.picks.character}" is not a character in pack "${pack.id}"`);
  return def.favoured;
}

/** Removes and returns one stat of `from`, uniformly (undefined if empty). */
function takeOne(rng: Rng, from: StatId[]): StatId | undefined {
  if (from.length === 0) return undefined;
  const [stat] = from.splice(rng.int(0, from.length - 1), 1);
  return stat;
}

/**
 * The level-up offer: eligible stats are those with a base value below the cap (in stat order). Option 1: a favoured
 * eligible stat (uniform); option 2: uniform among the other eligible stats (the other favoured one included). With
 * no favoured stat eligible, two different eligible stats (uniform). Shorter when fewer are eligible; [] when none.
 */
export function levelUpOptions(favoured: readonly StatId[], baseStats: Readonly<Record<StatId, number>>, rng: Rng): StatId[] {
  const eligible = STAT_IDS.filter((s) => baseStats[s] < STAT_CAP);
  const fav = eligible.filter((s) => favoured.includes(s));
  const options: StatId[] = [];
  const first = fav.length > 0 ? takeOne(rng, fav) : takeOne(rng, eligible);
  if (first === undefined) return options;
  options.push(first);
  const rest = eligible.filter((s) => s !== first);
  const second = rest.length > 0 ? takeOne(rng, rest) : undefined;
  if (second !== undefined) options.push(second);
  return options;
}

/**
 * Raises `stat`: +2 if favoured, +1 otherwise, capped on the base value. Max HP moves by the change of the loadout's
 * max HP formula (only a Vitality gain changes it, through the final stat with its 0 floor), and HP rises by the same
 * amount (StatRaised with the gain actually applied).
 */
export function raiseStat(pack: ContentPack, run: RunState, stat: StatId, events: RunEvent[]): void {
  const p = run.player;
  const favoured = favouredStats(pack, run).includes(stat);
  const old = p.baseStats[stat];
  const value = Math.min(STAT_CAP, old + (favoured ? LEVEL_UP_GAIN.favoured : LEVEL_UP_GAIN.other));
  const before = loadoutTotals(pack, run.picks, p.baseStats).maxHp;
  p.baseStats = { ...p.baseStats, [stat]: value };
  const change = loadoutTotals(pack, run.picks, p.baseStats).maxHp - before;
  p.maxHp += change;
  p.hp = Math.min(p.maxHp, Math.max(1, p.hp + change));
  events.push({ type: "StatRaised", stat, gain: value - old, value, maxHp: p.maxHp, hp: p.hp });
}
