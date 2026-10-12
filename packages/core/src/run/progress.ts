/**
 * Run progress (spec: Rarity; Rewards and level-ups; Skills; ADR 0012): level-ups, item swaps, relics and learning,
 * upgrading and forgetting cards. Each operation mutates the run state in place and keeps it plain data; a refused
 * or throwing operation changes nothing.
 *
 * Max HP is recomputed here (equipItem, gainRelic, applyLevelUp) from the loadout, the relics and the run's base
 * stats; everything else reads `run.player.maxHp`. Content is read through kinds and data only (code rule 2).
 * Randomness comes only from the Rng the caller passes (code rule 3).
 */
import { MAX_PLAYER_CARDS } from "../combat/unit.ts";
import type { ContentPack } from "../content/types.ts";
import { isRarity, rarityRank, type Rarity } from "../model/rarity.ts";
import { isStatId, LEVEL_UP_GAIN, STAT_CAP, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
import type { Rng } from "../rng/rng.ts";
import { heldRarity, loadoutMaxHp, loadoutStartRarity, type LoadoutPicks } from "./loadout.ts";
import type { RunState } from "./run.ts";

export type LearnRefusal = "full" | "already_held" | "not_held" | "not_higher" | "unknown_card";
export type LearnResult = { readonly ok: true } | { readonly ok: false; readonly reason: LearnRefusal };

const OK: LearnResult = { ok: true };
const refuse = (reason: LearnRefusal): LearnResult => ({ ok: false, reason });

// ---------------------------------------------------------------------------------------------
// Helpers

function favouredOf(pack: ContentPack, run: RunState): readonly StatId[] {
  const def = pack.byId.get(run.picks.character);
  if (def?.kind !== "character") throw new RangeError(`progress: "${run.picks.character}" is not a character in pack "${pack.id}"`);
  return def.favoured;
}

/** Draws one entry of a non-empty list. */
function drawOne<T>(rng: Rng, list: readonly T[]): T | undefined {
  return list[rng.int(0, list.length - 1)];
}

/**
 * HP after max HP changes from `oldMax` to `newMax`: the HP you were missing stays missing, never below 1, never above
 * the new max (spec: Rewards and level-ups, Item swaps; a level-up or a relic raises both by the same amount).
 */
function carriedHp(oldHp: number, oldMax: number, newMax: number): number {
  const hp = newMax - (oldMax - oldHp);
  return Math.min(newMax, Math.max(1, hp));
}

/** Sets max HP from the given loadout, relics and base stats, and moves HP with it. Validates before any change. */
function setBody(pack: ContentPack, run: RunState, picks: LoadoutPicks, relics: string[], baseStats: StatBlock): void {
  const newMax = loadoutMaxHp(pack, picks, baseStats, relics);
  const p = run.player;
  p.hp = carriedHp(p.hp, p.maxHp, newMax);
  p.maxHp = newMax;
  p.baseStats = baseStats;
  run.picks = picks;
  run.relics = relics;
}

/** The held cards' rarity entries, without entries for cards no longer held. */
function raritiesFor(cards: readonly string[], old: Readonly<Record<string, Rarity>>, set: string | null, rarity: Rarity | null): Record<string, Rarity> {
  const out: Record<string, Rarity> = {};
  for (const id of cards) {
    if (id === set && rarity !== null) out[id] = rarity;
    else if (Object.hasOwn(old, id)) {
      const r = old[id];
      if (r !== undefined) out[id] = r;
    }
  }
  return out;
}

function checkRarity(rarity: Rarity): void {
  if (!isRarity(rarity)) throw new RangeError(`progress: unknown rarity "${String(rarity)}"`);
}

// ---------------------------------------------------------------------------------------------
// Level-ups

/**
 * The stats a level-up offers (spec: Rewards and level-ups): first a favoured stat below the cap (drawn among them),
 * then another stat below the cap (drawn among the rest, favoured or not). With no favoured stat below the cap, one
 * stat drawn among the others below the cap; none below the cap, no level-up ([]). "Below the cap" counts base stats.
 * Doesn't change the run.
 */
export function levelUpOffer(pack: ContentPack, run: RunState, rng: Rng): readonly StatId[] {
  const favoured = favouredOf(pack, run);
  const below = STAT_IDS.filter((s) => run.player.baseStats[s] < STAT_CAP);
  const favouredBelow = below.filter((s) => favoured.includes(s));
  if (favouredBelow.length === 0) {
    const only = below.length > 0 ? drawOne(rng, below) : undefined;
    return only === undefined ? [] : [only];
  }
  const first = drawOne(rng, favouredBelow);
  if (first === undefined) return [];
  const rest = below.filter((s) => s !== first);
  const second = rest.length > 0 ? drawOne(rng, rest) : undefined;
  return second === undefined ? [first] : [first, second];
}

/**
 * Raises a base stat (spec: Rewards and level-ups): +2 if favoured, else +1, never above the cap of 7. Max HP is
 * recomputed (a Vitality rise counts through final Vitality, floor 0) and current HP rises by the same amount.
 * Throws RangeError for an unknown stat or one at the cap.
 */
export function applyLevelUp(pack: ContentPack, run: RunState, stat: StatId): void {
  if (!isStatId(stat)) throw new RangeError(`progress: unknown stat "${String(stat)}"`);
  const before = run.player.baseStats[stat];
  if (before >= STAT_CAP) throw new RangeError(`progress: ${stat} is at the cap (${STAT_CAP}) and can't rise`);
  const gain = favouredOf(pack, run).includes(stat) ? LEVEL_UP_GAIN.favoured : LEVEL_UP_GAIN.other;
  const baseStats: StatBlock = { ...run.player.baseStats, [stat]: Math.min(STAT_CAP, before + gain) };
  setBody(pack, run, run.picks, run.relics, baseStats);
}

// ---------------------------------------------------------------------------------------------
// Items and relics

/**
 * Equips a weapon, armor or accessory in its slot; the old item is gone (spec: Item swaps). Max HP is recomputed and
 * the HP you were missing stays missing (never below 1). Cards don't change: returns the card ids the new item offers
 * to learn (a weapon its Strike, an accessory its grant), unless already held. Learn them with `learnCard`, at
 * `itemOfferRarity`. Throws RangeError for an id that isn't a weapon, armor or accessory, or one already equipped.
 */
export function equipItem(pack: ContentPack, run: RunState, itemId: string): { readonly offers: readonly string[] } {
  const def = pack.byId.get(itemId);
  if (def === undefined || (def.kind !== "weapon" && def.kind !== "armor" && def.kind !== "accessory")) {
    throw new RangeError(`progress: "${itemId}" is not a weapon, armor or accessory in pack "${pack.id}"`);
  }
  const slot = def.kind;
  if (run.picks[slot] === def.id) throw new RangeError(`progress: "${itemId}" is already equipped`);
  const picks: LoadoutPicks = { ...run.picks, [slot]: def.id };
  setBody(pack, run, picks, run.relics, run.player.baseStats);

  const offered = def.kind === "weapon" ? def.id : def.kind === "accessory" ? (def.grants ?? null) : null;
  return { offers: offered !== null && !run.player.cards.includes(offered) ? [offered] : [] };
}

/** The rarity an item offer comes at (spec: Rarity): the highest startRarity for the card across the current weapon, armor, accessory and path; grey if none. */
export function itemOfferRarity(pack: ContentPack, run: RunState, cardId: string): Rarity {
  return loadoutStartRarity(pack, run.picks, cardId);
}

/**
 * Gains a relic (spec: Rewards and level-ups): appended to the run's relics. Max HP is recomputed: the relic's HP
 * (and Vitality) raise max and current HP by the same amount. Throws RangeError for an unknown relic or one held.
 */
export function gainRelic(pack: ContentPack, run: RunState, relicId: string): void {
  const def = pack.byId.get(relicId);
  if (def?.kind !== "relic") throw new RangeError(`progress: "${relicId}" is not a relic in pack "${pack.id}"`);
  if (run.relics.includes(def.id)) throw new RangeError(`progress: relic "${relicId}" is already held`);
  setBody(pack, run, run.picks, [...run.relics, def.id], run.player.baseStats);
}

// ---------------------------------------------------------------------------------------------
// Cards

const isCardId = (pack: ContentPack, id: string): boolean => {
  const kind = pack.byId.get(id)?.kind;
  return kind === "weapon" || kind === "skill" || kind === "word";
};

/**
 * Learns a card at `rarity` (spec: Skills, "Gaining a skill when full"): a skill or Word id, or a weapon id (its
 * Strike). Below 5 cards it is appended (`forget` is ignored). With 5 it takes the place of `forget`, which must be
 * held; that card and its rarity go. Refused (nothing changes): "unknown_card", "already_held" (use upgradeCard),
 * "full" (5 held, no forget), "not_held" (the forget isn't held). Throws RangeError for an unknown rarity.
 */
export function learnCard(pack: ContentPack, run: RunState, cardId: string, rarity: Rarity, forget: string | null): LearnResult {
  checkRarity(rarity);
  if (!isCardId(pack, cardId)) return refuse("unknown_card");
  const p = run.player;
  if (p.cards.includes(cardId)) return refuse("already_held");
  let cards: string[];
  if (p.cards.length < MAX_PLAYER_CARDS) cards = [...p.cards, cardId];
  else {
    if (forget === null) return refuse("full");
    const at = p.cards.indexOf(forget);
    if (at < 0) return refuse("not_held");
    cards = [...p.cards];
    cards[at] = cardId;
  }
  p.rarities = raritiesFor(cards, p.rarities, cardId, rarity);
  p.cards = cards;
  return OK;
}

/**
 * Raises a held card's rarity in its slot (spec: Rarity, "Upgrading"). Refused: "not_held", or "not_higher" unless
 * `rarity` is strictly higher than the card's (grey without an entry). Throws RangeError for an unknown rarity.
 */
export function upgradeCard(run: RunState, cardId: string, rarity: Rarity): LearnResult {
  checkRarity(rarity);
  const p = run.player;
  if (!p.cards.includes(cardId)) return refuse("not_held");
  if (rarityRank(rarity) <= rarityRank(heldRarity(p.rarities, cardId))) return refuse("not_higher");
  p.rarities = raritiesFor(p.cards, p.rarities, cardId, rarity);
  return OK;
}

/** Forgets a held card, permanently for the run (spec: Skills); its rarity entry goes. Refused: "not_held". */
export function forgetCard(run: RunState, cardId: string): LearnResult {
  const p = run.player;
  if (!p.cards.includes(cardId)) return refuse("not_held");
  const cards = p.cards.filter((id) => id !== cardId);
  p.rarities = raritiesFor(cards, p.rarities, null, null);
  p.cards = cards;
  return OK;
}
