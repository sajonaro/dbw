# Working on dbw

This is for people changing dbw or adding a database to it. If you only
want to use it, the [README](README.md) is enough.

## How it is put together

![How dbw is put together](docs/architecture.svg)

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
Extension Development Host. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
parts in detail and where to add things.

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

Publishing to the Marketplace is currently done by hand: download the
`.vsix` from the GitHub release and upload it under the `sajonaro` publisher
at marketplace.visualstudio.com/manage. Setting a `VSCE_PAT` secret with the
*Marketplace: Manage* scope would make the Release workflow do it instead.
