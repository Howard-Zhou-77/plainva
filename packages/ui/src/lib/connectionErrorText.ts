import i18n from "i18next";
import { connectionFailureCode } from "@plainva/core";

/** Shared across setup dialogs and both shells' running sync status. */
export function connectionErrorText(error: unknown): string | null {
  const code = connectionFailureCode(error);
  if (!code) return null;
  return i18n.t(`connectionFailure.${code}`, { defaultValue: code });
}
