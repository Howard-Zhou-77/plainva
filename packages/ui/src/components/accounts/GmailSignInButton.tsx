import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { SettingCardNote } from "../ui/SettingsSurface";
import { serviceConnectionMessage } from "../../lib/serviceConnection";

/** Visible only with a configured test registration; no unverified production entry. */
export function GmailSignInButton({ onSignIn }: { onSignIn(): Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <SettingCardNote>
    <Button variant="secondary" disabled={busy} data-testid="gmail-sign-in" onClick={async () => {
      setBusy(true); setError("");
      try { await onSignIn(); } catch (failure) { setError(serviceConnectionMessage(failure, t)); } finally { setBusy(false); }
    }}>{t("mail.googleSignInTest")}</Button>
    <Banner kind="info" rounded>{t("mail.googleTestHint")}</Banner>
    {error && <Banner kind="error" rounded>{error}</Banner>}
  </SettingCardNote>;
}
