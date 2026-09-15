import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("phone search pages, jumps to the selected occurrence, and restores return context", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  const text = '# Record\n\n## First\nneedle first\n\n## Second\nneedle second\n\n' + Array.from({ length: 53 }, (_, i) => `needle extra ${i}`).join('\n\n');
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async data => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Record.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, text);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByRole('button', { name: /^Search$/ }).first().click();
    const field = page.getByTestId('appbar-searchpage').locator('input');
    await field.fill('needle');
    const rows = page.locator('[data-search-occurrence]');
    await expect(rows).toHaveCount(40);
    await expect(rows.nth(1)).toContainText('Second');
    await page.getByRole('button', { name: 'Load more occurrences' }).click();
    await expect(rows).toHaveCount(55);
    await rows.nth(45).click();
    // Reading mode highlights the occurrence without opening the keyboard.
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('needle');
    await expect(page.locator('.cm-line').filter({ hasText: /^needle extra 43$/ })).toBeInViewport();
    await page.getByRole('button', { name: /^Back$/ }).first().click();
    await expect(field).toHaveValue('needle');
    await expect(rows).toHaveCount(55);
    await expect(rows.nth(45)).toBeInViewport();
    await field.fill('missingterm');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('No matching occurrences.', { exact: true })).toBeVisible();
  } finally { sql.close(); }
});
