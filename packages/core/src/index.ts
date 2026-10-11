// Public surface of the rules core. Everything here is pure and deterministic.
export * from "./model/stats.ts";
export * from "./rng/rng.ts";
export * from "./run/limits.ts";
export * from "./content/types.ts";
export * from "./content/validate.ts";

// Combat core (M1)
export * from "./combat/unit.ts";
export * from "./combat/status-set.ts";
export * from "./combat/events.ts";
export * from "./combat/context.ts";
export * from "./combat/hit-state.ts";
export * from "./combat/hit.ts";
export * from "./combat/attack.ts";
export * from "./combat/cards.ts";
export * from "./combat/moves.ts";
export * from "./combat/play.ts";
export * from "./combat/queries.ts";
export * from "./combat/power-ids.ts";
export * from "./combat/powers.ts";
export * from "./combat/triggers.ts";
export * from "./combat/turn-info.ts";
export * from "./combat/decay-rules.ts";
export * from "./combat/cooldowns.ts";
export * from "./combat/gate.ts";
export type { CombatState } from "./combat/state.ts";
export { beginCombat, startTurn, endTurn } from "./combat/turn.ts";
export type {
  DecayKind,
  StatusDef,
  StatusHooks,
  HitHook,
  TurnHook,
  GateHook,
  HitHookName,
  TurnHookName,
  HookName,
  StatusModule,
} from "./combat/statuses/types.ts";
export { HIT_HOOK_NAMES, TURN_HOOK_NAMES, HOOK_NAMES } from "./combat/statuses/types.ts";
export { statusDef, statusModule } from "./combat/statuses/registry.ts";

export const CORE_VERSION = "0.0.0";
