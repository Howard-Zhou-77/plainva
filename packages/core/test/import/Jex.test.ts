import { describe, it, expect } from 'vitest';
import { JoplinImporter } from '../../src/import/adapters/markdownFamily.js';
import { rewriteJexLinks } from '../../src/import/adapters/jex.js';
import { readFrontmatterPath } from '../../src/frontmatter-surgical.js';
import type { ImportOptions, UnpackedFile } from '../../src/import/ImportTypes.js';
const ids = Array.from({ length: 12 }, (_, i) => (i + 1).toString(16).repeat(32));
function item(index: number, type: number, title?: string, body?: string, props: Record<string, string> = {}): UnpackedFile {
  const fields = { id: ids[index], ...props, type_: type };
  return { relativePath: `${ids[index]}.md`, content: [title, body, Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')].filter(v => v !== undefined).join('\n\n') };
}
function fixture() {
  const files = [item(0, 2, 'Work'), item(1, 2, 'Sub', undefined, { parent_id: ids[0]! }), item(2, 2, 'Empty'),
    item(3, 1, 'First', `A body with\n\nid: body text\n\n[Second](:/${ids[4]}) ![image](:/${ids[5]})`, { parent_id: ids[1]!, user_created_time: '2020-02-01T12:30:00.000Z', user_updated_time: '2021-03-02T12:30:00.000Z', unknown_future_field: 'kept' }),
    item(4, 1, 'Second', '- [ ] Existing task 🆔 stable', { parent_id: ids[0]!, is_todo: '1', todo_due: '1600000000000', todo_completed: '0' }),
    item(5, 4, 'Image', undefined, { file_extension: 'png' }), item(6, 5, 'Project X'), item(7, 6, undefined, undefined, { note_id: ids[3]!, tag_id: ids[6]! })];
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
  files.push({ relativePath: `resources/${ids[5]}.png`, content: '', isText: false, byteSize: bytes.length, sourcePath: 'image' });
  const written = new Map<string, string | Uint8Array>(), folders = new Set<string>();
  const opts: ImportOptions = { targetVaultPath: '/vault', targetSubfolder: 'Import Joplin', preserveTimestamps: true,
    readSourceBytes: async () => bytes, vaultAdapter: {
      exists: async (p: string) => written.has(p) || folders.has(p), createDir: async (p: string) => { folders.add(p); },
      writeTextFile: async (p: string, content: string) => { written.set(p, content); },
      writeBinaryFile: async (p: string, content: Uint8Array) => { written.set(p, content); },
    } };
  return { files, bytes, written, folders, opts };
}
describe('Joplin JEX/RAW', () => {
  it('previews source counts and imports notes, empty notebooks, tags, timestamps, IDs and byte-identical resources', async () => {
    const f = fixture(), source = new JoplinImporter();
    expect(await source.detect(f.files)).toBe(true);
    const plan = await source.analyze(f.files, f.opts);
    expect([plan.totalNotes, plan.totalFolders, plan.totalTags, plan.totalAttachments]).toEqual([2, 3, 1, 2]);
    const report = await source.run(f.files, f.opts);
    expect([report.importedNotesCount, report.importedAttachmentsCount, report.degradedCount, report.skippedCount]).toEqual([2, 2, 0, 0]);
    const first = f.written.get('Import Joplin/Work/Sub/First.md') as string;
    expect(first).toContain('[Second](../Second.md)');
    expect(first).toContain(`![image](../../Attachments/Joplin/resources/${ids[5]}.png)`);
    expect(first).toContain('id: body text');
    expect(readFrontmatterPath(first, ['tags'])).toEqual(['Project X']);
    expect(readFrontmatterPath(first, ['created'])).toBe('2020-02-01T12:30:00.000Z');
    expect(readFrontmatterPath(first, ['joplin', 'unknown_future_field'])).toBe('kept');
    expect(f.folders.has('Import Joplin/Empty')).toBe(true);
    expect(f.written.get(`Import Joplin/Attachments/Joplin/resources/${ids[5]}.png`)).toEqual(f.bytes);
    const records = JSON.parse(f.written.get('Import Joplin/_Joplin/Export.json') as string).records;
    expect(records.find((r: {path: string}) => r.path === f.files[3]!.relativePath).content).toBe(f.files[3]!.content);
  });
  it('uses distinct paths for equal titles and rewrites each link to the right ID', async () => {
    const f = fixture(); f.files.push(item(8, 1, 'Second', `first [one](:/${ids[4]})`, { parent_id: ids[0]! }));
    await new JoplinImporter().run(f.files, f.opts);
    expect(f.written.has(`Import Joplin/Work/Second (${ids[8]}).md`)).toBe(true);
    expect(f.written.get(`Import Joplin/Work/Second (${ids[8]}).md`)).toContain('[one](Second.md)');
  });
  it.each(['duplicate', 'cycle', 'wrongParentType', 'encrypted', 'invalidId', 'duplicateResource', 'invalidTag'])('refuses %s before any vault writes', async kind => {
    const f = fixture();
    if (kind === 'duplicate') f.files.push(f.files[0]!);
    if (kind === 'cycle') f.files[0] = item(0, 2, 'Work', undefined, { parent_id: ids[1]! });
    if (kind === 'wrongParentType') f.files[0] = item(0, 2, 'Work', undefined, { parent_id: ids[3]! });
    if (kind === 'encrypted') f.files[3]!.content += '\nencryption_applied: 1';
    if (kind === 'invalidId') f.files[3]!.content = f.files[3]!.content.replace(ids[3]!, 'invalid');
    if (kind === 'duplicateResource') f.files.push({ relativePath: `resources/${ids[5]}.jpg`, content: 'other' });
    if (kind === 'invalidTag') f.files[7]!.content = f.files[7]!.content.replace(ids[6]!, ids[9]!);
    await expect(new JoplinImporter().run(f.files, f.opts)).rejects.toThrow();
    expect(f.written.size).toBe(0); expect(f.folders.size).toBe(0);
  });
  it('keeps a missing resource as an honest incomplete link and retains original records', async () => {
    const f = fixture(); f.files.pop();
    expect((await new JoplinImporter().analyze(f.files, f.opts)).warnings).toContain('import.jexIncomplete');
    const report = await new JoplinImporter().run(f.files, f.opts);
    expect(report.degradedCount).toBe(1);
    expect(f.written.get('Import Joplin/Work/Sub/First.md')).toContain(`![image](:/${ids[5]})`);
  });
  it('refuses an existing destination and keeps it unchanged', async () => {
    const f = fixture(); f.folders.add('Import Joplin');
    await expect(new JoplinImporter().run(f.files, f.opts)).rejects.toThrow('jexFreshTarget');
    expect(f.written.size).toBe(0);
  });
  it('reports a resource read failure while keeping notes and the original target', async () => {
    const f = fixture(); f.opts.readSourceBytes = async () => { throw new Error('test resource unavailable'); };
    const result = await new JoplinImporter().run(f.files, f.opts);
    expect(result.importedNotesCount).toBe(2);
    expect(result.skippedCount + result.degradedCount).toBeGreaterThan(0);
    expect(f.written.get('Import Joplin/Work/Sub/First.md')).toContain(`![image](:/${ids[5]})`);
    expect(f.written.has('Import Joplin/_Joplin/Export.json')).toBe(true);
  });

  it('supports note-only exports whose source notebook was not exported', async () => {
    const f = fixture(); f.files = [item(3, 1, 'Single', 'The body', { parent_id: ids[9]! })];
    expect((await new JoplinImporter().analyze(f.files, f.opts)).warnings).toContain('import.jexMissingFolders');
    const result = await new JoplinImporter().run(f.files, f.opts);
    expect(result.importedNotesCount).toBe(1); expect(f.written.has('Import Joplin/Single.md')).toBe(true);
  });
  it('stops between entries, leaves a report and does not write subsequent notes', async () => {
    const f = fixture(), controller = new AbortController(); f.opts.signal = controller.signal;
    const report = await new JoplinImporter().run(f.files, f.opts, () => controller.abort());
    expect(report.importedNotesCount).toBe(0); expect(report.summaryMarkdown).toContain('stopped');
    expect(f.written.has(report.reportPath)).toBe(true);
  });
  it('only rewrites actual Markdown targets, including references, keeping code unchanged', () => {
    const body = `[x](:/${ids[0]} "Title")\n\n[ref]: :/${ids[0]}\n\n\`[x](:/${ids[0]})\`\n\n\`\`\`\n[x](:/${ids[0]})\n\`\`\``;
    const result = rewriteJexLinks(body, 'A/from.md', new Map([[ids[0]!, 'B/to.md']]));
    expect(result.content).toContain('[x](../B/to.md "Title")');
    expect(result.content).toContain('[ref]: ../B/to.md');
    expect(result.content).toContain(`\`[x](:/${ids[0]})\``); expect(result.missing).toBe(0);
  });

  it('rewrites Joplin HTML resource and note attributes without changing surrounding markup', () => {
    const result = rewriteJexLinks(`<img alt="example" src=":/${ids[0]}"><a href=':/${ids[0]}#heading'>go</a>`, 'A/n.md', new Map([[ids[0]!, 'B/image.png']]));
    expect(result.content).toBe('<img alt="example" src="../B/image.png"><a href=\'../B/image.png#heading\'>go</a>');
    expect(result.missing).toBe(0);
  });
});
