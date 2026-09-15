import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import http from 'node:http';

const packageRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const workspace = path.resolve(packageRoot, '../..');
const require = createRequire(import.meta.url);
const npmCli = process.env.npm_execpath;
if (!npmCli || path.basename(npmCli) !== 'npm-cli.js') throw new Error('Use npm --prefix packages/core run smoke:package (the smoke tests npm itself).');
const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const artifactRoot = path.join(workspace, '.cache', 'core-package');
await fs.mkdir(artifactRoot, { recursive: true });
const consumer = await fs.mkdtemp(path.join(os.tmpdir(), 'plainva-core-consumer-'));
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
const runNode = (args, cwd, capture = false) => {
  const out = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: capture ? 'pipe' : 'inherit' });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`Command failed (${out.status}): ${args[0]}\n${out.stderr ?? ''}\n${out.stdout ?? ''}`);
  return out.stdout?.trim();
};
const npm = (args, cwd, capture = false) => runNode([npmCli, ...args], cwd, capture);
let browser;
let server;
let bundler;
let success = false;
async function removeConsumer() {
  const expectedPrefix=path.join(os.tmpdir(),'plainva-core-consumer-');
  if(!path.resolve(consumer).startsWith(path.resolve(expectedPrefix)) || path.dirname(consumer)!==path.resolve(os.tmpdir()))throw new Error('Unsafe consumer cleanup path');
  await fs.rm(consumer,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
try {
  runNode(['scripts/build.mjs'], packageRoot);
  assert.equal(await fs.readFile(path.join(packageRoot, 'LICENSE'), 'utf8'), await fs.readFile(path.join(workspace, 'LICENSE'), 'utf8'));
  const [dryRun] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], packageRoot, true));
  assert(dryRun.files.every(file => /^(dist\/|examples\/|LICENSE$|README\.md$|package\.json$)/.test(file.path)));
  assert(!dryRun.files.some(file => /(?:\.test\.|\.spec\.|^src\/)/.test(file.path)));
  for (const entry of ['public', 'node', 'sqlite']) for (const ext of ['js', 'd.ts', 'js.map']) {
    assert(dryRun.files.some(file => file.path === `dist/${entry}.${ext}`), `Missing ${entry}.${ext}`);
  }
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', artifactRoot], packageRoot, true));
  assert.deepEqual(packed.files.map(file => file.path), dryRun.files.map(file => file.path));
  const tarball = path.join(artifactRoot, packed.filename);
  await fs.writeFile(path.join(artifactRoot, 'pack-manifest.json'), JSON.stringify(packed, null, 2) + '\n');
  console.log(`Packed ${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes compressed.`);

  const tsxRequire = createRequire(require.resolve('tsx/package.json'));
  const toolVersions = { typescript: require('typescript/package.json').version, esbuild: tsxRequire('esbuild/package.json').version, '@types/node': require('@types/node/package.json').version };
  await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'plainva-core-isolated-consumer', private: true, type: 'module', dependencies: { '@plainva/core': `file:${tarball.replaceAll('\\', '/')}` }, devDependencies: toolVersions }, null, 2));
  npm(['install', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules', '@plainva', 'core');
  assert(!(await fs.lstat(installed)).isSymbolicLink(), 'Consumer must have the extracted tarball, not a workspace link');
  const isolatedRequire = createRequire(path.join(consumer, 'package.json'));
  for (const peer of ['sqlite', 'sqlite3']) assert.throws(() => isolatedRequire.resolve(peer), { code: 'MODULE_NOT_FOUND' });
  await fs.writeFile(path.join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import * as core from '@plainva/core';
import { LocalVaultAdapter } from '@plainva/core/node';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const text = '---\\nstatus: draft\\n---\\n# Example\\n- [ ] Read\\n';
assert.equal(core.extractFrontmatter(core.parseMarkdownAst(text)).data.status, 'draft');
assert.equal(core.scanTasks(text).length, 1);
assert.equal(core.aggregateRollup({through:'links',of:'hours',fn:'sum'},[1,2]),3);
assert.equal('WorkspaceCryptoSession' in core, false);
assert.equal('SyncWorker' in core, false);
assert.equal('SqliteDatabaseAdapter' in core, false);
const folder = path.resolve('vault'); await fs.mkdir(folder);
await fs.writeFile(path.join(folder,'Example.md'),text);
const vault = new LocalVaultAdapter(folder);
assert.equal(await vault.readTextFile('Example.md'),text);
assert.equal((await vault.listDir('',true)).length,1);
assert.equal(await fs.readFile(path.join(folder,'Example.md'),'utf8'),text);
await assert.rejects(import('@plainva/core/dist/workspace/index.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
console.log('Installed Node API and filesystem adapter passed without SQLite peers.');
`);
  runNode(['smoke.mjs'], consumer);
  const example = runNode([path.join(installed, 'examples', 'vault-summary.mjs'), path.join(consumer, 'vault')], consumer, true);
  assert.equal(JSON.parse(example)[0].tasks, 1);

  await fs.writeFile(path.join(consumer, 'consumer.ts'), `import { parseMarkdownAst, extractFrontmatter, aggregateRollup, type RollupSpec, type IDatabaseAdapter } from '@plainva/core';\nconst spec: RollupSpec = {through:'links',of:'hours',fn:'sum'};\nconst value: number|string|null = aggregateRollup(spec,[1,2]);\nconst result = extractFrontmatter(parseMarkdownAst('# Example'));\nexport type Adapter = IDatabaseAdapter;\nexport {value,result};\n`);
  const tsc = isolatedRequire.resolve('typescript/bin/tsc');
  for (const mode of ['NodeNext', 'Bundler']) {
    const config = { compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022', module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext', moduleResolution: mode, lib: mode === 'NodeNext' ? ['ES2022'] : ['ES2022','DOM'], types: mode === 'NodeNext' ? ['node'] : [] }, files: ['consumer.ts'] };
    await fs.writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify(config));
    runNode([tsc, '-p', 'tsconfig.json'], consumer);
  }
  console.log('Installed declarations passed strict NodeNext and browser/Bundler typechecks.');
  await fs.writeFile(path.join(consumer, 'browser.js'), `import * as core from '@plainva/core'; globalThis.coreSdk=core; document.body.textContent=core.extractFrontmatter(core.parseMarkdownAst('---\\nstatus: browser-ok\\n---\\n')).data.status;`);
  bundler = isolatedRequire('esbuild');
  const bundle = await bundler.build({ absWorkingDir: consumer, entryPoints: ['browser.js'], outfile: 'bundle.js', bundle: true, platform: 'browser', format: 'esm', target: ['chrome111','safari16.4'], metafile: true });
  assert(Object.keys(bundle.metafile.inputs).every(input => !path.resolve(consumer,input).startsWith(workspace + path.sep)), 'Browser package resolution escaped into the monorepo');
  server = http.createServer(async (req,res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(await fs.readFile(path.join(consumer,'bundle.js'))); }
    else if (req.url === '/') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><body><script type="module" src="/bundle.js"></script>'); }
    else { res.statusCode=404; res.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const {chromium} = createRequire(path.join(workspace,'apps','desktop','package.json'))('@playwright/test');
  browser = await chromium.launch({headless:true});
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>globalThis.document.body.textContent==='browser-ok');
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>typeof globalThis.coreSdk.VaultQueryService),'function');
  console.log('Installed browser bundle loaded the full public API and parsed Markdown.');
  await browser.close(); browser=undefined; await new Promise(resolve=>server.close(resolve)); server=undefined;

  // sqlite intentionally does not export its manifest. Read the installed
  // workspace manifests as files instead of bypassing its import contract.
  const peers = await Promise.all(['sqlite', 'sqlite3'].map(async name => {
    const installedManifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'node_modules', name, 'package.json'), 'utf8'));
    return `${name}@${installedManifest.version}`;
  }));
  npm(['install', '--no-audit', '--no-fund', ...peers], consumer);
  await fs.writeFile(path.join(consumer, 'sqlite.mjs'), `import assert from 'node:assert/strict'; import {SqliteDatabaseAdapter} from '@plainva/core/sqlite'; import {initializeSchema,VaultIndexer,VaultQueryService} from '@plainva/core'; import {LocalVaultAdapter} from '@plainva/core/node'; import path from 'node:path'; const db=new SqliteDatabaseAdapter(':memory:'); await db.initialize(); try {await initializeSchema(db); const vault=new LocalVaultAdapter(path.resolve('vault')); await new VaultIndexer(vault,db).indexVaultFull(); const rows=await new VaultQueryService(db).queryDatabaseFiles({columns:{status:{}},views:[{type:'table',name:'Notes'}]}); assert.equal(rows.length,1); assert.equal(rows[0].status,'draft');} finally {await db.close();} console.log('Installed optional SQLite adapter indexed and queried a real note.');`);
  runNode(['sqlite.mjs'], consumer);
  await fs.writeFile(path.join(artifactRoot,'smoke-result.json'),JSON.stringify({version:manifest.version,tarball:packed.filename,integrity:packed.integrity,entryCount:packed.entryCount,compressedBytes:packed.size,unpackedBytes:packed.unpackedSize,node:process.version,checks:['dry-run-files','real-tarball','isolated-install','no-implicit-sqlite','node-api','filesystem-adapter','example','strict-node-types','strict-browser-types','browser-runtime','optional-sqlite']},null,2)+'\n');
  success=true;
  console.log(`Package smoke passed. Review artifacts: ${artifactRoot}`);
} finally {
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  bundler?.stop();
  if(success) {
    await removeConsumer();
  } else console.error(`Consumer retained for diagnosis: ${consumer}`);
}
