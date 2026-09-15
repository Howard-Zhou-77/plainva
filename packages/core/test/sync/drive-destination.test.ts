import { describe, expect, it, vi } from "vitest";
import { DriveSyncTarget, readDriveFolderSelection } from "../../src/sync/DriveSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";

const mime = "application/vnd.google-apps.folder";
function fixture(folderId?: string) {
  const fetch: FetchFn = vi.fn(async (url, init) => {
    expect(init?.method).toBe("GET");
    const u = new URL(String(url));
    if (u.pathname.endsWith("/missing")) return new Response("missing", { status: 404 });
    if (!u.searchParams.has("q")) return Response.json({ id: u.pathname.split("/").pop(), name: "Vault", mimeType: mime, trashed: false });
    if (u.searchParams.get("q")!.startsWith("name=")) return Response.json({ files: [{ id: "first", name: "Vault" }, { id: "second", name: "Vault" }] });
    expect(u.searchParams.get("pageSize")).toBe("100");
    return Response.json({ files: [{ id: "note", name: "Known note.md", mimeType: "text/markdown", modifiedTime: "2026-09-14T10:00:00Z" }], nextPageToken: "more" });
  });
  const target = new DriveSyncTarget({ clientId: "client", clientSecret: "test", refreshToken: "refresh", accessToken: "access", rootFolderName: "Vault", rootFolderId: folderId }, fetch);
  return { target, fetch };
}

describe("explicit Drive destinations", () => {
  it("refuses an ambiguous historical name and creates nothing", async () => {
    await expect(fixture().target.previewConfiguredFolder()).rejects.toThrow("several folders");
  });
  it("previews the exact selected id with bounded metadata and keeps a continuation", async () => {
    const { target, fetch } = fixture("second");
    await expect(target.previewConfiguredFolder()).resolves.toMatchObject({ id: "second", items: [{ name: "Known note.md", folder: false }], nextPageToken: "more" });
    expect(fetch).toHaveBeenCalledTimes(2);
    await target.previewFolder("second", "more");
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain("pageToken=more");
  });
  it("fails closed when an explicitly selected root disappeared", async () => {
    const { target, fetch } = fixture("missing");
    await expect(target.pull()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps historical string settings readable but refuses corrupt selections", () => {
    expect(readDriveFolderSelection("Vault")).toBeNull();
    expect(readDriveFolderSelection({ path: "Vault", id: "second" })).toEqual({ path: "Vault", id: "second" });
    expect(() => readDriveFolderSelection({ path: "Vault", id: "" })).toThrow();
  });
  it.each([undefined, "cursor"])("refuses a cached root that disappears before the next pull (%s)", async (cursor) => {
    let gone = false;
    const fetch: FetchFn = vi.fn(async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/chosen")) return gone
        ? new Response("missing", { status: 404 })
        : Response.json({ id: "chosen", name: "Vault", mimeType: mime, trashed: false });
      return Response.json({ files: [{ id: "note", name: "Keep.md", mimeType: "text/markdown", md5Checksum: "hash" }] });
    });
    const target = new DriveSyncTarget({ clientId: "client", clientSecret: "test", refreshToken: "refresh", accessToken: "access", rootFolderId: "chosen" }, fetch);
    expect((await target.pull()).etagMap.get("Keep.md")).toBe("hash");
    gone = true;
    vi.mocked(fetch).mockClear();
    await expect(target.pull(cursor)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/chosen?");
  });
});
