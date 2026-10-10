import { describe, expect, it } from "vitest";
import {
  consume,
  createRng,
  initialRunLimits,
  remaining,
  RUN_LIMITS,
  type Grant,
  type GrantSource,
  type LimitedAction,
} from "../src/index.ts";

const grant = (action: LimitedAction, source: GrantSource): Grant => ({ action, source });

describe("run limits (spec: Monetisation)", () => {
  it("allows exactly 2 revives and 3 rerolls", () => {
    expect(RUN_LIMITS).toEqual({ revive: 2, reroll: 3 });
  });

  it("refuses a third revive", () => {
    let s = initialRunLimits();
    for (let i = 0; i < 2; i++) {
      const r = consume(s, "revive", grant("revive", "ad"));
      expect(r.ok).toBe(true);
      s = r.state;
    }
    const third = consume(s, "revive", grant("revive", "ad"));
    expect(third).toMatchObject({ ok: false, reason: "limit_reached" });
    expect(remaining(s, "revive")).toBe(0);
  });

  it("gives Premium exactly the same limits (no pay-to-win)", () => {
    let s = initialRunLimits();
    let granted = 0;
    for (let i = 0; i < 10; i++) {
      const r = consume(s, "reroll", grant("reroll", "premium"));
      if (r.ok) granted++;
      s = r.state;
    }
    expect(granted).toBe(RUN_LIMITS.reroll);
  });

  it("rejects a grant for the wrong action", () => {
    const r = consume(initialRunLimits(), "revive", grant("reroll", "ad"));
    expect(r).toMatchObject({ ok: false, reason: "wrong_action" });
  });

  it("invariant: no sequence of requests ever exceeds the limits, whatever the grant source", () => {
    const sources: GrantSource[] = ["premium", "ad", "fallback"];
    const actions: LimitedAction[] = ["revive", "reroll"];
    for (let run = 0; run < 2_000; run++) {
      const rng = createRng(`limits-invariant-${run}`);
      let s = initialRunLimits();
      const steps = rng.int(0, 40);
      for (let i = 0; i < steps; i++) {
        const action = rng.pick(actions);
        // Sometimes send a mismatched grant, as a buggy UI might.
        const grantAction = rng.chance(0.1) ? rng.pick(actions) : action;
        s = consume(s, action, grant(grantAction, rng.pick(sources))).state;
        expect(s.used.revive).toBeLessThanOrEqual(RUN_LIMITS.revive);
        expect(s.used.reroll).toBeLessThanOrEqual(RUN_LIMITS.reroll);
      }
    }
  });
});
