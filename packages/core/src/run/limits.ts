/**
 * Per-run limits on revives and rerolls (spec: Monetisation).
 *
 * These are product rules that protect against pay-to-win, so they live in the
 * core and nowhere else (code rule 7). Premium players get the same limits;
 * the grant source never changes what is allowed.
 */

export const RUN_LIMITS = Object.freeze({
  revive: 2,
  reroll: 3,
} as const);

export type LimitedAction = keyof typeof RUN_LIMITS;

/** How the platform layer obtained permission. The core records it but never treats sources differently. */
export type GrantSource = "premium" | "ad" | "fallback";

/**
 * Permission for one limited action, issued by the platform layer's
 * MonetisationService after an ad, a Premium check, or the no-ad fallback.
 */
export interface Grant {
  readonly action: LimitedAction;
  readonly source: GrantSource;
}

export interface RunLimitsState {
  readonly used: Readonly<Record<LimitedAction, number>>;
}

export const initialRunLimits = (): RunLimitsState => ({ used: { revive: 0, reroll: 0 } });

export const remaining = (state: RunLimitsState, action: LimitedAction): number =>
  Math.max(0, RUN_LIMITS[action] - state.used[action]);

export type ConsumeResult =
  | { readonly ok: true; readonly state: RunLimitsState }
  | { readonly ok: false; readonly reason: "limit_reached" | "wrong_action"; readonly state: RunLimitsState };

/** Spend one use of `action`. Refuses past the limit whatever the grant says. */
export function consume(state: RunLimitsState, action: LimitedAction, grant: Grant): ConsumeResult {
  if (grant.action !== action) return { ok: false, reason: "wrong_action", state };
  if (remaining(state, action) === 0) return { ok: false, reason: "limit_reached", state };
  return {
    ok: true,
    state: { used: { ...state.used, [action]: state.used[action] + 1 } },
  };
}
