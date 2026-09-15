import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { BaseExportFile } from "@plainva/ui";

export async function saveBaseExport(path: string, file: BaseExportFile): Promise<boolean> {
  const stem = (path.split(/[/\\]/).pop() ?? "Database").replace(/\.base$/i, "");
  const target = await save({
    defaultPath: `${stem}-export.${file.extension}`,
    filters: [{ name: file.extension === "base" ? "Obsidian Bases" : "CSV", extensions: [file.extension] }],
  });
  if (!target) return false;
  await writeTextFile(target, file.text);
  return true;
}
