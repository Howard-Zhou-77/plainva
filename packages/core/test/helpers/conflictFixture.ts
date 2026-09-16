import { vi } from "vitest";
import type { ConflictEditSession } from "../../src/vault/conflictSession.js";

/** Extend the older scripted sync fixture with stateful local conflict files.
 * Its provider assertions still see every call and every injected rejection.
 * Session durability itself is covered against real SQLite and local files.
 */
export function addConflictFixture(repo: any, vault: any): void {
  const sessions = new Map<string, ConflictEditSession>();
  repo.getConflictSession = vi.fn(async (path: string) => structuredClone(sessions.get(path) ?? null));
  repo.saveConflictSession = vi.fn(async (session: ConflictEditSession) => { sessions.set(session.originalPath, structuredClone(session)); });
  repo.recordConflictDiagnostic = vi.fn(async () => {});
  const copies = new Map<string, string>();
  for (const method of ["exists", "readTextFile", "writeTextFile", "deleteItem"]) {
    vault[method] = new Proxy(vault[method], {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        const path = args[0];
        if (!path.includes(".CONFLICT-") && !path.startsWith(".plainva/conflict-revisions/")) return result;
        return Promise.resolve(result).then(() => {
          if (method === "exists") return copies.has(path);
          if (method === "readTextFile") { if (!copies.has(path)) throw new Error("missing conflict copy"); return copies.get(path); }
          if (method === "writeTextFile") copies.set(path, args[1]);
          if (method === "deleteItem") copies.delete(path);
        });
      },
    });
  }
}
