/**
 * Per-card cooldowns of one unit (spec: Turn details, "Cooldowns"). A card with cooldown N can't
 * be used on its owner's next N turns: the counter is set to N on use and drops by 1 at each of
 * the owner's turn ends, skipped turns included, except at the end of the turn it was used.
 */
export interface Cooldowns {
  /** Turns left; 0 = ready. */
  remaining(cardId: string): number;
  ready(cardId: string): boolean;
  /** Rules only (resolveAttack): puts a card on cooldown for `turns` turns. */
  start(cardId: string, turns: number): void;
  /** Rules only (turn end): every counter not set this turn drops by 1. */
  tick(): void;
}

/**
 * Parallel arrays, searched linearly: a unit has at most a handful of cards, and after a card's
 * first use nothing here allocates (code rule 6).
 */
export class CardCooldowns implements Cooldowns {
  readonly #ids: string[] = [];
  readonly #left: number[] = [];
  readonly #usedThisTurn: boolean[] = [];

  #find(cardId: string): number {
    for (let i = 0; i < this.#ids.length; i++) if (this.#ids[i] === cardId) return i;
    return -1;
  }

  remaining(cardId: string): number {
    const i = this.#find(cardId);
    return i < 0 ? 0 : (this.#left[i] ?? 0);
  }

  ready(cardId: string): boolean {
    return this.remaining(cardId) === 0;
  }

  start(cardId: string, turns: number): void {
    if (!(turns > 0)) return;
    let i = this.#find(cardId);
    if (i < 0) {
      i = this.#ids.length;
      this.#ids.push(cardId);
      this.#left.push(0);
      this.#usedThisTurn.push(false);
    }
    this.#left[i] = Math.floor(turns);
    this.#usedThisTurn[i] = true;
  }

  tick(): void {
    for (let i = 0; i < this.#ids.length; i++) {
      if (this.#usedThisTurn[i] === true) {
        this.#usedThisTurn[i] = false;
        continue;
      }
      const left = this.#left[i] ?? 0;
      if (left > 0) this.#left[i] = left - 1;
    }
  }
}
