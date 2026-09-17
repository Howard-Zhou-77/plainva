import type { ImapAttachment } from "../transport";

/**
 * Building the RFC 822 document for sending / storing a draft (mail feinplan
 * G2). The desktop builds this in Rust; mobile builds it here, in shared code,
 * so both platforms produce the same message.
 */

const CRLF = "\r\n";

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64Text(text: string): string {
  return b64(new TextEncoder().encode(text));
}

/** Folds base64 to 76-character lines, as the standard requires. */
function fold(data: string): string {
  return (data.match(/.{1,76}/g) ?? []).join(CRLF);
}

/** RFC 2231 continuations keep Unicode names and header lines interoperable. */
function filenameParameter(key: string, value: string): string {
  if (value.length <= 50 && /^[\x20-\x7e]*$/.test(value)) {
    return ` ${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  const pieces: string[] = [];
  let piece = "";
  for (let index = 0; index < encoded.length;) {
    const token = encoded.slice(index, index + (encoded[index] === "%" ? 3 : 1));
    if (piece.length + token.length > 48) { pieces.push(piece); piece = ""; }
    piece += token;
    index += token.length;
  }
  pieces.push(piece);
  return pieces.map((piece, index) => `${CRLF} ${key}*${index}*=${index === 0 ? "utf-8''" : ""}${piece}`).join(";");
}

/** RFC 2047 for a header value; ASCII passes through untouched. */
export function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?utf-8?B?${b64Text(value)}?=`;
}

function boundary(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "plainva-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BuildMimeArgs {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: ImapAttachment[];
  /** iCalendar invitation carried as an inline text/calendar alternative. */
  calendar?: { ics: string; method?: string };
  /** Fixed date, for tests. */
  date?: Date;
}

/**
 * Builds the message. Structure follows what mail clients expect:
 *   multipart/mixed            (only with attachments)
 *     multipart/alternative    (only with html or an invitation)
 *       text/plain
 *       text/html
 *       text/calendar; method  (iMIP, so Gmail renders the invitation)
 *     attachments…
 */
export function buildMimeMessage(args: BuildMimeArgs): string {
  for (const value of [args.from, args.to, args.cc, args.bcc, args.subject, args.calendar?.method]) {
    if (value && /[\r\n\0]/.test(value)) throw new Error("Invalid mail header");
  }
  if (args.calendar?.method !== undefined && !/^[a-z0-9-]+$/i.test(args.calendar.method)) throw new Error("Invalid calendar method");
  for (const attachment of args.attachments ?? []) {
    if (/[\r\n\0]/.test(attachment.name) || !/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(attachment.mime)) throw new Error("Invalid attachment header");
  }
  const date = (args.date ?? new Date()).toUTCString().replace("GMT", "+0000");
  const headers: string[] = [
    `Date: ${date}`,
    `From: ${args.from}`,
    `To: ${args.to}`,
  ];
  if (args.cc?.trim()) headers.push(`Cc: ${args.cc.trim()}`);
  // Bcc deliberately absent from the headers — it lives in the SMTP envelope
  // only, otherwise every recipient would see the blind copies.
  headers.push(`Subject: ${encodeHeaderValue(args.subject)}`);
  headers.push("MIME-Version: 1.0");

  const alternatives: string[] = [];
  const textPart = [`Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: base64`, "", fold(b64Text(args.text))].join(CRLF);
  alternatives.push(textPart);
  if (args.html) {
    alternatives.push([`Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: base64`, "", fold(b64Text(args.html))].join(CRLF));
  }
  if (args.calendar) {
    alternatives.push(
      [
        `Content-Type: text/calendar; charset=utf-8; method=${args.calendar.method ?? "REQUEST"}`,
        `Content-Transfer-Encoding: base64`,
        "",
        fold(b64Text(args.calendar.ics)),
      ].join(CRLF),
    );
  }

  let body: string;
  let contentType: string;
  if (alternatives.length === 1) {
    contentType = `Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: base64`;
    body = fold(b64Text(args.text));
  } else {
    const alt = boundary();
    contentType = `Content-Type: multipart/alternative; boundary="${alt}"`;
    body = alternatives.map((p) => `--${alt}${CRLF}${p}`).join(CRLF) + `${CRLF}--${alt}--`;
  }

  const attachments = args.attachments ?? [];
  if (attachments.length > 0) {
    const mixed = boundary();
    const inner = [contentType, "", body].join(CRLF);
    const files = attachments.map((a) =>
      [
        `Content-Type: ${a.mime};${filenameParameter("name", a.name)}`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment;${filenameParameter("filename", a.name)}`,
        "",
        fold(a.contentBase64.replace(/\s+/g, "")),
      ].join(CRLF),
    );
    const parts = [inner, ...files].map((p) => `--${mixed}${CRLF}${p}`).join(CRLF);
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    return headers.join(CRLF) + CRLF + CRLF + parts + `${CRLF}--${mixed}--${CRLF}`;
  }

  return headers.join(CRLF) + CRLF + contentType + CRLF + CRLF + body + CRLF;
}
