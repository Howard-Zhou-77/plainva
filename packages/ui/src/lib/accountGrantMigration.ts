import type { FetchFn } from "@plainva/core";
import { assertAccountGrantIdentity, assertAccountLoginBinding, requireCompleteAccountGrant, reviewAccountGrant } from "./accountLoginGrant";
import type { CloudAccountRecord, CloudServiceId } from "./cloudAccounts";
import { oauthScopeFor } from "./oauthScopes";
import { hasStoredAccountGrant, sameOAuthClient, tokenCoversService, type RefreshResult, type StoredAccountToken } from "./tokenBroker";
import { accountCredentialGrants } from "./accountCredentials";
import { verifiedProviderIdentityKey } from "./accountProfile";
import type { ProtectedSecretStore } from "./passwordChangeJournal";

export interface LegacyAccountGrant {
  token: StoredAccountToken;
  /** Opaque in-memory snapshot of the service source; never logged or synced. */
  snapshot: string;
}

export function legacyOAuthToken(value: Record<string, unknown>): StoredAccountToken {
  const scopes = value.grantedScope ?? value.scopes;
  if (typeof value.clientId !== "string" || !value.clientId.trim() || typeof value.refreshToken !== "string"
    || (value.clientSecret !== undefined && typeof value.clientSecret !== "string")
    || (scopes !== undefined && typeof scopes !== "string")) throw new Error("The stored service sign-in is invalid");
  const token = { clientId: value.clientId, refreshToken: value.refreshToken,
    ...(value.clientSecret !== undefined ? { clientSecret: value.clientSecret as string } : {}),
    ...(scopes !== undefined ? { scopes: scopes as string } : {}),
    ...(value.nativeGoogle ? { nativeGoogle: value.nativeGoogle, providerIdentity: value.providerIdentity } : {}),
  };
  return accountCredentialGrants(token)[0];
}

/** Keep the original key and exact serialized source for native CAS. */
export function createLegacyGrantSource(ports: {
  store: ProtectedSecretStore;
  keys: string[];
  binding?(): Promise<unknown>;
  token(value: Record<string, unknown>, binding: unknown): StoredAccountToken | null;
  replace(value: Record<string, unknown>, refreshToken: string): Record<string, unknown>;
}) {
  const readSource = async (): Promise<LegacyAccountGrant | null> => {
    for (const key of [...new Set(ports.keys)]) {
      const raw = await ports.store.read(key);
      if (raw === null) continue;
      const binding = await ports.binding?.() ?? null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The stored service sign-in is invalid");
      const token = ports.token(value as Record<string, unknown>, binding);
      if (!token) return null;
      return { token, snapshot: JSON.stringify({ key, raw, binding }) };
    }
    return null;
  };
  return { readSource, writeSource: async (refreshToken: string, snapshot: string): Promise<void> => {
    const expected = JSON.parse(snapshot) as { key: string; raw: string; binding: unknown };
    if (!ports.keys.includes(expected.key) || (await readSource())?.snapshot !== snapshot) throw new Error("The service sign-in changed during migration. Existing sign-ins were kept.");
    const next = JSON.stringify(ports.replace(JSON.parse(expected.raw) as Record<string, unknown>, refreshToken));
    if (!await ports.store.compareAndSet(expected.key, expected.raw, next)) throw new Error("The service sign-in changed during migration. Existing sign-ins were kept.");
    if (await ports.store.read(expected.key) !== next) throw new Error("The service sign-in could not be confirmed in secure storage.");
  } };
}

export async function rotateLegacyGrant(source: ReturnType<typeof createLegacyGrantSource>, expected: StoredAccountToken, refreshToken: string): Promise<void> {
  const current = await source.readSource();
  if (!current || !sameOAuthClient(current.token, expected)) throw new Error("The service sign-in changed before rotation could be saved");
  if (current.token.refreshToken === refreshToken && !current.token.nativeGoogle) return; // confirmed retry after an interrupted read-back
  if (current.token.refreshToken !== expected.refreshToken) throw new Error("The service sign-in changed before rotation could be saved");
  await source.writeSource(refreshToken, current.snapshot);
}

/** The source and confirmed account grant are the durable recovery record.
 * Until binding succeeds, both remain. Reopening resumes from that pair. */
export async function migrateAccountGrant(ports: {
  record: CloudAccountRecord;
  service: CloudServiceId;
  requiredServices?: readonly CloudServiceId[];
  readRecord(): Promise<CloudAccountRecord | undefined>;
  readSource(): Promise<LegacyAccountGrant | null>;
  readConfirmed(source: StoredAccountToken): Promise<StoredAccountToken | null>;
  refresh(token: StoredAccountToken, scope: string): Promise<RefreshResult>;
  /** Compare-and-swap the full captured service source. */
  writeSource(refreshToken: string, expectedSnapshot: string): Promise<void>;
  saveConfirmed(token: StoredAccountToken): Promise<void>;
  fetch: FetchFn;
  now?: () => number;
}): Promise<"absent" | "migrated"> {
  const { record, service } = ports;
  if (record.family !== "google" && record.family !== "microsoft") return "absent";
  if (!oauthScopeFor(record.family, service)) return "absent";
  const requiredServices = ports.requiredServices ?? [service];
  const scope = [...new Set(requiredServices.flatMap((required) => (oauthScopeFor(record.family as "google" | "microsoft", required) ?? "").split(/\s+/)).filter(Boolean))].join(" ");
  let source = await ports.readSource();
  if (!source || !hasStoredAccountGrant(source.token)) return "absent";
  const assertCurrent = async () => {
    assertAccountLoginBinding(record, await ports.readRecord());
    if ((await ports.readSource())?.snapshot !== source!.snapshot) throw new Error("The service sign-in changed during migration. Existing sign-ins were kept.");
  };
  await assertCurrent();
  let confirmed = await ports.readConfirmed(source.token);
  const resumes = confirmed?.providerIdentity && sameOAuthClient(confirmed, source.token)
    && confirmed.refreshToken === source.token.refreshToken && requiredServices.every((required) => tokenCoversService(confirmed, required, record.family as "google" | "microsoft"))
    && (!record.verifiedProviderIdentity || verifiedProviderIdentityKey(confirmed.providerIdentity) === verifiedProviderIdentityKey(record.verifiedProviderIdentity));
  if (!resumes) {
    const answer = await ports.refresh(source.token, scope);
    if (typeof answer.accessToken !== "string" || !answer.accessToken.trim()
      || (answer.refreshToken !== undefined && typeof answer.refreshToken !== "string")
      || (answer.scope !== undefined && typeof answer.scope !== "string")) throw new Error("The provider returned an invalid grant");
    await assertCurrent();
    // Keep a returned rotation even if later identity verification or target
    // persistence fails; the service still owns this original credential.
    if (answer.refreshToken && answer.refreshToken !== source.token.refreshToken) {
      await ports.writeSource(answer.refreshToken, source.snapshot);
      source = await ports.readSource();
      if (!source || source.token.refreshToken !== answer.refreshToken) throw new Error("The renewed service sign-in could not be confirmed");
    }
    const scopes = answer.scope ?? (record.family === "microsoft" ? scope : source.token.scopes);
    const review = reviewAccountGrant(record.family, requiredServices, source.token, scope, scopes);
    confirmed = requireCompleteAccountGrant(review);
    const providerIdentity = await assertAccountGrantIdentity(record, answer.accessToken, ports.fetch);
    confirmed = { ...confirmed, providerIdentity, verifiedAt: (ports.now ?? Date.now)() };
    await assertCurrent();
    await ports.saveConfirmed(confirmed);
  }
  await assertCurrent();
  // A failed write leaves the source readable, and the confirmed copy can be
  // used on the next run without another network exchange.
  await ports.writeSource("", source.snapshot);
  return "migrated";
}
