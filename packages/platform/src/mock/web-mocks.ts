import type { AdOutcome, AdProvider, BillingProvider, Delay, ProductId } from "../adapters.ts";

/**
 * Browser and test stand-ins (spec: "Web mock"). Ads show a placeholder for a
 * few seconds; purchases succeed instantly. Behaviour is scriptable so tests
 * can cover declines and no-fill.
 */
export class MockAdProvider implements AdProvider {
  /** What the next rewarded ads return; defaults to "rewarded" when empty. */
  readonly script: AdOutcome[] = [];
  readonly log: string[] = [];

  constructor(
    private readonly delay: Delay,
    private readonly durationMs = 3000,
    private readonly onShow?: (kind: "rewarded" | "interstitial", placement: string) => void,
  ) {}

  async showRewarded(placement: "revive" | "reroll"): Promise<AdOutcome> {
    const outcome = this.script.shift() ?? "rewarded";
    this.log.push(`rewarded:${placement}:${outcome}`);
    if (outcome !== "unavailable") {
      this.onShow?.("rewarded", placement);
      await this.delay(this.durationMs);
    }
    return outcome;
  }

  async showInterstitial(placement: "run_end"): Promise<"shown" | "unavailable"> {
    this.log.push(`interstitial:${placement}`);
    this.onShow?.("interstitial", placement);
    await this.delay(this.durationMs);
    return "shown";
  }
}

export class MockBillingProvider implements BillingProvider {
  readonly #owned = new Set<ProductId>();

  constructor(initiallyOwned: readonly ProductId[] = []) {
    for (const p of initiallyOwned) this.#owned.add(p);
  }

  async owned(): Promise<ReadonlySet<ProductId>> {
    return new Set(this.#owned);
  }

  async purchase(product: ProductId): Promise<"purchased"> {
    this.#owned.add(product);
    return "purchased";
  }

  async restore(): Promise<ReadonlySet<ProductId>> {
    return this.owned();
  }
}
