import type { StatusId } from "../content/types.ts";
import { BASE_STAT, STAT_IDS, type StatBlock, type StatId } from "../model/stats.ts";
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

  constructor(id: string, side: Side, stats: StatBlock, maxHp: number, hp: number, maxShield: number, shield: number) {
    this.id = id;
    this.side = side;
    this.stats = stats;
    this.maxHp = maxHp;
    this.hp = hp;
    this.maxShield = maxShield;
    this.shield = shield;
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

  const unit = new Unit(init.id, init.side, Object.freeze(stats), maxHp, hp, maxShield, shield);
  if (init.statuses) {
    for (const [id, n] of Object.entries(init.statuses) as [StatusId, number | undefined][]) {
      if (n !== undefined) unit.statuses.add(id, n);
    }
  }
  return unit;
}
