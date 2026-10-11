import type { StatusId } from "../content/types.ts";
import { BASE_STAT, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
import { compileCard, type CardPlan, type CardSpec, type EnemyMove } from "./cards.ts";
import { CardCooldowns, type Cooldowns } from "./cooldowns.ts";
import { POWER_IDS, type PowerId } from "./power-ids.ts";
import { DenseStatusSet, type StatusSet } from "./status-set.ts";
import type { UnitTraits } from "./triggers.ts";

export type Side = "player" | "enemy";

export interface UnitInit {
  id: string;
  side: Side;
  /** Missing stats default to `BASE_STAT` (2). */
  stats?: Partial<Record<StatId, number>>;
  maxHp: number;
  /** Defaults to `maxHp`. */
  hp?: number;
  /** Defaults to 0. */
  maxShield?: number;
  /** Defaults to `maxShield`. */
  shield?: number;
  /** Initial stacks per status. */
  statuses?: Partial<Record<StatusId, number>>;
  // Powers (spec: Powers). All default to 0.
  /** The fight's full Stun power; −1 per own turn end, full again each fight. */
  stunPower?: number;
  paralysisPower?: number;
  bleedPower?: number;
  burnPower?: number;
  poisonPower?: number;
  traits?: UnitTraits;
  /** The unit's cards (skills). A player-side unit holds at most 5 (spec: Skills). */
  cards?: readonly CardSpec[];
  /** Enemy moves (spec: Enemy moves): each weight must be > 0. */
  moves?: readonly EnemyMove[];
}

/** A player holds at most this many cards (spec: Skills). */
export const MAX_PLAYER_CARDS = 5;

/** A unit in combat. Stats are fixed for the fight; HP, Shield, statuses and decaying powers change. */
export interface CombatUnit {
  readonly id: string;
  readonly side: Side;
  readonly stats: StatBlock;
  readonly maxHp: number;
  hp: number;
  readonly maxShield: number;
  shield: number;
  readonly statuses: StatusSet;
  /** True at 0 HP (spec: Shield and HP). */
  readonly fallen: boolean;
  /** Current value of every power, by id. Rules read it generically (see ./powers.ts). */
  readonly powers: Record<PowerId, number>;
  /** Full value of every power, restored at fight start. */
  readonly fullPowers: Readonly<Record<PowerId, number>>;
  /** Full Stun power, restored at fight start. */
  readonly maxStunPower: number;
  /** Current Stun power: Stunned stacks added by every hit the unit lands; −1 at each of its turn ends. */
  stunPower: number;
  /** Paralysed stacks added once per attack that lands. Never drops. */
  readonly paralysisPower: number;
  /** Bleeding stacks added by every hit that lands. Never drops. */
  readonly bleedPower: number;
  /** Burning stacks added once per attack that lands. Never drops. */
  readonly burnPower: number;
  /** Poisoned stacks added once per attack that lands. Never drops. */
  readonly poisonPower: number;
  readonly traits: UnitTraits;
  readonly cooldowns: Cooldowns;
  /** The unit's cards, in order. */
  readonly cards: readonly CardSpec[];
  /** Compiled cards, parallel to `cards` (rules internals). */
  readonly cardPlans: readonly CardPlan[];
  /** The unit's moves (enemies), in order. */
  readonly moves: readonly EnemyMove[];
  /** Compiled move cards, parallel to `moves` (rules internals). */
  readonly movePlans: readonly CardPlan[];
  /** The id of the move the unit will use next (its intent); null without moves or with none ready. Set by the rules. */
  readonly intent: string | null;
}

const NO_TRAITS: UnitTraits = Object.freeze({});

class Unit implements CombatUnit {
  readonly id: string;
  readonly side: Side;
  readonly stats: StatBlock;
  readonly maxHp: number;
  hp: number;
  readonly maxShield: number;
  shield: number;
  readonly statuses: StatusSet = new DenseStatusSet();
  readonly cooldowns: Cooldowns = new CardCooldowns();
  readonly powers: Record<PowerId, number>;
  readonly fullPowers: Readonly<Record<PowerId, number>>;
  readonly traits: UnitTraits;
  readonly cards: readonly CardSpec[];
  readonly cardPlans: readonly CardPlan[];
  readonly moves: readonly EnemyMove[];
  readonly movePlans: readonly CardPlan[];
  intent: string | null = null;

  constructor(
    id: string,
    side: Side,
    stats: StatBlock,
    maxHp: number,
    hp: number,
    maxShield: number,
    shield: number,
    powers: Readonly<Record<PowerId, number>>,
    traits: UnitTraits,
    cards: readonly CardSpec[],
    moves: readonly EnemyMove[],
  ) {
    this.id = id;
    this.side = side;
    this.stats = stats;
    this.maxHp = maxHp;
    this.hp = hp;
    this.maxShield = maxShield;
    this.shield = shield;
    this.fullPowers = Object.freeze({ ...powers });
    this.powers = { ...powers };
    this.traits = traits;
    this.cards = cards;
    this.cardPlans = cards.map(compileCard);
    this.moves = moves;
    this.movePlans = moves.map((m) => compileCard(m.card));
  }

  get fallen(): boolean {
    return this.hp === 0;
  }
  get maxStunPower(): number {
    return this.fullPowers.stunPower;
  }
  get stunPower(): number {
    return this.powers.stunPower;
  }
  set stunPower(value: number) {
    this.powers.stunPower = value;
  }
  get paralysisPower(): number {
    return this.powers.paralysisPower;
  }
  get bleedPower(): number {
    return this.powers.bleedPower;
  }
  get burnPower(): number {
    return this.powers.burnPower;
  }
  get poisonPower(): number {
    return this.powers.poisonPower;
  }
}

/**
 * Rules internals (moves.ts): sets a unit's intent. `CombatUnit.intent` is readonly to callers; units
 * come from createUnit, so the class narrows without a cast.
 */
export function setIntent(unit: CombatUnit, id: string | null): void {
  if (unit instanceof Unit) unit.intent = id;
}

const nonNegativeInt = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`createUnit: ${field} must be a non-negative integer, got ${value}`);
  return value;
};

export function createUnit(init: UnitInit): CombatUnit {
  const stats = {} as Record<StatId, number>;
  for (const s of STAT_IDS) stats[s] = init.stats?.[s] ?? BASE_STAT;

  const maxHp = nonNegativeInt(init.maxHp, "maxHp");
  const maxShield = nonNegativeInt(init.maxShield ?? 0, "maxShield");
  const hp = Math.min(nonNegativeInt(init.hp ?? maxHp, "hp"), maxHp);
  const shield = Math.min(nonNegativeInt(init.shield ?? maxShield, "shield"), maxShield);
  const powers = {} as Record<PowerId, number>;
  for (const p of POWER_IDS) powers[p] = nonNegativeInt(init[p] ?? 0, p);

  const cards = init.cards ?? [];
  if (init.side === "player" && cards.length > MAX_PLAYER_CARDS) {
    throw new RangeError(`createUnit: a player holds at most ${MAX_PLAYER_CARDS} cards, got ${cards.length}`);
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length) throw new RangeError("createUnit: card ids must be unique");
  const moves = init.moves ?? [];
  if (new Set(moves.map((m) => m.card.id)).size !== moves.length) throw new RangeError("createUnit: move ids must be unique");
  for (const m of moves) {
    if (!(Number.isFinite(m.weight) && m.weight > 0)) throw new RangeError(`createUnit: move ${m.card.id} needs a weight > 0, got ${m.weight}`);
  }

  const unit = new Unit(init.id, init.side, Object.freeze(stats), maxHp, hp, maxShield, shield, powers, init.traits ?? NO_TRAITS, Object.freeze([...cards]), Object.freeze([...moves]));
  if (init.statuses) {
    for (const [id, n] of Object.entries(init.statuses) as [StatusId, number | undefined][]) {
      if (n !== undefined) unit.statuses.add(id, n);
    }
  }
  return unit;
}
