import { FatalSyncProtocolError } from "../settingsSync/errors.js";
import { classifySyncError, syncErrorMessage } from "../sync/errorKind.js";
import { parseRetryAfterMs } from "../sync/httpRetry.js";
import { WorkspaceProtocolError } from "./errors.js";

export type WorkspaceSyncFailureKind = "transient" | "authentication" | "integrity" | "fatal";

/** Local scheduling state; never changes a signed document or queue attempt. */
export interface WorkspaceSyncFailure {
  kind: WorkspaceSyncFailureKind;
  message: string;
  at: number;
}

export function isWorkspaceSyncAborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

export function classifyWorkspaceSyncFailure(error: unknown): WorkspaceSyncFailureKind {
  if (error instanceof WorkspaceProtocolError || error instanceof FatalSyncProtocolError) return "integrity";
  if (error instanceof Error && error.cause instanceof WorkspaceProtocolError) return "integrity";
  const text = syncErrorMessage(error);
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status : Number(/\b(4\d\d|5\d\d)\b/.exec(text)?.[1]);
  if (status === 401 || /invalid[_ -]?grant|token.*(?:revoked|expired)|unauthori[sz]ed/i.test(text)) return "authentication";
  return classifySyncError(error) === "transient" ? "transient" : "fatal";
}

/** Equal jitter avoids both synchronized devices and near-zero retry loops. */
export function workspaceSyncRetryDelay(error: unknown, failures: number, intervalMs: number, now: number, random: number): number {
  const max = 5 * 60_000;
  const ceiling = Math.min(max, Math.max(1000, intervalMs) * 2 ** Math.min(20, Math.max(1, failures)));
  const jitter = Math.round(ceiling * (0.5 + Math.min(1, Math.max(0, random)) / 2));
  const value = error as { retryAfterMs?: unknown; headers?: { get?(name: string): string | null }; cause?: unknown } | null;
  const explicit = typeof value?.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) ? Math.max(0, value.retryAfterMs) : null;
  const header = parseRetryAfterMs(value?.headers?.get?.("Retry-After") ?? null, now);
  const retryAfter = explicit ?? header;
  // A server-directed delay has its own bound, above the ordinary backoff.
  return retryAfter === null ? jitter : Math.max(jitter, Math.min(60 * 60_000, retryAfter));
}
