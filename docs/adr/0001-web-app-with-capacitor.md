# ADR 0001: Web app in TypeScript, packaged with Capacitor

- Status: accepted
- Date: 2026-10-10

## Context
The game is 2D: text, cards, bars, illustrations and simple hit animations. Most code will be written by agents, and the product owner wants to see every change without store releases. Unity, Godot (C#), React Native and a web app were compared (spec: "Technology").

## Decision
Build a web app in TypeScript (React, Vite) and package it for Android, later iOS, with Capacitor. Ink events run on inkjs. Purchases through RevenueCat, ads through AdMob, post-launch web updates through Capgo.

## Consequences
- Every change is playable in a browser on a preview or staging link; agents test in a real browser.
- The approved HTML mockups carry over almost directly.
- Godot with C# was ruled out partly because it could not export C# projects to the web.
- No game-engine tooling; a PixiJS layer can be added for one screen if CSS is not enough.
- If native feel becomes a problem, the UI can move to React Native without touching `packages/core`.
