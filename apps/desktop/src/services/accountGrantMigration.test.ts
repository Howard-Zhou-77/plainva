import { describe, expect, it, vi } from "vitest";
import { createLegacyGrantSource, legacyOAuthToken, migrateAccountGrant, mergeAccountToken, selectAccountToken, updateAccountCredentials, replaceProtectedSlot, oauthScopeFor, type CloudAccountRecord, type ProtectedSecretStore } from "@plainva/ui";

function fixture() {
  const values = new Map<string, string>([["legacy", JSON.stringify({ clientId: "client", refreshToken: "old", folder: "Keep this folder" })]]);
  const store: ProtectedSecretStore = {
    read: async (key) => values.get(key) ?? null,
    compareAndSet: async (key, expected, value) => {
      if ((values.get(key) ?? null) !== expected) return false;
      if (value === null) values.delete(key); else values.set(key, value);
      return true;
    },
  };
  const record: CloudAccountRecord = { id: "account", family: "microsoft", label: "Person", verifiedProviderIdentity: { issuer: "microsoft", subject: "person" }, services: { files: { provider: "onedrive" } } };
  const source = createLegacyGrantSource({ store, keys: ["legacy"], token: legacyOAuthToken, replace: (raw, refreshToken) => ({ ...raw, refreshToken }) });
  const refresh = vi.fn(async () => ({ accessToken: "access", refreshToken: "rotated", scope: oauthScopeFor("microsoft", "files")! }));
  const ports = { record, service: "files" as const, ...source,
    readRecord: async () => record,
    readConfirmed: async () => selectAccountToken(values.has("account") ? JSON.parse(values.get("account")!) : null, "microsoft", "files"),
    saveConfirmed: async (token: Parameters<typeof mergeAccountToken>[1]) => updateAccountCredentials(store, "account", (current) => mergeAccountToken(current, token)),
    refresh, fetch: vi.fn(async () => new Response(JSON.stringify({ id: "person" }))), now: () => 100,
  };
  return { values, ports, source, refresh, store };
}

describe("verified legacy account migration", () => {
  it("retains a native Google source through a failed copy and retires it only after confirmation", async () => {
    const f = fixture();
    const identity = { issuer: "google" as const, subject: "person" };
    const native = { clientId: "android", refreshToken: "", nativeGoogle: { email: "person@example.test" }, providerIdentity: identity, grantedScope: oauthScopeFor("google", "files")!, folder: "Keep this folder" };
    f.values.set("legacy", JSON.stringify(native));
    const source = createLegacyGrantSource({ store: f.store, keys: ["legacy"], token: legacyOAuthToken, replace: (raw, refreshToken) => {
      const next: Record<string, unknown> = { ...raw, refreshToken }; delete next.nativeGoogle; return next;
    } });
    const record: CloudAccountRecord = { ...f.ports.record, family: "google", verifiedProviderIdentity: identity, services: { files: { provider: "drive" } } };
    const ports = { ...f.ports, ...source, record, readRecord: async () => record,
      readConfirmed: async () => selectAccountToken(f.values.has("account") ? JSON.parse(f.values.get("account")!) : null, "google", "files"),
      refresh: vi.fn(async () => ({ accessToken: "access", scope: native.grantedScope })),
      fetch: async () => new Response(JSON.stringify({ sub: "person", email: "person@example.test", email_verified: true })),
    };
    await expect(migrateAccountGrant({ ...ports, saveConfirmed: async () => { throw new Error("storage failed"); } })).rejects.toThrow("storage failed");
    expect(JSON.parse(f.values.get("legacy")!)).toEqual(native);
    await expect(migrateAccountGrant(ports)).resolves.toBe("migrated");
    expect(await ports.readConfirmed()).toMatchObject({ nativeGoogle: native.nativeGoogle, providerIdentity: identity });
    expect(JSON.parse(f.values.get("legacy")!)).toMatchObject({ refreshToken: "", folder: "Keep this folder" });
    expect(JSON.parse(f.values.get("legacy")!).nativeGoogle).toBeUndefined();
  });
  it("reconnects the historical source key while preserving a concurrent new login", async () => {
    const f = fixture();
    const old = JSON.parse(f.values.get("legacy")!);
    const newLogin = { ...old, refreshToken: "independent" };
    f.store.compareAndSet = async () => { f.values.set("legacy", JSON.stringify(newLogin)); return false; };
    await expect(replaceProtectedSlot(f.store, ["readable", "legacy"], old, { ...old, refreshToken: "" })).rejects.toThrow("changed");
    expect(JSON.parse(f.values.get("legacy")!)).toEqual(newLogin);
    expect(f.values.has("readable")).toBe(false);
  });
  it("creates only the missing second-device service credential after confirmed consent", async () => {
    const f = fixture();
    const next = { kind: "google", clientId: "client", refreshToken: "" };
    await replaceProtectedSlot(f.store, ["new-device"], null, next);
    expect(JSON.parse(f.values.get("new-device")!)).toEqual(next);
  });
  it("confirms identity and durable storage before making the source dormant", async () => {
    const f = fixture();
    await expect(migrateAccountGrant(f.ports)).resolves.toBe("migrated");
    expect(JSON.parse(f.values.get("legacy")!)).toEqual({ clientId: "client", refreshToken: "", folder: "Keep this folder" });
    expect(await f.ports.readConfirmed()).toMatchObject({ refreshToken: "rotated", providerIdentity: { issuer: "microsoft", subject: "person" }, verifiedAt: 100 });
    await expect(migrateAccountGrant(f.ports)).resolves.toBe("absent");
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("resumes after stopping between copied grant and source binding, even offline", async () => {
    const f = fixture();
    const stopped = { ...f.ports, writeSource: async (token: string, snapshot: string) => {
      if (!token) throw new Error("process stopped");
      await f.source.writeSource(token, snapshot);
    } };
    await expect(migrateAccountGrant(stopped)).rejects.toThrow("process stopped");
    expect(JSON.parse(f.values.get("legacy")!).refreshToken).toBe("rotated");
    f.refresh.mockRejectedValue(new Error("offline"));
    await expect(migrateAccountGrant(f.ports)).resolves.toBe("migrated");
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the source and its returned rotation when account storage fails", async () => {
    const f = fixture();
    await expect(migrateAccountGrant({ ...f.ports, saveConfirmed: async () => { throw new Error("storage failed"); } })).rejects.toThrow("storage failed");
    expect(JSON.parse(f.values.get("legacy")!).refreshToken).toBe("rotated");
    expect(f.values.has("account")).toBe(false);
  });

  it("rejects another identity without clearing the service", async () => {
    const f = fixture();
    f.ports.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "someone-else" })));
    await expect(migrateAccountGrant(f.ports)).rejects.toThrow(/different provider account/);
    expect(JSON.parse(f.values.get("legacy")!).refreshToken).toBe("rotated");
    expect(f.values.has("account")).toBe(false);
  });

  it("refuses a new union when only one requested service was granted", async () => {
    const f = fixture();
    await expect(migrateAccountGrant({ ...f.ports, requiredServices: ["files", "calendar"] })).rejects.toMatchObject({ name: "AccountGrantMissingPermissionsError" });
    expect(f.values.has("account")).toBe(false);
    expect(JSON.parse(f.values.get("legacy")!).refreshToken).toBe("rotated");
  });

  it("does not delete a source changed during provider verification", async () => {
    const f = fixture();
    f.ports.fetch.mockImplementation(async () => {
      f.values.set("legacy", JSON.stringify({ clientId: "client", refreshToken: "newer-login", folder: "Other folder" }));
      return new Response(JSON.stringify({ id: "person" }));
    });
    await expect(migrateAccountGrant(f.ports)).rejects.toThrow(/service sign-in changed/);
    expect(JSON.parse(f.values.get("legacy")!).refreshToken).toBe("newer-login");
    expect(f.values.has("account")).toBe(false);
  });
});
