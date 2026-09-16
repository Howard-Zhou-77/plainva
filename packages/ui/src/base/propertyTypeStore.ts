/**
 * Per-vault property TYPE registry (ADR 0008).
 *
 * Obsidian itself records property *types* globally per name in
 * `.obsidian/types.json` (not options). We mirror that idea in a Plainva-local
 * store so a property a user marks as e.g. "status" stays a status across
 * reloads — WITHOUT writing anything into the note or vault (Obsidian-safe).
 *
 * Only the type name is stored here. Option sets / colors are NOT stored: they
 * come from a `.base` (curated) or are discovered from vault usage + derived
 * colors. We use localStorage (synchronous, like RightSidebar's section state)
 * rather than the async Tauri store so the panel can resolve types on render.
 */

import type { PropertyType } from "./propertyModel";

export type PropertyTypeStorage = Pick<Storage, "getItem" | "setItem">;
const storage = (): PropertyTypeStorage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

const key = (vault: string | null) => `plainva-prop-types::${vault ?? "_"}`;

type Registry = Record<string, PropertyType>;

function read(vault: string | null, adapter = storage()): Registry {
  try {
    const raw = adapter?.getItem(key(vault));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([name, type]) => name !== "__proto__" && isPropertyType(type))) as Registry : {};
  } catch {
    return {};
  }
}

function write(vault: string | null, reg: Registry, adapter = storage()): void {
  try {
    adapter?.setItem(key(vault), JSON.stringify(reg));
  } catch {
    /* storage unavailable — degrade to inference-only, no crash */
  }
}

/** The whole registry for a vault (property name -> chosen type). */
export function loadPropertyTypes(vault: string | null, adapter?: PropertyTypeStorage): Registry {
  return read(vault, adapter);
}

/** Remember the explicit type a user picked for a property name. */
export function setPropertyType(vault: string | null, name: string, type: PropertyType, adapter?: PropertyTypeStorage): void {
  const reg = read(vault, adapter);
  reg[name] = type;
  write(vault, reg, adapter);
}

/** Forget an explicit type (e.g. when the property is deleted). */
export function clearPropertyType(vault: string | null, name: string, adapter?: PropertyTypeStorage): void {
  const reg = read(vault, adapter);
  if (name in reg) {
    delete reg[name];
    write(vault, reg, adapter);
  }
}

/** Follow a rename so the type sticks to the new name. */
export function renamePropertyType(vault: string | null, oldName: string, newName: string, adapter?: PropertyTypeStorage): void {
  const reg = read(vault, adapter);
  if (oldName in reg) {
    reg[newName] = reg[oldName];
    delete reg[oldName];
    write(vault, reg, adapter);
  }
}

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === "string" && ["text", "number", "checkbox", "date", "datetime", "list", "tags", "select", "status", "multiselect", "url", "email", "phone", "link"].includes(value);
}
