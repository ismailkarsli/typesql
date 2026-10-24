# Writing data

`INSERT`, `UPDATE`, `DELETE` and `MERGE` are checked against the schema like queries. With
`RETURNING`, they have a row type; without it the row type is `never`, and adapters'
`execute()` returns the affected row count.

## INSERT

Value parameters take the column's type, including `| null` for nullable columns. Every
`NOT NULL` column without a default must be listed:

<<< @/snippets/writing-data.ts#insert

```ts
sql("INSERT INTO users (display_name) VALUES ($1)", "Ada");
// … SqlError<"null value in column \"email\" of relation \"users\" violates not-null constraint", 2>
```

JSON values for `json` / `jsonb` columns go through `${sql.json(value)}`, which sends JSON text
with any driver and checks the value against a [`Json<T>`](./schema#typed-json-columns) column.

Also supported: multi-row `VALUES`, `DEFAULT` and `DEFAULT VALUES`, `INSERT … SELECT` (its
columns are checked against the target list), `OVERRIDING … VALUE`, and inserting into a view
is an error. `DEFAULT` is only allowed as a whole `VALUES` item or `SET` value, and not for a
`NOT NULL` column without a default (it would store `NULL`).

## Optional values

A `sql.param(value)` whose value is `undefined` sends `DEFAULT` instead of a parameter. The
column's default stays in the database, so you don't copy it into a `coalesce(…)`:

<<< @/snippets/writing-data.ts#optional-values

The value is checked like any parameter, without `undefined`. When it can be `undefined`, the
statement is checked a second time with `DEFAULT` in its place, so such a value outside a
`VALUES` item or `SET` value, or for a `NOT NULL` column without a default, is an error:

```ts
sql(`INSERT INTO users (email) VALUES (${sql.param(maybeEmail)})`);
// … SqlError<"null value in column \"email\" of relation \"users\" violates not-null constraint
//            (sql.param() sends DEFAULT for undefined)", 4>
sql(`SELECT id FROM users WHERE email = ${sql.param(maybeEmail)}`);
// … SqlError<"DEFAULT is not allowed in this context (sql.param() sends DEFAULT for undefined)", 7>
```

Narrow the value first, or pass `maybeEmail ?? null` to send `NULL`. The second check runs once
per statement, however many such values it has. `sql.fragment(…)` refuses a value that can be
`undefined`: the fragment is checked where it is spliced, with `$n` for its values, so a
`DEFAULT` there could not be checked. `any` and `unknown` values are not checked.

## Partial updates: `sql.set`

`sql.set(table, values)` builds a `SET` list from an object, such as a PATCH body with
optional keys. Keys must be columns of the table and values must fit them (`null` only for
nullable columns, enum values for enums). `undefined` values are skipped:

<<< @/snippets/writing-data.ts#set

- Splice it into `UPDATE … SET {set}` or `ON CONFLICT … DO UPDATE SET {set}`; other
  assignments can follow (`SET {set}, updated_at = now()`).
- The statement is checked with every key of the input type assigned once, so the columns are
  checked again against the table being updated.
- Keys that are not columns are errors, also on a variable whose type has extra keys, because
  they would be sent.
- If no value is defined at runtime, `sql.set` throws: Postgres needs at least one assignment.
  Skip the `UPDATE` (or `SELECT` the row) when the input is empty.

## Bulk inserts: `sql.values`

`sql.values(table, rows)` builds the column list and the `VALUES` rows from objects:

<<< @/snippets/writing-data.ts#values

- `NOT NULL` columns without a default are required in every row; the others are optional.
- The columns are the keys that have a value in any row, in order of first appearance. A
  missing or `undefined` value is `DEFAULT`, so rows with different keys can be mixed.
- One row without any value becomes `DEFAULT VALUES`. An empty array throws, and so do
  several rows without values (Postgres cannot insert them with `VALUES`).
- The statement is checked with every key of the row types once.

The table name is only used for typing, and schema tables are written `"schema.table"`:
`sql.values("auth.sessions", rows)`.

### JSON columns

`sql.set` and `sql.values` pass their values to the driver as parameters, so a JSON value goes
through `sql.json(value)` there too: it is sent as JSON text by both drivers and checked
against a [`Json<T>`](./schema#typed-json-columns) column. A plain object also works as it is;
an array without `sql.json()` is an error, because node-postgres would send it as a Postgres
array:

<<< @/snippets/json.ts#write-helpers

## UPDATE

`SET` columns must exist and values take their types. `UPDATE … FROM` joins more tables, and
`RETURNING` can use all of them:

<<< @/snippets/writing-data.ts#update

Targets can assign an array element or slice, a `jsonb` key or a field of a composite column:
`SET tags[1] = $1`, `SET data['k'] = $1`, `INSERT INTO t (tags[1:2], addr.city)`. The value
takes the element / slice / field type (`unknown` for a composite the schema does not
describe), and subscripting a type without subscripts is an error. `WHERE CURRENT OF cursor`
is accepted; the cursor's row is not checked.

## Upserts

`ON CONFLICT … DO NOTHING` and `DO UPDATE SET … WHERE …` are supported; `EXCLUDED` refers to
the row that was proposed for insertion:

<<< @/snippets/writing-data.ts#upsert

## DELETE

<<< @/snippets/writing-data.ts#delete

`RETURNING *` expands to the target table's columns, or to every table in `FROM`/`USING`, as
in Postgres.

## RETURNING old and new values

As in PostgreSQL 18, `RETURNING` can read the row before (`old`) and after (`new`) the change,
renamed with `RETURNING WITH (OLD AS o, NEW AS n)`. `old` columns are nullable in an `INSERT`
(there is no old row) and `new` columns in a `DELETE`:

```ts
sql("UPDATE users SET email = $1 WHERE id = $2 RETURNING old.email AS was, new.email AS now", "a@b.c", 1);
// Row: { was: string; now: string }
```

## MERGE

`MERGE INTO target USING source ON … WHEN [NOT] MATCHED [BY SOURCE | BY TARGET] [AND …] THEN
…` is checked like the statements its actions resemble: `UPDATE SET` and `INSERT` columns and
values, required columns, parameters typed from their columns. Each `WHEN` clause sees what
Postgres lets it see (`NOT MATCHED` only the source, `NOT MATCHED BY SOURCE` only the target).
`RETURNING` can use both tables, `merge_action()`, `old` and `new`; source columns are nullable
when a `NOT MATCHED BY SOURCE` action returns rows:

```ts
sql(`MERGE INTO accounts a USING deltas d ON a.id = d.sid
     WHEN MATCHED THEN UPDATE SET balance = a.balance + d.delta
     WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (d.sid, d.delta)
     RETURNING merge_action() AS action, a.id, new.balance`);
// Row: { action: string; id: number; balance: string }
```

## Data-modifying CTEs

Statements with `RETURNING` (`MERGE` included) can feed a `WITH` clause:

<<< @/snippets/writing-data.ts#cte
