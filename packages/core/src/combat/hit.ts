import type { Scaling } from "../content/types.ts";
import type { StatBlock } from "../model/stats.ts";
import { addStacks, applyDamage, reportDamage } from "./actions.ts";
import type { CombatContext } from "./context.ts";
import type { CombatEvent } from "./events.ts";
import type { HitSpec, HitState } from "./hit-state.ts";
import { HIT_HOOKS, statusDef, type HookEntry } from "./statuses/registry.ts";
import type { CombatUnit } from "./unit.ts";

// The hit pipeline (spec: Hit order, ADR 0005). A fixed list of seven steps; statuses take part
// only through the hook points in ./statuses/types.ts, and nothing here names a status.
// Performance rule: no allocations, spreads or closures here except the events pushed.

/** Each damage-modifier step is 25%, i.e. 1/4 of the base value. */
const MODIFIER_STEPS_PER_WHOLE = 4;
/** A resisting stat above this removes 1 stack (or turn) per point (spec: Stacking). */
const RESIST_THRESHOLD = 2;

/** Step 1: base value = amount + Σ per × the attacker's stat. */
export function baseValue(amount: number, scaling: readonly Scaling[] | undefined, stats: StatBlock): number {
  let value = amount;
  if (scaling !== undefined) {
    for (let i = 0; i < scaling.length; i++) {
      const s = scaling[i];
      if (s !== undefined) value += s.per * stats[s.stat];
    }
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

function acquire(attacker: CombatUnit, target: CombatUnit, hit: HitSpec): HitState {
  let h = pool[depth];
  if (h === undefined) {
    h = {
      attacker,
      target,
      damageType: hit.damageType,
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
  h.damageType = hit.damageType;
  h.base = 0;
  h.modifierSteps = 0;
  h.value = 0;
  h.piercing = hit.piercing === true;
  h.deflected = false;
  h.shieldDamage = 0;
  h.hpDamage = 0;
  return h;
}

/** Runs one hook point for the statuses `owner` has. */
function dispatch(list: readonly HookEntry[], h: HitState, owner: CombatUnit, ctx: CombatContext): void {
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry === undefined) continue;
    const stacks = owner.statuses.stacksAt(entry.index);
    if (stacks > 0) entry.hook(h, owner, stacks, ctx);
  }
}

/** Step 7: chance (rolled first), then resistance, then the stacks are added. */
function applyStatuses(ctx: CombatContext, h: HitState, hit: HitSpec): void {
  const apps = hit.statuses;
  if (apps === undefined) return;
  const target = h.target;
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    if (app === undefined || app.stacks <= 0) continue;
    const chance = app.chance ?? 1;
    // Certain outcomes use no roll, so chance-free hits never shift the combat stream.
    const lands = chance >= 1 ? true : chance <= 0 ? false : ctx.rng.chance(chance);
    if (!lands) {
      ctx.events.push({ type: "StatusMissed", unit: target.id, status: app.status });
      continue;
    }
    const resistedBy = statusDef(app.status).resistedBy;
    let resist = 0;
    for (let r = 0; r < resistedBy.length; r++) {
      const stat = resistedBy[r];
      if (stat === undefined) continue;
      const points = target.stats[stat] - RESIST_THRESHOLD;
      if (points > resist) resist = points;
    }
    const maxRemoved = app.stacks - 1;
    const removed = resist < maxRemoved ? resist : maxRemoved;
    if (removed > 0) ctx.events.push({ type: "StatusResisted", unit: target.id, status: app.status, removed });
    addStacks(ctx, target, app.status, removed > 0 ? app.stacks - removed : app.stacks);
  }
}

/**
 * Resolves one hit from `attacker` on `target` through the seven steps of the hit order,
 * appending events to `ctx.events`. A hit by or against a fallen unit does nothing.
 */
export function resolveHit(ctx: CombatContext, attacker: CombatUnit, target: CombatUnit, hit: HitSpec): void {
  if (attacker.fallen || target.fallen) return;
  const h = acquire(attacker, target, hit);
  depth++;
  try {
    // HitStarted opens the hit; its value is filled in once step 2 is done, so that charges used
    // at step 2 are reported after it.
    const started: Extract<CombatEvent, { type: "HitStarted" }> = {
      type: "HitStarted",
      attacker: attacker.id,
      target: target.id,
      damageType: hit.damageType,
      value: 0,
    };
    ctx.events.push(started);

    // 1. Base value.
    h.base = baseValue(hit.amount, hit.scaling, attacker.stats);
    // 2. Attacker modifiers (damage modifiers, Piercing charge).
    dispatch(HIT_HOOKS.modifyOutgoing, h, attacker, ctx);
    h.value = applyModifier(h.base > 0 ? h.base : 0, h.modifierSteps);
    started.value = h.value;
    // 3. Attacked triggers (Thorns), whether or not the hit lands.
    dispatch(HIT_HOOKS.onAttacked, h, target, ctx);
    // 4. Warded check.
    dispatch(HIT_HOOKS.modifyIncoming, h, target, ctx);
    if (h.deflected) {
      ctx.events.push({ type: "HitDeflected", attacker: attacker.id, target: target.id });
      return;
    }
    // 5. Shield, then HP (Piercing skips Shield).
    const out = h.scratch;
    applyDamage(target, h.value, h.piercing, out);
    h.shieldDamage = out.shield;
    h.hpDamage = out.hp;
    ctx.events.push({
      type: "DamageDealt",
      attacker: attacker.id,
      target: target.id,
      damageType: hit.damageType,
      shieldDamage: out.shield,
      hpDamage: out.hp,
      piercing: h.piercing,
    });
    reportDamage(ctx, target, out);
    // 6. Damage triggers, only when damage was dealt: attacker first (Leeching), then target (Bleeding).
    if (h.shieldDamage + h.hpDamage > 0) {
      dispatch(HIT_HOOKS.onDealtDamage, h, attacker, ctx);
      dispatch(HIT_HOOKS.onTookDamage, h, target, ctx);
    }
    // 7. Statuses carried by the hit.
    applyStatuses(ctx, h, hit);
  } finally {
    depth--;
  }
}
