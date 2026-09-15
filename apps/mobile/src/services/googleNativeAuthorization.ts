import { Capacitor, registerPlugin } from "@capacitor/core";
import { oauthScopesCover, parseGoogleUserInfo, verifiedProviderIdentityKey, withAccountCredentialLock, type StoredAccountToken } from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";

interface GoogleAuthorizationPort {
  authorize(options: { scopes: string[]; email?: string; interactive: boolean }): Promise<{ accessToken: string; scopes: string[] }>;
  clearToken(options: { token: string }): Promise<void>;
}
const native = registerPlugin<GoogleAuthorizationPort>("GoogleAuthorization");
const issued = new Set<string>();
const rejected = new Set<string>();

/** Queued until the next request, which awaits clearing before obtaining a token. */
export function forgetNativeGoogleTokens(): void { for (const token of issued) rejected.add(token); issued.clear(); }

export async function authorizeNativeGoogle(scope: string, interactive: boolean, expected?: StoredAccountToken) {
  return withAccountCredentialLock("native-google-authorization", () => authorize(scope, interactive, expected));
}

async function authorize(scope: string, interactive: boolean, expected?: StoredAccountToken) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") throw new Error("Native Google authorization requires Android");
  for (const token of [...rejected]) { await native.clearToken({ token }); rejected.delete(token); }
  let response: { accessToken: string; scopes: string[] };
  try { response = await native.authorize({ scopes: scope.split(/\s+/).filter(Boolean), email: expected?.nativeGoogle?.email, interactive }); }
  catch (error) {
    if ((error as { code?: string })?.code === "CONSENT_REQUIRED") throw new Error("invalid_grant: Google account needs sign-in", { cause: error });
    throw error;
  }
  if (!response.accessToken || !Array.isArray(response.scopes) || !oauthScopesCover(response.scopes.join(" "), scope, "google")) throw new Error("Google did not grant the requested permissions");
  const result = await webdavFetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${response.accessToken}` } });
  const profile = result.ok ? parseGoogleUserInfo(await result.json()) : null;
  if (!profile?.label?.includes("@") || (expected?.providerIdentity && verifiedProviderIdentityKey(expected.providerIdentity) !== verifiedProviderIdentityKey(profile.identity))
    || (expected?.nativeGoogle && expected.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase())) throw new Error("A different provider account was selected. Existing sign-ins were kept.");
  issued.add(response.accessToken);
  if (issued.size > 64) issued.delete(issued.values().next().value!);
  return { accessToken: response.accessToken, scope: response.scopes.join(" "), expiresIn: 300, profile };
}
