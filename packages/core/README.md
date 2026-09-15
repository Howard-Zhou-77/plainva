# Plainva Core

`@plainva/core` provides Markdown, frontmatter, links, tasks and indexed vault queries for local-first tools. The initial distributable SDK is **0.1.0-alpha.1**, independent of the app version. Its public API is experimental: pin an exact version and review changes before upgrading. Preparing this package does not publish it to npm.

## Install the reviewed archive

Use Node.js 22 or later and an ESM project (`"type": "module"`). The package has no CommonJS entry point.

```sh
npm install /absolute/path/plainva-core-0.1.0-alpha.1.tgz
```

The archive is produced by the package smoke below. After an explicitly authorized registry publication, the equivalent registry command is `npm install --save-exact @plainva/core@0.1.0-alpha.1`. Do not assume that version already exists on npm.

```js
import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString, scanTasks } from '@plainva/core';

const note = '---\nstatus: draft\n---\n# Example\n- [ ] Read\n';
const properties = extractFrontmatter(parseMarkdownAst(note));
if (properties.success) console.log(properties.data.status);
console.log(scanTasks(note));
// Returns text; it does not write or migrate a vault.
const edited = updateFrontmatterString(note, { status: 'ready' });
```

## Entry points

| Import | Environment | Contents |
| --- | --- | --- |
| `@plainva/core` | Node or a browser bundler | Markdown/metadata/AST utilities, source positions, task and link helpers, conflicts, rollups, schema, adapter interfaces, index/query/graph services |
| `@plainva/core/node` | Node | `LocalVaultAdapter` for a local directory |
| `@plainva/core/sqlite` | Node, with optional peers installed | `SqliteDatabaseAdapter` |
| `@plainva/core/package.json` | Package tooling | Version and manifest |

The browser entry contains no filesystem or SQLite driver imports. Cloud provider authentication, sync workers and workspace encryption are app-internal and are not part of this SDK contract. Deep imports into `dist` or `src` are unsupported. JavaScript, declarations and source maps are included; raw TypeScript entry points are not published.

## Read an existing directory

```js
import { LocalVaultAdapter } from '@plainva/core/node';

const vault = new LocalVaultAdapter('/absolute/path/to/notes');
for (const entry of await vault.listDir('', true)) {
  if (!entry.isDirectory && entry.path.endsWith('.md')) {
    console.log(entry.path, await vault.readTextFile(entry.path));
  }
}
```

Reading a supplied existing directory needs no `initialize()`, migration or template creation. The packaged `examples/vault-summary.mjs` uses this read-only route:

```sh
node node_modules/@plainva/core/examples/vault-summary.mjs /absolute/path/to/notes
```

## Optional SQLite adapter

The default import works without SQLite. Install both optional peers explicitly when using the SQLite subpath; `sqlite3` needs a compatible native binary or local build tools.

```sh
npm install sqlite@^5.1.1 sqlite3@^6.0.1
```

```js
import { initializeSchema, VaultIndexer, VaultQueryService } from '@plainva/core';
import { LocalVaultAdapter } from '@plainva/core/node';
import { SqliteDatabaseAdapter } from '@plainva/core/sqlite';

const db = new SqliteDatabaseAdapter(':memory:');
await db.initialize();
try {
  await initializeSchema(db);
  const vault = new LocalVaultAdapter('/absolute/path/to/notes');
  await new VaultIndexer(vault, db).indexVaultFull();
  const rows = await new VaultQueryService(db).queryDatabaseFiles({
    columns: { status: {} }, views: [{ type: 'table', name: 'Notes' }],
  });
  console.log(rows);
} finally {
  await db.close();
}
```

`IVaultAdapter` and `IDatabaseAdapter` are available for custom ports. The database schema and query services expect SQLite SQL with FTS5; implementing the interface on an unrelated SQL engine is not sufficient. Persistent adapters must preserve schema migrations and transaction semantics. The in-memory example creates only a disposable index and leaves source notes unchanged.

The optional peers also appear in devDependencies because the package's own tests exercise the real SQLite adapter; this does not make the drivers a runtime dependency of the default entry point.

## Build and verify

From the repository root:

```sh
pnpm --filter @plainva/core build
npm --prefix packages/core run smoke:package
```

The smoke builds the package, checks its license and dry-run file list, creates a real tarball, installs it in a fresh directory outside the monorepo, and verifies Node imports, the read-only example, strict Node and browser declarations, a real browser bundle, and optional SQLite indexing. It first verifies that SQLite is absent, then installs the peers separately. CI runs this same check. The consumer is removed after success; a failed consumer is retained for diagnosis.

Review `.cache/core-package/pack-manifest.json`, `smoke-result.json` and the tarball. The manifest includes every shipped file and archive integrity. Before publishing, confirm the version, reviewed archive, npm identity and access to the `@plainva` scope. Publication is a separate explicit operation, never an app-build or commit side effect. The configured prerelease tag is `next`; no automatic `latest` promotion is configured.

Workspace apps deliberately resolve `@plainva/core` to `src/index.ts` through matching exact Vite aliases and TypeScript paths. This keeps internal APIs and HMR available without building this SDK first or loading a second Core instance. External consumers receive only the bounded `src/public.ts` contract through generated `dist/public.js`.

The manifest deliberately makes no package-wide `sideEffects: false` promise. That flag also changes optimization of the workspace's internal source modules; a production check reproduced an invalid cross-chunk class initialization with it. Package metadata changes must pass both apps' production runtime smokes as well as the isolated SDK smoke.

## License

AGPL-3.0-only. The complete license text is included in `LICENSE` and matches the repository license. Dependencies retain their own licenses. An SDK prerelease does not change the project's licensing terms.
