# dbw architecture

A VS Code extension, built as a set of parts that do not know each other,
so that each kind of change is a new file rather than an edit to an old one.

## The seams

Open for extension, closed for modification, at four places.

**Drivers.** `DriverPlugin` in `packages/core` is the whole contract for
reaching a database: a connection schema for the form, `connect`, and a
`Connection` that can `query`, list `roots` and `children` for the explorer,
and list `objects` for completion. The built-in drivers are ordinary
plugins; the extension registers them the same way it registers ones from
`dbw.driverModules` or from other extensions through the exported API.
Nothing outside a driver names a database. A driver may use explorer node
kinds of its own and give them an `icon`; the explorer has icons for the
common kinds and asks the node for any other.

**Dialects.** `Dialect` is the whole contract for spelling SQL, and all of
it is behaviour: `quoteIdentifier`, `qualify`, `selectFrom`, `split` (a
script into statements with positions) and `format`, plus the keywords and
functions the editor should offer. A dialect that does any of these
differently supplies a function; nothing else in dbw changes, because
nothing else in dbw knows how splitting or formatting is done.
`defineDialect` builds one from a few facts (a quoting style, a limit
style, a splitter flavour, a formatter language) and it is the only place
that knows `dbgate-query-splitter` and `sql-formatter`. `genericDialect`
serves editors bound to nothing. A driver carries its dialect; a generic
driver (ODBC, say) can let each connection choose one by id.

**Query languages.** `QueryLanguage` is the contract for an editor that
holds something other than SQL: `compile(text, dialect)` gives the SQL the
connection receives, and optionally `split`, `format`, keywords and
functions. PRQL is built in: `packages/language-prql` wraps prqlc, which
arrives as WebAssembly in prql-js and is copied into `dist/prql` at build
time, then loaded on first use. The runner compiles before it runs and the
history keeps the SQL; completion and hover work on the connection's schema
as they do for SQL. Nothing else in dbw knows PRQL exists.

**Features.** Inside the extension, each feature is a module exporting one
function `(dbw: Dbw) => Disposable`. The `Dbw` object is the set of shared
services and nothing more. `extension.ts` is the composition root: it
builds the services, registers the built-in drivers, calls each feature in
a list, and owns every disposable. Features do not import each other; they
meet through the services and through VS Code commands.

```
packages/core            the two contracts, defineDialect, genericDialect
packages/driver-*        one plugin each: sqlite, postgres, mssql
packages/language-prql   PRQL, compiled to the connection's dialect by prqlc
packages/extension/src
  extension.ts           composition root; the only file that knows every part
  dbw.ts                 the Dbw services object and the Feature type
  registry.ts            drivers and dialects, and which dialect a connection speaks
  connections/           ProfileStore (settings + secrets), the form from a schema, Sessions
  explorer.ts, history.ts, binding.ts     tree providers and the editor-to-connection binding
  query/                 protocol (shared with the page), statements, run, results, serialize
  intellisense/          analyze (pure), providers (completion, hover, format)
  features/              connections, explorer, history, query, intellisense
packages/extension/media/results.ts     the results page: views over AG Grid, in a webview
```

## Services

- `Registry`: drivers and dialects by id; `dialectFor(profile)`.
- `ProfileStore`: saved connections in user settings, secrets in
  `SecretStorage` keyed by connection and field.
- `Sessions`: one open `Connection` per profile, opened on first use; the
  schema for completion, fetched once per connection, kept as a resolved
  value beside its promise so completion can read it without waiting, and
  refreshed on demand.
- `Binding`: which connection each SQL editor talks to; the status bar item.
- `History`: what was run, in global state; also its tree provider.
- `Results`: the results panel of each editor, given to the runner.

Every service that subscribes to VS Code events is a `Disposable` owned by
the composition root.

## The results page

`query/protocol.ts` is the wire between the extension and the page, and
both sides import it, so they cannot drift without a compile error. On the
page, a run is a list of `View`s: a grid per result set and the messages.
A view has a tab, toolbar actions, and `mount`, which returns its teardown.
A new kind of view (a chart, a plan) is a new `View` added to `viewsFor`.

## What is deliberately pure

`packages/core`, `intellisense/analyze.ts`, `query/statements.ts` and
`query/serialize.ts` import nothing from VS Code, and that is where the
tests are. The analyzer reads the shape of a statement (clause, tables,
aliases) without a parser, because completion needs an answer while the
statement is half typed.

## Reused

`dbgate-query-splitter` (statements, batches, `GO`, `$$`), `sql-formatter`
(formatting per dialect), `ag-grid-community` (the grid), `pg`, `mssql`,
and `node:sqlite`. Everything is bundled by esbuild into two files, so the
packaged extension ships no `node_modules`.

## Adding things

- A database: a new `packages/driver-*`, one line in `extension.ts`, or
  nothing at all if it is loaded from settings or another extension.
- A dialect for an existing generic driver: `registerDialect`.
- A query language: a `QueryLanguage` and `registerLanguage`, plus a
  `contributes.languages` entry if VS Code does not know the language yet.
- A feature (say, an execution plan viewer): one file in `features/`, one
  line in the list. It gets the services; it does not touch other features.
- A results view (say, a chart): a `View` in `media/results.ts`; the
  runner and the protocol do not change unless the view needs new data.

## Shape

Indicated by the PRD: a microkernel with plugins (a host that knows no
SQL, plus driver and dialect plugins), ports and adapters at the driver
boundary, a registry and feature modules inside the host. That is the
shape on disk. An architecture review on 2026-09-21 found the dialect seam
leaky (enum tags where behaviour belonged), a dead schema cache, services
never disposed, a static panel map, a duplicated wire protocol and a
monolithic results renderer; all of those were fixed the same day and the
description above is of the code after the fixes.
