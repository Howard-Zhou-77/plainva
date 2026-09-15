export type GoogleNativePlatform = "desktop" | "ios" | "android";
export interface GooglePublicClient { clientId: string; clientSecret?: string; state: "testing" }

/** No shipped registration or production approval is assumed. Values describe
 * native clients, not a web client or a backend secret. Production activation
 * requires a separately reviewed change after provider verification. */
export function googlePublicClient(env: Record<string, unknown>, platform: GoogleNativePlatform): GooglePublicClient | null {
  if (env.VITE_PLAINVA_GOOGLE_MAIL_STATE !== "testing") return null;
  const clientId = env[`VITE_PLAINVA_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`];
  if (typeof clientId !== "string" || !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) return null;
  const secret = env.VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_SECRET;
  if (platform === "desktop" && (typeof secret !== "string" || !secret.trim())) return null;
  return { clientId, state: "testing", ...(platform === "desktop" ? { clientSecret: (secret as string).trim() } : {}) };
}
