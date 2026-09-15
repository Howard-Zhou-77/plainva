import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(root, 'dist');
// Only the package's generated output may be cleared, on every platform.
if (path.dirname(destination) !== path.resolve(root) || path.basename(destination) !== 'dist') throw new Error('Invalid package output directory');
await fs.rm(destination, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Core JavaScript, declarations and source maps built.');
