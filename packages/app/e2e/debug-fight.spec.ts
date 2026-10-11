import { expect, test, type Page } from "@playwright/test";

// Browser tests for the debug fight page (task M1.3c), written from the brief and the spec
// ("Turn details", "Stun and paralysis", "Hit order", "Powers"). Expected numbers are worked
// out by hand from the spec, never from the core implementation.

const DEBUG = "./#debug";

async function openDebug(page: Page, preset?: string): Promise<void> {
  await page.goto(DEBUG);
  await expect(page.getByTestId("preset")).toBeVisible();
  if (preset) await page.getByTestId("preset").selectOption(preset);
}

async function nextTurns(page: Page, count: number): Promise<void> {
  const next = page.getByTestId("next");
  for (let i = 0; i < count; i++) await next.click();
}

function logLines(page: Page, text: string) {
  return page.getByTestId("log").locator("li", { hasText: text });
}

test.describe("debug fight page: navigation", () => {
  test("#debug loads with no console errors, even after a whole fight", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await openDebug(page);
    await expect(page.getByText("Debug fight").first()).toBeVisible();
    await page.getByTestId("start").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toBeVisible();
    // Google Fonts can fail offline in CI; ignore font network noise only.
    expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)/.test(e))).toEqual([]);
  });

  test("the title screen links to the debug page, and Back returns", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { name: "Invasion" })).toBeVisible();
    await page.getByTestId("debug-link").click();
    await expect(page).toHaveURL(/#debug$/);
    await expect(page.getByTestId("preset")).toBeVisible();

    await page.getByTestId("debug-back").click();
    await expect(page.getByRole("heading", { name: "Invasion" })).toBeVisible();
    await expect(page.getByTestId("preset")).toHaveCount(0);
  });
});

test.describe("debug fight page: setup and controls", () => {
  test("default preset duel fills both editors; seed defaults to debug; statuses are collapsed", async ({ page }) => {
    await openDebug(page);
    await expect(page.getByTestId("preset")).toHaveValue("duel");
    await expect(page.getByTestId("seed")).toHaveValue("debug");

    const player = page.getByTestId("unit-player");
    const enemy = page.getByTestId("unit-enemy");
    await expect(player).toBeVisible();
    await expect(enemy).toBeVisible();

    await expect(page.getByTestId("player-stat-might")).toHaveValue("4");
    await expect(page.getByTestId("player-stat-vitality")).toHaveValue("4");
    await expect(page.getByTestId("player-stat-agility")).toHaveValue("1");
    await expect(page.getByTestId("player-stat-wisdom")).toHaveValue("3");
    await expect(page.getByTestId("player-stat-cunning")).toHaveValue("2");
    await expect(page.getByTestId("player-hp")).toHaveValue("50");
    await expect(page.getByTestId("player-shield")).toHaveValue("8");
    await expect(page.getByTestId("player-attack-type")).toHaveValue("physical");
    await expect(page.getByTestId("player-attack-amount")).toHaveValue("12");
    await expect(page.getByTestId("player-attack-hits")).toHaveValue("1");
    await expect(page.getByTestId("player-attack-piercing")).not.toBeChecked();

    await expect(page.getByTestId("enemy-stat-might")).toHaveValue("4");
    await expect(page.getByTestId("enemy-stat-agility")).toHaveValue("2");
    await expect(page.getByTestId("enemy-hp")).toHaveValue("50");
    await expect(page.getByTestId("enemy-shield")).toHaveValue("0");
    await expect(page.getByTestId("enemy-attack-amount")).toHaveValue("17");

    await expect(page.getByTestId("player-statuses")).toHaveJSProperty("open", false);
    await expect(page.getByTestId("enemy-statuses")).toHaveJSProperty("open", false);
  });

  test("changing the preset refills the editors", async ({ page }) => {
    await openDebug(page, "stun");
    await expect(page.getByTestId("player-power-stunPower")).toHaveValue("7");
    await expect(page.getByTestId("player-attack-amount")).toHaveValue("3");
    await expect(page.getByTestId("enemy-hp")).toHaveValue("80");
    await expect(page.getByTestId("enemy-stat-vitality")).toHaveValue("2");

    await page.getByTestId("preset").selectOption("thorns");
    await expect(page.getByTestId("player-status-warded")).toHaveValue("2");
    await expect(page.getByTestId("player-status-thorns")).toHaveValue("3");
    await expect(page.getByTestId("enemy-attack-hits")).toHaveValue("2");
  });

  test("controls and inputs follow the fight state", async ({ page }) => {
    await openDebug(page);
    const start = page.getByTestId("start");
    const next = page.getByTestId("next");
    const run = page.getByTestId("run");
    const reset = page.getByTestId("reset");

    // Before start: only Start and Reset.
    await expect(start).toBeEnabled();
    await expect(reset).toBeEnabled();
    await expect(next).toBeDisabled();
    await expect(run).toBeDisabled();
    await expect(page.getByTestId("player-hp")).toBeEnabled();

    // Running: inputs locked, the fight can be stepped.
    await start.click();
    await expect(page.getByTestId("fight")).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(run).toBeEnabled();
    await expect(reset).toBeEnabled();
    for (const id of ["player-hp", "player-stat-might", "player-attack-amount", "enemy-shield", "enemy-attack-type"]) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }

    // Over: only Reset.
    await run.click();
    await expect(page.getByTestId("winner")).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(next).toBeDisabled();
    await expect(run).toBeDisabled();
    await expect(reset).toBeEnabled();

    // Reset: back to setup.
    await reset.click();
    await expect(start).toBeEnabled();
    await expect(next).toBeDisabled();
    await expect(run).toBeDisabled();
    await expect(page.getByTestId("player-hp")).toBeEnabled();
  });
});

test.describe("debug fight page: fights from the rules core", () => {
  test("duel: enemy acts first (Agility 2 vs 1), round 1 damage, and the enemy wins in round 4", async ({ page }) => {
    await openDebug(page);
    await page.getByTestId("start").click();
    await expect(page.getByTestId("round")).toContainText("Round 1");
    // Turn order: player Agility 1 < enemy Agility 2, so the enemy goes first.
    await expect(page.getByTestId("active")).toContainText("Enemy");

    await nextTurns(page, 2);
    // Enemy 17 physical vs 8 Shield; player 12 physical vs 0 Shield.
    await expect(logLines(page, "Enemy hits Player for 17 (8 Shield, 9 HP)")).toHaveCount(1);
    await expect(logLines(page, "Player hits Enemy for 12 (0 Shield, 12 HP)")).toHaveCount(1);
    await expect(page.getByTestId("fight-player")).toContainText("41/50");
    await expect(page.getByTestId("fight-player")).toContainText("0/8");
    await expect(page.getByTestId("fight-enemy")).toContainText("38/50");

    // Player HP 50+8 → 41 → 24 → 7 → falls to the enemy's hit in round 4; enemy 50 → 38 → 26 → 14.
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toHaveText("Winner: Enemy");
    await expect(page.getByTestId("round")).toContainText("Round 4");
    await expect(logLines(page, "Player falls")).toHaveCount(1);
    await expect(logLines(page, "Fight over: Enemy wins")).toHaveCount(1);
    await expect(logLines(page, "Fight over:").last()).toHaveAttribute("data-type", "CombatEnded");
    await expect(page.getByTestId("fight-player")).toContainText("0/50");
    await expect(page.getByTestId("fight-enemy")).toContainText("14/50");
    await expect(logLines(page, "Player hits Enemy for 12 (0 Shield, 12 HP)")).toHaveCount(3);
  });

  test("editing an input before Start changes the fight (duel, enemy HP 5)", async ({ page }) => {
    await openDebug(page);
    await page.getByTestId("enemy-hp").fill("5");
    await page.getByTestId("start").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toHaveText("Winner: Player");
    await expect(page.getByTestId("round")).toContainText("Round 1");
    await expect(logLines(page, "Enemy falls")).toHaveCount(1);
    await expect(logLines(page, "Fight over: Player wins")).toHaveCount(1);
  });

  test("same preset and seed give the same log (determinism)", async ({ page }) => {
    await openDebug(page, "rot");
    await page.getByTestId("start").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toBeVisible();
    const first = await page.getByTestId("log").innerText();
    expect(first).toContain("Fight over:");

    await page.getByTestId("reset").click();
    await expect(page.getByTestId("start")).toBeEnabled();
    await expect(page.getByTestId("preset")).toHaveValue("rot");
    await expect(page.getByTestId("seed")).toHaveValue("debug");
    await page.getByTestId("start").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toBeVisible();
    const second = await page.getByTestId("log").innerText();
    expect(second).toBe(first);
  });

  test("stun: Stun 7 vs Vitality 2 skips the enemy's turn in rounds 2 and 5", async ({ page }) => {
    // Spec example: +7 (7), +6 (13 → enemy loses its next turn, reset to 0), +5, +4, +3 (12 → stunned again).
    // Agility 2 vs 2 → player first. Each Next turn click is one unit's turn:
    // 1 R1 player, 2 R1 enemy, 3 R2 player, 4 R2 enemy (skipped), ... 9 R5 player, 10 R5 enemy (skipped).
    await openDebug(page, "stun");
    await page.getByTestId("start").click();
    await expect(page.getByTestId("active")).toContainText("Player");
    const skipped = logLines(page, "Enemy loses the turn (Stunned)");
    const meter = logLines(page, "Stunned meter full");

    await nextTurns(page, 1);
    await expect(page.getByTestId("fight-enemy")).toContainText("Stunned 7");
    await expect(page.getByTestId("fight-player")).toContainText("6/7"); // Stun power −1 at turn end

    await nextTurns(page, 2); // R1 enemy acts (7 < 10), R2 player
    await expect(page.getByTestId("fight-enemy")).toContainText("Stunned 13");
    await expect(skipped).toHaveCount(0);
    await expect(meter).toHaveCount(0);
    await expect(logLines(page, "Enemy hits Player")).toHaveCount(1);

    await nextTurns(page, 1); // R2 enemy: 13 ≥ 10
    await expect(skipped).toHaveCount(1);
    await expect(skipped.first()).toHaveAttribute("data-type", "TurnSkipped");
    await expect(meter).toHaveCount(1);
    await expect(meter.first()).toContainText("turn lost");
    await expect(page.getByTestId("fight-enemy")).not.toContainText("Stunned");
    await expect(logLines(page, "Enemy hits Player")).toHaveCount(1);

    await nextTurns(page, 5); // R3 P (5), R3 E, R4 P (9), R4 E, R5 P (12)
    await expect(page.getByTestId("fight-enemy")).toContainText("Stunned 12");
    await expect(skipped).toHaveCount(1);
    await expect(logLines(page, "Enemy hits Player")).toHaveCount(3);

    await nextTurns(page, 1); // R5 enemy: 12 ≥ 10
    await expect(skipped).toHaveCount(2);
    await expect(meter).toHaveCount(2);
    await expect(logLines(page, "Enemy hits Player")).toHaveCount(3);
  });

  test("rot: one attack applies all three DoTs, which tick at the enemy's turn start", async ({ page }) => {
    // Agility 2 vs 2 → player first. Two hits of 2 (Shield 10 → 6), Bleed 1 per hit (2),
    // then Burn 3 and Poison 2 once per attack. Enemy resistances are all 2, so no reduction.
    await openDebug(page, "rot");
    await page.getByTestId("start").click();
    await nextTurns(page, 1);
    const enemy = page.getByTestId("fight-enemy");
    await expect(enemy).toContainText("Burning 3");
    await expect(enemy).toContainText("Poisoned 2");
    await expect(enemy).toContainText("Bleeding 2");
    await expect(logLines(page, "Player hits Enemy for 2 (2 Shield, 0 HP)")).toHaveCount(2);

    // Enemy turn start: Burning 3, Bleeding 2 (Shield 6 → 1), Poisoned 2 (HP 60 → 58), each −1 stack.
    await nextTurns(page, 1);
    await expect(logLines(page, "Burning deals 3 to Enemy")).toHaveCount(1);
    await expect(logLines(page, "Bleeding deals 2 to Enemy")).toHaveCount(1);
    await expect(logLines(page, "Poisoned deals 2 to Enemy")).toHaveCount(1);
    const lines = await page.getByTestId("log").locator("li").allInnerTexts();
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at("Burning deals")).toBeLessThan(at("Bleeding deals"));
    expect(at("Bleeding deals")).toBeLessThan(at("Poisoned deals"));
    await expect(enemy).toContainText("Burning 2");
    await expect(enemy).toContainText("Bleeding 1");
    await expect(enemy).toContainText("Poisoned 1");
    await expect(enemy).toContainText("58/60");
    await expect(enemy).toContainText("1/10");
  });

  test("thorns: Warded deflects the enemy's hits and Thorns fires on each, even when deflected", async ({ page }) => {
    // Agility 2 vs 2 → player first. Player's turn end ticks Thorns 3 → 2 (spec: Thorns loses 1 at turn end).
    // Enemy's 2-hit attack: each hit fires Thorns (2) at step 3, then Warded deflects it at step 4.
    await openDebug(page, "thorns");
    await page.getByTestId("start").click();
    await nextTurns(page, 2);

    await expect(logLines(page, "Player deflects the hit")).toHaveCount(2);
    await expect(logLines(page, "Thorns deals 2 to Enemy")).toHaveCount(2);
    await expect(logLines(page, "Enemy hits Player")).toHaveCount(0);
    const lines = (await page.getByTestId("log").locator("li").allInnerTexts()).filter(
      (l) => l.includes("Thorns deals") || l.includes("deflects the hit"),
    );
    expect(lines.map((l) => (l.includes("Thorns") ? "thorns" : "deflect"))).toEqual([
      "thorns",
      "deflect",
      "thorns",
      "deflect",
    ]);
    await expect(page.getByTestId("fight-player")).not.toContainText("Warded");
  });
});

test.describe("debug fight page: run cap, reset and log headers", () => {
  test("Run to end stops after 50 rounds when nobody can win", async ({ page }) => {
    await openDebug(page);
    await page.getByTestId("player-attack-amount").fill("0");
    await page.getByTestId("enemy-attack-amount").fill("0");
    await page.getByTestId("start").click();
    await page.getByTestId("run").click();

    await expect(page.getByTestId("capped")).toHaveText("Stopped after 50 rounds");
    await expect(page.getByTestId("winner")).toHaveCount(0);
    await expect(page.getByTestId("next")).toBeDisabled();
    await expect(page.getByTestId("run")).toBeDisabled();
    await expect(page.getByTestId("reset")).toBeEnabled();
  });

  test("Reset removes the fight view and clears the log", async ({ page }) => {
    await openDebug(page);
    await page.getByTestId("start").click();
    await nextTurns(page, 2);
    await expect(page.getByTestId("fight")).toBeVisible();
    await expect(page.getByTestId("log").locator("li").first()).toBeVisible();

    await page.getByTestId("reset").click();
    await expect(page.getByTestId("fight")).toHaveCount(0);
    // Passes whether the log is empty or not rendered at all.
    await expect(page.getByTestId("log").locator("li")).toHaveCount(0);
  });

  test("log lines are grouped under turn headers like 'Round 1 · Enemy'", async ({ page }) => {
    // Duel: enemy Agility 2 > player Agility 1, so the first turn is the enemy's.
    await openDebug(page);
    await page.getByTestId("start").click();
    await nextTurns(page, 1);
    await expect(page.locator(".turn-head").first()).toHaveText("Round 1 · Enemy");
  });
});

test.describe("debug fight page: layout", () => {
  test("no sideways scroll on the phone viewport, and inputs are at least 40px tall", async ({ page }) => {
    await openDebug(page);
    const box = await page.getByTestId("player-hp").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);

    await page.getByTestId("start").click();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("winner")).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
  });
});
