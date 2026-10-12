/**
 * Loadout assembly (spec: Loadout assembly; ADR 0009): the five picks build the player's starting unit,
 * and the starting technique offer is drawn from the technique pool.
 *
 * Everything here reads content through kinds, tags and data: no content id decides behaviour (code rule 2).
 * Randomness comes only from the Rng the caller passes (code rule 3), normally
 * `streams.derive("loadout", "technique")`, so the offer never shifts combat or map randomness.
 */
import { cardFromSkill, strikeCard, type CardSpec } from "../combat/cards.ts";
import { POWER_IDS, type PowerId } from "../combat/power-ids.ts";
import type { ConvertTrigger, UnitTraits } from "../combat/triggers.ts";
import type { SlowDecay } from "../combat/decay-rules.ts";
import type { UnitInit } from "../combat/unit.ts";
import type {
  AccessoryDef,
  ArmorDef,
  CharacterDef,
  ContentDef,
  ContentPack,
  PathDef,
  PowerBonus,
  SkillDef,
  StatBonus,
  StatusId,
  WeaponDef,
  WordDef,
} from "../content/types.ts";
import { BASE_STAT, FAVOURED_START, maxHpFromVitality, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
import type { Rng } from "../rng/rng.ts";

/** The five picks, as content ids. */
export interface LoadoutPicks {
  character: string;
  weapon: string;
  armor: string;
  accessory: string;
  path: string;
}

export interface AssembledPlayer {
  /** Ready for createUnit: id "player", side "player", stats, HP and Shield at full, powers, traits, cards. */
  readonly unit: UnitInit;
  /** 2 / favoured 3, before item and path modifiers. Level-ups raise these, up to the run cap of 7. */
  readonly baseStats: StatBlock;
  /** The character's event tags. */
  readonly eventTags: readonly string[];
  /** The path's rules. */
  readonly rules: readonly string[];
}

/** The tag that puts a skill or Word in the starting technique pool (spec: Loadout assembly). */
export const TECHNIQUE_TAG = "technique";

/** Size of a starting technique offer before Intelligence, and how many of it scale with a favoured stat. */
export const TECHNIQUE_OFFER_SIZE = 3;
export const TECHNIQUE_FAVOURED = 2;

/**
 * Extra options whenever the player is offered skills or Words (spec: Loadout assembly, "Intelligence
 * everywhere"): 0 below 4, 1 at 4-5, 2 at 6 and above.
 */
export function intelligenceBonusOptions(intelligence: number): number {
  return intelligence >= 6 ? 2 : intelligence >= 4 ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Resolving picks

type SkillLike = SkillDef | WordDef;

interface Resolved {
  character: CharacterDef;
  weapon: WeaponDef;
  armor: ArmorDef;
  accessory: AccessoryDef;
  path: PathDef;
}

function find(pack: ContentPack, id: string, slot: string): ContentDef {
  const def = pack.byId.get(id);
  if (def === undefined) throw new RangeError(`loadout: unknown ${slot} "${id}"`);
  return def;
}

function wrongKind(slot: string, def: ContentDef): RangeError {
  return new RangeError(`loadout: "${def.id}" is a ${def.kind}, not a ${slot}`);
}

/** Looks up every pick and checks its kind; a RangeError names the first bad one. */
function resolve(pack: ContentPack, picks: LoadoutPicks): Resolved {
  const character = find(pack, picks.character, "character");
  if (character.kind !== "character") throw wrongKind("character", character);
  const weapon = find(pack, picks.weapon, "weapon");
  if (weapon.kind !== "weapon") throw wrongKind("weapon", weapon);
  const armor = find(pack, picks.armor, "armor");
  if (armor.kind !== "armor") throw wrongKind("armor", armor);
  const accessory = find(pack, picks.accessory, "accessory");
  if (accessory.kind !== "accessory") throw wrongKind("accessory", accessory);
  const path = find(pack, picks.path, "path");
  if (path.kind !== "path") throw wrongKind("path", path);
  return { character, weapon, armor, accessory, path };
}

const isSkillLike = (def: ContentDef | undefined): def is SkillLike => def !== undefined && (def.kind === "skill" || def.kind === "word");

/** The skill or Word the accessory grants, if any. */
function granted(pack: ContentPack, accessory: AccessoryDef): SkillLike | null {
  if (accessory.grants === undefined) return null;
  const def = pack.byId.get(accessory.grants);
  if (!isSkillLike(def)) throw new RangeError(`loadout: "${accessory.grants}" granted by ${accessory.id} is not a skill or Word`);
  return def;
}

// ---------------------------------------------------------------------------------------------
// Stats, HP, Shield, powers, traits

function baseStatsOf(character: CharacterDef): StatBlock {
  const block = {} as Record<StatId, number>;
  for (const s of STAT_IDS) block[s] = character.favoured.includes(s) ? FAVOURED_START : BASE_STAT;
  return Object.freeze(block);
}

/** Base stats plus the slot modifiers, in slot order; the floor of 0 applies once, at the end. */
function finalStatsOf(base: StatBlock, modifiers: readonly (StatBonus | undefined)[]): StatBlock {
  const block = {} as Record<StatId, number>;
  for (const s of STAT_IDS) {
    let v = base[s];
    for (const m of modifiers) v += m?.[s] ?? 0;
    block[s] = v > 0 ? v : 0;
  }
  return Object.freeze(block);
}

function powersOf(sources: readonly (PowerBonus | undefined)[]): Record<PowerId, number> {
  const total = {} as Record<PowerId, number>;
  for (const p of POWER_IDS) {
    let n = 0;
    for (const src of sources) n += src?.[p] ?? 0;
    total[p] = n;
  }
  return total;
}

/** Converts and slow decay concatenate in slot order; decay floors merge by max. */
function traitsOf(sources: readonly (UnitTraits | undefined)[]): UnitTraits {
  const converts: ConvertTrigger[] = [];
  const slowDecay: SlowDecay[] = [];
  const decayFloors: Partial<Record<StatusId, number>> = {};
  for (const t of sources) {
    if (t === undefined) continue;
    for (const c of t.converts ?? []) converts.push({ ...c });
    for (const e of t.slowDecay ?? []) slowDecay.push(e);
    for (const [id, min] of Object.entries(t.decayFloors ?? {}) as [StatusId, number | undefined][]) {
      if (min !== undefined) decayFloors[id] = Math.max(decayFloors[id] ?? 0, min);
    }
  }
  return { converts, slowDecay, decayFloors };
}

// ---------------------------------------------------------------------------------------------
// Cards

/**
 * The weapon's Strike as a card. Its id is the weapon's content id, as every other card's id is the id of
 * the content it comes from (skills and Words use theirs); a held weapon is unique, so the id is too.
 */
export function weaponStrikeCard(weapon: WeaponDef): CardSpec {
  return { ...strikeCard(weapon), id: weapon.id };
}

/** Does any scaling entry of any effect use one of these stats? (spec: Loadout assembly, Details) */
function scalesWithAny(def: SkillLike, stats: readonly StatId[]): boolean {
  for (const e of def.effects) {
    if (e.type === "status" || e.type === "consume") continue;
    for (const term of e.scaling ?? []) if ("stat" in term && stats.includes(term.stat)) return true;
  }
  return false;
}

const isTechnique = (def: SkillLike): boolean => (def.tags ?? []).includes(TECHNIQUE_TAG);

/**
 * The starting technique offer (spec: Loadout assembly): 3 + intelligenceBonusOptions(final Intelligence)
 * skill ids from the technique pool. Up to two scale with a favoured stat, the rest come from the whole pool;
 * no repeats, never a card already held; shorter if the pool runs out. The pool is taken in id order, so the
 * offer depends only on the content and the rng. Throws RangeError for an unknown or wrong-kind pick.
 */
export function techniqueOffer(pack: ContentPack, picks: LoadoutPicks, rng: Rng): readonly string[] {
  const r = resolve(pack, picks);
  const stats = finalStatsOf(baseStatsOf(r.character), [r.weapon.stats, r.armor.stats, r.accessory.stats, r.path.stats]);
  const size = TECHNIQUE_OFFER_SIZE + intelligenceBonusOptions(stats.intelligence);
  const held = granted(pack, r.accessory);

  const pool: SkillLike[] = [];
  for (const def of pack.byId.values()) {
    // "Held" is the same definition (object identity), not a comparison of ids.
    if (isSkillLike(def) && isTechnique(def) && def !== held) pool.push(def);
  }
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const offer: string[] = [];
  const favoured = pool.filter((d) => scalesWithAny(d, r.character.favoured));
  while (offer.length < TECHNIQUE_FAVOURED && favoured.length > 0) take(favoured, pool, offer, rng);
  while (offer.length < size && pool.length > 0) take(pool, favoured, offer, rng);
  return offer;
}

/** Draws one def from `from` (removing it there and from `also`) and appends its id. */
function take(from: SkillLike[], also: SkillLike[], offer: string[], rng: Rng): void {
  const [def] = from.splice(rng.int(0, from.length - 1), 1);
  if (def === undefined) return;
  const i = also.indexOf(def);
  if (i >= 0) also.splice(i, 1);
  offer.push(def.id);
}

// ---------------------------------------------------------------------------------------------
// Assembly

/**
 * Builds the player unit from the picks (spec: Loadout assembly). `techniqueId` is one of the offered ids
 * (any technique not already held), or null to start without one. Throws RangeError for unknown or
 * wrong-kind picks, or a technique that isn't in the pool or is already held.
 */
export function assemblePlayer(pack: ContentPack, picks: LoadoutPicks, techniqueId: string | null): AssembledPlayer {
  const r = resolve(pack, picks);
  const baseStats = baseStatsOf(r.character);
  const stats = finalStatsOf(baseStats, [r.weapon.stats, r.armor.stats, r.accessory.stats, r.path.stats]);

  const cards: CardSpec[] = [weaponStrikeCard(r.weapon)];
  const grant = granted(pack, r.accessory);
  if (grant !== null) cards.push(cardFromSkill(grant));
  if (techniqueId !== null) {
    const technique = pack.byId.get(techniqueId);
    if (!isSkillLike(technique)) throw new RangeError(`loadout: technique "${techniqueId}" is not a skill or Word in this pack`);
    if (!isTechnique(technique)) throw new RangeError(`loadout: "${techniqueId}" is not tagged "${TECHNIQUE_TAG}"`);
    if (technique === grant) throw new RangeError(`loadout: "${techniqueId}" is already held`);
    cards.push(cardFromSkill(technique));
  }

  // Only items give HP and Shield (paths can't).
  const itemHp = (r.weapon.hp ?? 0) + (r.armor.hp ?? 0) + (r.accessory.hp ?? 0);
  const maxHp = maxHpFromVitality(stats.vitality) + itemHp;
  const maxShield = (r.weapon.shield ?? 0) + (r.armor.shield ?? 0) + (r.accessory.shield ?? 0);
  const powers = powersOf([r.weapon.powers, r.armor.powers, r.accessory.powers, r.path.powers]);

  const unit: UnitInit = {
    id: "player",
    side: "player",
    stats,
    maxHp,
    hp: maxHp,
    maxShield,
    shield: maxShield,
    bleedPower: powers.bleedPower,
    burnPower: powers.burnPower,
    poisonPower: powers.poisonPower,
    stunPower: powers.stunPower,
    paralysisPower: powers.paralysisPower,
    traits: traitsOf([r.weapon.traits, r.armor.traits, r.accessory.traits, r.path.traits]),
    cards,
  };
  return { unit, baseStats, eventTags: [...r.character.eventTags], rules: [...(r.path.rules ?? [])] };
}
