/**
 * The draw of a step's 3 option types (spec: Run map, "Choices at a step"). Pure: the caller decides which
 * types are drawable and passes their weights and the step's rng.
 */
import type { Rng } from "../rng/rng.ts";

/** A drawable node type (or any other drawn key) and its weight (an integer above 0). */
export interface WeightedType<T extends string = string> {
  readonly type: T;
  readonly weight: number;
}

/** One type by weight. `items` must be non-empty with positive integer weights. Also used by the rewards draw. */
export function pickWeighted<T extends string>(rng: Rng, items: readonly WeightedType<T>[]): T {
  let total = 0;
  for (const it of items) total += it.weight;
  if (items.length === 0 || total <= 0) throw new RangeError("pickWeighted: nothing to draw");
  let r = rng.int(0, total - 1);
  for (const it of items) {
    if (r < it.weight) return it.type;
    r -= it.weight;
  }
  // Unreachable with integer weights; keeps the type checker happy without a non-null assertion.
  throw new RangeError("pickWeighted: weights are not integers");
}

/**
 * Options 1 and 2 by weight (repeats allowed); if they are the same type and another type can be drawn,
 * option 3 by weight among the other types only, else like the first two. Returned in draw order.
 */
export function drawOptionTypes(rng: Rng, items: readonly WeightedType[]): [string, string, string] {
  const a = pickWeighted(rng, items);
  const b = pickWeighted(rng, items);
  const others = a === b ? items.filter((it) => it.type !== a) : [];
  const c = others.length > 0 ? pickWeighted(rng, others) : pickWeighted(rng, items);
  return [a, b, c];
}
