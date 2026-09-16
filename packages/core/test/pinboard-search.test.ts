import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

describe("pinboard body search", () => {
  it("searches all selected paths, including the tail, with Unicode folding and bounded reads", async () => {
    const db = await realSqlite();
    try {
      const paths = Array.from({ length: 503 }, (_, i) => `Note-${i}.md`);
      for (const [i, path] of paths.entries()) await db.execute("INSERT INTO fts_notes(path, content) VALUES (?, ?)", [path, i === 502 ? "---\nHidden: secret-value\n---\nMÜLLER finds 100% here." : "Ordinary body"]);
      await db.execute("INSERT INTO fts_notes(path, content) VALUES (?, ?)", ["Outside.md", "MÜLLER finds 100% here."]);
      const query = new VaultQueryService(db);
      const reads = vi.spyOn(db, "query");
      expect(await query.searchCardContent(paths, "müller")).toEqual(["Note-502.md"]);
      expect(reads.mock.calls.every(([, params]) => params!.length <= 200)).toBe(true);
      expect(await query.searchCardContent(paths, "secret-value")).toEqual([]);
      expect(await query.searchCardContent(paths, "100%")).toEqual(["Note-502.md"]);
      expect(await query.searchCardContent(paths, "%' OR 1=1 --")).toEqual([]);
      expect(await query.searchCardContent([], "ordinary")).toEqual([]);
    } finally { await db.close(); }
  });
});
