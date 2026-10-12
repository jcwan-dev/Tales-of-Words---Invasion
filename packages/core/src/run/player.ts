/**
 * The player unit for a fight, built from the run (spec: Combat node, "The fight"). Reuses loadout assembly's
 * modifiers, powers, traits and starting rarities (run/loadout.ts), so a fresh run's unit matches `assemblePlayer`
 * exactly.
 */
import type { UnitInit } from "../combat/unit.ts";
import type { ContentPack } from "../content/types.ts";
import { loadoutUnit } from "./loadout.ts";
import type { RunState } from "./run.ts";

/**
 * Stats = the run's base stats + the loadout's item and path modifiers + the relics' (floor 0, once); max HP =
 * `run.player.maxHp` (it already counts items and relics); HP = `run.player.hp`; Shield = the items' and relics'
 * Shield, full; powers and traits from the loadout, then the relics in the order gained; the relics' starting
 * statuses, summed; cards = `run.player.cards` in order (the weapon id is its Strike), each at its rarity in
 * `run.player.rarities` (grey without an entry). Throws RangeError for an unknown card or relic id.
 */
export function playerUnitFromRun(pack: ContentPack, run: RunState): UnitInit {
  const p = run.player;
  return loadoutUnit(pack, run.picks, p.baseStats, p.maxHp, p.hp, p.cards, p.rarities, run.relics);
}
