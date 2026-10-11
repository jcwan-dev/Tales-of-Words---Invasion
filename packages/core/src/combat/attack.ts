import { applyStatus } from "./apply-status.ts";
import type { CombatContext } from "./context.ts";
import { resolveHit } from "./hit.ts";
import type { HitSpec } from "./hit-state.ts";
import { PER_ATTACK_POWERS } from "./powers.ts";
import type { CombatUnit } from "./unit.ts";

/** One action with one or more hits: a skill, Strike or enemy move use (spec: Stun and paralysis). */
export interface AttackSpec {
  /** At least 1. */
  hits: readonly HitSpec[];
  /** With `cooldown`, the card goes on cooldown once used. */
  cardId?: string;
  /** N: the card can't be used on the owner's next N turns. */
  cooldown?: number;
}

/**
 * Resolves each hit in order, then adds the attacker's per-attack powers once (Burn, Poison, then
 * Paralysis) if at least one hit landed and neither unit has fallen. Puts the card on cooldown if given (even if every hit was
 * deflected: the card was used). A fallen attacker's or target's remaining hits do nothing.
 */
export function resolveAttack(ctx: CombatContext, attacker: CombatUnit, target: CombatUnit, attack: AttackSpec): void {
  // TODO(M1 step 4, Cards): refuse a card that is still on cooldown. Today resolveAttack doesn't check.
  const hits = attack.hits;
  let landed = false;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit === undefined) continue;
    if (attacker.fallen || target.fallen) break;
    if (resolveHit(ctx, attacker, target, hit)) landed = true;
  }
  if (attack.cardId !== undefined && attack.cooldown !== undefined) attacker.cooldowns.start(attack.cardId, attack.cooldown);
  if (!landed || attacker.fallen || target.fallen) return;
  const powers = attacker.powers;
  for (let i = 0; i < PER_ATTACK_POWERS.length; i++) {
    const p = PER_ATTACK_POWERS[i];
    if (p === undefined) continue;
    const amount = powers[p.power];
    if (amount > 0) applyStatus(ctx, target, p.status, amount, 1);
  }
}
