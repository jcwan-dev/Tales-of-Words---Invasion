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
export type { DecayKind, StatusDef, StatusHooks, HitHook, HitHookName, StatusModule } from "./combat/statuses/types.ts";
export { HIT_HOOK_NAMES } from "./combat/statuses/types.ts";
export { statusDef, statusModule } from "./combat/statuses/registry.ts";

export const CORE_VERSION = "0.0.0";
