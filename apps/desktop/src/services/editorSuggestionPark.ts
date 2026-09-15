import { clearParkedSuggestion, writeParkedSuggestion, type IDatabaseAdapter, type ParkedSuggestion } from "@plainva/core";
import { isOwnerWindow } from "./windowContext";
import { getWindowBus } from "./windowBus";

/** Auxiliary windows can read the shared index, but only its owner writes it. */
export async function parkEditorSuggestion(db: IDatabaseAdapter, record: ParkedSuggestion, vaultPath: string | null): Promise<void> {
  if (isOwnerWindow()) return writeParkedSuggestion(db, record);
  if (!vaultPath) throw new Error("No vault for the suggestion draft");
  await (await getWindowBus()).request("suggestion-park-write", record, { vaultPath });
}
export async function clearEditorSuggestion(db: IDatabaseAdapter, path: string, vaultPath: string | null): Promise<void> {
  if (isOwnerWindow()) return clearParkedSuggestion(db, path);
  if (!vaultPath) throw new Error("No vault for the suggestion draft");
  await (await getWindowBus()).request("suggestion-park-clear", { path }, { vaultPath });
}
