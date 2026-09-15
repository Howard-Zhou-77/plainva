import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";
import { CompareModal } from "./CompareModal";
import { comparisonSubject } from "../services/comparisonWindow";

export function ComparisonWindow({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const subject = comparisonSubject(path);
  if (!subject) return <EmptyState>{t("compare.versionUnavailable")}</EmptyState>;
  return <CompareModal subject={subject} standalone onClose={onClose} />;
}
