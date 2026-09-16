import { useEffect, useState } from "react";
import { bookmarkKey, type BookmarkEntry } from "./bookmarksFile";

interface TargetIO {
  exists(path: string): Promise<boolean>;
  getFileInfo?(path: string): Promise<{ isDirectory: boolean }>;
}
/** Absence is distinct from an unreadable target. Bounded concurrency avoids a
 * filesystem storm for a long bookmark list; nothing is deleted by this read. */
export function useBookmarkTargets(io: TargetIO | null, entries: BookmarkEntry[], revision: unknown = null) {
  const [result, setResult] = useState<{ io: TargetIO; entries: BookmarkEntry[]; values: Map<string, boolean> } | null>(null);
  useEffect(() => {
    let alive = true;
    if (io) void (async () => {
      const values = new Map<string, boolean>();
      for (let offset = 0; offset < entries.length && alive; offset += 16) await Promise.all(entries.slice(offset, offset + 16).map(async (entry) => {
        try {
          const exists = await io.exists(entry.path);
          const info = exists && io.getFileInfo ? await io.getFileInfo(entry.path) : null;
          values.set(bookmarkKey(entry), exists && (!info || info.isDirectory === (entry.type === "folder")));
        } catch { /* Indeterminate targets stay visible without a false missing label. */ }
      }));
      if (alive) setResult({ io, entries, values });
    })();
    return () => { alive = false; };
  }, [io, entries, revision]);
  return result?.io === io && result?.entries === entries ? result.values : new Map<string, boolean>();
}
