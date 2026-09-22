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

## Quick start

1. Click the **dbw** icon in the activity bar and choose **Add Connection**.
2. Pick a database type and fill in the form.
   - SQLite: the path to the file, or `:memory:`.
   - PostgreSQL: host, port, database, user, password, SSL on or off.
   - SQL Server: server, port, database, user, password, encryption.
3. Expand the connection. Right-click a table for **Select Top Rows**, or
   choose **New Query** to open an editor bound to it.
4. Write a statement and press `Ctrl+Enter`.

## Running queries

| Keys           | Does                                                     |
| -------------- | -------------------------------------------------------- |
| `Ctrl+Enter`   | Run the statement under the cursor                       |
| `F5`           | Run the whole editor                                     |
| `Ctrl+Alt+C`   | Choose which connection this editor uses                 |

A selection always wins: if you have text selected, either key runs just
that. Multiple statements produce one results tab each. SQL Server batches
split on `GO`.

In the grid, `Ctrl+C` copies the selected cell or rows. **Export CSV** and
**Copy as JSON** are in the toolbar above it.

## PRQL on any database

Open a `.prql` file, bind it to a connection, and `Ctrl+Enter` compiles the
query to that database's SQL dialect and runs it. **Show Compiled SQL** in
the editor title opens the generated SQL beside your PRQL. Completion knows
PRQL's keywords and your tables.

```prql
from orders
filter status == "open"
group customer_id (aggregate { total = sum amount })
sort { -total }
take 20
```

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

dbw is built so that a new database is a plugin, not a change to dbw. If
you need a driver that is not built in, or want to write one, see the
[project on GitHub](https://github.com/sajonaro/dbw).

## Not yet

Query cancellation, editing rows in the grid, and DDL helpers are not part
of this release.

## Feedback

Bugs and requests: [github.com/sajonaro/dbw/issues](https://github.com/sajonaro/dbw/issues).
