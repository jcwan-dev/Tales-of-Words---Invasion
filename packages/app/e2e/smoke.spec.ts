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
    await revive.click();
    await expect(page.getByTestId("log")).toContainText("revive: limit reached (2 per run)");
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
    await reroll.click();
    await expect(page.getByTestId("log")).toContainText("reroll: limit reached (3 per run)");
    await expect(page.getByTestId("log")).toContainText("reroll granted (premium)");
  });
});
