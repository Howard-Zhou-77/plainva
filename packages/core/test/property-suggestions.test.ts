import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

describe("indexed property suggestions", () => {
  it("expands lists without blobs, nulls, objects or duplicate counts; scopes and filters types", async () => {
    const db = await realSqlite();
    try {
      const add = async (id: string, path: string, type: string, value: string) => {
        await db.execute("INSERT INTO files(id,path,mode) VALUES(?,?,'markdown')", [id, path]);
        await db.execute("INSERT INTO properties(file_id,key,type,value) VALUES(?,'Status',?,?)", [id, type, value]);
      };
      await add("a", "A_B/a.md", "list", '["Open","Open","Done",null,{"no":"object"},17]');
      await add("b", "A_B/b.md", "string", "Open");
      await add("c", "Else/c.md", "string", "Elsewhere");
      await add("d", "AxB/d.md", "number", "17");
      await add("e", "root.md", "boolean", "true");
      await add("f", "A_B/f.md", "object", "null");
      await add("g", "A_B/g.md", "list", "bad-json");
      const query = new VaultQueryService(db);
      expect(await query.getDistinctPropertyValues("Status", "A_B/", ["string", "list"]))
        .toEqual([{ value: "Open", count: 2 }, { value: "Done", count: 1 }]);
      expect(await query.getDistinctPropertyValues("Status", undefined, ["number"]))
        .toEqual([{ value: "17", count: 1 }]);
      expect(await query.getDistinctPropertyValues("Status", "/")).toEqual([{ value: "true", count: 1 }]);
      expect((await query.getDistinctPropertyValues("Status", undefined, ["string", "list"])).map((v) => v.value))
        .toEqual(["Open", "Done", "Elsewhere"]);
      expect(await query.getDistinctPropertyValues("Status' OR 1=1 --")).toEqual([]);
    } finally { await db.close(); }
  });

  it("returns bounded names with dominant index type and frequency using one query", async () => {
    const db = await realSqlite();
    try {
      await db.execute("INSERT INTO files(id,path,mode) VALUES('a','a.md','markdown'),('b','b.md','markdown')");
      for (let i = 0; i < 500; i++) await db.execute("INSERT INTO properties(file_id,key,type,value) VALUES('a',?,'string','v')", [`Property-${i}`]);
      await db.execute("INSERT INTO properties(file_id,key,type,value) VALUES('a','Status','string','Open'),('b','Status','string','Closed')");
      const query = new VaultQueryService(db), read = vi.spyOn(db, "query");
      expect(await query.getKnownProperties("Statu")).toEqual([{ name: "Status", type: "string", count: 2 }]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(await query.getKnownProperties()).toHaveLength(80);
      expect(await query.getKnownProperties("", 10_000)).toHaveLength(200);
      expect(await query.getKnownProperties("%' OR 1=1 --")).toEqual([]);
    } finally { await db.close(); }
  });
});
