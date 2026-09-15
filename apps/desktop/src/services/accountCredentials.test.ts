import { describe, expect, it } from "vitest";
import {
  accountCredentialGrants, mergeAccountToken, primaryAccountToken, rotateAccountToken, selectAccountToken,
  createTokenBroker, oauthScopeFor, type AccountCredentialDocument, type StoredAccountToken,
  updateAccountCredentials, type ProtectedSecretStore,
} from "@plainva/ui";

const identity = { issuer: "microsoft", subject: "same-person" };
function grant(service: string, client = "client"): StoredAccountToken {
  return { clientId: client, refreshToken: `refresh-${service}-${client}`, scopes: oauthScopeFor("microsoft", service)!, providerIdentity: identity, verifiedAt: 100 };
}

describe("independent grants in one account", () => {
  it("keeps narrow file and calendar grants when mail is added", () => {
    const files = grant("files", "files-client"), calendar = grant("calendar", "calendar-client"), mail = grant("mail", "mail-client");
    const before = mergeAccountToken(files, calendar);
    const after = mergeAccountToken(before, mail);
    expect(accountCredentialGrants(before)).toHaveLength(2);
    expect(selectAccountToken(after, "microsoft", "files")).toEqual(files);
    expect(selectAccountToken(after, "microsoft", "calendar")).toEqual(calendar);
    expect(selectAccountToken(after, "microsoft", "mail")).toEqual(mail);
    expect(primaryAccountToken(after)).toEqual(mail);
    expect(selectAccountToken(after, "microsoft", "files", { clientId: "mail-client" })).toBeNull();
    expect(selectAccountToken(after, "google", "files")).toBeNull();
  });

  it("does not assemble one service's required permissions from different grants", () => {
    const doc = mergeAccountToken({ ...grant("mail"), scopes: "User.Read Mail.ReadWrite" }, { ...grant("mail"), refreshToken: "second", scopes: "Mail.Send" });
    expect(selectAccountToken(doc, "microsoft", "mail")).toBeNull();
  });

  it("rejects another provider subject before changing the old credentials", () => {
    const old = grant("files");
    expect(() => mergeAccountToken(old, { ...grant("mail"), providerIdentity: { issuer: "microsoft", subject: "another-person" } })).toThrow(/different provider account/);
    expect(old).toEqual(grant("files"));
  });

  it("retires only grants whose confirmed permissions are fully replaced", () => {
    const files = grant("files");
    const calendar = grant("calendar", "other-client");
    const wide = { ...files, refreshToken: "wide", scopes: `${files.scopes} ${oauthScopeFor("microsoft", "mail")}` };
    const doc = mergeAccountToken(mergeAccountToken(files, calendar), wide);
    expect(accountCredentialGrants(doc)).toEqual([calendar, wide]);
    expect(accountCredentialGrants(mergeAccountToken(doc, wide))).toEqual([calendar, wide]);
  });

  it("keeps historical unknown permissions and does not rewrite reads", () => {
    const old = { clientId: "client", refreshToken: "legacy" };
    expect(accountCredentialGrants(old)).toEqual([old]);
    expect(accountCredentialGrants(mergeAccountToken(old, grant("mail")))).toEqual([old, grant("mail")]);
    expect(old).toEqual({ clientId: "client", refreshToken: "legacy" });
  });

  it.each([{ version: 3, grants: [] }, { version: 2, grants: [] }, { clientId: "id", refreshToken: 3 }, { clientId: "id", refreshToken: "token", providerIdentity: {} }])("fails closed on unsupported or corrupt secure-store data", (value) => {
    expect(() => mergeAccountToken(value, grant("mail"))).toThrow();
  });

  it("rotates only the matching predecessor and refuses a replaced one", () => {
    const files = grant("files"), mail = grant("mail", "second");
    const old = mergeAccountToken(files, mail);
    const rotated = { ...files, refreshToken: "rotated" };
    const next = rotateAccountToken(old, rotated, files);
    expect(selectAccountToken(next, "microsoft", "files")).toEqual(rotated);
    expect(selectAccountToken(next, "microsoft", "mail")).toEqual(mail);
    expect(() => rotateAccountToken(next, { ...files, refreshToken: "late" }, files)).toThrow(/changed before rotation/);
    expect(accountCredentialGrants(old)).toEqual([files, mail]);
  });

  it("parallel services and client-specific access retain both rotations", async () => {
    const first = grant("files", "first"), second = grant("files", "second"), mail = grant("mail", "third");
    let stored: AccountCredentialDocument = mergeAccountToken(mergeAccountToken(first, second), mail);
    const calls: string[] = [];
    const broker = createTokenBroker({ family: "microsoft", scopeFor: (service) => oauthScopeFor("microsoft", service)!, store: {
      read: async (service, client) => service ? selectAccountToken(stored, "microsoft", service, client) : primaryAccountToken(stored),
      write: async (next, expected) => { stored = rotateAccountToken(stored, next, expected); },
    }, refresh: async ({ clientId, scope }) => {
      calls.push(clientId);
      return { accessToken: `access-${clientId}`, refreshToken: `rotated-${clientId}`, scope };
    } });
    expect(await Promise.all([
      broker.getAccessToken("files", { clientId: "first" }), broker.getAccessToken("mail"),
      broker.getAccessToken("files", { clientId: "first" }), broker.getAccessToken("files", { clientId: "second" }),
    ])).toEqual(["access-first", "access-third", "access-first", "access-second"]);
    expect(calls.sort()).toEqual(["first", "second", "third"]);
    expect(accountCredentialGrants(stored).map((token) => token.refreshToken)).toEqual(["rotated-first", "rotated-second", "rotated-third"]);
  });

  it("native CAS retries an independent window's write without losing either grant", async () => {
    let raw = JSON.stringify(grant("files"));
    let collisions = 0;
    const store: ProtectedSecretStore = {
      read: async () => raw,
      compareAndSet: async (_key, expected, next) => {
        if (expected !== raw) { collisions++; return false; }
        raw = next!;
        return true;
      },
    };
    await Promise.all([
      updateAccountCredentials(store, "account", (value) => mergeAccountToken(value, grant("calendar"))),
      updateAccountCredentials(store, "account", (value) => mergeAccountToken(value, grant("mail"))),
    ]);
    expect(collisions).toBeGreaterThan(0);
    for (const service of ["files", "calendar", "mail"]) expect(selectAccountToken(JSON.parse(raw), "microsoft", service)).toEqual(grant(service));
  });

  it.each(["{broken", "null", '{"version":3}'])("never overwrites unreadable protected data", async (raw) => {
    let writes = 0;
    await expect(updateAccountCredentials({ read: async () => raw, compareAndSet: async () => { writes++; return true; } }, "account", (current) => mergeAccountToken(current, grant("files")))).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
