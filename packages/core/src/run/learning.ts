/**
 * Learning a card (spec: Skills, "Gaining a skill when full"; Rewards, items and level-ups, "Learning a skill or
 * Word"; ADR 0012): a new card is added at the end while the hand has room; with a full hand the player forgets one
 * card (Strike included) or leaves the new one. Rewards, item swaps and, later, events and merchants all use this.
 */
import { MAX_PLAYER_CARDS } from "../combat/unit.ts";
import type { RunEvent, RunPlayer } from "./run.ts";

/**
 * Gains `card` like any new skill. Already held: nothing happens (no event). Room in the hand: appended
 * (CardLearned, replaced null). Full hand: nothing changes yet and CardOffered is emitted; returns true, and the
 * caller puts the run in phase "learning" with this card.
 */
export function gainCard(player: RunPlayer, card: string, events: RunEvent[]): boolean {
  if (player.cards.includes(card)) return false;
  if (player.cards.length < MAX_PLAYER_CARDS) {
    player.cards.push(card);
    events.push({ type: "CardLearned", card, replaced: null });
    return false;
  }
  events.push({ type: "CardOffered", card });
  return true;
}

/** Forgets card `index` (permanent for the run) and adds `card` at the end (CardLearned with the forgotten id). */
export function learnInPlaceOf(player: RunPlayer, card: string, index: number, events: RunEvent[]): void {
  const [replaced] = player.cards.splice(index, 1);
  player.cards.push(card);
  events.push({ type: "CardLearned", card, replaced: replaced ?? null });
}

/** Removes `card` if held (CardRemoved), e.g. an item's card leaving with the item. */
export function removeCard(player: RunPlayer, card: string, events: RunEvent[]): void {
  const i = player.cards.indexOf(card);
  if (i < 0) return;
  player.cards.splice(i, 1);
  events.push({ type: "CardRemoved", card });
}
