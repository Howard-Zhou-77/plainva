import { describe, it, expect } from 'vitest';
import { tarFixture } from '../../../../packages/core/test/import/tarFixture';
import { readStagedTar } from './importArchive';
function fixture(bytes: Uint8Array) {
  const opened: string[] = []; let closed = 0;
  const fs = { SeekMode: { Start: 0 }, open: async (path: string) => {
    opened.push(path); let cursor = 0;
    return { seek: async (offset: number) => { cursor = offset; }, close: async () => { closed++; }, read: async (buffer: Uint8Array) => {
      const n = Math.min(buffer.length, 317, bytes.length - cursor);
      buffer.set(bytes.subarray(cursor, cursor + n)); cursor += n; return n;
    } };
  } };
  return { fs, opened, closed: () => closed, result: { root: '/private/stage', entries: [], skipped: [], total_bytes: bytes.length } };
}
describe('desktop JEX staging port', () => {
  it('decodes note slices and reads original attachments from the private snapshot', async () => {
    const image = new Uint8Array([0, 255, 128, 0]);
    const f = fixture(tarFixture([{ path: 'one.md', content: '# Unicode ü🙂' }, { path: 'resources/image.png', content: image }]));
    const archive = await readStagedTar(f.result, {}, f.fs);
    expect(archive.files[0].content).toBe('# Unicode ü🙂');
    expect(f.closed()).toBe(1);
    expect(await archive.readSourceBytes!(archive.files[1].sourcePath!)).toEqual(image);
    expect(f.closed()).toBe(2);
    expect(await archive.readSourceBytes!('/user/other-file')).toBeNull();
    expect(f.opened).toEqual(['/private/stage/source.tar', '/private/stage/source.tar']);
  });
  it('closes the staging handle after rejection or cancellation', async () => {
    const f = fixture(tarFixture([{ path: '../bad' }]));
    await expect(readStagedTar(f.result, {}, f.fs)).rejects.toThrow('archiveInvalid');
    expect(f.closed()).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(readStagedTar(f.result, { signal: controller.signal }, f.fs)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.closed()).toBe(2);
  });
});
