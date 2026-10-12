/**
 * Item swaps during a run (spec: Rewards, items and level-ups, "Items"; Skills, "Changing weapon mid-run"; ADR 0012).
 * One item per slot: the new item replaces the old one, stats follow at once, max HP is recomputed with loadout
 * assembly's formula (run/loadout.ts) and HP moves by the same amount. Cards belong to their item: the weapon's
 * Strike (the weapon's id) and an accessory's granted skill or Word. Read through kinds, never ids (code rule 2).
 */
import type { ContentDef, ContentPack } from "../content/types.ts";
import { removeCard } from "./learning.ts";
import { loadoutTotals } from "./loadout.ts";
import type { ItemSlot } from "./rewards.ts";
import type { RunEvent, RunState } from "./run.ts";

/** The card an item brings: a weapon's Strike (its id), an accessory's grant, or none. */
export function itemCard(def: ContentDef | undefined): string | null {
  if (def?.kind === "weapon") return def.id;
  if (def?.kind === "accessory") return def.grants ?? null;
  return null;
}

/**
 * Equips item `id` in `slot`, replacing the one there (lost). Max HP moves by the change of 20 + 5 × final Vitality +
 * items' HP; HP moves by the same amount, then stays in [1, max HP] (ItemEquipped). The old item's card leaves if held
 * (CardRemoved). Returns the new item's card for the caller to gain like a new skill (null if it has none). Throws
 * RangeError if `id` isn't an item of that slot in the pack.
 */
export function equipItem(pack: ContentPack, run: RunState, slot: ItemSlot, id: string, events: RunEvent[]): string | null {
  const def = pack.byId.get(id);
  if (def?.kind !== slot) throw new RangeError(`run: "${id}" is not a ${slot} in pack "${pack.id}"`);
  const p = run.player;
  const previous = run.picks[slot];
  const before = loadoutTotals(pack, run.picks, p.baseStats).maxHp;
  run.picks[slot] = id;
  const after = loadoutTotals(pack, run.picks, p.baseStats).maxHp;
  p.maxHp += after - before;
  p.hp = Math.min(p.maxHp, Math.max(1, p.hp + after - before));
  events.push({ type: "ItemEquipped", slot, item: id, previous, maxHp: p.maxHp, hp: p.hp });
  const oldCard = itemCard(pack.byId.get(previous));
  if (oldCard !== null) removeCard(p, oldCard, events);
  return itemCard(def);
}
