import { describe, expect, it, vi } from "vitest";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";

describe.each(["onedrive", "dropbox"] as const)("%s refresh persistence", (provider) => {
  it("retries the same rotation after a storage failure before any data request", async () => {
    const requests: string[] = [];
    const fetch: FetchFn = vi.fn(async (url) => {
      requests.push(String(url));
      const tokenRequest = String(url).includes("/token");
      return new Response(JSON.stringify(tokenRequest
        ? { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }
        : provider === "onedrive" ? { value: [] } : { entries: [], cursor: "c", has_more: false }),
      { status: 200, headers: { "content-type": "application/json" } });
    });
    const target = provider === "onedrive"
      ? new OneDriveSyncTarget({ clientId: "test-client", refreshToken: "old-refresh" }, fetch)
      : new DropboxSyncTarget({ appKey: "test-client", refreshToken: "old-refresh" }, fetch);
    const saved = vi.fn().mockRejectedValueOnce(new Error("storage unavailable"));
    target.onTokensRefreshed = saved;

    await expect(target.listFolders("")).rejects.toThrow("storage unavailable");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/token");
    await Promise.all([target.listFolders(""), target.listFolders("")]);
    expect(requests.filter((url) => url.includes("/token"))).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[0]).toEqual(saved.mock.calls[1]);
    expect(saved.mock.calls[1][1]).toBe("new-refresh");
  });
});
