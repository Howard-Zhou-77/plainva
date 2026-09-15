import { Capacitor } from "@capacitor/core";
import { withAccountCredentialLock, type ProtectedSecretStore } from "@plainva/ui";
import { secureCredentialStore } from "../platform/secureStore";
import { protectedSecrets } from "../platform/protectedSecrets";

/** Native writers share the protected-store CAS; previews use their existing store. */
export const accountCredentialStore: ProtectedSecretStore = {
  read: async (key) => {
    if (Capacitor.isNativePlatform()) {
      const raw = await protectedSecrets.read(key);
      if (raw !== null) return raw;
      // Let the existing native adapter finish its old Preferences migration,
      // then read the raw protected value so corrupt JSON cannot mean absence.
      await secureCredentialStore.readSecret<unknown>(key);
      return protectedSecrets.read(key);
    }
    const value = await secureCredentialStore.readSecret<unknown>(key);
    return value === null || value === undefined ? null : JSON.stringify(value);
  },
  compareAndSet: async (key, expected, value) => {
    if (Capacitor.isNativePlatform()) return protectedSecrets.compareAndSet(key, expected, value);
    return withAccountCredentialLock(`browser-account-cas:${key}`, async () => {
      if (await accountCredentialStore.read(key) !== expected) return false;
      if (value === null) await secureCredentialStore.removeSecret(key);
      else await secureCredentialStore.writeSecret(key, JSON.parse(value));
      return true;
    });
  },
};
