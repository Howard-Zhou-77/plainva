import { normalizeVerifiedProviderIdentity, verifiedProviderIdentityKey } from "./accountProfile";
import { oauthScopesCover, type OAuthFamily } from "./oauthScopes";
import { hasStoredAccountGrant, sameOAuthClient, sameStoredAccountToken, tokenCoversService, type OAuthClientRegistration, type StoredAccountToken } from "./tokenBroker";
import type { ProtectedSecretStore } from "./passwordChangeJournal";

/** The entire set is one secure-store value. No token is stored in a profile. */
export type AccountCredentialDocument = StoredAccountToken | { version: 2; grants: StoredAccountToken[] };
const MAX_GRANTS = 32;

function readGrant(value: unknown): StoredAccountToken {
  if (!value || typeof value !== "object") throw new Error("The stored account sign-in is invalid");
  const raw = value as Record<string, unknown>;
  if (typeof raw.clientId !== "string" || !raw.clientId.trim() || raw.clientId.length > 8192
    || typeof raw.refreshToken !== "string" || raw.refreshToken.length > 262144
    || (raw.clientSecret !== undefined && (typeof raw.clientSecret !== "string" || raw.clientSecret.length > 262144))
    || (raw.scopes !== undefined && (typeof raw.scopes !== "string" || raw.scopes.length > 65536))) {
    throw new Error("The stored account sign-in is invalid");
  }
  const identity = normalizeVerifiedProviderIdentity(raw.providerIdentity);
  if (raw.providerIdentity !== undefined && !identity) throw new Error("The stored account identity is invalid");
  const native = raw.nativeGoogle as { email?: unknown } | undefined;
  if (native !== undefined && (!native || typeof native !== "object" || typeof native.email !== "string"
    || !/^[^\s@]+@[^\s@]+$/.test(native.email) || native.email.length > 320 || identity?.issuer !== "google"
    || raw.refreshToken !== "" || raw.clientSecret)) throw new Error("The stored native Google authorization is invalid");
  if (raw.verifiedAt !== undefined && (typeof raw.verifiedAt !== "number" || !Number.isFinite(raw.verifiedAt) || raw.verifiedAt < 0)) {
    throw new Error("The stored account verification is invalid");
  }
  return {
    clientId: raw.clientId, refreshToken: raw.refreshToken,
    ...(raw.clientSecret !== undefined ? { clientSecret: raw.clientSecret as string } : {}),
    ...(raw.scopes !== undefined ? { scopes: raw.scopes as string } : {}),
    ...(identity ? { providerIdentity: identity } : {}),
    ...(native ? { nativeGoogle: { email: native.email as string } } : {}),
    ...(raw.verifiedAt !== undefined ? { verifiedAt: raw.verifiedAt as number } : {}),
  };
}

/** Reads historical single slots without rewriting them or guessing a grant. */
export function accountCredentialGrants(value: unknown): StoredAccountToken[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") throw new Error("The stored account sign-in is invalid");
  if ("version" in value) {
    const raw = value as { version: unknown; grants?: unknown };
    if (raw.version !== 2 || !Array.isArray(raw.grants) || raw.grants.length === 0 || raw.grants.length > MAX_GRANTS) {
      throw new Error("The stored account sign-in format is unsupported");
    }
    return raw.grants.map(readGrant);
  }
  return [readGrant(value)];
}

export function primaryAccountToken(value: unknown): StoredAccountToken | null {
  const grants = accountCredentialGrants(value);
  return grants[grants.length - 1] ?? null;
}

/** One actual grant must cover the service. Separate scopes are never unioned. */
export function selectAccountToken(
  value: unknown, family: OAuthFamily, service: string, client?: OAuthClientRegistration,
): StoredAccountToken | null {
  return accountCredentialGrants(value).reverse().find((grant) => (!client || sameOAuthClient(grant, client))
    && (!grant.providerIdentity || grant.providerIdentity.issuer === family)
    && tokenCoversService(grant, service, family)) ?? null;
}

function encode(grants: StoredAccountToken[]): AccountCredentialDocument {
  // Single-grant installations remain readable by the historical client.
  return grants.length === 1 ? grants[0] : { version: 2, grants };
}

/** A consent adds confirmed rights without deleting an unrelated narrow grant. */
export function mergeAccountToken(current: unknown, nextInput: StoredAccountToken): AccountCredentialDocument {
  const next = readGrant(nextInput);
  const grants = accountCredentialGrants(current);
  if (next.providerIdentity && grants.some((grant) => grant.providerIdentity
    && verifiedProviderIdentityKey(grant.providerIdentity) !== verifiedProviderIdentityKey(next.providerIdentity!))) {
    throw new Error("A different provider account was selected. Existing sign-ins were kept.");
  }
  const kept = grants.filter((grant) => {
    if (sameStoredAccountToken(grant, next)) return false;
    if (!hasStoredAccountGrant(grant) && sameOAuthClient(grant, next)) return false;
    // Retire a redundant grant only with matching verified subjects, clients,
    // and explicitly confirmed data permissions. Unknown legacy rights stay.
    const family = next.providerIdentity?.issuer;
    const replaces = (family === "google" || family === "microsoft") && grant.providerIdentity
      && verifiedProviderIdentityKey(grant.providerIdentity) === verifiedProviderIdentityKey(next.providerIdentity!)
      && sameOAuthClient(grant, next) && grant.scopes !== undefined
      && oauthScopesCover(next.scopes, grant.scopes, family);
    return !replaces;
  });
  if (kept.length >= MAX_GRANTS) throw new Error("The account has too many independent sign-ins. Existing sign-ins were kept.");
  return encode([...kept, next]);
}

/** Compare-and-swap only the predecessor that actually produced the rotation. */
export function rotateAccountToken(current: unknown, next: StoredAccountToken, expected: StoredAccountToken): AccountCredentialDocument {
  const grants = accountCredentialGrants(current);
  const index = grants.findIndex((grant) => sameStoredAccountToken(grant, expected));
  if (index < 0 || !sameOAuthClient(next, expected)) throw new Error("account sign-in changed before rotation could be saved");
  grants[index] = readGrant(next);
  return encode(grants);
}

export function sameAccountCredentials(left: unknown, right: unknown): boolean {
  const a = accountCredentialGrants(left), b = accountCredentialGrants(right);
  return a.length === b.length && a.every((grant, index) => sameStoredAccountToken(grant, b[index]));
}

/** A native compare-and-swap preserves independent writers in other windows. */
export async function updateAccountCredentials(
  store: ProtectedSecretStore, key: string, update: (current: unknown) => AccountCredentialDocument,
  readLegacy?: () => Promise<unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = await store.read(key);
    const current: unknown = raw === null ? await readLegacy?.() ?? null : JSON.parse(raw);
    if (raw !== null && current === null) throw new Error("The stored account sign-in is invalid");
    const next = update(current);
    const replacement = JSON.stringify(next);
    if (!await store.compareAndSet(key, raw, replacement)) continue;
    const confirmed = await store.read(key);
    if (confirmed === null) throw new Error("The account sign-in could not be confirmed in secure storage.");
    const confirmedGrants = accountCredentialGrants(JSON.parse(confirmed));
    if (!accountCredentialGrants(next).every((grant) => confirmedGrants.some((stored) => sameStoredAccountToken(stored, grant)))) {
      throw new Error("The account sign-in changed before storage could be confirmed.");
    }
    return;
  }
  throw new Error("The account sign-in changed repeatedly. Please try again.");
}
