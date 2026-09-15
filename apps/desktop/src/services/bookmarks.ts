import { mergeBookmarksOnDisk, readBookmarksOnDisk, type BookmarksIO } from "@plainva/ui";
import { getWindowBus } from "./windowBus";

/** Existing Obsidian import, run once by the vault owner when a shell opens. */
export async function loadDesktopBookmarks(io: BookmarksIO): Promise<string[]> {
  const paths: string[] = [];
  try {
    const data = JSON.parse(await io.readTextFile(".obsidian/bookmarks.json"));
    const queue: unknown[] = Array.isArray(data?.items) ? [...data.items] : [];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i] as { type?: string; path?: unknown; items?: unknown } | null;
      if (item?.type === "file" && typeof item.path === "string") paths.push(item.path);
      if (item?.type === "group" && Array.isArray(item.items)) queue.push(...item.items);
    }
  } catch { /* No readable source to import; the Plainva list is still authoritative. */ }
  return paths.length ? mergeBookmarksOnDisk(io, paths) : readBookmarksOnDisk(io);
}

export function publishBookmarks(vaultPath: string, bookmarks: string[]): void {
  window.dispatchEvent(new CustomEvent("plainva-bookmarks-changed", { detail: { vaultPath, bookmarks } }));
  void getWindowBus().then(bus => bus.broadcast("bookmarks-changed", { paths: bookmarks }, vaultPath)).catch(() => {});
}
