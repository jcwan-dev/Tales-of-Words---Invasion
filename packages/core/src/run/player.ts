/**
 * The player unit for a fight, built from the run (spec: Combat node, "The fight"). Reuses loadout assembly's
 * modifiers, powers and traits (run/loadout.ts), so a fresh run's unit matches `assemblePlayer` exactly.
 */
import type { UnitInit } from "../combat/unit.ts";
import type { ContentPack } from "../content/types.ts";
import { loadoutUnit } from "./loadout.ts";
import type { RunState } from "./run.ts";

/**
 * Stats = the run's base stats + the loadout's item and path modifiers (floor 0); max HP = `run.player.maxHp`;
 * HP = `run.player.hp`; Shield = the items' Shield, full; powers and traits from the loadout; cards =
 * `run.player.cards` in order (the weapon id is its Strike). No statuses. Throws RangeError for an unknown card id.
 */
export function playerUnitFromRun(pack: ContentPack, run: RunState): UnitInit {
  const p = run.player;
  return loadoutUnit(pack, run.picks, p.baseStats, p.maxHp, p.hp, p.cards);
}
