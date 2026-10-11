import type { StatusId } from "../content/types.ts";
import { BASE_STAT, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
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
}

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

  const unit = new Unit(init.id, init.side, Object.freeze(stats), maxHp, hp, maxShield, shield, powers, init.traits ?? NO_TRAITS);
  if (init.statuses) {
    for (const [id, n] of Object.entries(init.statuses) as [StatusId, number | undefined][]) {
      if (n !== undefined) unit.statuses.add(id, n);
    }
  }
  return unit;
}
