import { RngStreams, type Rng } from "../rng/rng.ts";
import type { CombatEvent } from "./events.ts";

/** What every combat rule needs: the combat RNG stream and the event log to append to. */
export interface CombatContext {
  readonly rng: Rng;
  readonly events: CombatEvent[];
}

/** A fresh context whose RNG is the run's "combat" stream for this seed. */
export function createCombatContext(seed: string): CombatContext {
  return { rng: new RngStreams(seed).stream("combat"), events: [] };
}
