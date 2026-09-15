import { isTauri } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { GOOGLE_MAIL_SCOPES, googlePublicClient, type CloudAccountRecord } from "@plainva/ui";
import { completeGmailSignIn } from "@plainva/ui/mail";
import { authorizeDrive } from "../driveAuth";
import { saveAccountToken } from "../accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "../cloudAccounts";

export function desktopGmailClient() { return isTauri() ? googlePublicClient(import.meta.env, "desktop") : null; }
export async function signInGmail(vault: string, expected?: CloudAccountRecord): Promise<void> {
  const client = desktopGmailClient();
  if (!client) throw new Error("The Google mail test client is not configured for this build");
  const result = await authorizeDrive({ clientId: client.clientId, clientSecret: client.clientSecret!, scope: GOOGLE_MAIL_SCOPES, includeAccessToken: true });
  await completeGmailSignIn(vault, { clientId: result.clientId, clientSecret: result.clientSecret, refreshToken: result.refreshToken, scopes: result.grantedScope }, result.accessToken ?? "", {
    fetch: httpFetch,
    read: () => loadCloudAccounts(vault), write: records => saveCloudAccounts(vault, records),
    saveGrant: (id, grant) => saveAccountToken(vault, id, grant),
  }, expected);
}
