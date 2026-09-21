# dbw: product requirements

**Goal.** A database workbench inside VS Code: an object explorer, query
editors, results beside them. Reachable from any VS Code, including code-server in a browser.

**Requirements**

1. Customisable: a new SQL dialect or a new database is added as a plugin,
   without changing dbw. Dialects and drivers are separate plugins.
2. Excellent IntelliSense: completion from the connected schema (tables,
   columns, aliases, schemas), keywords and functions of the dialect, hover
   documentation, formatting per dialect.
3. A useful querying experience: run the statement under the cursor or the
   whole editor, results in a grid with sorting, filtering and export,
   messages and timings, multiple result sets, a query history.
4. Reuse open-source parts wherever one exists (grid, formatter, splitter,
   drivers) rather than writing them.

**Non-goals for v1.** Editing data in the grid, DDL generation, import and
export pipelines, execution plans, query cancellation, an ODBC driver
(needs a native module built per VS Code version; planned as a plugin).

**Quality bar.** Open/closed: features and plugins are added, not edited
in. Pure logic (analysis, splitting, serialisation) is unit-tested; the
rest is thin over VS Code's API.
