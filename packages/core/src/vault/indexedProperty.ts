/** The index is derived data. A YAML null is not the literal text "null";
 * keep an explicit type so vocabulary queries and empty filters agree. */
export function encodeIndexedProperty(value: unknown): { type: string; value: string } {
  if (value === null || value === undefined) return { type: "null", value: "" };
  return { type: Array.isArray(value) ? "list" : typeof value,
    value: typeof value === "object" ? JSON.stringify(value) : String(value) };
}

/** Objects stay serialized for existing namespace consumers. Read the old
 * object/null representation until the next derived-index rebuild finishes. */
export function decodeIndexedProperty(type: unknown, value: any): any {
  if (type === "null" || type === "undefined" || (type === "object" && value === "null")) return null;
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "list") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
