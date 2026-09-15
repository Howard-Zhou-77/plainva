import { describe, it, expect } from 'vitest';
import { readTarEntries, JEX_LIMITS } from '../../src/import/tarArchive.js';
import { tarFixture } from './tarFixture.js';
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: async (at: number, length: number) => bytes.slice(at, at + length) });
describe('bounded JEX TAR reader', () => {
  it('reads regular entries with dates in slices, including empty resources', async () => {
    const bytes = tarFixture([{ path: 'resources/', type: '5' }, { path: 'one.md', content: 'ü🙂' }, { path: 'resources/empty.bin' }]);
    const ranges: number[] = [], progress: number[] = [];
    const entries = await readTarEntries({ size: bytes.length, read: async (at, length) => { ranges.push(length); return bytes.slice(at, at + length); } }, { onProgress: n => progress.push(n) });
    expect(entries.map(e => e.relativePath)).toEqual(['one.md', 'resources/empty.bin']);
    expect(new TextDecoder().decode(bytes.slice(entries[0]!.offset, entries[0]!.offset + entries[0]!.size))).toBe('ü🙂');
    expect(entries[0]!.mtimeMs).toBeGreaterThan(0);
    expect(Math.max(...ranges)).toBeLessThanOrEqual(65536);
    expect(progress[progress.length - 1]).toBe(100);
  });
  it.each(['../evil.md', 'a/../../x', 'C:/x', '/abs', '..\\x', 'a/./x', 'a//x', 'CON.txt', 'a:stream', 'a.'])('refuses unsafe portable path %s', async path => {
    await expect(readTarEntries(source(tarFixture([{ path }])))).rejects.toThrow('archiveInvalid');
  });
  it.each(['1', '2', '3', '4', '6', 'S', 'x', 'g', 'L'])('refuses special/link/extension type %s', async type => {
    await expect(readTarEntries(source(tarFixture([{ path: 'x', type }])))).rejects.toThrow('archiveInvalid');
  });
  it.each([['a.md', 'a.md'], ['A.md', 'a.md'], ['é.md', 'é.md'], ['file', 'file/child'], ['file/child', 'file']])('refuses ambiguous archive paths %s / %s', async (one, two) => {
    await expect(readTarEntries(source(tarFixture([{ path: one }, { path: two }])))).rejects.toThrow('archiveInvalid');
  });
  it('rejects damaged checksums, short bodies, trailing hidden archives and missing terminators', async () => {
    const corrupt = tarFixture([{ path: 'a', content: 'note' }]); corrupt[0] ^= 1;
    await expect(readTarEntries(source(corrupt))).rejects.toThrow('archiveInvalid');
    await expect(readTarEntries(source(tarFixture([{ path: 'a', declaredSize: 4096 }])))).rejects.toThrow('archiveInvalid');
    const footer = tarFixture([{ path: 'a' }]); footer[footer.length - 1] = 1;
    await expect(readTarEntries(source(footer))).rejects.toThrow('archiveInvalid');
    await expect(readTarEntries(source(tarFixture([{ path: 'a' }]).slice(0, -512)))).rejects.toThrow('archiveInvalid');
  });
  it('checks ceilings before payload allocation and aborts between reads', async () => {
    await expect(readTarEntries(source(tarFixture([{ path: 'large', declaredSize: JEX_LIMITS.maxEntryBytes + 1 }])))).rejects.toThrow('archiveTooLarge');
    await expect(readTarEntries(source(tarFixture([{ path: 'a' }, { path: 'b' }])), {}, { ...JEX_LIMITS, maxEntries: 1 })).rejects.toThrow('archiveTooLarge');
    const controller = new AbortController(), bytes = tarFixture([{ path: 'a' }, { path: 'b' }]);
    await expect(readTarEntries({ size: bytes.length, read: async (at, length) => { controller.abort(); return bytes.slice(at, at + length); } }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
