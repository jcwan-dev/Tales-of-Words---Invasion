# ADR 0003: Revive and reroll limits are enforced in the core

- Status: accepted
- Date: 2026-10-10

## Context
Monetisation (spec): free players revive (max 2 per run) and reroll rewards (max 3 per run) by watching ads; Premium removes ads but keeps the same limits, so paying never makes a run stronger.

## Decision
- The limits are constants in `packages/core/src/run/limits.ts`, never remote config.
- The core never knows about ads or money. A revive or reroll needs a `Grant` from the platform layer's `MonetisationService` (Premium → immediate; otherwise rewarded ad; no ad available → granted after a short wait).
- `consume()` refuses past the limit whatever the grant source, and refuses a grant issued for a different action.

## Consequences
- A UI bug or a Premium account cannot exceed the limits. An invariant test checks thousands of random request sequences.
- Granting after a short wait when no ad loads means a player could avoid ads by going offline. Accepted, so a bad connection never costs a run.
