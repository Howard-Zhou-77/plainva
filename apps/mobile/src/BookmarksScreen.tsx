import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, X, Folder } from "lucide-react";
import { EmptyState, ICON, IconButton, bookmarkKey, useBookmarkTargets, toast, type BookmarkEntry } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { vaultOps, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";

/** Bookmarks (P3): device-local list (.plainva/bookmarks.json). */
export function BookmarksScreen({
  vault,
  bump = 0,
  onBack,
  onOpenNote, onOpenFolder,
}: {
  vault: MobileVault;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenNote: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<BookmarkEntry[]>([]);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  const targets = useBookmarkTargets(vault.adapter, marks, bump);
  useEffect(() => {
    let alive = true;
    const read = () => void vaultOps.getBookmarks(vault).then((m) => { if (alive) setMarks(m); }).catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    read(); window.addEventListener("m-bookmarks-changed", read);
    return () => { alive = false; window.removeEventListener("m-bookmarks-changed", read); };
  }, [vault, bump, t]);

  return (
    <div className="m-page" ref={ptrRef}>
      {onBack && (
        <AppBar onBack={onBack} title={t("mobile.bookmarks")} />
      )}
      {ptrIndicator}
      {marks.length === 0 ? (
        <EmptyState icon={<Bookmark size={ICON.head} />}>{t("mobile.noBookmarks")}</EmptyState>
      ) : (
        marks.map((entry) => {
          const { path, type } = entry; const missing = targets.get(bookmarkKey(entry)) === false;
          return (
          <div className="m-row m-row--split" key={bookmarkKey(entry)}>
            <button className="m-row-main" aria-disabled={missing} onClick={() => { if (!missing) (type === "folder" ? onOpenFolder : onOpenNote)(path); }}>
              {type === "folder" ? <Folder className="m-accent" size={ICON.ui} /> : <Bookmark className="m-accent" size={ICON.ui} />}
              <span>{(type === "folder" ? path.split("/").pop()! : path.split("/").pop()!.replace(/\.md$/i, "")) + (missing ? ` (${t("sidebar.bookmarkMissing")})` : "")}</span>
            </button>
            <IconButton
              label={t("mobile.bookmarkRemove")}
              onClick={() => void vaultOps.toggleBookmark(vault, path, type).catch(() => toast.error(t("sidebar.bookmarkSaveFailed")))}
            >
              <X className="m-chevron" size={ICON.ui} />
            </IconButton>
          </div>
        ); })
      )}
    </div>
  );
}
