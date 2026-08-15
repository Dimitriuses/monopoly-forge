# CI, npm and the lockfile

Why a passing local `npm ci` is not evidence, and the failure that established it.
Consult this when changing a dependency; the rule itself is one line in
[CLAUDE.md](../CLAUDE.md).

---

## A local `npm ci` does not prove CI will install

**Run `npm run verify:install` after any dependency change.** A passing local
`npm ci` is not evidence, because it uses *your* npm, and the lockfile is only
valid for the npm that consumes it.

This broke every CI job once. `npm install -D vitest@latest` brought in vitest 4,
which requires `vite ^6 || ^7 || ^8` while `package.json` pinned `vite ^5`. npm 11
resolved that by nesting a second Vite (the app built on Vite 5 while the tests
ran on a nested Vite 8) and then wrote a lockfile that recorded the nested Vite
but **not** its `esbuild@0.28.1` subtree. npm 11 reinstalls happily from its own
incomplete lockfile; npm 10 — bundled with Node 22, therefore the npm on the
runners — recomputed the tree, found 27 packages absent, and refused with
`Missing: esbuild@0.28.1 from lock file`.

Two rules follow:

- **Keep dependency majors aligned.** If a dev tool wants a different major of
  something `package.json` already pins, fix the range rather than letting npm
  nest a second copy. Check 3 of `verify:install` fails on exactly that.
- **Node and npm come as a pair.** CI resolves Node from `.nvmrc`
  (`node-version-file`), so the npm major is whatever that Node bundles. Both
  workflows print `node --version && npm --version` before installing.

