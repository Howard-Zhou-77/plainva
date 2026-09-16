import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("folder bookmarks import into the navigator and follow nested rename and move", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    const source = JSON.stringify({ items: [{ type: "group", items: [{ type: "folder", path: "Projects/Sub" }, { type: "file", path: "Projects/Sub/Note.md" }, { type: "folder", path: "Gone" }] }] });
    await page.evaluate(async source => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [["Projects/Sub/Note.md", "# Note"], ["Archive/Other.md", "# Other"], [".obsidian/bookmarks.json", source]]) await fs.writeFile({ path: "vault/" + path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, source);
    await page.reload();
    const chip = (name: string) => page.locator(".m-chiprow .pv-chip-open").filter({ hasText: name });
    await expect(chip("Sub")).toBeVisible();
    await expect(chip("Gone")).toHaveAttribute("aria-disabled", "true");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("bookmarks-mobile.png") });
    await chip("Sub").click();
    await expect(page.getByRole("button", { name: /^Note/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Back$/ }).click();
    await page.getByRole("button", { name: /^Projects/ }).first().click();
    await page.getByRole("button", { name: /^Sub/ }).first().dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByRole("button", { name: /Rename/ }).click();
    await page.locator(".m-sheet").getByRole("textbox").fill("Renamed");
    await page.locator(".m-sheet").getByRole("button", { name: /OK|Confirm/ }).click();
    const read = () => page.evaluate(async () => JSON.parse(String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.plainva/bookmarks.json", directory: "DATA", encoding: "utf8" })).data)).items);
    await expect.poll(read).toContainEqual({ type: "folder", path: "Projects/Renamed" });
    await page.getByRole("button", { name: /^Renamed/ }).first().dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByRole("button", { name: /Move/ }).click();
    await page.locator(".m-sheet").getByRole("button", { name: "Archive", exact: true }).click();
    await page.locator(".m-sheet").getByRole("button", { name: /Use this folder/ }).click();
    await expect.poll(read).toContainEqual({ type: "folder", path: "Archive/Renamed" });
    await expect.poll(read).toContainEqual({ type: "file", path: "Archive/Renamed/Note.md" });
    expect(await page.evaluate(async () => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.obsidian/bookmarks.json", directory: "DATA", encoding: "utf8" })).data)).toBe(source);
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(chip("Renamed")).toBeVisible();
    await chip("Gone").locator("..").getByRole("button", { name: /Remove bookmark/ }).click();
    await expect(chip("Gone")).toHaveCount(0);
  } finally { sql.close(); }
});
