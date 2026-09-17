/**
 * The readable text of a failure, whatever shape it arrived in.
 *
 * WHY THIS EXISTS
 * Errors that cross the Tauri boundary are STRINGS, not Error objects: a Rust
 * command returns `Err(String)` and the plugin layer rejects with that value
 * as-is. `err.message` on a string is `undefined`, and an undefined
 * interpolation renders as nothing — so a message built as
 * "… Reason: {{error}}" reaches the user as "… Reason:" and stops there.
 *
 * That shipped. A reporter's screenshot on issue #46 showed a delete failure
 * whose whole purpose was to name its cause, saying nothing after the colon.
 * The diagnostics line two statements above it used String(err) and was fine,
 * which is the only reason the difference was visible at all.
 *
 * The same expression was already inlined in ~180 places. One function means
 * the next boundary that returns a bare string is handled by default rather
 * than by whoever remembers.
 */

import { connectionErrorText } from "./connectionErrorText";
import i18n from "i18next";

const INPUT_REJECTIONS = new Map([
  ["Invalid mail header", "mailHeader"],
  ["Invalid attachment header", "attachmentHeader"],
  ["Invalid calendar method", "calendarMethod"],
  ["Invalid IMAP argument", "imapValue"],
  ["Invalid IMAP command", "imapValue"],
  ["Invalid SMTP command", "smtpValue"],
  ["Invalid Google Drive folder id", "driveFolder"],
  ["HTML nesting exceeds the import limit", "htmlDepth"],
]);

/** Translate known input refusals at the shared display boundary. */
function inputErrorText(message: string): string {
  const key = INPUT_REJECTIONS.get(message);
  if (!key) return message;
  const translated = i18n.t(`inputRejected.${key}`, { defaultValue: message });
  return typeof translated === "string" && translated.trim() ? translated : message;
}

/** Never returns an empty string: a blank reason is worse than an ugly one. */
export function errorText(err: unknown): string {
  const connection = connectionErrorText(err);
  if (connection) return connection;
  if (typeof err === "string") return inputErrorText(err.trim() || "unknown error");

  if (err instanceof Error) {
    // An Error with an empty message still carries its name — "TypeError" says
    // more than nothing at all.
    return inputErrorText(err.message.trim() || err.name || "unknown error");
  }

  // Plain objects with a message: some plugin layers reject with `{message}`
  // without an Error prototype, and structured clone strips prototypes too.
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return inputErrorText(message.trim());

    // A stringified object is useless ("[object Object]") — say so plainly
    // rather than pretending there is a reason on screen.
    const asString = String(err);
    if (asString && asString !== "[object Object]") return asString;
    return "unknown error";
  }

  if (err === null || err === undefined) return "unknown error";

  return String(err).trim() || "unknown error";
}
