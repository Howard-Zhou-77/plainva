import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountCredentialGrants, createTokenBroker, GOOGLE_MAIL_SCOPES, tokenCoversService, type StoredAccountToken } from "@plainva/ui";

const state = vi.hoisted(() => ({ authorize: vi.fn(), clearToken: vi.fn(), fetch: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" }, registerPlugin: () => ({ authorize: state.authorize, clearToken: state.clearToken }) }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: state.fetch }));
let native: typeof import("./googleNativeAuthorization");
const grant: StoredAccountToken = { clientId: "android-registration", refreshToken: "", nativeGoogle: { email: "person@example.test" }, providerIdentity: { issuer: "google", subject: "subject" }, scopes: GOOGLE_MAIL_SCOPES };
beforeEach(async () => {
  vi.resetModules();
  state.authorize.mockReset().mockResolvedValue({ accessToken: "ephemeral", scopes: GOOGLE_MAIL_SCOPES.split(" ") });
  state.clearToken.mockReset().mockResolvedValue(undefined);
  state.fetch.mockReset().mockImplementation(async () => Response.json({ sub: "subject", email: "person@example.test", email_verified: true }));
  native = await import("./googleNativeAuthorization");
});
describe("Android Google authorization", () => {
  it("stores a verified native grant without inventing a refresh token and single-flights mail", async () => {
    expect(accountCredentialGrants(grant)).toEqual([grant]);
    expect(tokenCoversService(grant, "mail", "google")).toBe(true);
    const write = vi.fn();
    const broker = createTokenBroker({ family: "google", store: { read: async () => grant, write }, scopeFor: () => GOOGLE_MAIL_SCOPES,
      refresh: request => native.authorizeNativeGoogle(request.scope, false, request) });
    expect(await Promise.all([broker.getAccessToken("mail"), broker.getAccessToken("mail")])).toEqual(["ephemeral", "ephemeral"]);
    expect(state.authorize).toHaveBeenCalledTimes(1);
    expect(state.authorize).toHaveBeenCalledWith({ scopes: GOOGLE_MAIL_SCOPES.split(" "), email: grant.nativeGoogle!.email, interactive: false });
    expect(write).not.toHaveBeenCalled();
  });
  it("clears a rejected SDK token before asking again", async () => {
    await native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant);
    native.forgetNativeGoogleTokens();
    state.authorize.mockImplementationOnce(async () => { expect(state.clearToken).toHaveBeenCalledWith({ token: "ephemeral" }); return { accessToken: "next", scopes: GOOGLE_MAIL_SCOPES.split(" ") }; });
    await native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant);
  });
  it("surfaces revoked consent without opening the native account picker in the background", async () => {
    state.authorize.mockRejectedValue({ code: "CONSENT_REQUIRED" });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toThrow("invalid_grant");
    expect(state.authorize.mock.calls[0][0].interactive).toBe(false);
  });
  it("rejects another subject and a partial consent", async () => {
    state.fetch.mockResolvedValueOnce(Response.json({ sub: "other", email: "person@example.test", email_verified: true }));
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toThrow("different provider account");
    state.authorize.mockResolvedValueOnce({ accessToken: "token", scopes: ["openid", "email"] });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true)).rejects.toThrow("requested permissions");
  });
});
