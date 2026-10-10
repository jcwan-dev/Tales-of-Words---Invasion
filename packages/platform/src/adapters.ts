/**
 * Platform adapter interfaces (spec: Monetisation architecture).
 * Each has a web mock (here) and a native Capacitor implementation (M4).
 * The app reaches ads and billing only through these (code rule 7).
 */

export type AdOutcome = "rewarded" | "dismissed" | "unavailable";

export interface AdProvider {
  /** Rewarded video. Resolves "rewarded" only if the player watched to the end. */
  showRewarded(placement: "revive" | "reroll"): Promise<AdOutcome>;
  /** Interstitial at the end of a run. Resolves when closed or if none could load. */
  showInterstitial(placement: "run_end"): Promise<"shown" | "unavailable">;
}

export type ProductId = "premium" | `bundle.${string}`;

export interface BillingProvider {
  /** Owned non-consumable products, from the store (cached locally for offline play). */
  owned(): Promise<ReadonlySet<ProductId>>;
  purchase(product: ProductId): Promise<"purchased" | "cancelled" | "failed">;
  restore(): Promise<ReadonlySet<ProductId>>;
}

/** Waits without blocking the UI; injectable so tests run instantly. */
export type Delay = (ms: number) => Promise<void>;
export const realDelay: Delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
