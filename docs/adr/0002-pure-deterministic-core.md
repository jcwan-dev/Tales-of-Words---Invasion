# ADR 0002: Pure, deterministic rules core; commands in, events out

- Status: accepted
- Date: 2026-10-10

## Context
Combat has many interacting rules (stacking statuses, hit order, triggers, cooldowns, lost turns). Bugs there must be caught by tests, not players, and the same rules must run in the browser, in Node for the simulator, and inside Capacitor.

## Decision
- All rules live in `packages/core`, which imports nothing from the UI, platform, Node or the DOM (enforced by ESLint).
- All randomness comes from seeded streams (`RngStreams`). Rewards use a stream derived from run seed + node + reroll index, so rerolls never shift other randomness.
- The UI sends commands; the core resolves them instantly and returns events. The UI animates events; the core never waits.
- The core has no runtime dependencies. Content validation is hand-written for this reason.

## Consequences
- Same seed + same commands = same event log: replays, reproducible bug reports, daily challenges.
- Tests and the simulator run headless in milliseconds.
- Adding a dependency to core requires a new ADR.
