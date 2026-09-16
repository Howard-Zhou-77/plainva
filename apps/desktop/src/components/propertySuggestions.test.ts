import { describe, expect, it } from "vitest";
import { propertyNames, propertyIndexTypes } from "../../../../packages/ui/src/base/propertySuggestions";
import { loadPropertyTypes, setPropertyType } from "../../../../packages/ui/src/base/propertyTypeStore";

describe("shared property suggestions", () => {
  it("prefers schema, then index type, then registry; excludes existing and reserved names", () => {
    const known = [{ name: "Status", type: "string", count: 5 }, { name: "Rating", type: "number", count: 2 },
      { name: "plainva.icon", type: "string", count: 9 }, { name: "Existing", type: "string", count: 4 }];
    const columns = { Status: { input: "status" } };
    const registry = { Rating: "select" as const, OnlyRegistry: "multiselect" as const };
    expect(propertyNames(known, columns, registry, ["existing"], "Statu")).toEqual([{ ...known[0], input: "status" }]);
    const all = propertyNames(known, columns, registry, ["existing"], "");
    expect(all.map((p) => [p.name, p.input])).toEqual([["Status", "status"], ["Rating", "number"], ["OnlyRegistry", "multiselect"]]);
    expect(propertyIndexTypes("text")).toEqual(["string"]);
    expect(propertyIndexTypes("list")).toEqual(["string", "list"]);
  });
  it("keeps existing desktop keys and mobile vault isolation through the shared storage adapter", () => {
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    setPropertyType("vault-a", "Status", "status", store);
    expect(data.has("plainva-prop-types::vault-a")).toBe(true);
    expect(loadPropertyTypes("vault-a", store)).toEqual({ Status: "status" });
    expect(loadPropertyTypes("vault-b", store)).toEqual({});
    data.set("plainva-prop-types::vault-a", '{"Status":"unknown","__proto__":"text","List":"list"}');
    expect(loadPropertyTypes("vault-a", store)).toEqual({ List: "list" });
  });
});
