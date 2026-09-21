# dbw — a database workbench for VS Code

Query any database from VS Code: an object explorer, an editor that knows
your schema, a results grid beside it. One plugin per dialect and one per
driver, so a new database is a new package, not a change to dbw.

Built in: SQLite (no native build, it uses Node's own), PostgreSQL, SQL Server;
and [PRQL](https://prql-lang.org/) as a query language on any of them.

## Install

**From the VS Code Marketplace.** Search for `dbw` in the Extensions view, or:

```
ext install sajonaro.dbw
```

**From a GitHub release.** Download `dbw-<version>.vsix` from the
[releases page](https://github.com/sajonaro/dbw/releases), then:

```sh
code --install-extension dbw-<version>.vsix
```

or *Extensions view → … → Install from VSIX*. This also works for
code-server and for a VS Code connected to a remote or WSL.

**From git.**

```sh
git clone https://github.com/sajonaro/dbw.git && cd dbw
npm install
npm run package                        # packages/extension/dbw-<version>.vsix
code --install-extension packages/extension/dbw-*.vsix
```

With Docker and no Node at all: `npm run vsix` (or `docker build --target dist
--output out .`) runs the whole gate in a container and leaves the `.vsix`
in `out/`.

## Use it

1. Open the **dbw** view in the activity bar and **Add Connection**. Pick a
   driver; the form is whatever that driver asks for. Passwords go to VS
   Code's secret storage, never to settings.
2. Expand the connection. Click a table for its first rows, or **New Query**.
3. In any `.sql` editor the status bar shows which connection it uses. Click
   it, or press `Ctrl+Alt+C`, to change.
4. `Ctrl+Enter` runs the statement under the cursor; `F5` runs the whole
   editor; a selection wins over both. Results open beside the editor, one
   tab per result set, with a Messages tab. `Ctrl+C` in the grid copies the
   cell, or the selected rows; **Export CSV** and **Copy as JSON** are above it.
5. Completion knows the tables of the bound connection, the columns of the
   tables in the statement, and what `alias.` means. Hover a table for its
   columns. **Format Document** uses the dialect's formatter.
6. **Query History** keeps what you ran; click one to open it again.
7. A `.prql` editor works the same way on any connection: `Ctrl+Enter` compiles
   the PRQL to the connection's SQL dialect and runs it, **Show Compiled SQL**
   opens the SQL beside it, and completion knows PRQL's words and your tables.

## How it is put together

![How dbw is put together](https://raw.githubusercontent.com/sajonaro/dbw/master/docs/architecture.png)

Everything a database or a dialect has to say is said through `@dbw/core`,
the one seam. On its left, the extension: a composition root that builds
the shared services and calls each feature; a registry that looks drivers
and dialects up by id; the results page in a webview on the other side of a
message. On its right, the plugins that implement the contract, and beyond
them the databases they reach. Adding a database or a dialect touches
nothing on the left.

## Add a database

A driver is a module whose default export is a `DriverPlugin` from
`@dbw/core`: a name, a dialect, a JSON Schema for its connection form, and
`connect`, which returns something that can `query`, list `roots` and
`children` for the explorer, and list `objects` for completion.

Three ways to register one:

- **From settings**, no extension needed: build the module and add its path
  to `dbw.driverModules`.
- **From another extension**: `vscode.extensions.getExtension('sajonaro.dbw').exports.registerDriver(plugin)`.
- **Built in**: add it to the list in `packages/extension/src/extension.ts`.

A dialect alone (quoting, keywords, formatter, splitter) is registered the
same way with `registerDialect`; a generic driver can let each connection
pick a dialect by putting `dialect` in its connection schema. A query
language that compiles to SQL, as PRQL does, is a `QueryLanguage` registered
with `registerLanguage`: an id (the VS Code language id), `compile(text,
dialect)`, and optionally `split`, `format` and keywords.

## Develop

```sh
npm install
npm run build        # bundles the extension and the results page
npm test             # the analyzer, the dialect helpers, serialization, the sqlite driver
npm run package      # dbw-<version>.vsix
npm run vsix         # the same, through the Docker gate, into out/
npm run version      # what every manifest says; `-- 0.2.0` or `-- minor` sets them
```

Press F5 in VS Code with `packages/extension` open to run it in an
Extension Development Host. See [ARCHITECTURE.md](https://github.com/sajonaro/dbw/blob/master/ARCHITECTURE.md)
for the parts in detail and where to add things.

## Release

The `Dockerfile` is the CI: `test` is the gate (types, tests, bundle) and
`dist` is the `.vsix`, which only exists if the gate passed. Three workflows:

- **CI** runs the gate on every push and pull request and uploads the `.vsix`.
- **Tag a release** (run it from the Actions tab, give it `0.2.0`, `minor`
  or `patch`) bumps every manifest, commits, and pushes tag `v<version>`.
- **Release** runs on that tag: the gate again, a GitHub release with the
  `.vsix`, and publication to the VS Code Marketplace and Open VSX when the
  `VSCE_PAT` and `OVSX_PAT` secrets are set. Without them the release still
  happens on GitHub only.

Publishing needs a publisher named `sajonaro` on the Marketplace (created
once at marketplace.visualstudio.com/manage) and a personal access token
with the *Marketplace: Manage* scope stored as the `VSCE_PAT` secret.
