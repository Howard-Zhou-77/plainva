import type { ISyncTarget } from "./ISyncTarget.js";

interface Entry { bytes: Uint8Array; etag: string }
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 128;
const strongEtag = (value: string | undefined) => !!value && value.length <= 512 && /^"[\x21\x23-\x7e\x80-\uffff]*"$/.test(value);

/** A single GET/304, never an extra stat request just to avoid a small GET. */
export class SidebandReadCache {
  private entries = new Map<string, Entry>();
  private target: ISyncTarget | null = null;
  readonly transfers = { requests: 0, bytes: 0, notModified: 0 };

  begin(target: ISyncTarget) {
    if (this.target !== target) { this.entries.clear(); this.target = target; }
    const pending = new Map<string, Entry | null>();
    return {
      read: async (path: string, accept: (bytes: Uint8Array | null) => boolean = () => true): Promise<Uint8Array | null> => {
        this.transfers.requests++;
        if (!target.downloadConditional) {
          const bytes = await target.download(path);
          this.transfers.bytes += bytes?.length ?? 0;
          return bytes;
        }
        const cached = this.entries.get(path);
        const response = await target.downloadConditional(path, cached?.etag);
        if (response.notModified) {
          if (!cached || response.etag !== cached.etag) throw new Error("Sideband returned an unbound validator");
          this.transfers.notModified++;
          return new Uint8Array(cached.bytes);
        }
        this.transfers.bytes += response.bytes?.length ?? 0;
        pending.set(path, response.bytes && strongEtag(response.etag) && accept(response.bytes) ? { bytes: new Uint8Array(response.bytes), etag: response.etag! } : null);
        return response.bytes;
      },
      /** Call only after validation AND durable local processing succeeded. */
      commit: () => {
        for (const [path, entry] of pending) {
          this.entries.delete(path);
          if (entry && entry.bytes.length <= MAX_BYTES) this.entries.set(path, entry);
        }
        let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
        while (this.entries.size > MAX_ENTRIES || bytes > MAX_BYTES) {
          const oldest = this.entries.entries().next().value;
          if (!oldest) break;
          bytes -= oldest[1].bytes.length;
          this.entries.delete(oldest[0]);
        }
      },
    };
  }
}
