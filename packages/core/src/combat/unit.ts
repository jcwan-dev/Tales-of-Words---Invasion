import type { StatusId } from "../content/types.ts";
import { BASE_STAT, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
import { CardCooldowns, type Cooldowns } from "./cooldowns.ts";
import { DenseStatusSet, type StatusSet } from "./status-set.ts";

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
  /** The fight's full Stun power (spec: Stun and paralysis). Defaults to 0. */
  stunPower?: number;
  /** Defaults to 0. Never drops. */
  paralysisPower?: number;
}

/** A unit in combat. Stats are fixed for the fight; HP, Shield and statuses change. */
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
  /** Full Stun power, restored at fight start. */
  readonly maxStunPower: number;
  /** Current Stun power: Stunned stacks added by every hit the unit lands; −1 at each of its turn ends. */
  stunPower: number;
  /** Paralysed stacks added once per attack that lands. */
  readonly paralysisPower: number;
  readonly cooldowns: Cooldowns;
}

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
  readonly maxStunPower: number;
  stunPower: number;
  readonly paralysisPower: number;

  constructor(
    id: string,
    side: Side,
    stats: StatBlock,
    maxHp: number,
    hp: number,
    maxShield: number,
    shield: number,
    stunPower: number,
    paralysisPower: number,
  ) {
    this.id = id;
    this.side = side;
    this.stats = stats;
    this.maxHp = maxHp;
    this.hp = hp;
    this.maxShield = maxShield;
    this.shield = shield;
    this.maxStunPower = stunPower;
    this.stunPower = stunPower;
    this.paralysisPower = paralysisPower;
  }

  get fallen(): boolean {
    return this.hp === 0;
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

  const stunPower = nonNegativeInt(init.stunPower ?? 0, "stunPower");
  const paralysisPower = nonNegativeInt(init.paralysisPower ?? 0, "paralysisPower");

  const unit = new Unit(init.id, init.side, Object.freeze(stats), maxHp, hp, maxShield, shield, stunPower, paralysisPower);
  if (init.statuses) {
    for (const [id, n] of Object.entries(init.statuses) as [StatusId, number | undefined][]) {
      if (n !== undefined) unit.statuses.add(id, n);
    }
  }
  return unit;
}
