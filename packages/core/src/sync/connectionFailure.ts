/** Cross-platform TLS classifications. Unknown failures are never guessed to
 * mean an untrusted CA: they may be a protocol or client-certificate failure. */
export const CONNECTION_FAILURE_CODES = [
  "TLS_CERTIFICATE_EXPIRED", "TLS_CERTIFICATE_NOT_YET_VALID",
  "TLS_HOSTNAME_MISMATCH", "TLS_CERTIFICATE_UNTRUSTED", "TLS_HANDSHAKE_FAILED",
  "HTTP_ORIGIN_BLOCKED", "HTTP_TIMEOUT", "HTTP_NETWORK_ERROR", "HTTP_REQUEST_FAILED",
] as const;
export type ConnectionFailureCode = typeof CONNECTION_FAILURE_CODES[number];

export function connectionFailureCode(error: unknown): ConnectionFailureCode | null {
  const object = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; cause?: unknown } : null;
  const text = `${typeof object?.code === "string" ? object.code : ""} ${typeof error === "string" ? error : typeof object?.message === "string" ? object.message : ""}`;
  for (const code of CONNECTION_FAILURE_CODES) if (text.includes(code)) return code;
  // Native desktop TLS libraries return strings; match their specific causes
  // before any broad network classifier sees the word "connection".
  if (/certificate.{0,30}(?:has expired|expired)|cert(?:ificate)?expired/i.test(text)) return "TLS_CERTIFICATE_EXPIRED";
  if (/certificate.{0,30}not yet valid|notvalidyet/i.test(text)) return "TLS_CERTIFICATE_NOT_YET_VALID";
  if (/hostname.{0,30}(?:not verified|mismatch)|notvalidforname|certificate.{0,30}(?:name mismatch|not valid for)/i.test(text)) return "TLS_HOSTNAME_MISMATCH";
  if (/unknownissuer|unknown issuer|trust anchor.*not found|unable to get local issuer|self.signed certificate|untrustedroot/i.test(text)) return "TLS_CERTIFICATE_UNTRUSTED";
  if (/certificate verify failed|invalid peer certificate|sslhandshakeexception|tls handshake/i.test(text)) return "TLS_HANDSHAKE_FAILED";
  return null;
}
