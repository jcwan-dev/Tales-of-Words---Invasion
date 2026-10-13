/**
 * The rewards screen's draw (spec: Rewards and level-ups, "After-fight flow"; ADR 0013). Pure: the caller passes the
 * pack, what the player holds, wears and carries, the tier's table, the Intelligence bonus, whether the screen has
 * the boss relic card, and the screen's own rng.
 *
 * Candidates are read through content kinds, `upgrade` and the run's rarities; no content id decides anything (code
 * rule 2). They are taken in id order, so load order never changes a screen. Randomness comes only from the rng
 * passed in (code rule 3), normally `derive("rewards", actNumber, act, step, rerollIndex)`, so a reroll changes
 * nothing else in the run.
 */
import { REWARD_KINDS, type ContentDef, type ContentPack, type GroupTier, type RewardKind, type RewardTableDef } from "../content/types.ts";
import { RARITIES, rarityRank, type Rarity } from "../model/rarity.ts";
import type { Rng } from "../rng/rng.ts";
import { pickWeighted, type WeightedType } from "./draw.ts";
import { heldRarity, type LoadoutPicks } from "./loadout.ts";

/** The loadout slots an item card fills. */
export type ItemSlot = "weapon" | "armor" | "accessory";
export const ITEM_SLOTS: readonly ItemSlot[] = ["weapon", "armor", "accessory"];

/**
 * One card of a rewards screen. A skill or Word at a rarity (`upgrade`: held at a lower rarity, so taking it raises
 * the held card); an item for its slot; a purse of crowns; or a relic (the boss card).
 */
export type RewardCard =
  | { readonly kind: "skill"; readonly id: string; readonly rarity: Rarity; readonly upgrade: boolean }
  | { readonly kind: "item"; readonly id: string; readonly slot: ItemSlot }
  | { readonly kind: "crowns"; readonly amount: number }
  | { readonly kind: "relic"; readonly id: string };

/** Cards before the Intelligence bonus. */
export const REWARD_BASE_CARDS = 3;
/** Tiers whose screen has a relic card, and its position among the base cards (1-based: the third). */
export const RELIC_CARD_TIERS: readonly GroupTier[] = ["boss"];
export const RELIC_CARD_POSITION = 3;
/** Tiers followed by a level-up (spec: Rewards and level-ups, "Level-ups"). */
export const LEVEL_UP_TIERS: readonly GroupTier[] = ["elite", "boss"];

export interface RewardDrawInput {
  /** Held card ids (a weapon id is its Strike: never a skill card). */
  readonly cards: readonly string[];
  /** Held cards' rarities (no entry: grey). */
  readonly rarities: Readonly<Record<string, Rarity>>;
  /** Equipped items: never offered. */
  readonly picks: LoadoutPicks;
  /** Relics held: never offered. */
  readonly relics: readonly string[];
  readonly table: RewardTableDef;
  /** Intelligence bonus cards (skills or Words), after the base cards. */
  readonly bonus: number;
  /** Whether the third base card is a relic (when a relic is left). */
  readonly relicCard: boolean;
}

const byId = (a: ContentDef, b: ContentDef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface SkillCandidate {
  readonly id: string;
  /** The held rarity, or null when not held. */
  readonly held: Rarity | null;
}

interface Pools {
  /** Skills and Words not named as another's upgrade, in id order. */
  skills: SkillCandidate[];
  items: { readonly id: string; readonly slot: ItemSlot }[];
  relics: string[];
}

function poolsOf(pack: ContentPack, input: RewardDrawInput): Pools {
  const defs = [...pack.byId.values()].sort(byId);
  const upgrades = new Set<string>();
  for (const def of defs) if ((def.kind === "skill" || def.kind === "word") && def.upgrade !== undefined) upgrades.add(def.upgrade);
  const worn = ITEM_SLOTS.map((slot) => input.picks[slot]);
  const pools: Pools = { skills: [], items: [], relics: [] };
  for (const def of defs) {
    if (def.kind === "skill" || def.kind === "word") {
      if (upgrades.has(def.id)) continue;
      pools.skills.push({ id: def.id, held: input.cards.includes(def.id) ? heldRarity(input.rarities, def.id) : null });
    } else if (def.kind === "weapon" || def.kind === "armor" || def.kind === "accessory") {
      if (!worn.includes(def.id)) pools.items.push({ id: def.id, slot: def.kind });
    } else if (def.kind === "relic") {
      if (!input.relics.includes(def.id)) pools.relics.push(def.id);
    }
  }
  return pools;
}

/** A skill can be offered at `rarity` when not held, or held at a lower rarity. */
const fits = (c: SkillCandidate, rarity: Rarity): boolean => c.held === null || rarityRank(c.held) < rarityRank(rarity);

/** The rarities with a weight above 0 that have a candidate left, with their weights, lowest first. */
function drawableRarities(skills: readonly SkillCandidate[], table: RewardTableDef): WeightedType<Rarity>[] {
  const out: WeightedType<Rarity>[] = [];
  for (const rarity of RARITIES) {
    const weight = table.rarity[rarity] ?? 0;
    if (weight > 0 && skills.some((c) => fits(c, rarity))) out.push({ type: rarity, weight });
  }
  return out;
}

/** Removes and returns one entry of a non-empty list, with equal chance. */
function takeOne<T>(rng: Rng, list: T[]): T | undefined {
  const i = rng.int(0, list.length - 1);
  const [x] = list.splice(i, 1);
  return x;
}

/** A skill or Word card: a rarity by weight among those with a candidate, then a candidate with equal chance. */
function drawSkill(pools: Pools, table: RewardTableDef, rng: Rng): RewardCard | null {
  const rarities = drawableRarities(pools.skills, table);
  if (rarities.length === 0) return null;
  const rarity = pickWeighted(rng, rarities);
  const fitting = pools.skills.filter((c) => fits(c, rarity));
  const chosen = fitting[rng.int(0, fitting.length - 1)];
  if (chosen === undefined) return null;
  pools.skills.splice(pools.skills.indexOf(chosen), 1);
  return { kind: "skill", id: chosen.id, rarity, upgrade: chosen.held !== null };
}

/**
 * Draws one rewards screen (spec: After-fight flow, "Screen size", "Drawing a card", "Details"). Base cards 1-3: the
 * relic card at position 3 when `relicCard` and a relic is left; otherwise a kind by the table's weights among the
 * kinds with something left (at most one purse), then its content. A card nothing can fill is not drawn. Then `bonus`
 * skill or Word cards. No two cards name the same thing. Empty when nothing at all can be offered.
 */
export function drawRewardScreen(pack: ContentPack, input: RewardDrawInput, rng: Rng): RewardCard[] {
  const pools = poolsOf(pack, input);
  const { table } = input;
  const cards: RewardCard[] = [];
  let purse = false;
  for (let position = 1; position <= REWARD_BASE_CARDS; position++) {
    if (input.relicCard && position === RELIC_CARD_POSITION && pools.relics.length > 0) {
      const relic = takeOne(rng, pools.relics);
      if (relic !== undefined) cards.push({ kind: "relic", id: relic });
      continue;
    }
    const kinds: WeightedType<RewardKind>[] = [];
    for (const kind of REWARD_KINDS) {
      const weight = table.kinds[kind] ?? 0;
      if (weight <= 0) continue;
      const open = kind === "crowns" ? !purse : kind === "item" ? pools.items.length > 0 : drawableRarities(pools.skills, table).length > 0;
      if (open) kinds.push({ type: kind, weight });
    }
    if (kinds.length === 0) continue;
    const kind = pickWeighted(rng, kinds);
    if (kind === "crowns") {
      purse = true;
      cards.push({ kind: "crowns", amount: rng.int(table.crowns.min, table.crowns.max) });
    } else if (kind === "item") {
      const item = takeOne(rng, pools.items);
      if (item !== undefined) cards.push({ kind: "item", id: item.id, slot: item.slot });
    } else {
      const card = drawSkill(pools, table, rng);
      if (card !== null) cards.push(card);
    }
  }
  for (let i = 0; i < input.bonus; i++) {
    const card = drawSkill(pools, table, rng);
    if (card === null) break;
    cards.push(card);
  }
  return cards;
}

/** A copy of a card (event payloads and state never share objects). */
export const copyCard = (c: RewardCard): RewardCard => ({ ...c });
