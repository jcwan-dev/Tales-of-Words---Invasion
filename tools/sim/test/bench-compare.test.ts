import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotation, BUDGET_HIT_US, BUDGET_ROUND_US, compareToBaseline, type Baseline, type BenchResult } from "../src/bench-compare.ts";

// Spec, Performance rules: "the CI benchmark (10,000 simulated fights with 50+ stacks) fails the build if it gets
// more than 20% slower than its baseline"; budgets: one hit under 0.1 ms, a whole round under 2 ms.

const baseline: Baseline = { ratio: 10, perHitUs: 0.6, perRoundUs: 6, workloadHash: "abc12345", recordedFrom: "ci" };

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
  ...over,
});

const levels = (r: ReturnType<typeof compareToBaseline>): string[] => r.messages.map((m) => m.level);

describe("compareToBaseline", () => {
  it("passes when the run matches the baseline (one notice, no error)", () => {
    const r = compareToBaseline(run(), baseline);
    assert.equal(r.ok, true);
    assert.deepEqual(levels(r), ["notice"]);
  });

  it("passes when faster than the baseline", () => {
    assert.equal(compareToBaseline(run({ ratio: 7 }), baseline).ok, true);
  });

  it("passes at 19% slower", () => {
    const r = compareToBaseline(run({ ratio: 11.9 }), baseline);
    assert.equal(r.ok, true);
    assert.ok(!levels(r).includes("error"));
  });

  it("passes at exactly 20% slower (the limit is 'more than 20%')", () => {
    assert.equal(compareToBaseline(run({ ratio: 12 }), baseline).ok, true);
  });

  it("fails at 21% slower, with an error naming the slowdown", () => {
    const r = compareToBaseline(run({ ratio: 12.1 }), baseline);
    assert.equal(r.ok, false);
    const error = r.messages.find((m) => m.level === "error");
    assert.match(error?.text ?? "", /21\.0% slower/);
  });

  it("uses the given tolerance", () => {
    assert.equal(compareToBaseline(run({ ratio: 11 }), baseline, 0.05).ok, false);
    assert.equal(compareToBaseline(run({ ratio: 11 }), baseline, 0.1).ok, true);
  });

  it("fails when one hit is over the 100 µs budget, even within the ratio", () => {
    const r = compareToBaseline(run({ perHitUs: BUDGET_HIT_US + 0.5 }), baseline);
    assert.equal(r.ok, false);
    assert.ok(r.messages.some((m) => m.level === "error" && m.text.includes("one hit") && m.text.includes("budget")));
  });

  it("fails when one round is over the 2,000 µs budget", () => {
    const r = compareToBaseline(run({ perRoundUs: BUDGET_ROUND_US + 1 }), baseline);
    assert.equal(r.ok, false);
    assert.ok(r.messages.some((m) => m.level === "error" && m.text.includes("round")));
  });

  it("budgets apply even without a baseline", () => {
    assert.equal(compareToBaseline(run({ perHitUs: 150 }), null).ok, false);
    assert.equal(compareToBaseline(run({ perRoundUs: 2500 }), null).ok, false);
  });

  it("at the budgets exactly: pass", () => {
    assert.equal(compareToBaseline(run({ perHitUs: BUDGET_HIT_US, perRoundUs: BUDGET_ROUND_US }), baseline).ok, true);
  });

  it("a different workload hash is a notice, not a failure", () => {
    const r = compareToBaseline(run({ workloadHash: "ffff0000" }), baseline);
    assert.equal(r.ok, true);
    const notice = r.messages.find((m) => m.text.includes("workload changed"));
    assert.equal(notice?.level, "notice");
    assert.match(notice?.text ?? "", /re-record/);
  });

  it("a hash mismatch and a slowdown: still fails, and both are reported", () => {
    const r = compareToBaseline(run({ ratio: 13, workloadHash: "ffff0000" }), baseline);
    assert.equal(r.ok, false);
    assert.deepEqual(levels(r).sort(), ["error", "notice"]);
  });

  it("no baseline yet: passes with a notice carrying this run's numbers", () => {
    const r = compareToBaseline(run({ ratio: 6.5, workloadHash: "da908594" }), null);
    assert.equal(r.ok, true);
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0]?.level, "notice");
    assert.match(r.messages[0]?.text ?? "", /no baseline yet/);
    assert.match(r.messages[0]?.text ?? "", /6\.500/);
    assert.match(r.messages[0]?.text ?? "", /da908594/);
  });
});

describe("annotation", () => {
  it("formats GitHub annotation lines", () => {
    assert.equal(annotation({ level: "notice", text: "hello" }), "::notice title=Benchmark::hello");
    assert.equal(annotation({ level: "error", text: "slow" }), "::error title=Benchmark::slow");
  });
});
