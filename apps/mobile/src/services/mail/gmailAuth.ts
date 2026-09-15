import { Capacitor } from "@capacitor/core";
import { GOOGLE_MAIL_SCOPES, googlePublicClient, type CloudAccountRecord, type StoredAccountToken } from "@plainva/ui";
import { completeGmailSignIn } from "@plainva/ui/mail";
import { webdavFetch } from "../../adapters/webdavHttp";
import { loadCloudAccounts, saveCloudAccounts } from "../cloudAccountsStore";
import { saveAccountToken } from "../accountBroker";
import { beginPimOAuth, setOAuthPurposeHandler } from "../pim/pimOAuth";
import { notifyMailChanged } from "./mailRuntime";
import { recordConnectOutcome } from "../connectQueue";
import type { ServiceConnectionContext } from "@plainva/ui";

export function mobileGmailClient() {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? googlePublicClient(import.meta.env, platform) : null;
}
async function complete(vault: string, token: StoredAccountToken, accessToken: string, expected?: CloudAccountRecord) {
  const record = await completeGmailSignIn(vault, token, accessToken, {
    fetch: webdavFetch, read: () => loadCloudAccounts(vault), write: records => saveCloudAccounts(vault, records),
    saveGrant: (id, grant) => saveAccountToken(vault, id, grant),
  }, expected);
  notifyMailChanged();
  return record;
}

/** The durable iOS PKCE result is replayed by the existing OAuth journal. */
export function registerGmailOAuth(): void {
  setOAuthPurposeHandler("gmail", async ({ provider, clientId, clientSecret, refreshToken, accessToken, grantedScope, serviceContext, accountContext, nativeGoogle, providerIdentity }) => {
    if (provider !== "google" || !serviceContext?.vaultId) throw new Error("Gmail sign-in context is missing");
    const client = mobileGmailClient();
    if (!client || clientId !== client.clientId) throw new Error("Gmail client registration changed");
    const record = await complete(serviceContext.vaultId, { clientId, clientSecret, refreshToken, scopes: grantedScope, ...(nativeGoogle ? { nativeGoogle, providerIdentity } : {}) }, accessToken ?? "", accountContext?.record);
    await recordConnectOutcome(serviceContext, "mail", { state: "connected", bindingId: record.services.mail!.mailAccountId });
  });
}

export async function signInGmail(vault: string, expected?: CloudAccountRecord, context?: ServiceConnectionContext): Promise<void> {
  const client = mobileGmailClient();
  if (!client) throw new Error("The Google mail test client is not configured for this build");
  registerGmailOAuth();
  await beginPimOAuth("google", { clientId: client.clientId, purpose: "gmail", scope: GOOGLE_MAIL_SCOPES,
      serviceContext: context ?? { vaultId: vault, ...(expected ? { cloudAccountId: expected.id } : {}) },
      accountContext: expected ? { vaultId: vault, record: expected, expectedToken: null, serviceSources: {} } : undefined });
}
