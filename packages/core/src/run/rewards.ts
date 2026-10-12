/**
 * The rewards screen's draw (spec: Rewards, items and level-ups; ADR 0012). Pure: the caller passes the pack, what
 * the player holds and wears, the tier's table, the number of Intelligence options and the screen's own rng.
 *
 * Candidates are read through content kinds and `rarity` only; no content id decides anything (code rule 2).
 * Randomness comes only from the rng passed in (code rule 3), normally
 * `derive("rewards", actNumber, act, step, rerollIndex)`, so a reroll changes nothing else in the run.
 */
import { RARITIES, REWARD_KINDS, type ContentPack, type Rarity, type RewardKind, type RewardTableDef } from "../content/types.ts";
import type { Rng } from "../rng/rng.ts";
import { pickWeighted, type WeightedType } from "./draw.ts";
import type { LoadoutPicks } from "./loadout.ts";

/** The loadout slots an item can fill. */
export type ItemSlot = "weapon" | "armor" | "accessory";
export const ITEM_SLOTS: readonly ItemSlot[] = ["weapon", "armor", "accessory"];

/** One option of a rewards screen: a skill or Word (by id), an item for its slot, or a crowns purse. */
export type RewardOption =
  | { readonly kind: "skill"; readonly id: string }
  | { readonly kind: "item"; readonly id: string; readonly slot: ItemSlot }
  | { readonly kind: "crowns"; readonly amount: number };

/** The options drawn by kind and weight before the Intelligence bonus (spec: "3 options, pick 1"). */
export const REWARD_BASE_OPTIONS = 3;

export interface RewardDrawInput {
  /** The player's cards: skills and Words held are never offered. */
  readonly cards: readonly string[];
  /** The loadout: items worn are never offered. */
  readonly picks: LoadoutPicks;
  readonly table: RewardTableDef;
  /** Extra options from Intelligence (intelligenceBonusOptions of the final stat); always skills or Words. */
  readonly bonus: number;
}

interface Candidate {
  readonly option: RewardOption;
  readonly rarity: Rarity;
}

/** The unheld skills and Words and the unworn items of the pack, in pack order. */
function candidates(pack: ContentPack, input: RewardDrawInput): { skill: Candidate[]; item: Candidate[] } {
  const skill: Candidate[] = [];
  const item: Candidate[] = [];
  const worn = ITEM_SLOTS.map((slot) => input.picks[slot]);
  for (const def of pack.byId.values()) {
    if (def.kind === "skill" || def.kind === "word") {
      if (!input.cards.includes(def.id)) skill.push({ option: { kind: "skill", id: def.id }, rarity: def.rarity ?? "common" });
    } else if (def.kind === "weapon" || def.kind === "armor" || def.kind === "accessory") {
      if (!worn.includes(def.id)) item.push({ option: { kind: "item", id: def.id, slot: def.kind }, rarity: def.rarity ?? "common" });
    }
  }
  return { skill, item };
}

/** The rarities with a weight above 0 that still have a candidate in `pool`, with their weights, in rarity order. */
function drawableRarities(pool: readonly Candidate[], table: RewardTableDef): WeightedType<Rarity>[] {
  const out: WeightedType<Rarity>[] = [];
  for (const rarity of RARITIES) {
    const weight = table.rarity[rarity] ?? 0;
    if (weight > 0 && pool.some((c) => c.rarity === rarity)) out.push({ type: rarity, weight });
  }
  return out;
}

/** A rarity by weight among the drawable ones, then one candidate of it with equal chance; removed from `pool`. */
function drawFrom(pool: Candidate[], table: RewardTableDef, rng: Rng): RewardOption | null {
  const rarities = drawableRarities(pool, table);
  if (rarities.length === 0) return null;
  const rarity = pickWeighted(rng, rarities);
  const ofRarity = pool.filter((c) => c.rarity === rarity);
  const chosen = ofRarity[rng.int(0, ofRarity.length - 1)];
  if (chosen === undefined) return null;
  pool.splice(pool.indexOf(chosen), 1);
  return chosen.option;
}

/**
 * Draws one rewards screen. The first REWARD_BASE_OPTIONS options: a kind by the table's weights among the kinds
 * still drawable (a purse at most once; skills or items while a drawable rarity has a candidate left), then a purse
 * amount uniformly in [min, max] or a candidate (drawFrom). Then `bonus` skill or Word options by the same rarity
 * rule. Never the same thing twice; shorter when the pools run out; empty when nothing at all can be offered.
 */
export function drawRewards(pack: ContentPack, input: RewardDrawInput, rng: Rng): RewardOption[] {
  const pools = candidates(pack, input);
  const options: RewardOption[] = [];
  let purse = false;
  for (let i = 0; i < REWARD_BASE_OPTIONS; i++) {
    const kinds: WeightedType<RewardKind>[] = [];
    for (const kind of REWARD_KINDS) {
      const weight = input.table.kinds[kind] ?? 0;
      if (weight <= 0) continue;
      const open = kind === "crowns" ? !purse : drawableRarities(pools[kind], input.table).length > 0;
      if (open) kinds.push({ type: kind, weight });
    }
    if (kinds.length === 0) break;
    const kind = pickWeighted(rng, kinds);
    if (kind === "crowns") {
      purse = true;
      options.push({ kind: "crowns", amount: rng.int(input.table.crowns.min, input.table.crowns.max) });
    } else {
      const option = drawFrom(pools[kind], input.table, rng);
      if (option !== null) options.push(option);
    }
  }
  for (let i = 0; i < input.bonus; i++) {
    const option = drawFrom(pools.skill, input.table, rng);
    if (option === null) break;
    options.push(option);
  }
  return options;
}
