import { describe, expect, it } from 'vitest';
import { tarFixture } from '../../../../packages/core/test/import/tarFixture';
import { archiveByteReader, extractTarArchive, unpackSelection } from './importArchive';
import { analyzeSelection } from './importService';
describe('mobile JEX staging', () => {
  it('detects JEX and keeps resources in the Blob until requested', async () => {
    const id = 'a'.repeat(32), data = new Uint8Array([0, 255, 128]);
    const tar = tarFixture([{ path: `${id}.md`, content: `Example\n\nBody\n\nid: ${id}\ntype_: 1` }, { path: `resources/${'b'.repeat(32)}.bin`, content: data }]);
    const blob = new File([tar as unknown as BlobPart], 'example.JEX');
    const { archive, detected } = await analyzeSelection([blob]);
    expect(detected?.id).toBe('joplin');
    expect(archive.files[0].sourceFormat).toBe('jex');
    expect(archive.files[1].bytes).toBeUndefined();
    expect(await archiveByteReader(archive)(archive.files[1].sourcePath!)).toEqual(data);
  });
  it('preserves a textual attachment as original bytes rather than a second note', async () => {
    const text = new TextEncoder().encode('\uFEFF# Attachment\r\n');
    const tar = tarFixture([{ path: 'resources/readme.md', content: text }]);
    const archive = await extractTarArchive(new Blob([tar as unknown as BlobPart]));
    expect(archive.files[0].isText).toBe(false);
    expect(await archiveByteReader(archive)('resources/readme.md')).toEqual(text);
  });
  it('rejects an unsafe archive as a whole and cancels before reading content', async () => {
    const tar = tarFixture([{ path: 'valid.md', content: 'valid' }, { path: '../unsafe', content: 'bad' }]);
    await expect(unpackSelection([new File([tar as unknown as BlobPart], 'unsafe.jex')])).rejects.toThrow('archiveInvalid');
    const controller = new AbortController(); controller.abort();
    await expect(extractTarArchive(new Blob([tar as unknown as BlobPart]), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
