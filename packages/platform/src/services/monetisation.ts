import type { Grant, LimitedAction } from "@tow/core";
import type { AdProvider, BillingProvider, Delay } from "../adapters.ts";

/** How long a player waits for a revive or reroll when no ad can load. */
export const FALLBACK_WAIT_MS = 3000;

export type GrantResult = { readonly granted: true; readonly grant: Grant } | { readonly granted: false; readonly reason: "declined" };

/**
 * Decides how a player obtains permission for a revive or reroll
 * (spec: Monetisation architecture):
 *  - Premium owned: granted immediately.
 *  - Otherwise: rewarded ad; granted when the ad rewards.
 *  - No ad available (offline, no fill): granted after a short wait.
 * It never counts uses. The per-run limits are enforced by @tow/core only.
 */
export class MonetisationService {
  constructor(
    private readonly ads: AdProvider,
    private readonly billing: BillingProvider,
    private readonly delay: Delay,
  ) {}

  async isPremium(): Promise<boolean> {
    return (await this.billing.owned()).has("premium");
  }

  async requestGrant(action: LimitedAction): Promise<GrantResult> {
    if (await this.isPremium()) return { granted: true, grant: { action, source: "premium" } };

    const outcome = await this.ads.showRewarded(action);
    if (outcome === "rewarded") return { granted: true, grant: { action, source: "ad" } };
    if (outcome === "dismissed") return { granted: false, reason: "declined" };

    await this.delay(FALLBACK_WAIT_MS);
    return { granted: true, grant: { action, source: "fallback" } };
  }

  /** End-of-run ad: skipped for Premium, skipped if none can load. */
  async runEnded(): Promise<"shown" | "skipped"> {
    if (await this.isPremium()) return "skipped";
    return (await this.ads.showInterstitial("run_end")) === "shown" ? "shown" : "skipped";
  }
}
