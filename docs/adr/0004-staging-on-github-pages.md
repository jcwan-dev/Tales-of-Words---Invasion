# ADR 0004: Staging on GitHub Pages first, per-change previews later

- Status: accepted
- Date: 2026-10-10

## Context
The spec asks for a private preview link for every change and a stable staging link for main. Per-change previews need a hosting account (Cloudflare Pages) and secrets, which do not exist yet.

## Decision
- M0: every push to `main` publishes the app to GitHub Pages (staging link). Every pull request uploads its browser test videos and report as CI artifacts.
- When a Cloudflare account exists, add per-pull-request preview links (Cloudflare Pages) without changing the build.

## Consequences
- The staging link is public while the repository is public. Nothing secret is in the app at this stage.
- GitHub Pages must be enabled once in the repository settings (Settings → Pages → Source: GitHub Actions).
