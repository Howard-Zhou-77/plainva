/** Stable, redacted authentication failure shared with the native mail bridge. */
export const MAIL_OAUTH_REJECTED = "MAIL_OAUTH_REJECTED";

export function xoauth2Payload(user: string, accessToken: string): string {
  // SASL separators and line breaks must never enter through credential fields.
  // eslint-disable-next-line no-control-regex
  if (!user || !accessToken || /[\x00-\x1f\x7f]/.test(user + accessToken)) throw new Error("Invalid OAuth mail credentials");
  const bytes = new TextEncoder().encode(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function isMailOAuthRejection(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)) === MAIL_OAUTH_REJECTED;
}
