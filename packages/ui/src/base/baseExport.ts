import { databaseFilterValue, normalizeRollup, obsidianRollupFormula, type ObsidianRollupIssue } from "@plainva/core";
import * as yaml from "yaml";
import { toPropId } from "./baseFormat";

export interface BaseExportColumn { key: string; label: string }
export interface BaseExportIssue { column: string; issue: ObsidianRollupIssue }
export interface BaseExportFile { text: string; extension: "base" | "csv"; mime: string }
const propertyId = (key: string) => key.startsWith("note.") ? key : toPropId(key);

/** Export the result table. Row membership is fixed; formulas remain live. */
export function baseExportColumns(config: any, viewIndex: number): BaseExportColumn[] {
  const view = config?.views?.[viewIndex];
  const order: string[] = Array.isArray(view?.order) && view.order.length
    ? view.order : ["file.name", ...Object.keys(config?.columns ?? {}).filter(key => key !== "plainva")];
  return [...new Set(order.map(key => key.startsWith("note.") && !key.startsWith("note.plainva.") ? key.slice(5) : key))].map(key => ({
    key,
    label: config?._obsidian?.properties?.[propertyId(key)]?.displayName || key,
  }));
}

/** Does not mutate a config, normalize a foreign file, or write vault notes. */
export function planBaseFormulaExport(config: any, columns: BaseExportColumn[]) {
  const issues: BaseExportIssue[] = [];
  const formulas: Record<string, string> = { ...(config?._obsidian?.formulas ?? {}) };
  const properties: Record<string, { displayName: string; plainva?: unknown }> = {};
  const order: string[] = [];
  for (const { key, label } of columns) {
    const column = config?.columns?.[key];
    let id = propertyId(key);
    if (column?.rollup) {
      const spec = normalizeRollup(column.rollup);
      const result = spec ? obsidianRollupFormula(spec, config?.columns?.[spec.through]) : { issue: "operation" as const };
      if (result.issue) issues.push({ column: key, issue: result.issue });
      else if (config?.columns?.[spec!.through]?.previousKeys?.length) issues.push({ column: key, issue: "relation" });
      else {
        let name = `plainva_rollup_${order.length + 1}`;
        while (Object.prototype.hasOwnProperty.call(formulas, name)) name += "_";
        formulas[name] = result.formula;
        id = `formula.${name}`;
      }
    } else if (column?.reverseOf) issues.push({ column: key, issue: "relation" });
    else if (key.startsWith("file.") && !["name", "path", "folder", "ext", "size", "ctime", "mtime", "tags", "links", "backlinks"].includes(key.slice(5))) {
      issues.push({ column: key, issue: "property" });
    }
    properties[id] = { displayName: label };
    // The same exported file retains working computed columns in Plainva.
    if (column?.rollup) properties[id].plainva = { rollup: column.rollup };
    order.push(id);
  }
  return { issues, formulas, properties, order };
}

export function exportBaseFormulas(config: any, columns: BaseExportColumn[], rows: Record<string, unknown>[]): BaseExportFile {
  const plan = planBaseFormulaExport(config, columns);
  if (plan.issues.length) throw new Error("Unsupported database columns must use the values export");
  const paths = [...new Set(rows.map(row => row["file.path"]).filter((p): p is string => typeof p === "string" && !!p))];
  if (paths.length !== new Set(rows.map(row => row["file.path"])).size) throw new Error("Missing database row path");
  return {
    extension: "base", mime: "text/yaml; charset=utf-8",
    text: yaml.stringify({
      filters: paths.length ? { or: paths.map(path => `file.path == ${JSON.stringify(path)}`) } : 'file.path == ""',
      ...(Object.keys(plan.formulas).length ? { formulas: plan.formulas } : {}),
      properties: plan.properties,
      views: [{ type: "table", name: "Export", order: plan.order }],
    }),
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // A CSV is data, including strings which spreadsheet apps might execute.
  // eslint-disable-next-line no-control-regex -- Include control prefixes that spreadsheet readers may discard before evaluating a formula.
  if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportBaseValues(columns: BaseExportColumn[], rows: Record<string, unknown>[]): BaseExportFile {
  const exported = columns.some(col => col.key === "file.path") ? columns : [{ key: "file.path", label: "file.path" }, ...columns];
  return {
    extension: "csv", mime: "text/csv; charset=utf-8",
    text: [exported.map(col => csvCell(col.label)).join(","), ...rows.map(row => exported.map(col => csvCell(databaseFilterValue(row, col.key.startsWith("plainva.") ? `note.${col.key}` : col.key))).join(","))].join("\r\n") + "\r\n",
  };
}
