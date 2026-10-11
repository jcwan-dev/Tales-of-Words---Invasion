import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotation,
  BUDGET_HIT_US,
  BUDGET_ROUND_US,
  compareToBaseline,
  parseBaseline,
  recordRun,
  type BaselineEntry,
  type BaselineFile,
  type BenchResult,
} from "../src/bench-compare.ts";

// Spec, Performance rules: "the CI benchmark (10,000 simulated fights with 50+ stacks) fails the build if it gets
// more than 20% slower than its baseline"; budgets: one hit under 0.1 ms, a whole round under 2 ms.
// Baselines are kept per CPU model (GitHub runners differ).

const CPU = "AMD EPYC 7763 64-Core Processor";
const OTHER_CPU = "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz";

const entry: BaselineEntry = { ratio: 10, perHitUs: 0.6, perRoundUs: 6, workloadHash: "abc12345", samples: 5, recordedFrom: "ci" };
const file = (byCpu: Record<string, BaselineEntry> = { [CPU]: entry }, tolerance = 0.2): BaselineFile => ({ tolerance, byCpu });

const run = (over: Partial<BenchResult> = {}): BenchResult => ({
  fights: 10_000,
  totalMs: 650,
  perFightUs: 65,
  perHitUs: 0.6,
  perRoundUs: 6,
  calibrationMs: 65,
  ratio: 10,
  workloadHash: "abc12345",
  node: "v22",
  cpu: CPU,
  cores: 4,
  ...over,
});

const levels = (r: ReturnType<typeof compareToBaseline>): string[] => r.messages.map((m) => m.level);

describe("compareToBaseline: per-CPU baselines", () => {
  it("matching CPU, same speed: passes with one notice", () => {
    const r = compareToBaseline(run(), file());
    assert.equal(r.ok, true);
    assert.deepEqual(levels(r), ["notice"]);
  });

  it("matching CPU, 19% and exactly 20% slower: passes", () => {
    assert.equal(compareToBaseline(run({ ratio: 11.9 }), file()).ok, true);
    assert.equal(compareToBaseline(run({ ratio: 12 }), file()).ok, true);
  });

  it("matching CPU, 21% slower: fails with an error naming the slowdown", () => {
    const r = compareToBaseline(run({ ratio: 12.1 }), file());
    assert.equal(r.ok, false);
    const error = r.messages.find((m) => m.level === "error");
    assert.match(error?.text ?? "", /21\.0% slower/);
  });

  it("compares only with the entry for the current CPU (another CPU's faster baseline is ignored)", () => {
    const r = compareToBaseline(run({ ratio: 12.1 }), file({ [OTHER_CPU]: { ...entry, ratio: 5 }, [CPU]: { ...entry, ratio: 11 } }));
    assert.equal(r.ok, true);
  });

  it("uses the file's tolerance; an explicit tolerance overrides it", () => {
    assert.equal(compareToBaseline(run({ ratio: 11 }), file(undefined, 0.05)).ok, false);
    assert.equal(compareToBaseline(run({ ratio: 11 }), file(undefined, 0.05), 0.1).ok, true);
  });

  it("unknown CPU: passes with a notice 'no baseline for <cpu>' carrying this run's numbers", () => {
    const r = compareToBaseline(run({ cpu: OTHER_CPU, ratio: 30, workloadHash: "da908594" }), file());
    assert.equal(r.ok, true);
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0]?.level, "notice");
    assert.match(r.messages[0]?.text ?? "", new RegExp(`no baseline for ${OTHER_CPU.replace(/[()@.]/g, "\\$&")}`));
    assert.match(r.messages[0]?.text ?? "", /30\.000/);
    assert.match(r.messages[0]?.text ?? "", /da908594/);
  });

  it("no baseline file: passes with a 'no baseline yet' notice", () => {
    const r = compareToBaseline(run(), null);
    assert.equal(r.ok, true);
    assert.match(r.messages[0]?.text ?? "", /no baseline yet/);
  });

  it("budgets always apply: per hit over 100 µs fails, with a matching CPU, an unknown CPU or no file", () => {
    for (const b of [file(), file({ [OTHER_CPU]: entry }), null]) {
      const r = compareToBaseline(run({ perHitUs: BUDGET_HIT_US + 0.5 }), b);
      assert.equal(r.ok, false);
      assert.ok(r.messages.some((m) => m.level === "error" && m.text.includes("one hit") && m.text.includes("budget")));
    }
  });

  it("budgets always apply: per round over 2,000 µs fails", () => {
    for (const b of [file(), file({ [OTHER_CPU]: entry }), null]) {
      const r = compareToBaseline(run({ perRoundUs: BUDGET_ROUND_US + 1 }), b);
      assert.equal(r.ok, false);
      assert.ok(r.messages.some((m) => m.level === "error" && m.text.includes("one round")));
    }
  });

  it("at the budgets exactly: passes", () => {
    assert.equal(compareToBaseline(run({ perHitUs: BUDGET_HIT_US, perRoundUs: BUDGET_ROUND_US }), file()).ok, true);
  });

  it("a different workload hash is a notice, not a failure; with a slowdown both are reported", () => {
    const changed = compareToBaseline(run({ workloadHash: "ffff0000" }), file());
    assert.equal(changed.ok, true);
    const notice = changed.messages.find((m) => m.text.includes("workload changed"));
    assert.equal(notice?.level, "notice");
    assert.match(notice?.text ?? "", /re-record/);
    const both = compareToBaseline(run({ ratio: 13, workloadHash: "ffff0000" }), file());
    assert.equal(both.ok, false);
    assert.deepEqual(levels(both).sort(), ["error", "notice"]);
  });
});

describe("parseBaseline", () => {
  it("reads the per-CPU format", () => {
    const parsed = parseBaseline({ tolerance: 0.2, byCpu: { [CPU]: entry } });
    assert.deepEqual(parsed, file());
  });

  it("defaults: tolerance 0.2, samples 1, recordedFrom empty", () => {
    const parsed = parseBaseline({ byCpu: { [CPU]: { ratio: 10, perHitUs: 0.6, perRoundUs: 6, workloadHash: "abc12345" } } });
    assert.equal(parsed.tolerance, 0.2);
    assert.equal(parsed.byCpu[CPU]?.samples, 1);
    assert.equal(parsed.byCpu[CPU]?.recordedFrom, "");
  });

  it("rejects the old flat format explicitly (no migration: its CPU is unknown)", () => {
    assert.throws(
      () => parseBaseline({ ratio: 7.4, perHitUs: 0.56, perRoundUs: 6, workloadHash: "abc12345", recordedFrom: "ci" }),
      /old flat format/,
    );
  });

  it("rejects malformed files", () => {
    assert.throws(() => parseBaseline([]), /JSON object/);
    assert.throws(() => parseBaseline({}), /no byCpu/);
    assert.throws(() => parseBaseline({ tolerance: -1, byCpu: {} }), /tolerance/);
    assert.throws(() => parseBaseline({ byCpu: { [CPU]: { ratio: "fast" } } }), /needs ratio/);
  });
});

describe("recordRun", () => {
  it("adds an entry for a new CPU and keeps the others", () => {
    const next = recordRun(file(), run({ cpu: OTHER_CPU, ratio: 6.5 }), 5, "sha");
    assert.deepEqual(Object.keys(next.byCpu).sort(), [CPU, OTHER_CPU].sort());
    assert.equal(next.byCpu[CPU]?.ratio, 10);
    assert.deepEqual(next.byCpu[OTHER_CPU], { ratio: 6.5, perHitUs: 0.6, perRoundUs: 6, workloadHash: "abc12345", samples: 5, recordedFrom: "sha" });
  });

  it("replaces the entry for the same CPU", () => {
    const next = recordRun(file(), run({ ratio: 9 }), 5, "sha2");
    assert.equal(Object.keys(next.byCpu).length, 1);
    assert.equal(next.byCpu[CPU]?.ratio, 9);
    assert.equal(next.byCpu[CPU]?.recordedFrom, "sha2");
  });

  it("starts a file with the default tolerance when there is none; keeps a file's tolerance", () => {
    assert.equal(recordRun(null, run(), 5, "sha").tolerance, 0.2);
    assert.equal(recordRun(file(undefined, 0.15), run(), 5, "sha").tolerance, 0.15);
  });
});

describe("annotation", () => {
  it("formats GitHub annotation lines that name the CPU and core count", () => {
    const r = run();
    assert.equal(annotation({ level: "notice", text: "hello" }, r), `::notice title=Benchmark::hello [cpu: ${CPU}, 4 cores]`);
    assert.equal(annotation({ level: "error", text: "slow" }, r), `::error title=Benchmark::slow [cpu: ${CPU}, 4 cores]`);
  });
});
