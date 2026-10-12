/**
 * Card rarity (spec: Rarity; ADR 0012). Rarity scales what a skill or Word card gets from stats: every
 * `{ stat, per }` term is multiplied by the rarity's factor. It is applied once, when a unit's cards are built
 * (`cardWithRarity`), so the hit pipeline never looks at it (code rule 6).
 */
import type { CardSpec } from "../combat/cards.ts";
import type { Effect, Scaling } from "../content/types.ts";

/** The five rarities, lowest first (colours on the card edge). */
export const RARITIES = ["grey", "green", "blue", "purple", "orange"] as const;
export type Rarity = (typeof RARITIES)[number];

/** Multiplier on every stat-scaling term. Content numbers are written at blue (100%). */
export const RARITY_SCALING: Readonly<Record<Rarity, number>> = Object.freeze({
  grey: 0.9,
  green: 0.95,
  blue: 1,
  purple: 1.1,
  orange: 1.25,
});

/** Everything starts grey unless the loadout raises it; a held card with no recorded rarity counts as grey. */
export const DEFAULT_RARITY: Rarity = "grey";

export const isRarity = (value: unknown): value is Rarity => typeof value === "string" && (RARITIES as readonly string[]).includes(value);

/** 0 (grey) to 4 (orange). */
export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** The higher of two rarities. */
export const higherRarity = (a: Rarity, b: Rarity): Rarity => (rarityRank(b) > rarityRank(a) ? b : a);

/** Grid the scaled `per` values are rounded to, so 6 × 0.95 is stored as 5.7 and not 5.699999999999999. */
const PER_GRID = 1e9;

function scaleTerms(scaling: readonly Scaling[], factor: number): readonly Scaling[] {
  return scaling.map((s) => ("stat" in s ? { stat: s.stat, per: Math.round(s.per * factor * PER_GRID) / PER_GRID } : s));
}

function scaleEffect(e: Effect, factor: number): Effect {
  if (e.type === "status" || e.type === "consume" || e.scaling === undefined) return e;
  return { ...e, scaling: scaleTerms(e.scaling, factor) };
}

/**
 * The card at `rarity`: every `{ stat, per }` term of every effect has per × RARITY_SCALING[rarity]. Flat amounts,
 * Afflictions and stack-scaling terms, hits, statuses, cooldown and id don't change. Blue returns the card itself.
 * The input is never changed. Amounts still round down when they are used (hit pipeline, heal, restore Shield).
 */
export function cardWithRarity(card: CardSpec, rarity: Rarity): CardSpec {
  const factor = RARITY_SCALING[rarity];
  if (factor === 1) return card;
  return { id: card.id, cooldown: card.cooldown, effects: card.effects.map((e) => scaleEffect(e, factor)) };
}
