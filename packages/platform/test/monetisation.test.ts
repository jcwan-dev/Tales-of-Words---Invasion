import { describe, expect, it } from "vitest";
import { consume, initialRunLimits, RUN_LIMITS, type RunLimitsState } from "@tow/core";
import { FALLBACK_WAIT_MS, MockAdProvider, MockBillingProvider, MonetisationService, type Delay } from "../src/index.ts";

const waits: number[] = [];
const noDelay: Delay = async (ms) => {
  waits.push(ms);
};

const setup = (premium = false) => {
  const ads = new MockAdProvider(noDelay, 0);
  const billing = new MockBillingProvider(premium ? ["premium"] : []);
  return { ads, billing, service: new MonetisationService(ads, billing, noDelay) };
};

describe("MonetisationService (spec: Monetisation)", () => {
  it("Premium gets an instant grant and never sees an ad", async () => {
    const { ads, service } = setup(true);
    const res = await service.requestGrant("revive");
    expect(res).toEqual({ granted: true, grant: { action: "revive", source: "premium" } });
    expect(ads.log).toEqual([]);
  });

  it("free players get a grant after a rewarded ad", async () => {
    const { service } = setup();
    expect(await service.requestGrant("reroll")).toEqual({ granted: true, grant: { action: "reroll", source: "ad" } });
  });

  it("closing the ad early declines the grant", async () => {
    const { ads, service } = setup();
    ads.script.push("dismissed");
    expect(await service.requestGrant("revive")).toEqual({ granted: false, reason: "declined" });
  });

  it("no ad available: granted after the fallback wait, so a bad connection never costs a run", async () => {
    const { ads, service } = setup();
    ads.script.push("unavailable");
    waits.length = 0;
    expect(await service.requestGrant("revive")).toEqual({ granted: true, grant: { action: "revive", source: "fallback" } });
    expect(waits).toContain(FALLBACK_WAIT_MS);
  });

  it("end-of-run ad: shown to free players, skipped for Premium", async () => {
    expect(await setup(false).service.runEnded()).toBe("shown");
    expect(await setup(true).service.runEnded()).toBe("skipped");
  });

  it("buying Premium removes ads from then on", async () => {
    const { ads, billing, service } = setup();
    await billing.purchase("premium");
    await service.requestGrant("revive");
    expect(ads.log).toEqual([]);
  });

  it("the core still caps a Premium player at the same limits", async () => {
    const { service } = setup(true);
    let limits: RunLimitsState = initialRunLimits();
    let revives = 0;
    for (let i = 0; i < 6; i++) {
      const res = await service.requestGrant("revive");
      if (!res.granted) continue;
      const used = consume(limits, "revive", res.grant);
      if (used.ok) revives++;
      limits = used.state;
    }
    expect(revives).toBe(RUN_LIMITS.revive);
  });
});
