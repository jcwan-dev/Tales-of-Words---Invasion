/**
 * Benchmark comparison (spec: Performance rules): "the CI benchmark (10,000 simulated fights with 50+
 * stacks) fails the build if it gets more than 20% slower than its baseline". Pure, so it is unit-tested.
 */

/** One benchmark run (the JSON line bench.ts prints). */
export interface BenchResult {
  fights: number;
  totalMs: number;
  perFightUs: number;
  perHitUs: number;
  perRoundUs: number;
  calibrationMs: number;
  /** Workload time / calibration time: machine-normalised, so runs on different runners compare. */
  ratio: number;
  workloadHash: string;
  node: string;
}

/** The recorded baseline (tools/sim/bench-baseline.json), written from a CI run with --record. */
export interface Baseline {
  ratio: number;
  perHitUs: number;
  perRoundUs: number;
  workloadHash: string;
  recordedFrom: string;
}

/** Spec budgets for a mid-range phone; a CI runner is faster, so going over on CI is surely over. */
export const BUDGET_HIT_US = 100;
export const BUDGET_ROUND_US = 2000;

export interface CompareMessage {
  level: "notice" | "error";
  text: string;
}

export interface CompareResult {
  ok: boolean;
  messages: CompareMessage[];
}

const fmt = (n: number, digits = 3): string => n.toFixed(digits);

/**
 * Compares a run with the baseline:
 * - fails if the ratio is more than `tolerance` (default 20%) above the baseline ratio;
 * - fails if a micro-measure is over its spec budget (100 µs per hit, 2,000 µs per round);
 * - a different workload hash is a notice (the rules changed the workload: re-record deliberately);
 * - no baseline: passes with a notice, so the first CI run can record one.
 */
export function compareToBaseline(current: BenchResult, baseline: Baseline | null, tolerance = 0.2): CompareResult {
  const messages: CompareMessage[] = [];
  let ok = true;

  if (current.perHitUs > BUDGET_HIT_US) {
    ok = false;
    messages.push({ level: "error", text: `one hit takes ${fmt(current.perHitUs)} µs, over the ${BUDGET_HIT_US} µs budget` });
  }
  if (current.perRoundUs > BUDGET_ROUND_US) {
    ok = false;
    messages.push({ level: "error", text: `one round takes ${fmt(current.perRoundUs)} µs, over the ${BUDGET_ROUND_US} µs budget` });
  }

  if (baseline === null) {
    messages.push({
      level: "notice",
      text: `no baseline yet; this run: ratio ${fmt(current.ratio)}, ${fmt(current.perHitUs)} µs/hit, ${fmt(current.perRoundUs)} µs/round, workload ${current.workloadHash}`,
    });
    return { ok, messages };
  }

  const limit = baseline.ratio * (1 + tolerance);
  const change = (current.ratio / baseline.ratio - 1) * 100;
  if (current.ratio > limit) {
    ok = false;
    messages.push({
      level: "error",
      text: `${fmt(change, 1)}% slower than the baseline (ratio ${fmt(current.ratio)} > ${fmt(limit)}, baseline ${fmt(baseline.ratio)})`,
    });
  } else {
    messages.push({ level: "notice", text: `ratio ${fmt(current.ratio)} vs baseline ${fmt(baseline.ratio)} (${change >= 0 ? "+" : ""}${fmt(change, 1)}%), within ${Math.round(tolerance * 100)}%` });
  }

  if (current.workloadHash !== baseline.workloadHash) {
    messages.push({
      level: "notice",
      text: `workload changed (hash ${current.workloadHash}, baseline ${baseline.workloadHash}): the rules changed the fights; re-record the baseline deliberately`,
    });
  }
  return { ok, messages };
}

/** GitHub annotation lines, readable from the checks REST API. */
export const annotation = (m: CompareMessage): string => `::${m.level} title=Benchmark::${m.text}`;
