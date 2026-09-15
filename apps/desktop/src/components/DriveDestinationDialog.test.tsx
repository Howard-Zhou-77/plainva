// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DriveDestinationDialog, type DriveDestinationSession } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); });
const preview = (id: string) => ({ id, name: "Vault", items: id === "root"
  ? [{ id: "first", name: "Vault", folder: true }, { id: "second", name: "Vault", folder: true }]
  : [{ id: "note", name: `${id}.md`, folder: false }] });
async function mount(session: DriveDestinationSession, onSave = vi.fn(async () => {})) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<DriveDestinationDialog session={session} onSave={onSave} onClose={() => {}} />));
  return onSave;
}
async function click(text: string, index = 0) {
  const buttons = [...document.querySelectorAll("button")].filter(button => button.textContent === text);
  expect(buttons[index]).toBeTruthy();
  await act(async () => buttons[index].click());
}

describe("Drive destination confirmation", () => {
  it("keeps same-name folders distinct and only saves the reviewed id", async () => {
    const onSave = await mount({ currentPath: "Old", previewCurrent: async () => preview("old"), loadFolder: async id => preview(id) });
    await click("Vault", 1);
    expect(document.body.textContent).toContain("second.md");
    expect(onSave).not.toHaveBeenCalled();
    await click(i18n.t("driveDestination.review"));
    expect(document.body.textContent).toContain("old.md");
    expect(onSave).not.toHaveBeenCalled();
    await click(i18n.t("driveDestination.apply"));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ path: "Vault", id: "second" });
  });
  it("refuses saving when the selected folder disappears during confirmation", async () => {
    let removed = false;
    const onSave = await mount({ currentPath: "Old", previewCurrent: async () => preview("old"),
      loadFolder: async id => { if (removed) throw new Error("folder unavailable"); return preview(id); } });
    await click("Vault", 0);
    await click(i18n.t("driveDestination.review"));
    removed = true;
    await click(i18n.t("driveDestination.apply"));
    expect(document.body.textContent).toContain("folder unavailable");
    expect(onSave).not.toHaveBeenCalled();
  });
});
