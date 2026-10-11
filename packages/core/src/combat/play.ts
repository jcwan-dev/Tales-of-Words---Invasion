import { heal, restoreShield } from "./actions.ts";
import { applyOwnStatus, applyStatus } from "./apply-status.ts";
import { resolveAttack } from "./attack.ts";
import type { CardPlan, CardStep, StepReach } from "./cards.ts";
import type { CombatContext } from "./context.ts";
import { gateAllows } from "./gate.ts";
import { baseValue, resolveConsume } from "./hit.ts";
import { moveIndex, pickIntent } from "./moves.ts";
import { CombatStateImpl, type CombatState } from "./state.ts";
import { endTurn } from "./turn.ts";
import type { CombatUnit, Side } from "./unit.ts";

// One action per turn (spec: Skills, Cards in combat, Enemy moves; ADR 0008). The active unit plays one
// card, passes, or (an enemy) uses its intent move; each ends the turn. Validation and effect dispatch
// allocate nothing but events, and nothing here reads a card or status id for behaviour (code rules 2, 6).

export type PlayRejection =
  | "fight_over"
  | "not_your_turn"
  | "turn_not_started"
  | "cannot_act"
  | "unknown_card"
  | "on_cooldown"
  | "not_allowed"
  | "bad_target";

export type PlayResult = { readonly ok: true } | { readonly ok: false; readonly reason: PlayRejection };

// Shared and frozen: a result is never built on the turn path, and no caller can change one.
const OK: PlayResult = Object.freeze({ ok: true });
const REJECTIONS: Readonly<Record<PlayRejection, PlayResult>> = Object.freeze({
  fight_over: Object.freeze({ ok: false, reason: "fight_over" }),
  not_your_turn: Object.freeze({ ok: false, reason: "not_your_turn" }),
  turn_not_started: Object.freeze({ ok: false, reason: "turn_not_started" }),
  cannot_act: Object.freeze({ ok: false, reason: "cannot_act" }),
  unknown_card: Object.freeze({ ok: false, reason: "unknown_card" }),
  on_cooldown: Object.freeze({ ok: false, reason: "on_cooldown" }),
  not_allowed: Object.freeze({ ok: false, reason: "not_allowed" }),
  bad_target: Object.freeze({ ok: false, reason: "bad_target" }),
});

const impl = (state: CombatState): CombatStateImpl | null => (state instanceof CombatStateImpl ? state : null);

/** The checks every action shares, in order: fight over, whose turn, turn started, may act. */
function turnCheck(s: CombatStateImpl | null, side: Side): PlayRejection | null {
  if (s === null || s.over) return "fight_over";
  const unit = s.active;
  if (unit === null || unit.side !== side) return "not_your_turn";
  if (!s.turnStarted) return "turn_not_started";
  if (!s.canAct) return "cannot_act";
  return null;
}

/** The only living enemy of `unit`, or null when there are none or several. */
function soleLivingEnemy(s: CombatStateImpl, unit: CombatUnit): CombatUnit | null {
  let only: CombatUnit | null = null;
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i];
    if (u === undefined || u.side === unit.side || u.fallen) continue;
    if (only !== null) return null;
    only = u;
  }
  return only;
}

/**
 * The active player-side unit uses one of its cards: the turn's one action (spec: Cards in combat).
 * Refused (no events, no change) with the first failing reason: fight_over, not_your_turn,
 * turn_not_started, cannot_act, unknown_card, on_cooldown, not_allowed, bad_target. On success: CardPlayed,
 * the card's effects in order, the cooldown, then the turn ends (as endTurn).
 */
export function playCard(state: CombatState, cardId: string, targetId?: string): PlayResult {
  const s = impl(state);
  const failed = turnCheck(s, "player");
  if (failed !== null || s === null) return REJECTIONS[failed ?? "fight_over"];
  const user = s.active;
  if (user === null) return REJECTIONS.not_your_turn;

  let index = -1;
  for (let i = 0; i < user.cards.length; i++) {
    if (user.cards[i]?.id === cardId) {
      index = i;
      break;
    }
  }
  const plan = user.cardPlans[index];
  if (index < 0 || plan === undefined) return REJECTIONS.unknown_card;
  if (!user.cooldowns.ready(plan.card.id)) return REJECTIONS.on_cooldown;
  if (!gateAllows(s.gate, plan.card)) return REJECTIONS.not_allowed;

  // Target: a given id must be a living enemy; without one, a card that needs a chosen enemy takes the
  // only living enemy, and is refused when there are several.
  let chosen: CombatUnit | null = null;
  if (targetId !== undefined) {
    for (let i = 0; i < s.units.length; i++) {
      const u = s.units[i];
      if (u !== undefined && u.id === targetId) chosen = u;
    }
    if (chosen === null || chosen.side === user.side || chosen.fallen) return REJECTIONS.bad_target;
  } else if (plan.needsTarget) {
    chosen = soleLivingEnemy(s, user);
    if (chosen === null) return REJECTIONS.bad_target;
  }

  act(s, user, plan, chosen);
  return OK;
}

/** The active player-side unit passes: Passed, then the turn ends. Same turn checks as playCard. */
export function passTurn(state: CombatState): PlayResult {
  const s = impl(state);
  const failed = turnCheck(s, "player");
  if (failed !== null || s === null || s.active === null) return REJECTIONS[failed ?? "fight_over"];
  s.ctx.events.push({ type: "Passed", unit: s.active.id });
  endTurn(s);
  return OK;
}

/**
 * The active enemy uses its intent move on the first living unit of the other side (a move's "enemy"
 * target), or on all of them / itself as the move says (spec: Enemy moves). If the gate no longer allows
 * the intent, it picks again among allowed ready moves; with none it passes. Ends the turn.
 */
export function enemyAct(state: CombatState): PlayResult {
  const s = impl(state);
  const failed = turnCheck(s, "enemy");
  if (failed !== null || s === null) return REJECTIONS[failed ?? "fight_over"];
  const user = s.active;
  if (user === null) return REJECTIONS.not_your_turn;

  let index = moveIndex(user, user.intent);
  const intended = user.moves[index];
  if (intended === undefined || !user.cooldowns.ready(intended.card.id) || !gateAllows(s.gate, intended.card)) {
    pickIntent(s.ctx, user, s.gate);
    index = moveIndex(user, user.intent);
  }
  const plan = user.movePlans[index];
  if (index < 0 || plan === undefined) {
    s.ctx.events.push({ type: "Passed", unit: user.id });
    endTurn(s);
    return OK;
  }
  let target: CombatUnit | null = null;
  for (let i = 0; i < s.units.length && target === null; i++) {
    const u = s.units[i];
    if (u !== undefined && u.side !== user.side && !u.fallen) target = u;
  }
  act(s, user, plan, plan.needsTarget ? target : null);
  return OK;
}

/** Plays a card that passed validation: CardPlayed, its steps, its cooldown, then the turn's end. */
function act(s: CombatStateImpl, user: CombatUnit, plan: CardPlan, chosen: CombatUnit | null): void {
  const ctx = s.ctx;
  ctx.events.push({ type: "CardPlayed", unit: user.id, card: plan.card.id, target: chosen === null ? null : chosen.id });
  const steps = plan.steps;
  for (let i = 0; i < steps.length; i++) {
    // A user that falls mid-card (Thorns) does nothing more.
    if (user.fallen || s.over) break;
    const step = steps[i];
    if (step !== undefined) runStep(s, user, chosen, step);
  }
  user.cooldowns.start(plan.card.id, plan.card.cooldown);
  endTurn(s);
}

/** Runs one step on every unit it reaches, skipping fallen targets. */
function runStep(s: CombatStateImpl, user: CombatUnit, chosen: CombatUnit | null, step: CardStep): void {
  const reach: StepReach = step.reach;
  if (reach === "self") {
    applyStep(s.ctx, user, user, step, false);
    return;
  }
  if (reach === "chosen") {
    if (chosen !== null && !chosen.fallen) applyStep(s.ctx, user, chosen, step, true);
    return;
  }
  const units = s.units;
  for (let i = 0; i < units.length; i++) {
    if (user.fallen) return;
    const u = units[i];
    if (u === undefined || u.side === user.side || u.fallen) continue;
    if (reach === "othersThanChosen" && u === chosen) continue;
    applyStep(s.ctx, user, u, step, u === chosen);
  }
}

function applyStep(ctx: CombatContext, user: CombatUnit, target: CombatUnit, step: CardStep, isChosen: boolean): void {
  switch (step.kind) {
    case "attack":
      resolveAttack(ctx, user, target, isChosen ? step.chosenAttack : step.otherAttack);
      return;
    case "status":
      if (target === user) applyOwnStatus(ctx, user, step.status, step.stacks, step.chance);
      else applyStatus(ctx, target, step.status, step.stacks, step.chance);
      return;
    case "heal":
      // Scales with the user only (spec: Cards in combat).
      heal(ctx, target, baseValue(step.amount, step.scaling, user.stats, user));
      return;
    case "restoreShield":
      restoreShield(ctx, target, baseValue(step.amount, step.scaling, user.stats, user));
      return;
    case "consume":
      resolveConsume(ctx, user, target, step.spec);
      return;
  }
}
