/**
 * Benchmark comparison (spec: Performance rules): "the CI benchmark (10,000 simulated fights with 50+
 * stacks) fails the build if it gets more than 20% slower than its baseline". Pure, so it is unit-tested.
 *
 * GitHub runners come with different CPU models, and the calibration loop doesn't cancel that out, so a
 * baseline is kept per CPU model: a run is compared only with runs on the same model.
 */

/** One benchmark run (the JSON line bench.ts prints). */
export interface BenchResult {
  fights: number;
  totalMs: number;
  perFightUs: number;
  perHitUs: number;
  perRoundUs: number;
  calibrationMs: number;
  /** Workload time / calibration time. */
  ratio: number;
  workloadHash: string;
  node: string;
  /** CPU model (os.cpus()[0].model, trimmed): the key of the baseline entry. */
  cpu: string;
  cores: number;
}

/** The baseline for one CPU model. */
export interface BaselineEntry {
  ratio: number;
  perHitUs: number;
  perRoundUs: number;
  workloadHash: string;
  /** How many measured passes the recorded ratio is the median of. */
  samples: number;
  recordedFrom: string;
}

/** tools/sim/bench-baseline.json. */
export interface BaselineFile {
  tolerance: number;
  byCpu: Record<string, BaselineEntry>;
}

export const DEFAULT_TOLERANCE = 0.2;

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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads bench-baseline.json. The old flat format ({ ratio, perHitUs, ... } with no `byCpu`) is rejected,
 * not migrated: its CPU model is unknown, so its numbers can't be filed under one. Re-record per CPU.
 * Throws an Error that says what is wrong.
 */
export function parseBaseline(json: unknown): BaselineFile {
  if (!isObj(json)) throw new Error("bench-baseline.json must be a JSON object");
  if (!isObj(json["byCpu"])) {
    if ("ratio" in json) throw new Error("bench-baseline.json is in the old flat format (no byCpu); its CPU is unknown, so re-record it per CPU with --record");
    throw new Error("bench-baseline.json has no byCpu object");
  }
  const tolerance = json["tolerance"] === undefined ? DEFAULT_TOLERANCE : json["tolerance"];
  if (!isNum(tolerance) || tolerance <= 0) throw new Error("bench-baseline.json: tolerance must be a number > 0");
  const byCpu: Record<string, BaselineEntry> = {};
  for (const [cpu, e] of Object.entries(json["byCpu"])) {
    if (!isObj(e) || !isNum(e["ratio"]) || !isNum(e["perHitUs"]) || !isNum(e["perRoundUs"]) || typeof e["workloadHash"] !== "string") {
      throw new Error(`bench-baseline.json: entry for "${cpu}" needs ratio, perHitUs, perRoundUs and workloadHash`);
    }
    byCpu[cpu] = {
      ratio: e["ratio"],
      perHitUs: e["perHitUs"],
      perRoundUs: e["perRoundUs"],
      workloadHash: e["workloadHash"],
      samples: isNum(e["samples"]) ? e["samples"] : 1,
      recordedFrom: typeof e["recordedFrom"] === "string" ? e["recordedFrom"] : "",
    };
  }
  return { tolerance, byCpu };
}

/** The baseline file with the entry for the run's CPU added or replaced (other CPUs kept). */
export function recordRun(file: BaselineFile | null, run: BenchResult, samples: number, recordedFrom: string): BaselineFile {
  return {
    tolerance: file?.tolerance ?? DEFAULT_TOLERANCE,
    byCpu: {
      ...file?.byCpu,
      [run.cpu]: { ratio: run.ratio, perHitUs: run.perHitUs, perRoundUs: run.perRoundUs, workloadHash: run.workloadHash, samples, recordedFrom },
    },
  };
}

const summary = (r: BenchResult): string =>
  `ratio ${fmt(r.ratio)}, ${fmt(r.perHitUs)} µs/hit, ${fmt(r.perRoundUs)} µs/round, workload ${r.workloadHash}`;

/**
 * Compares a run with the baseline for its CPU model:
 * - the budgets always apply: fail if one hit is over 100 µs or one round over 2,000 µs;
 * - no file, or no entry for this CPU: pass with a notice carrying this run's numbers, to record;
 * - fail if the ratio is more than the tolerance (the file's, default 20%) above the entry's ratio;
 * - a different workload hash is a notice (the rules changed the workload: re-record deliberately).
 */
export function compareToBaseline(current: BenchResult, baseline: BaselineFile | null, tolerance?: number): CompareResult {
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

  const entry = baseline?.byCpu[current.cpu];
  if (baseline === null) {
    messages.push({ level: "notice", text: `no baseline yet; this run: ${summary(current)}` });
    return { ok, messages };
  }
  if (entry === undefined) {
    messages.push({ level: "notice", text: `no baseline for ${current.cpu}; this run: ${summary(current)}` });
    return { ok, messages };
  }

  const tol = tolerance ?? baseline.tolerance;
  const limit = entry.ratio * (1 + tol);
  const change = (current.ratio / entry.ratio - 1) * 100;
  if (current.ratio > limit) {
    ok = false;
    messages.push({
      level: "error",
      text: `${fmt(change, 1)}% slower than the baseline for this CPU (ratio ${fmt(current.ratio)} > ${fmt(limit)}, baseline ${fmt(entry.ratio)})`,
    });
  } else {
    messages.push({
      level: "notice",
      text: `ratio ${fmt(current.ratio)} vs baseline ${fmt(entry.ratio)} (${change >= 0 ? "+" : ""}${fmt(change, 1)}%), within ${Math.round(tol * 100)}%`,
    });
  }

  if (current.workloadHash !== entry.workloadHash) {
    messages.push({
      level: "notice",
      text: `workload changed (hash ${current.workloadHash}, baseline ${entry.workloadHash}): the rules changed the fights; re-record the baseline deliberately`,
    });
  }
  return { ok, messages };
}

/** A GitHub annotation line, readable from the checks REST API; every one names the CPU and core count. */
export const annotation = (m: CompareMessage, run: Pick<BenchResult, "cpu" | "cores">): string =>
  `::${m.level} title=Benchmark::${m.text} [cpu: ${run.cpu}, ${run.cores} cores]`;
