import { ZoomableImage } from "../components/ZoomableImage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Button, ICON, imageMimeType, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { shareVaultFile } from "../services/shareFile";
import type { MobileVault } from "../services/vaultService";

/** Image viewing with pinch, double-tap and reset. Crop/paint remain delegated
 * to the phone's own image editor through Share (see the parity catalog). */
export function ImageViewerScreen({
  vault,
  path,
  onBack,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const name = path.split("/").pop() ?? path;

  useEffect(() => {
    setUrl(null); setFailed(false);
    let objectUrl: string | null = null;
    let stale = false;
    void (async () => {
      try {
        const bytes = await vault.files.readBinaryFile(path);
        if (stale) return;
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMimeType(path) }));
        setUrl(objectUrl);
      } catch {
        if (!stale) setFailed(true);
      }
    })();
    return () => {
      stale = true;
      // The blob outlives the component otherwise, and a gallery of large
      // photos would hold every one of them for the session.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vault, path]);

  return (
    <div className="m-page m-page--viewer">
      <AppBar onBack={onBack} title={name} />
      {failed ? (
        <p className="m-hint">{t("imageViewer.loadError")}</p>
      ) : (
        url && <ZoomableImage key={`${path}:${url}`} url={url} name={name} onError={() => setFailed(true)} />
      )}
      <div className="m-sync-actions">
        <Button
          disabled={!url || failed}
          onClick={() => {
            void shareVaultFile(vault, path).catch(() => toast.warning(t("mobile.vaultExportFailed")));
          }}
          variant="tonal"
        >
          <Share2 size={ICON.ui} />
          {t("mobile.share")}
        </Button>
      </div>
    </div>
  );
}
