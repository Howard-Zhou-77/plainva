import type { IDatabaseAdapter } from "@plainva/core";
import { prepareReaderSource, selectNoteFragment } from "@plainva/core";
import { relativeLinkCandidates } from "./relativeLink";
import { splitLinkAnchor } from "./linkAnchor";

export type NoteEmbedTarget = { status: "found"; path: string; anchor: string | null } | { status: "missing" | "ambiguous" };

/** Both shells resolve the same reference; duplicates never pick an arbitrary row. */
export async function resolveNoteEmbed(raw: string, hostPath: string | undefined, ports: {
  exists(path: string): Promise<boolean>;
  db?: Pick<IDatabaseAdapter, "query"> | null;
  list?: () => Promise<{ path: string; isDirectory: boolean }[]>;
}): Promise<NoteEmbedTarget> {
  const { target, anchor } = splitLinkAnchor(raw.split("|")[0]);
  if (!target) return hostPath ? { status: "found", path: hostPath, anchor } : { status: "missing" };
  const pathTarget = /\.(?:md|base)$/i.test(target) ? target : `${target}.md`;
  for (const candidate of relativeLinkCandidates(pathTarget, hostPath)) {
    if (await ports.exists(candidate)) return { status: "found", path: candidate, anchor };
  }
  const name = target.replace(/\.(?:md|base)$/i, "").normalize("NFC").toLowerCase();
  let paths: string[];
  if (ports.db) {
    const escaped = target.replace(/[\\%_]/g, "\\$&");
    const rows = await ports.db.query<{ path: string }>(
      "SELECT path FROM files WHERE title = ? COLLATE NOCASE OR path = ? COLLATE NOCASE OR path = ? COLLATE NOCASE OR path LIKE ? ESCAPE '\\' COLLATE NOCASE OR path LIKE ? ESCAPE '\\' COLLATE NOCASE LIMIT 3",
      [target, target, pathTarget, `%/${escaped}`, `%/${escaped}.md`],
    );
    paths = [...new Set(rows.map((row) => row.path))];
  } else {
    paths = (await ports.list?.() ?? []).filter((file) => !file.isDirectory && file.path.split("/").pop()!.replace(/\.(?:md|base)$/i, "").normalize("NFC").toLowerCase() === name).map((file) => file.path);
  }
  const exact = paths.find((path) => path.normalize("NFC").toLowerCase() === pathTarget.normalize("NFC").toLowerCase());
  if (exact) return { status: "found", path: exact, anchor };
  return paths.length === 1 ? { status: "found", path: paths[0], anchor } : { status: paths.length ? "ambiguous" : "missing" };
}

/** Mobile's text card expands the same fragments with a bounded amount of IO. */
export async function noteEmbedPreview(raw: string, hostPath: string, ports: Parameters<typeof resolveNoteEmbed>[2] & {
  read(path: string): Promise<string>;
  message(kind: "missing" | "ambiguous" | "depth" | "unreadable", target: string): string;
}): Promise<string> {
  let reads = 0, remaining = 256_000;
  const walk = async (text: string, path: string, depth: number, trail: Set<string>): Promise<string> => {
    if (text.length > remaining) return ports.message("depth", path);
    remaining -= text.length;
    const source = prepareReaderSource(text);
    const pieces: string[] = [];
    let cursor = 0;
    for (const embed of source.embeds) {
      pieces.push(source.text.slice(cursor, embed.from));
      cursor = embed.to;
      if (depth >= 3 || reads >= 20) { pieces.push(ports.message("depth", embed.target)); continue; }
      try {
        const target = await resolveNoteEmbed(embed.target, path, ports);
        if (target.status !== "found") { pieces.push(ports.message(target.status, embed.target)); continue; }
        const key = `${target.path}#${target.anchor ?? ""}`;
        if (trail.has(key)) { pieces.push(ports.message("depth", embed.target)); continue; }
        reads++;
        const fragment = selectNoteFragment(await ports.read(target.path), target.anchor);
        pieces.push(fragment.status === "found" ? await walk(fragment.text, target.path, depth + 1, new Set([...trail, key])) : ports.message(fragment.status, embed.target));
      } catch { pieces.push(ports.message("unreadable", embed.target)); }
    }
    pieces.push(source.text.slice(cursor));
    return pieces.join("");
  };
  return walk(raw, hostPath, 1, new Set());
}
