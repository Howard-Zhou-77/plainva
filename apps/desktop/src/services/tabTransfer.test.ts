import { describe, expect, it, vi } from "vitest";
import { TabTransferManager, type TabTransfer } from "./tabTransfer";
const snapshot = (): TabTransfer => ({ id: "one", source: "aux-one", vaultPath: "/vault", path: "Note.md", tab: { history: ["Before.md", "Note.md"], historyIndex: 1, pinned: true }, document: { text: "unsaved", base: "base", shape: null, viewMode: "source", selection: { anchor: 1, head: 4 }, scrollTop: 52 } });
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
describe("tab transfer ownership", () => {
  it("remembers cancellation before a delayed begin arrives", async () => {
    const adopt = vi.fn(async () => {});
    const manager = new TabTransferManager({ persist: async () => {}, adopt });
    expect(manager.cancel("one", "aux-one").status).toBe("canceled");
    expect((await manager.begin(snapshot(), "aux-one")).status).toBe("canceled");
    await manager.whenIdle(); expect(adopt).not.toHaveBeenCalled();
  });
  it("rejects malformed selections without touching either document", async () => {
    const persist = vi.fn(async () => {});
    const manager = new TabTransferManager({ persist, adopt: async () => {} });
    const value = snapshot(); value.document!.selection!.head = -1;
    await expect(manager.begin(value, "aux-one")).rejects.toThrow("selection");
    expect(persist).not.toHaveBeenCalled();
  });
  it("acknowledges only a durably journaled and actually adopted document", async () => {
    const disk = gate(), target = gate();
    const persist = vi.fn(() => disk.promise), adopt = vi.fn(() => target.promise);
    const manager = new TabTransferManager({ persist, adopt });
    await manager.begin(snapshot(), "aux-one");
    expect(manager.status("one", "aux-one").status).toBe("pending");
    expect(adopt).not.toHaveBeenCalled();
    disk.resolve(); await vi.waitFor(() => expect(adopt).toHaveBeenCalledTimes(1));
    expect(manager.status("one", "aux-one").status).toBe("applying");
    expect(manager.cancel("one", "aux-one").status).toBe("applying");
    target.resolve(); await manager.whenIdle();
    expect(manager.status("one", "aux-one").status).toBe("accepted");
    expect(adopt).toHaveBeenCalledWith(snapshot());
  });
  it("answers a lost acknowledgement without applying the tab twice", async () => {
    const adopt = vi.fn(async () => {});
    const manager = new TabTransferManager({ persist: async () => {}, adopt });
    await manager.begin(snapshot(), "aux-one"); await manager.whenIdle();
    expect(await manager.begin(snapshot(), "aux-one")).toEqual({ status: "accepted" });
    expect(adopt).toHaveBeenCalledTimes(1);
    await expect(manager.begin({ ...snapshot(), path: "renamed.md" }, "aux-one")).rejects.toThrow();
    await expect(manager.begin({ ...snapshot(), document: { ...snapshot().document!, text: "different" } }, "aux-one")).rejects.toThrow();
  });
  it("does not adopt after cancellation while the journal is pending", async () => {
    const disk = gate(), adopt = vi.fn(async () => {});
    const manager = new TabTransferManager({ persist: () => disk.promise, adopt });
    await manager.begin(snapshot(), "aux-one");
    expect(manager.cancel("one", "another-window").status).toBe("unknown");
    expect(manager.cancel("one", "aux-one").status).toBe("canceled");
    disk.resolve(); await manager.whenIdle();
    expect(adopt).not.toHaveBeenCalled();
  });
  it.each(["journal", "target"])("retains source ownership when %s fails", async failure => {
    const manager = new TabTransferManager({ persist: async () => { if (failure === "journal") throw Error("disk full"); }, adopt: async () => { throw Error("closed or renamed target"); } });
    await manager.begin(snapshot(), "aux-one"); await manager.whenIdle();
    expect(manager.status("one", "aux-one").status).toBe("failed");
  });
});
