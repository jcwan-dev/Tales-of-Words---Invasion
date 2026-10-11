import type { Effect, Scaling, SkillDef, StatusId, Target, WeaponDef, WordDef } from "../content/types.ts";
import type { AttackSpec } from "./attack.ts";
import type { ConsumeSpec } from "./hit.ts";
import type { HitSpec, StatusApplication } from "./hit-state.ts";

/** A card: a skill (or an enemy move) in combat (spec: Cards in combat). Its behaviour is its effect data. */
export interface CardSpec {
  id: string;
  /** Turns of waiting after use (0 = always ready, e.g. Strike). */
  cooldown: number;
  effects: readonly Effect[];
}

/** An enemy move (spec: Enemy moves): a card, a pick weight (> 0) and an optional intent line key. */
export interface EnemyMove {
  card: CardSpec;
  weight: number;
  intent?: string;
}

/** A card from a skill or Word definition: its id, cooldown and effects. */
export const cardFromSkill = (def: SkillDef | WordDef): CardSpec => ({ id: def.id, cooldown: def.cooldown, effects: def.effects });

/** The weapon's Strike: id "strike", no cooldown, one damage effect on the chosen enemy with the weapon's hits. */
export const strikeCard = (weapon: WeaponDef): CardSpec => ({
  id: "strike",
  cooldown: 0,
  effects: [
    {
      type: "damage",
      damageType: weapon.attack.damageType,
      amount: weapon.attack.damage,
      target: "enemy",
      hits: weapon.attack.hits ?? 1,
      scaling: weapon.attack.scaling,
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Compiled cards. Everything that depends only on the card's data (which hits carry which riding
// statuses, which statuses apply directly and to whom) is worked out once when a unit is created, so
// playing a card allocates nothing but events (code rule 6).

/**
 * Who a step reaches when the card is played:
 * - `self`: the user; `chosen`: the chosen enemy; `allEnemies`: every living enemy, in turn order;
 * - `othersThanChosen`: every living enemy except the chosen one (statuses on all enemies that the
 *   carrying damage effect, aimed at the chosen enemy, doesn't hit).
 */
export type StepReach = "self" | "chosen" | "allEnemies" | "othersThanChosen";

export type CardStep =
  /** One attack per target. `chosenAttack` is used against the chosen enemy, `otherAttack` against the rest. */
  | { readonly kind: "attack"; readonly reach: StepReach; readonly chosenAttack: AttackSpec; readonly otherAttack: AttackSpec }
  /** A status applied directly (not an attack): resisted unless on the user. */
  | { readonly kind: "status"; readonly reach: StepReach; readonly status: StatusId; readonly stacks: number; readonly chance: number }
  /** Heal or restore Shield; the amount scales with the user only. */
  | { readonly kind: "heal" | "restoreShield"; readonly reach: StepReach; readonly amount: number; readonly scaling: readonly Scaling[] | undefined }
  | { readonly kind: "consume"; readonly reach: StepReach; readonly spec: ConsumeSpec };

/** A card ready to play: its spec, whether it needs a chosen enemy, and its steps in card order. */
export interface CardPlan {
  readonly card: CardSpec;
  /** True if an effect targets "the chosen enemy" (spec: target choice). */
  readonly needsTarget: boolean;
  readonly steps: readonly CardStep[];
}

const reachOf = (target: Target): StepReach => (target === "self" ? "self" : target === "enemy" ? "chosen" : "allEnemies");

const isEnemyTarget = (target: Target): boolean => target !== "self";

function application(status: StatusId, stacks: number, chance: number | undefined): StatusApplication {
  return chance === undefined ? { status, stacks } : { status, stacks, chance };
}

function attackOf(e: Extract<Effect, { type: "damage" }>, riders: readonly StatusApplication[]): AttackSpec {
  const hit: HitSpec = {
    damageType: e.damageType,
    amount: e.amount,
    piercing: e.piercing === true,
    ...(e.scaling === undefined ? {} : { scaling: e.scaling }),
    ...(riders.length === 0 ? {} : { statuses: riders }),
  };
  const n = e.hits !== undefined && Number.isInteger(e.hits) && e.hits >= 1 ? e.hits : 1;
  const hits: HitSpec[] = [];
  for (let i = 0; i < n; i++) hits.push(hit);
  return { hits };
}

/**
 * Compiles a card (spec: Cards in combat, "Statuses on a damaging card ride on its hits"):
 * - each damage effect is one attack of `hits` hits on its target(s);
 * - enemy status effects ride on every hit of the card's first enemy damage effect: an "enemy" (chosen)
 *   status only on hits against the chosen enemy, an "allEnemies" status on hits against any enemy; enemies
 *   that damage effect doesn't hit get the status directly; with no enemy damage effect, all enemy statuses
 *   apply directly;
 * - self effects apply directly to the user.
 */
export function compileCard(card: CardSpec): CardPlan {
  const effects = card.effects;
  let carrier = -1;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (e !== undefined && e.type === "damage" && isEnemyTarget(e.target)) {
      carrier = i;
      break;
    }
  }
  const carrierEffect = carrier >= 0 ? effects[carrier] : undefined;
  const carrierTarget: Target | null = carrierEffect?.type === "damage" ? carrierEffect.target : null;

  // Riding statuses, in card order: on the chosen enemy's hits, and on the other enemies' hits.
  const onChosen: StatusApplication[] = [];
  const onOthers: StatusApplication[] = [];
  if (carrierTarget !== null) {
    for (const e of effects) {
      if (e.type !== "status" || !isEnemyTarget(e.target)) continue;
      onChosen.push(application(e.status, e.stacks, e.chance));
      // Other enemies are hit only by an allEnemies carrier.
      if (e.target === "allEnemies" && carrierTarget === "allEnemies") onOthers.push(application(e.status, e.stacks, e.chance));
    }
  }

  let needsTarget = false;
  const steps: CardStep[] = [];
  effects.forEach((e, i) => {
    if (e.target === "enemy") needsTarget = true;
    const reach = reachOf(e.target);
    switch (e.type) {
      case "damage": {
        const riding = i === carrier;
        steps.push({ kind: "attack", reach, chosenAttack: attackOf(e, riding ? onChosen : []), otherAttack: attackOf(e, riding ? onOthers : []) });
        break;
      }
      case "status": {
        let direct: StepReach | null = reach;
        if (isEnemyTarget(e.target) && carrierTarget !== null) {
          // Rides on the carrier's hits; only enemies the carrier doesn't hit get it directly.
          direct = e.target === "allEnemies" && carrierTarget === "enemy" ? "othersThanChosen" : null;
        }
        if (direct !== null) steps.push({ kind: "status", reach: direct, status: e.status, stacks: e.stacks, chance: e.chance ?? 1 });
        break;
      }
      case "heal":
      case "restoreShield":
        steps.push({ kind: e.type, reach, amount: e.amount, scaling: e.scaling });
        break;
      case "consume":
        steps.push({
          kind: "consume",
          reach,
          spec: { status: e.status, multiplier: e.multiplier, damageType: e.damageType, ...(e.max === undefined ? {} : { max: e.max }) },
        });
        break;
    }
  });
  return { card, needsTarget, steps };
}
