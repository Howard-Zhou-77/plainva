import { useState } from "react";
import { useTranslation } from "react-i18next";
import { baseExportColumns, exportBaseFormulas, exportBaseValues, planBaseFormulaExport, type BaseExportFile } from "../base/baseExport";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { capitalizeFirst } from "../base/propertyModel";

export function BaseExportDialog(props: {
  config: any;
  viewIndex: number;
  rows: Record<string, unknown>[];
  onExport: (file: BaseExportFile) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { onClose } = props;
  // Sync can update a database while the chooser is open. Export the exact
  // result whose count and compatibility the user has just reviewed.
  const [{ config, viewIndex, rows, onExport }] = useState(() => ({
    ...props, ...JSON.parse(JSON.stringify({ config: props.config, viewIndex: props.viewIndex, rows: props.rows })),
  }) as Pick<typeof props, "config" | "viewIndex" | "rows" | "onExport">);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const columns = baseExportColumns(config, viewIndex).map(col => ({ ...col, label: col.label === col.key
    ? col.key === "file.name" ? t("database.colFileName") : col.key === "file.path" ? t("database.colPath") : capitalizeFirst(col.label)
    : col.label }));
  const plan = planBaseFormulaExport(config, columns);
  const close = () => { if (!busy) onClose(); };
  async function run(formulas: boolean) {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const file = formulas ? exportBaseFormulas(config, columns, rows) : exportBaseValues(columns, rows);
      if (await onExport(file)) onClose();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <Modal title={t("database.exportTitle")} onClose={close} size="md" testId="base-export-dialog" footer={<>
    <Button variant="ghost" onClick={close} disabled={busy}>{t("common.cancel")}</Button>
    <Button variant="secondary" disabled={busy} onClick={() => { void run(false); }}>{t("database.exportValues")}</Button>
    <Button disabled={busy || plan.issues.length > 0} onClick={() => { void run(true); }}>{t("database.exportFormulas")}</Button>
  </>}>
    <p>{t("database.exportScope", { count: rows.length })}</p>
    <p>{t("database.exportFormulaHint")}</p>
    {plan.issues.length > 0 && <>
      <p>{t("database.exportUnsupported")}</p>
      <ul>{plan.issues.map(({ column, issue }) => <li key={column}>
        <strong>{columns.find(col => col.key === column)?.label ?? column}</strong>: {t(`database.exportIssue_${issue}`)}
      </li>)}</ul>
    </>}
    <p>{t("database.exportValuesHint")}</p>
    {failed && <p role="alert">{t("database.exportFailed")}</p>}
  </Modal>;
}
