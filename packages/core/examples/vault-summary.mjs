import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { parseMarkdownAst, extractFrontmatter, scanTasks } from '@plainva/core';
import { LocalVaultAdapter } from '@plainva/core/node';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: node vault-summary.mjs <existing-vault-folder>');
const vault = new LocalVaultAdapter(path.resolve(folder));
const notes = [];
// Reading a supplied existing directory needs no initialization or migration.
for (const file of await vault.listDir('', true)) {
  if (file.isDirectory || !file.path.toLowerCase().endsWith('.md')) continue;
  const text = await vault.readTextFile(file.path);
  const frontmatter = extractFrontmatter(parseMarkdownAst(text));
  notes.push({ path: file.path, properties: frontmatter.success ? frontmatter.data : null, tasks: scanTasks(text).length });
}
console.log(JSON.stringify(notes, null, 2));
