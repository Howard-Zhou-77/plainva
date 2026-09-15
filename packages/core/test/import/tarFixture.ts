/** Portable USTAR fixtures, also consumed by the two shell integration tests. */
export function tarFixture(entries: { path: string; content?: string | Uint8Array; type?: string; declaredSize?: number }[]): Uint8Array {
  const encoder = new TextEncoder(), parts: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512), bytes = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content ?? new Uint8Array();
    const put = (offset: number, value: string) => header.set(encoder.encode(value), offset);
    put(0, entry.path); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
    put(124, (entry.declaredSize ?? bytes.length).toString(8).padStart(11, '0') + '\0');
    put(136, '14740000000\0'); put(148, '        '); put(156, entry.type ?? '0'); put(257, 'ustar\0'); put(263, '00');
    put(148, header.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ');
    parts.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
  }
  parts.push(new Uint8Array(1024));
  const output = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
