import { describe, expect, it, vi } from "vitest";
import { SidebandReadCache } from "../src/sync/sidebandReadCache.js";
import type { ISyncTarget } from "../src/sync/ISyncTarget.js";

describe("sideband conditional reads", () => {
  it.each([undefined, 'W/"v1"', 'not-an-etag', '"bad\r\nheader"'])("does not cache an unreliable validator %s", async etag => {
    const downloadConditional = vi.fn(async () => ({ notModified: false as const, bytes: new Uint8Array([1]), etag }));
    const target = { downloadConditional } as unknown as ISyncTarget, cache = new SidebandReadCache();
    for (let i = 0; i < 2; i++) { const cycle = cache.begin(target); await cycle.read("roster"); cycle.commit(); }
    expect(downloadConditional.mock.calls[1]).toEqual(["roster", undefined]);
  });
  it("saves payload bytes with one request per cycle, and only commits successful processing", async () => {
    let version = '"v1"';
    const body = new TextEncoder().encode("A comment file".repeat(1000));
    const downloadConditional = vi.fn(async (_path: string, etag?: string) => etag === version
      ? { notModified: true as const, etag } : { notModified: false as const, bytes: body, etag: version });
    const target = { downloadConditional } as unknown as ISyncTarget;
    const cache = new SidebandReadCache();
    const failed = cache.begin(target); await failed.read("comments.json");
    const initial = cache.begin(target); await initial.read("comments.json"); initial.commit();
    expect(downloadConditional.mock.calls[1][1]).toBeUndefined();
    const same = cache.begin(target); expect(await same.read("comments.json")).toEqual(body); same.commit();
    expect(cache.transfers).toEqual({ requests: 3, bytes: 2 * body.length, notModified: 1 });
    version = '"v2"';
    const changed = cache.begin(target); await changed.read("comments.json"); changed.commit();
    expect(cache.transfers.bytes).toBe(3 * body.length);
    const next = cache.begin(target); await next.read("comments.json"); next.commit();
    expect(downloadConditional.mock.calls[4][1]).toBe('"v2"');
  });
  it("downloads correctly without validators and does not add metadata requests", async () => {
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const stat = vi.fn();
    const cache = new SidebandReadCache(), target = { download, stat } as unknown as ISyncTarget;
    for (let i = 0; i < 3; i++) { const cycle = cache.begin(target); await cycle.read("roster"); cycle.commit(); }
    expect(download).toHaveBeenCalledTimes(3); expect(stat).not.toHaveBeenCalled();
    expect(cache.transfers).toEqual({ requests: 3, bytes: 9, notModified: 0 });
  });
  it("rejects unbound 304 replies and never shares data across targets", async () => {
    const cache = new SidebandReadCache();
    const first = { downloadConditional: async () => ({ notModified: false, bytes: new Uint8Array([1]), etag: '"v1"' }) } as unknown as ISyncTarget;
    const initial = cache.begin(first); await initial.read("roster"); initial.commit();
    const second = { downloadConditional: async () => ({ notModified: true, etag: '"v1"' }) } as unknown as ISyncTarget;
    await expect(cache.begin(second).read("roster")).rejects.toThrow("unbound validator");
  });
});
