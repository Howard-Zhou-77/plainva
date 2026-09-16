import { importObsidianBookmarks, renameBookmarksOnDisk, setBookmarksLaneScope, toast, type BookmarkEntry, type BookmarksIO } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getWindowBus } from "./windowBus";

/** Each owner adapter is bound to its own vault, including background vaults. */
const scopes = new WeakMap<BookmarksIO, string>();
export function bindBookmarkVault(io: BookmarksIO, vaultPath: string) {
  scopes.set(io, vaultPath); setBookmarksLaneScope(io, `desktop:${vaultPath}`);
  return () => { if (scopes.get(io) === vaultPath) scopes.delete(io); };
}
export const loadDesktopBookmarks = importObsidianBookmarks;
export function publishBookmarks(vaultPath: string, bookmarks: BookmarkEntry[]): void {
  window.dispatchEvent(new CustomEvent("plainva-bookmarks-changed", { detail: { vaultPath, bookmarks } }));
  void getWindowBus().then(bus => bus.broadcast("bookmarks-changed", { entries: bookmarks }, vaultPath)).catch(() => {});
}
/** The file has already moved. A bookmark I/O error must remain visible without
 * pretending the file move failed or discarding the unreadable list. */
export async function retargetDesktopBookmarks(io: BookmarksIO & { retargetBookmarks?: (from: string, to: string) => Promise<void> }, from: string, to: string): Promise<void> {
  try {
    if (io.retargetBookmarks) return await io.retargetBookmarks(from, to);
    const entries = await renameBookmarksOnDisk(io, from, to);
    const scope = scopes.get(io); if (scope) publishBookmarks(scope, entries);
  } catch { toast.error(i18n.t("sidebar.bookmarkSaveFailed")); }
}
