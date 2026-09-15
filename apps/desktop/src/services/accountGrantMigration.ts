import { refreshDriveAccessToken, refreshOneDriveAccessToken } from "@plainva/core";
import { createLegacyGrantSource, legacyOAuthToken, migrateAccountGrant, rotateLegacyGrant, PLAINVA_ONEDRIVE_CLIENT_ID, withAccountCredentialLock, type CloudAccountRecord, type CloudServiceId, type StoredAccountToken } from "@plainva/ui";
import { legacyMailSecretKey, listMailAccounts, mailAccountKind, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "./authFetch";
import { accountSecretKey, getAccountToken, saveAccountToken } from "./accountBroker";
import { accountCredentialStore } from "./accountCredentialStore";
import { loadCloudAccounts } from "./cloudAccounts";
import { slot, legacySlot } from "./keychainSlots";

export async function rotateLegacyFileGrant(vaultPath: string, provider: "onedrive" | "dropbox", expected: StoredAccountToken, refreshToken: string): Promise<void> {
  const source = createLegacyGrantSource({ store: accountCredentialStore,
    keys: [slot.files(vaultPath, provider), legacySlot.files(vaultPath, provider)],
    token: (raw) => legacyOAuthToken(provider === "dropbox" ? { ...raw, clientId: raw.appKey } : raw),
    replace: (raw, next) => ({ ...raw, refreshToken: next }),
  });
  await rotateLegacyGrant(source, expected, refreshToken);
}

/** Read-compatible service slots become dormant only after a verified copy. */
export async function migrateLegacyAccountGrant(vaultPath: string, record: CloudAccountRecord, service: CloudServiceId, requiredServices?: readonly CloudServiceId[]) {
  const family = record.family;
  if (family !== "google" && family !== "microsoft") return "absent" as const;
  const bindingId = service === "calendar" ? record.services.calendar?.pimAccountId : record.services.mail?.mailAccountId;
  const provider = record.services.files?.provider;
  if (service === "files" && provider !== (family === "google" ? "drive" : "onedrive")) return "absent" as const;
  if (service !== "files" && !bindingId) return "absent" as const;
  if (service === "mail" && family !== "microsoft") return "absent" as const;
  const keys = service === "files" ? [slot.files(vaultPath, provider!), legacySlot.files(vaultPath, provider!)]
    : service === "calendar" ? [slot.calendar(vaultPath, bindingId!), legacySlot.calendar(vaultPath, bindingId!)]
      : [mailSecretKey(vaultPath, bindingId!), legacyMailSecretKey(vaultPath, bindingId!)];
  const source = createLegacyGrantSource({ store: accountCredentialStore, keys,
    binding: service === "mail" ? async () => (await listMailAccounts(vaultPath)).find((mail) => mail.id === bindingId) ?? null : undefined,
    token: (raw, binding) => {
      if (service === "calendar" && raw.kind !== family) return null;
      if (service === "mail") {
        const mail = binding as MailAccountConfig | null;
        if (!mail || mailAccountKind(mail) !== "microsoft") return null;
        return legacyOAuthToken({ ...raw, clientId: mail.clientId || PLAINVA_ONEDRIVE_CLIENT_ID });
      }
      return legacyOAuthToken(raw);
    },
    replace: (raw, refreshToken) => ({ ...raw, refreshToken }),
  });
  return withAccountCredentialLock(`account-migration:${accountSecretKey(vaultPath, record.id)}:${service}`, () => migrateAccountGrant({
    record: structuredClone(record), service, requiredServices, ...source,
    readRecord: () => loadCloudAccounts(vaultPath).then((rows) => rows.find((row) => row.id === record.id)),
    readConfirmed: (token) => getAccountToken(vaultPath, record.id, service, family, token),
    saveConfirmed: (token) => saveAccountToken(vaultPath, record.id, token),
    fetch: httpFetch,
    refresh: async (token, scope) => {
      if (family === "google") return refreshDriveAccessToken({ ...token, clientSecret: token.clientSecret ?? "" }, httpFetch);
      return refreshOneDriveAccessToken({ clientId: token.clientId, refreshToken: token.refreshToken, scope }, microsoftAuthFetch);
    },
  }));
}
