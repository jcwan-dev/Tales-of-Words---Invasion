import { expect, test } from "@playwright/test";

test("title screen loads with valid content and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Invasion" })).toBeVisible();
  await expect(page.getByTestId("content-status")).toContainText("files valid");
  // Google Fonts can fail offline in CI; ignore font network noise only.
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)/.test(e))).toEqual([]);
});

test("the game's stylesheet is applied (dark background, gold title, panels)", async ({ page }) => {
  // Catches a build or deploy where the CSS file is missing or not applied:
  // the page still works, but would render with browser defaults.
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Invasion" })).toBeVisible();
  const look = await page.evaluate(() => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop) : "");
    return {
      background: css(document.body, "background-color"),
      title: css(document.querySelector("h1"), "color"),
      panelBorder: css(document.querySelector(".panel"), "border-top-style"),
      fontVariable: getComputedStyle(document.documentElement).getPropertyValue("--f-display").trim(),
    };
  });
  expect(look.background).toBe("rgb(20, 17, 27)"); // --ink #14111b
  expect(look.title).toBe("rgb(201, 164, 92)"); // --gold #c9a45c
  expect(look.panelBorder).toBe("solid");
  expect(look.fontVariable).toContain("Marcellus");
});

test.describe("revive and reroll rules (spec: Monetisation)", () => {
  test("free player: ads gate revives, and the third revive is refused", async ({ page }) => {
    await page.goto("./?adms=300");
    const revive = page.getByTestId("revive");

    for (const left of [1, 0]) {
      await revive.click();
      await expect(page.getByTestId("ad-placeholder")).toBeVisible();
      await expect(page.getByTestId("ad-placeholder")).toBeHidden();
      await expect(revive).toContainText(`${left} left`);
    }
    // Out of revives: the button is disabled, so no third ad or grant can start.
    await expect(revive).toBeDisabled();
    await expect(page.getByTestId("log").locator("li")).toHaveCount(2);
  });

  test("Premium: no ads, same limits", async ({ page }) => {
    await page.goto("./?adms=300");
    await page.getByTestId("buy-premium").click();
    await expect(page.getByTestId("buy-premium")).toHaveText("Premium owned");

    const reroll = page.getByTestId("reroll");
    for (const left of [2, 1, 0]) {
      await reroll.click();
      await expect(reroll).toContainText(`${left} left`);
    }
    await expect(page.getByTestId("ad-placeholder")).toHaveCount(0);
    await expect(reroll).toBeDisabled();
    await expect(page.getByTestId("log")).toContainText("reroll granted (premium)");
  });

  test("New run restores the limits and re-enables the buttons", async ({ page }) => {
    await page.goto("./?adms=300");
    await page.getByTestId("buy-premium").click();
    const revive = page.getByTestId("revive");
    await revive.click();
    await revive.click();
    await expect(revive).toBeDisabled();

    await page.getByTestId("new-run").click();
    await expect(revive).toBeEnabled();
    await expect(revive).toContainText("2 left");
    await expect(page.getByTestId("reroll")).toContainText("3 left");
  });
});

test.describe("test panel log", () => {
  test("is unnumbered, newest first, and says when it trims old lines", async ({ page }) => {
    await page.goto("./?adms=300");
    const log = page.getByTestId("log");
    // An unordered list, so no "1." numbering on the newest line.
    await expect(log).toHaveJSProperty("tagName", "UL");

    await page.getByTestId("buy-premium").click();
    await expect(page.getByTestId("log-caption")).toHaveText("Newest first");

    // 1 purchase + 3 rerolls + 2 revives + 1 revive after New run = 7 log lines, more than the 6 kept.
    const reroll = page.getByTestId("reroll");
    const revive = page.getByTestId("revive");
    for (let i = 0; i < 3; i++) await reroll.click();
    for (let i = 0; i < 2; i++) await revive.click();
    await page.getByTestId("new-run").click();
    await revive.click();

    await expect(log.locator("li")).toHaveCount(6);
    await expect(log.locator("li").first()).toHaveText("revive granted (premium)");
    await expect(page.getByTestId("log-caption")).toHaveText("Last 6 of 7 actions, newest first");
  });
});
