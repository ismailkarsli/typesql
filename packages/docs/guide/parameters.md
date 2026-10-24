# Parameters

Values are always sent as parameters, never pasted into the SQL. There are three ways to
write them, and in all three the parameter's type comes from where it is used.

## Positional: `$1`, `$2`, …

The SQL text is sent as written; the values follow the text as arguments.

<<< @/snippets/parameters.ts#positional

## Named: `:name`

Named parameters are rewritten to `$n` in order of first appearance; the call takes one
object. A name used twice is one parameter. `::` casts and colons inside strings are left
alone.

<<< @/snippets/parameters.ts#named

## Inline: `${sql.param(value)}`

Write the value where it is used. `sql.param()` turns it into a `$n` parameter; it never
becomes part of the text, so hostile input stays harmless.

<<< @/snippets/parameters.ts#inline

The value's TypeScript type is checked against the parameter's type, and a mismatch is a
compile error naming the parameter:

```ts
sql(`SELECT id FROM users WHERE id = ${sql.param("7")}`);
// … SqlError<"parameter $1: a string value cannot be used as int4", 7>

sql(`INSERT INTO users (email) VALUES (${sql.param(maybeEmail /* string | null */)})`);
// … SqlError<"parameter $1: a string | null value cannot be used as text NOT NULL", 8>
```

Strings are accepted for enum columns, and any object for JSON and other object-typed columns
(arrays for JSON go through [`sql.json()`](#json-values)).
With no context (`SELECT ${sql.param(x)}`) anything is accepted.

Inline parameters mix with the other two styles: `$n` and `:name` parameters keep `$1…$k` and
are passed as arguments, inline values are numbered after them, and values carried by
[fragments](./fragments) come last.

A `sql.param()` value can be created ahead of time, but it belongs to one statement: using
the same value in a second statement throws at runtime. Wrap a value you want to reuse in a
[fragment](./fragments), which can be spliced any number of times. `sql.param()` inside quotes
or a comment is an error.

A value that is `undefined` sends `DEFAULT`, and one that can be is only accepted where
`DEFAULT` is; see [Writing data](./writing-data#optional-values).

## A value used more than once

Each `${sql.param(x)}` is its own `$n`, even for the same `x`: the value is sent once per use,
and each use is checked against its own context. Write a value used more than once as a
`:name` (or a `$n`). It is then one parameter, sent once, whose type must fit every use:

<<< @/snippets/parameters.ts#repeated

## JSON values

`${sql.json(value)}` binds a value as JSON. The drivers disagree on what a raw JS value means
for a `json` / `jsonb` parameter: node-postgres sends an array as a Postgres array literal
(which Postgres rejects as JSON) and a string as it is, while postgres.js runs
`JSON.stringify` on every value (so a string you stringified is stored as a JSON string).
`sql.json()` sends the same JSON text with both, and `null` / `undefined` as SQL `NULL`.

It is accepted only where a `json` / `jsonb` value is expected (or with no context, as in
`SELECT ${sql.json(v)}::jsonb`), and for a [`Json<T>` column](./schema#typed-json-columns) the
value is checked against `T`. Because a raw array would not work with node-postgres, passing one
to a JSON parameter with `sql.param()` is an error:

```ts
sql(`UPDATE portfolio SET name = ${sql.json({ a: 1 })}`);
// … SqlError<"parameter $1: a sql.json() value cannot be used as text NOT NULL", 5>

sql(`UPDATE portfolio SET history = ${sql.param(items)}`);
// … SqlError<"parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value)
//    (node-postgres sends a JS array as a Postgres array)", 5>
```

A `json` / `jsonb` positional or named parameter takes no raw array either; pass
`sql.json(value)` as the argument (objects and other values work as they are):

```ts
sql("UPDATE portfolio SET history = $1 WHERE id = $2", sql.json(items), 1);
sql("UPDATE portfolio SET history = :history WHERE id = :id", { history: sql.json(items), id: 1 });

sql("UPDATE portfolio SET history = $1", items);
// Argument of type 'HistoryItem[]' is not assignable to parameter of type 'NonArrayOrSqlJson<HistoryItem[]>'.
```

As an argument, `sql.json(value)` is only checked to be JSON: the value is checked against
`T` when it is written inline (`${sql.json(value)}`), as a `sql.set` / `sql.values` value or
as a `sql.fragment` argument. A plain `jsonb` parameter (typed `unknown`) also refuses objects
with a `length` key; wrap those in `sql.json()`.

## How parameters get their types

| Context | Parameter type |
|---|---|
| `col = $1`, `col > $1`, `$1 = col`, `col IS DISTINCT FROM $1` | the column's type, `\| null` |
| `col LIKE $1`, `col ~ $1` | `text \| null` |
| `col + $1`, `col \|\| $1` | the other operand's type and nullability |
| `INSERT … VALUES ($1)`, `UPDATE … SET col = $1` | the column's type, with `\| null` if the column is nullable |
| `col IN ($1, $2)`, `$1 BETWEEN a AND b` | the column's type for each, `\| null` |
| `col = ANY($1)` | an array of the column's type, `\| null` |
| `LIMIT $1`, `OFFSET $1` | `number \| null` |
| a function argument | the function's parameter type, `\| null` |
| `$1::T` | `T` (a cast wins over context), nullable as the context is; non-null without context |
| `$1 IS NULL`, `$1::T IS NOT NULL` | adds `\| null` to the type the other uses give |
| anywhere else | `unknown` |

<<< @/snippets/parameters.ts#contexts

`null` is accepted wherever Postgres accepts it: `col = NULL` is legal and matches no row,
`LIMIT NULL` means no limit, and every function argument may be NULL. It is rejected only in
an assignment to a `NOT NULL` column (`VALUES`, `SET`), which Postgres would refuse at run time.
A parameter used in several places accepts null only if every use does, so
`UPDATE t SET label = $1 WHERE label <> $1` rejects null for a `NOT NULL` `label`.

Array elements always accept `null`, whatever the nullability of the array: an `int4[]`
parameter takes `(number | null)[]`, so `unnest($1::float8[])` works for bulk inserts with
nullable values.

A parameter accepts the TypeScript type of a result column of its type, plus what the driver
can serialize for that type (the type map's [`$params`](./schema#parameter-types) entry). Under
the node-postgres map `int8` and `numeric` rows are strings, but their parameters take
`number | bigint | string`; `date` and `timestamp[tz]` parameters take `Date | string`:

<<< @/snippets/parameters.ts#inputs

## Only literal SQL is analysed

The SQL text must be a string literal, or a template literal whose substitutions are
compile-time constants (TypeScript folds those into the literal):

<<< @/snippets/parameters.ts#constants

Anything else is rejected, so a value cannot end up in the SQL text by accident:

```ts
sql(`SELECT id FROM users WHERE email = '${userInput}'`);
// … SqlError<"the SQL text is not a string literal: pass values as parameters ($1, :name or
//    ${sql.param(value)}), identifiers with sql.id(), reusable pieces as {slot} fragments,
//    or use sql.as<Row>() for dynamic SQL", 0>
```

Tagged templates (`` sql`…` ``) are not supported: TypeScript does not expose the text of a
tagged template to the type system, so nothing could be inferred from it.
