export const COMPARISON_PREFIX = "plainva://compare?";
export function comparisonPath(path: string, backupPath: string, orphan = false): string {
  return COMPARISON_PREFIX + new URLSearchParams({ path, version: backupPath, ...(orphan ? { orphan: "1" } : {}) });
}
export function comparisonSubject(path: string): { kind: "version"; path: string; selectedBackupPath: string; orphan: boolean } | null {
  if (!path.startsWith(COMPARISON_PREFIX)) return null;
  const query = new URLSearchParams(path.slice(COMPARISON_PREFIX.length));
  const note = query.get("path"), version = query.get("version");
  if (!note || !version) return null;
  return { kind: "version", path: note, selectedBackupPath: version, orphan: query.get("orphan") === "1" };
}
