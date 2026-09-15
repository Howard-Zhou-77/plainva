import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { bulkReasonKey, type MailBulkResult } from "./bulkActions";

export interface MailBulkReportItem extends MailBulkResult { label: string }
export function MailBulkReport({ items, busy, onCancel, onDismiss }: { items: MailBulkReportItem[]; busy: boolean; onCancel(): void; onDismiss(): void }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(50);
  const failed = items.filter(item => item.status !== "done");
  if (!busy && !failed.length) return null;
  return <section className="pv-mail-bulk-report" data-testid="mail-bulk-report">
    <Banner kind={busy ? "info" : "warning"} actions={<Button size="sm" variant="ghost" onClick={busy ? onCancel : onDismiss}>{t(busy ? "common.cancel" : "common.close")}</Button>}>
      {busy ? t("mail.bulkWorking") : t("mail.bulkReport", { done: items.length - failed.length, failed: failed.length })}
    </Banner>
    {!!failed.length && <ul className="pv-mail-bulk-problems">
      {failed.slice(0, limit).map(item => <li key={item.id} data-mail-result={item.status}>
        <strong>{item.label}</strong><span>{item.status === "uncertain" ? t("mail.bulkUncertain") : t(bulkReasonKey(item.reason))}</span>
      </li>)}
    </ul>}
    {failed.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(n => n + 50)}>{t("mail.loadMore")}</Button>}
  </section>;
}
