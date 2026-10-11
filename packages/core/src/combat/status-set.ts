import { STATUS_IDS, type StatusId } from "../content/types.ts";

/** Number of statuses; the length of every unit's dense status storage. */
export const STATUS_COUNT = STATUS_IDS.length;

/** Dense index of each status id, in `STATUS_IDS` order. Built once at load. */
const STATUS_INDEX = ((): Readonly<Record<StatusId, number>> => {
  const index = {} as Record<StatusId, number>;
  for (let i = 0; i < STATUS_IDS.length; i++) {
    const id = STATUS_IDS[i];
    if (id !== undefined) index[id] = i;
  }
  return index;
})();

export const statusIndex = (id: StatusId): number => STATUS_INDEX[id];

/**
 * A unit's statuses: one entry per id with an integer stack count (spec: Combat core design).
 * An entry with 0 stacks is absent.
 */
export interface StatusSet {
  /** Stacks of a status; 0 if absent. */
  stacks(id: StatusId): number;
  has(id: StatusId): boolean;
  /** Adds stacks. Non-positive amounts do nothing. */
  add(id: StatusId, n: number): void;
  /** Removes stacks, never below 0; the entry is gone at 0. Non-positive amounts do nothing. */
  remove(id: StatusId, n: number): void;
  /** Fast path for hook dispatch: stacks by dense index (see `statusIndex`). */
  stacksAt(index: number): number;
}

/**
 * Fixed-size storage indexed by status index, so reads, writes and iteration allocate nothing,
 * and 50 stacks cost the same as 1 (spec: Performance rules).
 */
export class DenseStatusSet implements StatusSet {
  readonly #stacks = new Float64Array(STATUS_COUNT);

  stacks(id: StatusId): number {
    return this.#stacks[STATUS_INDEX[id]] ?? 0;
  }

  has(id: StatusId): boolean {
    return this.stacks(id) > 0;
  }

  add(id: StatusId, n: number): void {
    if (!(n > 0)) return;
    const i = STATUS_INDEX[id];
    this.#stacks[i] = (this.#stacks[i] ?? 0) + Math.floor(n);
  }

  remove(id: StatusId, n: number): void {
    if (!(n > 0)) return;
    const i = STATUS_INDEX[id];
    const left = (this.#stacks[i] ?? 0) - Math.floor(n);
    this.#stacks[i] = left > 0 ? left : 0;
  }

  stacksAt(index: number): number {
    return this.#stacks[index] ?? 0;
  }
}
