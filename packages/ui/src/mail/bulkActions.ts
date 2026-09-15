/** A result belongs to one original message. Uncertain writes are never
 * automatically retried: a missing response does not mean a failed write. */
export type MailBulkAction = { kind: "seen" | "flagged"; value: boolean } | { kind: "move"; target: string } | { kind: "delete" };
export type MailBulkStatus = "done" | "failed" | "uncertain" | "skipped";
export type MailBulkReason = "missing" | "changed" | "unsupported" | "rejected" | "connection" | "cancelled";
export interface MailBulkResult { id: string; status: MailBulkStatus; reason?: MailBulkReason }
export interface ImapBulkResult { uid: number; status: MailBulkStatus; reason?: MailBulkReason }
export interface ImapBulkArgs { mailbox: string; uids: number[]; uidValidity?: number; action: MailBulkAction }

/** At most 100 explicit UIDs / 1099 bytes: never a sequence number, wildcard or
 * unchecked range. Chunks hold one authenticated session and selected mailbox. */
export const MAIL_BULK_LIMIT = 100;
export function validatedUids(uids: readonly number[]): number[] {
  if (uids.length > MAIL_BULK_LIMIT || uids.some(uid => !Number.isInteger(uid) || uid < 1 || uid > 0xffffffff)) throw new Error("Invalid mail UID batch");
  return [...new Set(uids)];
}

export function bulkReasonKey(reason?: MailBulkReason): string {
  const keys: Record<MailBulkReason, string> = {
    missing: "mail.bulkReason.missing", changed: "mail.bulkReason.changed", unsupported: "mail.bulkReason.unsupported",
    rejected: "mail.bulkReason.rejected", connection: "mail.bulkReason.connection", cancelled: "mail.bulkReason.cancelled",
  };
  return keys[reason ?? "rejected"];
}
