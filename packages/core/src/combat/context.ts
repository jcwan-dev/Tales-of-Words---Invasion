import { RngStreams, type Rng } from "../rng/rng.ts";
import type { CombatEvent } from "./events.ts";
import type { CombatState } from "./state.ts";

/** What every combat rule needs: the combat RNG stream, the event log to append to, and the fight. */
export interface CombatContext {
  readonly rng: Rng;
  readonly events: CombatEvent[];
  /**
   * The fight this context belongs to: null until `beginCombat` sets it. The fight-end check reads
   * it, so a hit resolved on its own (`resolveHit`) can end the fight.
   */
  fight: CombatState | null;
}

/** A fresh context whose RNG is the run's "combat" stream for this seed. */
export function createCombatContext(seed: string): CombatContext {
  return { rng: new RngStreams(seed).stream("combat"), events: [], fight: null };
}
