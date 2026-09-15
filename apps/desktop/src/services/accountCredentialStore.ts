import { isTauri } from "@tauri-apps/api/core";
import { withAccountCredentialLock, type ProtectedSecretStore } from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { protectedSecrets } from "./protectedSecrets";

/** Native writers share the keychain CAS; browser fixtures use their own store. */
export const accountCredentialStore: ProtectedSecretStore = {
  read: async (key) => {
    if (isTauri()) return protectedSecrets.read(key);
    const value = await credentialManager.readSecret<unknown>(key);
    return value === null || value === undefined ? null : JSON.stringify(value);
  },
  compareAndSet: async (key, expected, value) => {
    if (isTauri()) return protectedSecrets.compareAndSet(key, expected, value);
    return withAccountCredentialLock(`browser-account-cas:${key}`, async () => {
      if (await accountCredentialStore.read(key) !== expected) return false;
      if (value === null) await credentialManager.removeSecret(key);
      else await credentialManager.writeSecret(key, JSON.parse(value));
      return true;
    });
  },
};
