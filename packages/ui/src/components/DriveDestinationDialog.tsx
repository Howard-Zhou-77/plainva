import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, CornerLeftUp, File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveFolderPreview, DriveFolderSelection } from "@plainva/core";
import { Modal } from "./ui/Modal";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { GroupCard, Row, RowList, SectionLabel } from "./ui/GroupedRows";
import { ICON } from "../lib/iconSizes";

export interface DriveDestinationSession {
  currentPath: string;
  previewCurrent(): Promise<DriveFolderPreview>;
  loadFolder(id: string, pageToken?: string): Promise<DriveFolderPreview>;
}

/** Uses the same modal, grouped rows and buttons as account settings in both shells. */
export function DriveDestinationDialog({ session, onSave, onClose }: {
  session: DriveDestinationSession;
  onSave(selection: DriveFolderSelection): Promise<void>;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState<DriveFolderPreview | null>(null);
  const [currentError, setCurrentError] = useState("");
  const [trail, setTrail] = useState<DriveFolderSelection[]>([]);
  const [page, setPage] = useState<DriveFolderPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const browse = useCallback(async (next: DriveFolderSelection[], cursor?: string) => {
    const request = ++revision.current;
    setLoading(true); setError(""); setReview(false);
    try {
      const result = await session.loadFolder(next[next.length - 1]?.id ?? "root", cursor);
      if (request !== revision.current) return;
      setPage(previous => cursor && previous?.id === result.id
        ? { ...result, items: [...new Map([...previous.items, ...result.items].map(item => [item.id, item])).values()] }
        : result);
      setTrail(next);
    } catch (failure) {
      if (request === revision.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (request === revision.current) setLoading(false); }
  }, [session]);
  useEffect(() => {
    let alive = true;
    const requests = revision;
    void session.previewCurrent().then(result => { if (alive) setCurrent(result); })
      .catch(failure => { if (alive) setCurrentError(failure instanceof Error ? failure.message : String(failure)); });
    void browse([]);
    return () => { alive = false; requests.current++; };
  }, [session, browse]);
  const selectedPath = trail.map(item => item.path).join("/");
  const save = async () => {
    if (!page || !trail.length || saving) return;
    setSaving(true); setError("");
    try {
      await session.loadFolder(page.id); // Confirm that the exact selection still exists.
      await onSave({ path: selectedPath, id: page.id });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setSaving(false); }
  };
  const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(i18n.language) : "";
  const rows = (preview: DriveFolderPreview, limit?: number) => preview.items.slice(0, limit).map(item => (
    <Row key={item.id} wrap icon={item.folder ? <Folder size={ICON.ui} /> : <File size={ICON.ui} />}
      title={item.name} subtitle={date(item.modifiedTime)}
      end={!limit && !review && item.folder ? <ChevronRight size={ICON.ui} /> : undefined}
      disabled={loading || saving}
      onClick={!limit && !review && item.folder ? () => void browse([...trail, { path: item.name, id: item.id }]) : undefined} />
  ));
  return <Modal title={t("driveDestination.title")} size="lg" onClose={saving ? () => {} : onClose}
    closeOnOverlay={!saving} hideClose={saving} testId="drive-destination-dialog"
    footer={<>
      <Button variant="ghost" disabled={saving} onClick={review ? () => setReview(false) : onClose}>{t(review ? "common.back" : "common.cancel")}</Button>
      <Button variant="primary" disabled={loading || saving || !!error || !page || !trail.length}
        onClick={review ? () => void save() : () => setReview(true)}>{t(review ? "driveDestination.apply" : "driveDestination.review")}</Button>
    </>}>
    <details open={review || undefined}>
      <summary>{t("driveDestination.current")}: {session.currentPath}</summary>
      {currentError ? <Banner kind="warning" rounded>{currentError}</Banner> : current
        ? <GroupCard><RowList>{rows(current, 5)}{!current.items.length && <Row title={t("webDavPicker.emptyFolder")} />}</RowList></GroupCard>
        : <p>{t("common.loading")}</p>}
    </details>
    <SectionLabel>{t("driveDestination.selected")}: /{selectedPath}</SectionLabel>
    {page && <p className="pv-chain-desc">{t("driveDestination.folderId", { id: page.id })}</p>}
    {error && <Banner kind="error" rounded>{error}</Banner>}
    {review && <Banner kind="info" rounded>{t("driveDestination.effect")}</Banner>}
    {loading && <p role="status">{t("common.loading")}</p>}
    {!review && trail.length > 0 && <Button variant="ghost" disabled={loading || saving} icon={<CornerLeftUp size={ICON.ui} />}
      onClick={() => void browse(trail.slice(0, -1))}>{t("webDavPicker.goUp")}</Button>}
    {page && <GroupCard><RowList>{rows(page)}{!page.items.length && !loading && <Row title={t("webDavPicker.emptyFolder")} />}</RowList></GroupCard>}
    {page?.nextPageToken && !review && <Button variant="ghost" disabled={loading || saving} onClick={() => void browse(trail, page.nextPageToken)}>{t("driveDestination.more")}</Button>}
  </Modal>;
}
