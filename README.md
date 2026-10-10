# Tales of Words: Invasion

A narrative roguelike for mobile, set in the Tales of Words universe. Pick a background, a weapon, armor, an accessory and a way of living, then survive three acts of story events, merchants and turn-based fights where words are magic.

- **Spec and design:** [`docs/spec/roguelike-spec.md`](docs/spec/roguelike-spec.md), with [screen mockups](https://claude.ai/artifact/L1sHrieFqRf2CYbsc8m61s)
- **For contributors and agents:** [`CLAUDE.md`](CLAUDE.md)
- **Decisions:** [`docs/adr/`](docs/adr)

## Status
Milestone **M0: Foundations**. A blank app with a foundations check and a test panel for the revive and reroll rules. Combat arrives in M1.

## Run it
Requires Node 22 and pnpm 10 (`corepack enable`).

```
pnpm install
pnpm dev          # http://localhost:5173
pnpm check        # everything CI runs except the browser tests
pnpm test:e2e     # browser tests
```

## Tech
TypeScript web app (React, Vite), packaged for Android with Capacitor. Rules in a pure, deterministic core package. See [ADR 0001](docs/adr/0001-web-app-with-capacitor.md).
