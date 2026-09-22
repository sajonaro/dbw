# dbw

Query your databases without leaving VS Code. Browse tables in the sidebar,
write SQL in a normal editor with completion from your real schema, and see
the results in a grid beside it.

Works with **SQLite**, **PostgreSQL** and **SQL Server** out of the box, and
lets you write [PRQL](https://prql-lang.org/) against any of them.

## What you get

- **Object explorer.** Every connection in the sidebar: schemas, tables,
  views, columns with their types, functions and stored procedures.
- **Query editors that know where they run.** Any `.sql` or `.prql` file is
  bound to a connection. The status bar shows which one; click it to switch.
- **Results grid beside the editor.** One tab per result set, a Messages tab
  for row counts, timings and errors. Sort and filter columns, copy cells or
  rows, export to CSV, copy as JSON.
- **IntelliSense from your schema.** Completion for tables, the columns of
  the tables in your statement, and what `alias.` expands to. Hover a table
  to see its columns. Format Document uses the right formatter for the
  dialect.
- **Query history.** Everything you ran, with the connection it ran on.
  Click to open it again.
- **Passwords stay out of settings.** They are kept in VS Code's secret
  storage; the rest of the connection lives in your settings so it syncs.

## Install

Search for **dbw** in the Extensions view, or run `ext install sajonaro.dbw`.

To install a release by hand, download `dbw-<version>.vsix` from the
[releases page](https://github.com/sajonaro/dbw/releases) and use
*Extensions view → … → Install from VSIX*, or:

```sh
code --install-extension dbw-<version>.vsix
```

This also works for code-server and for VS Code connected to WSL or a
remote machine.

## Quick start

1. Click the **dbw** icon in the activity bar and choose **Add Connection**.
2. Pick a database type and fill in the form.
   - SQLite: the path to the file, or `:memory:`.
   - PostgreSQL: host, port, database, user, password, SSL on or off.
   - SQL Server: server, port, database, user, password, encryption.
3. Expand the connection. Right-click a table for **Select Top Rows**, or
   choose **New Query** to open an editor bound to it.
4. Write a statement and press `Ctrl+Enter`.

## SQL and PRQL in one minute

**Open a file.** `.sql` or `.prql`. The status bar shows the connection it
runs on; click it or press `Ctrl+Alt+C` to change.

**Run it.**

| Keys         | SQL                              | PRQL                          |
| ------------ | -------------------------------- | ----------------------------- |
| `Ctrl+Enter` | Statement under the cursor       | The whole file                |
| `F5`         | Whole file, one tab per statement | The whole file               |

A selection always wins over both. SQL Server batches split on `GO`.

**Read the results.** One tab per result set, plus Messages. `Ctrl+C` copies
the selected cells or rows. **Export CSV** and **Copy as JSON** are in the
toolbar.

**SQL** is the dialect of the connection, sent as is. Completion knows your
tables, their columns, and what `alias.` means; hover a table for its
columns; Format Document uses the dialect's formatter.

**PRQL** is compiled to the connection's SQL before it runs. Each line
transforms the result of the line above. **Show Compiled SQL** in the editor
title shows what was sent.

```prql
from o=orders
join c=customers (o.customer_id == c.customer_id)
filter o.ship_country == "Germany"
group {c.company_name} (aggregate {orders = count o.order_id})
sort {-orders}
take 10
```

`from` a table, `join` with an explicit condition (alias both sides), `filter`
rows, `derive` a column, `group` then `aggregate`, `sort` with `-` for
descending, `take` a count or a range like `10..20`, `select` the output
columns. Strings use double quotes.

## Commands

All of these are in the Command Palette under **dbw**, and most are also in
the sidebar and editor context menus.

- Add, Edit, Remove Connection; Connect; Disconnect; Refresh
- New Query; Select Top Rows; Copy Name; Insert Name into Editor
- Run Statement (or Selection); Run All (or Selection); Show Results
- Use Connection for This Editor; Refresh IntelliSense Schema
- Show Query History; Clear Query History; Open in New Query
- Show Compiled SQL (PRQL editors)

## Settings

| Setting              | Default | What it controls                                   |
| -------------------- | ------- | -------------------------------------------------- |
| `dbw.selectTopLimit` | 100     | Rows that **Select Top Rows** asks for             |
| `dbw.maxRowsShown`   | 10000   | Rows kept per result set in the grid               |
| `dbw.history.limit`  | 200     | How many queries to remember                       |
| `dbw.connections`    | `[]`    | Saved connections (passwords are stored separately) |
| `dbw.driverModules`  | `[]`    | Extra database drivers to load, as module paths    |

## Adding more databases

dbw is built so that a new database is a plugin, not a change to dbw. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how drivers, dialects and query
languages are registered, and [ARCHITECTURE.md](ARCHITECTURE.md) for how the
parts fit together.

## Not yet

Query cancellation, editing rows in the grid, and DDL helpers are not part
of this release.

## Feedback

Bugs and requests: [issues](https://github.com/sajonaro/dbw/issues).
