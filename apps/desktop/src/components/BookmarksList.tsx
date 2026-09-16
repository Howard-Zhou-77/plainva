import type React from "react";
import { Bookmark, FileText, Paperclip, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocIcon, EmptyState, ICON, bookmarkKey, useBookmarkTargets, parkTreeReveal, type BookmarkEntry, isRenderableDocIcon, stripNoteExtension } from "@plainva/ui";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { useVault } from "../contexts/VaultContext";
import { useDocumentTitles } from "../hooks/useDocumentTitles";

interface Props {
  /** Bookmarked vault paths (order preserved). */
  bookmarks: BookmarkEntry[];
  /** Debounced sidebar filter; matched against the path, like before. */
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Right-click on a row; the shell owns the menu (plan P4). */
  onRowContextMenu?: (path: string, event: React.MouseEvent<HTMLElement>, type?: "file" | "folder") => void;
}

/**
 * Bookmarks sidebar list. Renders each entry like a file-tree row — the
 * document icon (custom `plainva.icon`, database icon for `.base`, paperclip for
 * attachments, else the generic file icon) and the display name WITHOUT the
 * `.md`/`.base` extension. A bookmark only stores its path, so title + mode come
 * from the index (useDocumentTitles), mirroring how the tree derives its label.
 */
export function BookmarksList({ bookmarks, query, activePath, onOpen, onRowContextMenu }: Props) {
  const { t } = useTranslation();
  const { vaultAdapter, fileTreeVersion } = useVault();
  const targets = useBookmarkTargets(vaultAdapter, bookmarks, fileTreeVersion);
  const docIcons = useDocumentIcons();
  const docTitles = useDocumentTitles();

  const q = query.toLowerCase();
  const filtered = bookmarks.filter((b) => b.path.toLowerCase().includes(q));

  if (filtered.length === 0) {
    return <EmptyState icon={<Bookmark size={ICON.empty} />}>{t("sidebar.noBookmarks", { defaultValue: "Keine Lesezeichen" })}</EmptyState>;
  }

  return (
    <>
      {filtered.map((entry) => {
        const { path, type } = entry;
        const missing = targets.get(bookmarkKey(entry)) === false;
        const isBase = /\.base$/i.test(path);
        const meta = docTitles.get(path);
        const attachment = meta?.mode === "attachment" && !isBase;
        // Same derivation as the file tree (FileTree.tsx): frontmatter title or
        // the file name, extension stripped for notes/bases (attachments keep it).
        const basename = path.split(/[/\\]/).pop() ?? path;
        const displayName = type === "folder" ? basename : attachment ? (meta?.title || basename) : stripNoteExtension(meta?.title || basename);
        const iconEntry = docIcons.get(path);

        const iconNode = type === "folder" ? <Folder size={ICON.ui} /> : isBase ? (
          <DocIcon icon={iconEntry?.icon ?? "lucide:database"} color={iconEntry?.color} size={ICON.ui} />
        ) : attachment ? (
          <Paperclip size={ICON.ui} style={{ opacity: 0.7 }} />
        ) : iconEntry && isRenderableDocIcon(iconEntry.icon) ? (
          <DocIcon icon={iconEntry.icon} color={iconEntry.color} size={ICON.ui} />
        ) : (
          <FileText size={ICON.ui} style={{ opacity: 0.7 }} />
        );

        return (
          <button
            key={bookmarkKey(entry)}
            aria-disabled={missing}
            onClick={() => { if (missing) return; if (type === "folder") { parkTreeReveal(path); window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path } })); } else onOpen(path); }}
            onContextMenu={onRowContextMenu ? (e) => { e.preventDefault(); onRowContextMenu(path, e, type); } : undefined}
            data-tip={path}
            style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: "var(--pv-sec-gap, 0.55rem)",
              padding: "0.5rem", border: "none", cursor: "pointer", borderRadius: "var(--radius-xs)",
              background: activePath === path ? "var(--bg-hover)" : "transparent",
              color: "var(--text-main)",
            }}
          >
            <span aria-hidden="true" style={{ width: ICON.ui, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {iconNode}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}{missing ? ` (${t("sidebar.bookmarkMissing")})` : ""}</span>
          </button>
        );
      })}
    </>
  );
}
