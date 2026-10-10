/**
 * Simulator skeleton (M0). In M1 this runs thousands of seeded fights for the
 * balance reports and the performance benchmark. For now it proves the
 * determinism contract end to end: the same seeds always produce the same hash.
 *
 * Usage: pnpm sim -- --runs 1000 --seed nightly
 */
import { createRng, RngStreams } from "@tow/core";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const runs = Number(arg("runs", "1000"));
const seed = arg("seed", "m0");

const started = performance.now();
let hash = 0;
for (let r = 0; r < runs; r++) {
  const streams = new RngStreams(`${seed}-${r}`);
  const combat = streams.stream("combat");
  for (let i = 0; i < 100; i++) hash = (Math.imul(hash, 31) + combat.int(0, 1_000_000)) | 0;
  hash = (Math.imul(hash, 31) + streams.derive("rewards", "node1", 0).int(0, 1_000_000)) | 0;
}
const ms = performance.now() - started;

// A fresh generator from the same seed must reproduce the same first draw.
const check = createRng(`${seed}-0/combat`).int(0, 1_000_000) === new RngStreams(`${seed}-0`).stream("combat").int(0, 1_000_000);

console.log(JSON.stringify({ runs, seed, determinismHash: (hash >>> 0).toString(16), deterministic: check, ms: Math.round(ms) }));
if (!check) process.exit(1);
