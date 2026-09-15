import { useTranslation } from "react-i18next";
import type { ScannedTask } from "@plainva/core";

/** The same named metadata beside checkbox tasks in both shells. */
export function TaskMetadataDetails({ task }: { task: ScannedTask }) {
  const { t } = useTranslation();
  const fields = ["created", "start", "scheduled", "completed", "taskId"] as const;
  if (!fields.some(field => task[field]) && task.recurrence === undefined) return null;
  return <span className="pv-taskmeta" data-testid="task-metadata">
    {fields.map(field => task[field] ? <span key={field} data-tip={field === "taskId" ? task[field] : undefined}>{t(`tasks.metadata.${field}`)}: {field === "taskId" && task[field]!.length > 24 ? task[field]!.slice(0, 10) + "…" + task[field]!.slice(-6) : task[field]}</span> : null)}
    {task.recurrence !== undefined && <span>{t("tasks.metadata.recurrence")}: {task.recurrence || "🔁"}</span>}
    {task.recurrence !== undefined && !task.recurrenceSupported && <span className="pv-taskmeta-unsupported">{t("tasks.metadata.unsupported")}</span>}
  </span>;
}
