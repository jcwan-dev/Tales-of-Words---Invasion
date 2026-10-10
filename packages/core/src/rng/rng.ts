/**
 * Deterministic random numbers. All randomness in the rules comes from here
 * (code rule 3): same seed + same commands = same result.
 *
 * Generator: sfc32 (fast, small state, good statistical quality).
 * Seeding: cyrb128 string hash, so seeds and stream names can be any string.
 */

export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Snapshot for saves and replays. */
  state(): RngState;
}

function cyrb128(input: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function rngFromState(initial: RngState): Rng {
  let [a, b, c, d] = initial;

  const nextUint32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };

  const rng: Rng = {
    next: () => nextUint32() / 4294967296,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`rng.int: invalid range [${min}, ${max}]`);
      }
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    chance: (p) => rng.next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("rng.pick: empty array");
      return items[Math.floor(rng.next() * items.length)] as T;
    },
    state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };

  // Discard the first outputs so similar seeds diverge quickly.
  for (let i = 0; i < 12; i++) nextUint32();
  return rng;
}

export const createRng = (seed: string): Rng => rngFromState(cyrb128(seed));

/**
 * Independent named streams from one run seed. Rewards use their own stream
 * per node and reroll index, so a reroll never shifts combat or map randomness
 * (spec: Monetisation architecture).
 */
export class RngStreams {
  readonly #seed: string;
  readonly #streams = new Map<string, Rng>();

  constructor(seed: string) {
    this.#seed = seed;
  }

  get seed(): string {
    return this.#seed;
  }

  /** Long-lived stream, created on first use (e.g. "combat", "map"). */
  stream(name: string): Rng {
    let s = this.#streams.get(name);
    if (!s) {
      s = createRng(`${this.#seed}/${name}`);
      this.#streams.set(name, s);
    }
    return s;
  }

  /** Fresh, stateless stream for one decision, e.g. derive("rewards", nodeId, rerollIndex). */
  derive(...parts: readonly (string | number)[]): Rng {
    return createRng(`${this.#seed}/${parts.join("/")}`);
  }
}
