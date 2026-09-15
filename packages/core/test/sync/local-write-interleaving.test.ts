import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { realSqlite } from "../helpers/realSqlite.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const hash = async (text: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");

describe("worker and local save interleavings", () => {
  it("preserves a local save made while a pulled write is in flight", async () => {
    const root = await mkdtemp(join(tmpdir(), "plainva-write-race-"));
    cleanups.push(async () => {
      if (!resolve(root).startsWith(resolve(tmpdir()) + "\\") && !resolve(root).startsWith(resolve(tmpdir()) + "/")) throw new Error("Unexpected fixture path");
      await rm(root, { recursive: true, force: true });
    });
    const vault = new LocalVaultAdapter(root); await vault.initialize();
    const db = await realSqlite(); cleanups.push(() => db.close());
    const repo = new SyncStateRepository(db);
    const initial = "# Note\n\nBase text\n";
    const remote = "# Note\n\nRemote edit\n";
    const local = "# Note\n\nLocal edit\n";
    await vault.writeTextFile("note.md", initial);
    await repo.updateLocalHashAndBaseText("note.md", await hash(initial), initial);
    await repo.updateBaseState("note.md", await hash(initial), "v1");
    const editor = new ConflictAwareVaultAdapter(vault, repo);
    const queue = { hasPendingStructuralOp: async () => false, queueWrite: async () => {} };
    const worker = new SyncWorker({} as never, { download: async () => new TextEncoder().encode(remote) } as never, repo, vault, queue as never);
    cleanups.push(() => worker.stopAndDrain());
    const entry = worker as unknown as { isRunning: boolean; reconcilePulledFile(path: string, etag: string, state: unknown, now: number, changed: string[]): Promise<void> };
    entry.isRunning = true;
    let entered!: () => void, release!: () => void;
    const atWrite = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const write = vault.writeTextFile.bind(vault);
    vi.spyOn(vault, "writeTextFile").mockImplementation(async (path, text) => {
      if (path === "note.md" && text === remote) { entered(); await held; }
      await write(path, text);
    });
    const pulling = entry.reconcilePulledFile("note.md", "v2", await repo.getSyncState("note.md"), Date.now(), []);
    await atWrite;
    const saving = editor.writeTextFile("note.md", local);
    // Let the competing save enter its asynchronous read/check/write path.
    await new Promise(resolve => setTimeout(resolve, 30));
    release();
    await Promise.allSettled([pulling, saving]);
    const contents = await Promise.all((await readdir(root)).filter(name => name.endsWith(".md")).map(name => vault.readTextFile(name)));
    expect(contents.some(text => text.includes("Local edit"))).toBe(true);
    expect(contents.some(text => text.includes("Remote edit"))).toBe(true);
  });
});
