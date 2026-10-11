import type { DamageType, Scaling, StatusId } from "../content/types.ts";
import type { CombatUnit } from "./unit.ts";

/** A status carried by a hit, applied at step 7. */
export interface StatusApplication {
  status: StatusId;
  stacks: number;
  /** 0..1, default 1. Rolled on the combat RNG before resistance. */
  chance?: number;
}

/** What a hit carries. Built by skills and enemy moves. */
export interface HitSpec {
  damageType: DamageType;
  /** Base amount before scaling. */
  amount: number;
  /** Each entry adds `per` × the attacker's stat. */
  scaling?: readonly Scaling[];
  /** Keyword: this hit skips Shield and is never deflected. */
  piercing?: boolean;
  statuses?: readonly StatusApplication[];
}

/** Shield and HP damage of one damage application. Written in place, never allocated per hit. */
export interface DamageResult {
  shield: number;
  hp: number;
  shieldBroken: boolean;
  fell: boolean;
}

/**
 * The mutable state of one hit as it moves through the pipeline. Pooled and reused
 * (spec: Performance rules); status hooks read and write it. Valid only during `resolveHit`.
 */
export interface HitState {
  attacker: CombatUnit;
  target: CombatUnit;
  damageType: DamageType;
  /** Step 1 result. */
  base: number;
  /** Step 2: net damage-modifier stacks; each is ±25% of `base`. */
  modifierSteps: number;
  /** Value after step 2 (integer, never below 0). */
  value: number;
  piercing: boolean;
  deflected: boolean;
  /** Step 5 results. */
  shieldDamage: number;
  hpDamage: number;
  /** Scratch for any damage applied during this hit (Thorns, the hit itself). */
  readonly scratch: DamageResult;
}
