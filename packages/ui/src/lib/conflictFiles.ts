/**
 * Helpers around sync conflict copies (P3.11). The worker names them
 * `<base>.CONFLICT-<iso-stamp><ext>` (SyncWorker.preserveLocalAsConflict);
 * resolving needs the reverse mapping back to the original path.
 */

export function isConflictCopyPath(path: string): boolean {
  return conflictOriginalPath(path) !== null;
}

/** `Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md` -> `Notes/a.md`; null if not a conflict copy. */
export function conflictOriginalPath(conflictPath: string): string | null {
  const marker = conflictPath.lastIndexOf(".CONFLICT-");
  if (marker < 0 || marker < Math.max(conflictPath.lastIndexOf("/"), conflictPath.lastIndexOf("\\"))) return null;
  const suffix = conflictPath.slice(marker + ".CONFLICT-".length);
  const dot = suffix.lastIndexOf(".");
  return conflictPath.slice(0, marker) + (dot >= 0 && dot < suffix.length - 1 ? suffix.slice(dot) : "");
}

/**
 * Builds a conflict-copy sibling path for `path` — the same grammar the sync
 * worker uses (`<base>.CONFLICT-<iso-stamp><ext>`), so conflictOriginalPath
 * and the conflict banners resolve editor-preserved drafts identically.
 */
export function conflictCopyPath(path: string, now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const extMatch = path.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = extMatch ? path.substring(0, path.length - ext.length) : path;
  return `${base}.CONFLICT-${timestamp}${ext}`;
}
