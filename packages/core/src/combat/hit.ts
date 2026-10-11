import type { DamageType, Scaling, StatusId } from "../content/types.ts";
import type { StatBlock } from "../model/stats.ts";
import { applyDamage, reportDamage } from "./actions.ts";
import { applyStatus } from "./apply-status.ts";
import type { CombatContext } from "./context.ts";
import type { CombatEvent } from "./events.ts";
import type { HitSpec, HitState, StatusApplication } from "./hit-state.ts";
import { PER_HIT_POWERS } from "./powers.ts";
import { afflictions, stacksWithTag } from "./queries.ts";
import { checkFightEnd } from "./state.ts";
import { HIT_HOOKS, type HookEntry } from "./statuses/registry.ts";
import type { HitHook } from "./statuses/types.ts";
import { fireTriggers } from "./triggers.ts";
import type { CombatUnit } from "./unit.ts";

// The hit pipeline (spec: Hit order, ADR 0005, ADR 0007). A fixed list of seven steps; statuses take
// part only through the hook points in ./statuses/types.ts, powers through the table in ./powers.ts,
// converts through ./triggers.ts. Nothing here names a status.
// Performance rule: no allocations, spreads or closures here except the events pushed.

/** Each damage-modifier step is 25%, i.e. 1/4 of the base value. */
const MODIFIER_STEPS_PER_WHOLE = 4;

/**
 * Step 1: base value = amount + Σ scaling terms. Stat terms read the attacker's `stats`; Afflictions
 * and tag terms read `target` (required for them; a RangeError otherwise).
 */
export function baseValue(amount: number, scaling: readonly Scaling[] | undefined, stats: StatBlock, target?: CombatUnit): number {
  let value = amount;
  if (scaling === undefined) return value;
  for (let i = 0; i < scaling.length; i++) {
    const s = scaling[i];
    if (s === undefined) continue;
    if ("stat" in s) {
      value += s.per * stats[s.stat];
      continue;
    }
    if (target === undefined) throw new RangeError("baseValue: target scaling needs the target");
    value += s.per * ("afflictions" in s ? afflictions(target) : stacksWithTag(target, s.stacksOfTag));
  }
  return value;
}

/** Step 2 maths: floor(base × (1 + 0.25 × steps)) in integers, never below 0. */
const applyModifier = (base: number, steps: number): number => {
  const value = Math.floor((base * (MODIFIER_STEPS_PER_WHOLE + steps)) / MODIFIER_STEPS_PER_WHOLE);
  return value > 0 ? value : 0;
};

// Pooled hit states, one per nesting depth (a trigger that causes a hit gets the next one).
const pool: HitState[] = [];
let depth = 0;

function acquire(attacker: CombatUnit, target: CombatUnit, damageType: DamageType, piercing: boolean): HitState {
  let h = pool[depth];
  if (h === undefined) {
    h = {
      attacker,
      target,
      damageType,
      base: 0,
      modifierSteps: 0,
      value: 0,
      piercing: false,
      deflected: false,
      shieldDamage: 0,
      hpDamage: 0,
      scratch: { shield: 0, hp: 0, shieldBroken: false, fell: false },
    };
    pool[depth] = h;
  }
  h.attacker = attacker;
  h.target = target;
  h.damageType = damageType;
  h.base = 0;
  h.modifierSteps = 0;
  h.value = 0;
  h.piercing = piercing;
  h.deflected = false;
  h.shieldDamage = 0;
  h.hpDamage = 0;
  return h;
}

/** Runs one hook point for the statuses `owner` has. */
function dispatch(list: readonly HookEntry<HitHook>[], h: HitState, owner: CombatUnit, ctx: CombatContext): void {
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry === undefined) continue;
    const stacks = owner.statuses.stacksAt(entry.index);
    if (stacks > 0) entry.hook(h, owner, stacks, ctx);
  }
}

/**
 * Step 7: the hit's statuses, then the attacker's per-hit powers (Bleed, then Stun), each an
 * application with its own chance roll and resistance.
 */
function applyStatuses(ctx: CombatContext, h: HitState, apps: readonly StatusApplication[] | undefined): void {
  const target = h.target;
  if (apps !== undefined) {
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      if (app !== undefined) applyStatus(ctx, target, app.status, app.stacks, app.chance ?? 1);
    }
  }
  const powers = h.attacker.powers;
  for (let i = 0; i < PER_HIT_POWERS.length; i++) {
    const p = PER_HIT_POWERS[i];
    if (p === undefined) continue;
    const amount = powers[p.power];
    if (amount > 0) applyStatus(ctx, target, p.status, amount, 1);
  }
}

/**
 * The shared hit runner behind `resolveHit` and `resolveConsume`. With `consumeStatus` set, the base
 * value is the target's stacks of it × `consumeMultiplier` (counted when the hit starts), and if the hit
 * lands all its stacks are removed at the end of the hit. Returns true if the hit landed.
 */
function runHit(
  ctx: CombatContext,
  attacker: CombatUnit,
  target: CombatUnit,
  damageType: DamageType,
  amount: number,
  scaling: readonly Scaling[] | undefined,
  piercing: boolean,
  apps: readonly StatusApplication[] | undefined,
  consumeStatus: StatusId | null,
  consumeMultiplier: number,
): boolean {
  if (attacker.fallen || target.fallen) return false;
  const h = acquire(attacker, target, damageType, piercing);
  depth++;
  try {
    // HitStarted opens the hit; its value is filled in once step 2 is done, so that charges used
    // at step 2 are reported after it.
    const started: Extract<CombatEvent, { type: "HitStarted" }> = {
      type: "HitStarted",
      attacker: attacker.id,
      target: target.id,
      damageType,
      value: 0,
    };
    ctx.events.push(started);

    // 1. Base value (target terms read the target now, before anything this hit adds).
    h.base = consumeStatus !== null ? target.statuses.stacks(consumeStatus) * consumeMultiplier : baseValue(amount, scaling, attacker.stats, target);
    // 2. Attacker modifiers (damage modifiers, Piercing charge).
    dispatch(HIT_HOOKS.modifyOutgoing, h, attacker, ctx);
    h.value = applyModifier(h.base > 0 ? h.base : 0, h.modifierSteps);
    started.value = h.value;
    // 3. Attacked triggers (Thorns), whether or not the hit lands.
    dispatch(HIT_HOOKS.onAttacked, h, target, ctx);
    // 4. Warded check; a deflect trigger fires right after the deflect.
    dispatch(HIT_HOOKS.modifyIncoming, h, target, ctx);
    if (h.deflected) {
      ctx.events.push({ type: "HitDeflected", attacker: attacker.id, target: target.id });
      fireTriggers(ctx, target, "deflect");
    } else {
      resolveLandedHit(ctx, h, apps);
      // End of a landed consume: every stack of the status goes, including any this hit added.
      if (consumeStatus !== null) {
        const n = target.statuses.stacks(consumeStatus);
        if (n > 0) {
          target.statuses.remove(consumeStatus, n);
          ctx.events.push({ type: "Consumed", unit: target.id, status: consumeStatus, stacks: n });
        }
      }
    }
    // End of the hit: being-attacked triggers, so they never change this hit.
    fireTriggers(ctx, target, "attacked");
    // Only Thorns (step 3) or the hit itself (step 5) can fell a unit here.
    if (attacker.fallen || target.fallen) checkFightEnd(ctx);
    return !h.deflected;
  } finally {
    depth--;
  }
}

/** Steps 5-7 of a hit that was not deflected. */
function resolveLandedHit(ctx: CombatContext, h: HitState, apps: readonly StatusApplication[] | undefined): void {
  const attacker = h.attacker;
  const target = h.target;
  // 5. Shield, then HP (Piercing skips Shield).
  const out = h.scratch;
  applyDamage(target, h.value, h.piercing, out);
  h.shieldDamage = out.shield;
  h.hpDamage = out.hp;
  ctx.events.push({
    type: "DamageDealt",
    attacker: attacker.id,
    target: target.id,
    damageType: h.damageType,
    shieldDamage: out.shield,
    hpDamage: out.hp,
    piercing: h.piercing,
  });
  reportDamage(ctx, target, out);
  // 6. Damage triggers, only when damage was dealt: Leeching (attacker statuses), then the
  //    attacker's dealtDamage converts, then the target's tookDamage converts.
  if (h.shieldDamage + h.hpDamage > 0) {
    dispatch(HIT_HOOKS.onDealtDamage, h, attacker, ctx);
    dispatch(HIT_HOOKS.onTookDamage, h, target, ctx);
    fireTriggers(ctx, attacker, "dealtDamage");
    fireTriggers(ctx, target, "tookDamage");
  }
  // 7. Statuses carried by the hit, then per-hit powers.
  applyStatuses(ctx, h, apps);
}

/**
 * Resolves one hit from `attacker` on `target` through the seven steps of the hit order,
 * appending events to `ctx.events`. A hit by or against a fallen unit does nothing. If the hit
 * fells a unit and the context belongs to a fight, the fight-end check runs at the end of the hit.
 * Returns true if the hit landed (it was resolved and not deflected).
 */
export function resolveHit(ctx: CombatContext, attacker: CombatUnit, target: CombatUnit, hit: HitSpec): boolean {
  return runHit(ctx, attacker, target, hit.damageType, hit.amount, hit.scaling, hit.piercing === true, hit.statuses, null, 0);
}

/** A consume effect (spec: Synergy effects): one typed hit for the target's stacks of `status` × `multiplier`. */
export interface ConsumeSpec {
  status: StatusId;
  multiplier: number;
  damageType: DamageType;
  piercing?: boolean;
}

/**
 * One hit whose amount is the target's stacks of `status` (counted when the hit starts) × multiplier.
 * It goes through the whole hit order (modifiers, Thorns, Warded, Shield, per-hit powers, triggers).
 * If it isn't deflected, all stacks of `status` are removed at the end of the hit, including any the
 * hit added (Consumed, unless 0 were removed). It is not an attack: no per-attack powers.
 * Returns whether it landed.
 */
export function resolveConsume(ctx: CombatContext, attacker: CombatUnit, target: CombatUnit, spec: ConsumeSpec): boolean {
  return runHit(ctx, attacker, target, spec.damageType, 0, undefined, spec.piercing === true, undefined, spec.status, spec.multiplier);
}
