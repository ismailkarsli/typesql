# API

## `createSql<DB, TypeMap = DefaultTypeMap>(executor?, options?)`

Returns the typed `sql` function for a schema. Pass the adapter's type map (`PgTypeMap`,
`PostgresJsTypeMap`) or use the adapter's pre-bound `createSql`. The optional `executor` is
what the queries' `execute*` methods run on; the adapters' `createSql` take the driver client
instead (`createSql<DB>(pool)`) and add [`sql.transaction(fn)`](#sql-transaction-fn).

```ts
const sql = createSql<DB>();
const camel = createSql<DB>(executor, { rowKeys: "camelCase" }); // Sql<DB, DefaultTypeMap, "camelCase">
```

`options.rowKeys` is `"preserve"` (the default: rows keep Postgres' column names) or
`"camelCase"`: the rows' top-level keys are camelCased with `CamelCasePlugin`'s mapping, in the
row types and in the rows `execute*` return. See [camelCase row keys](../guide/queries#camelcase-row-keys).
`@typesql/pg`, `@typesql/postgres` and `@typesql/kysely` take the same option after the client
(`@typesql/postgres` also takes `bigint: true`, see [postgres.js](../adapters/postgres)).

### `sql.transaction(fn)`

On the `sql` of an adapter (`createSql<DB>(client)`): runs `fn(tx)` inside a transaction, where
`tx` is the same `sql` bound to it. Commits when `fn` resolves and resolves to its result; rolls
back and rethrows when it throws. `tx.transaction(fn)` nests with a savepoint. Rejects when the
`sql` has no client. See [Transactions](../adapters/#transactions).

```ts
const sql = createSql<DB>(pool); // @typesql/pg
const id = await sql.transaction(async (tx) => {
  const { id } = await tx("INSERT INTO users (email) VALUES ($1) RETURNING id", "a@b.c").executeTakeFirstOrThrow();
  await tx("INSERT INTO posts (author_id, title) VALUES ($1, $2)", id, "Hello").execute();
  return id;
});
```

### `sql(text, ...params)`

`text` must be a string literal (or a template literal without substitutions). The
statement is parsed at compile time; the result is

```ts
Query<Row, Params, Text>   // { text: string; values: unknown[] } + phantom types
```

- `Row` is the projected row (`never` for DML without RETURNING and for DDL).
- `Params` is the tuple of parameter types: `WHERE id = $1` → `[number | null]`; INSERT value
  slots take the column type (`| null` when nullable); `LIMIT $1` → `number | null`;
  `$1::T` → `T`; `= ANY($1)` → array (elements accept `null`); a parameter with no context is
  `unknown`. See [Parameters](../guide/parameters#how-parameters-get-their-types).
- `Text` is the final SQL literal (after `:name` rewriting and fragment splicing).

An invalid statement makes the `text` parameter's type an `SqlError<message, tokenIndex>`,
so the error is reported on the SQL text:

```
Argument of type '"SELECT nme FROM users"' is not assignable to parameter of type
  'SqlError<"column \"nme\" does not exist", 1> & "SELECT nme FROM users"'.
```

### Named parameters

`:name` placeholders are rewritten to `$n` in order of first appearance; the call then takes
one object:

```ts
sql("SELECT id FROM users WHERE id = :id AND email = :email", { id: 1, email: "x" });
// text: "SELECT id FROM users WHERE id = $1 AND email = $2", values: [1, "x"]
```

`::` casts, `:=` and colons inside string literals are not parameters. Mixing `:name` and
`$n` in one statement is an error.

### Inline parameters

Values can be written where they are used, inside a template literal, with `sql.param()`:

```ts
const q = sql(`SELECT id, email FROM users
               WHERE id = ${sql.param(userId)} AND email = ${sql.param(email)}`);
// text:   "SELECT id, email FROM users WHERE id = $1 AND email = $2"
// values: [userId, email]
// type:   Query<{ id: number; email: string }, [number, string]>
```

- The value is always sent as a `$n` parameter, never as text. An `undefined` value sends
  `DEFAULT` instead; when the value can be `undefined`, the statement is checked a second time
  with `DEFAULT` in its place, so it only fits a `VALUES` item or a `SET` value. See
  [Optional values](../guide/writing-data#optional-values).
- Each value's TypeScript type is checked against the type its context gives the parameter:
  `${sql.param("5")}` compared with an `int4` column fails with
  `parameter $1: a string value cannot be used as int4 NOT NULL`; a `string | null` value for a
  `NOT NULL` column fails too. Strings are accepted for enum columns and any object for JSON
  (except arrays, see `sql.json()` below), interval and other object-typed columns; with no context (`SELECT ${sql.param(x)}`) anything
  is accepted.
- Inline parameters are numbered after the statement's own parameters: `$n` and `:name`
  parameters keep `$1…$k` and stay call arguments; inline values follow; spliced fragments'
  values come last.
- `sql.param()` inside a quoted string or a comment is a compile error (and a runtime error).
- Tokens are single-use: each `sql.param()` call belongs to one statement. Fragments resolve
  their inline parameters when created, so a fragment can be reused.
- `sql.json(value)` is `sql.param()` for JSON: the value is sent as
  JSON text by every driver (a `JsonParam`, which implements `toPostgres()` for node-postgres and
  `toJSON()` for postgres.js), `null` / `undefined` as SQL `NULL`. It fails unless the parameter
  is `json` / `jsonb` or has no context, and the value is checked against a `Json<T>` column's
  `T`. A `sql.param()` array for a `json` / `jsonb` parameter is rejected
  (`parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value) …`), and so is a
  raw array as a positional or named argument (typed `NonArrayOrSqlJson<T>`): pass
  `sql.json(value)` as the argument, which is sent as JSON text (only checked to be JSON).

Only literal SQL text is analysed. Interpolating anything that is not a compile-time constant
is rejected, so a value can never be pasted into the SQL by accident:

```ts
sql(`SELECT id FROM users WHERE email = '${userInput}'`);
//  error: the SQL text is not a string literal: pass values as parameters ($1, :name or
//         ${sql.param(value)}), identifiers with sql.id(), reusable pieces as {slot}
//         fragments, or use sql.as<Row>() for dynamic SQL
const table = "users";
sql(`SELECT id FROM ${table}`);   // fine: a const is folded into the literal
```

Tagged templates (`` sql`…` ``) are not supported: TypeScript erases the text of a tagged
template from the types (TypeScript issue #33304), so nothing could be inferred.

### Fragments

```ts
const where = sql.fragment("WHERE u.id = $1", 7);          // Fragment<"WHERE u.id = $1", [unknown]>
const q = sql("SELECT u.id FROM users u {where}", { where });
// Query<{ id: number }, [number], "SELECT u.id FROM users u WHERE u.id = $1">
```

- `{name}` slots are replaced before inference; the fragment's `$n` are renumbered to follow
  the outer parameters (outer values first, then fragment values in order of appearance).
  Only `{identifier}` is a slot; `'{1,2}'` or `'{"a":1}'` inside literals are untouched.
- A fragment's parameters are typed once spliced (`WHERE u.id = $1` → `number` above), and
  the values it carries (positional, `:name` or inline) are checked against those types:
  `sql.fragment("AND age > $1", "eighteen")` spliced next to an `int4` column is an error.
- Whole queries are spliceable too (`WHERE id IN ({sub})`).
- `sql.id("col")` → `"col"`; `sql.id("schema", "table")` → `"schema"."table"`.
  A union of literal names gives a union of texts; the statement is checked once per member
  (an error in any member is reported) and the row type is the union. A generic name
  constrained to `RelationName<DB>` is widened to every top-level table and view; any other
  non-literal name is dynamic.
- `sql.join(items, separator = ", ")` joins fragments. A tuple (`sql.join([f1, f2], " AND ")`)
  keeps the literal text. A runtime array of fragments whose texts are literals (or unions of
  literals) is checked once with each distinct element present once; the fragment's text type
  is that representative text, and an element whose text is not known makes it dynamic. Throws
  when there are no items. See [Lists from runtime arrays](../guide/fragments#lists-from-runtime-arrays).
- `sql.raw(text)` is dynamic.

### Write helpers

- `sql.set(table, values)`: `"a" = $1, "b" = $2` for the defined values. `values` is checked
  against `SetInput<DB, TM, table>`; throws when no value is defined.
- `sql.values(table, rows)`: `("a", "b") VALUES ($1, $2), ($3, DEFAULT)`. Rows are checked
  against `InsertInput<DB, TM, table>`; throws on an empty array.
- A `json` / `jsonb` column in `set` / `values` takes `sql.json(value)` (sent as JSON text, the
  value checked against a `Json<T>` column's `T`) or a raw non-array value; a raw array is an
  error, as for `sql.param()`.
- `table` is a `TableName<DB>`: a top-level table, or `"schema.table"`.
- `set` and `values` are typed like `sql.join` over an array: the text type assigns or lists every key of
  the input type once (`SetRep`, `ValuesRep`). See [Writing data](../guide/writing-data).
- A dynamic fragment makes the statement text non-literal; the call is rejected with
  `SqlError<"dynamic SQL fragment …">` — use `sql.as<Row>(text, slots, ...params)`.

### `sql.as<Row>(text, ...params)`

Bypasses inference and asserts the row type. Accepts slots and named parameters like `sql`.
`Row` is the row as returned: with `rowKeys: "camelCase"`, write it with camelCase keys.

### `q.execute()`, `q.executeTakeFirst()`, `q.executeTakeFirstOrThrow()`, `q.executeCount()`

Run a query on the executor bound by `createSql(executor)` (or by an adapter's
`createSql(client)`), or on the one passed to the call (`q.execute(executor(client))`). Without
either they reject.

| Method | Returns |
|---|---|
| `execute(executor?)` | `Promise<Row[]>` |
| `executeTakeFirst(executor?)` | `Promise<Row \| undefined>` |
| `executeTakeFirstOrThrow(executor?)` | `Promise<Row>`; `NoResultError` (with the statement `text`) on 0 rows |
| `executeCount(executor?)` | `Promise<number>`: the statement's row count |

`executeCount` returns the count from Postgres' command tag: rows affected by `INSERT`,
`UPDATE`, `DELETE` or `MERGE`, with or without `RETURNING`, and rows returned by `SELECT`.
Statements without a count, such as DDL, give 0.

An `Executor` is `(text, values) => PromiseLike<readonly unknown[] | ExecutorResult>`, where
`ExecutorResult` is `{ rows, rowCount: number | null }` (`null` means no count, read as 0).
Each adapter exports `executor(client)` to build one; all of them report the count. An executor
that resolves to the rows alone works for everything but `executeCount`, which then rejects,
unless the executor has a `count(text, values) => PromiseLike<number>` method, which
`executeCount` calls instead (`@typesql/prisma`'s runs `$executeRawUnsafe`). The methods are
non-enumerable, so a query still deep-equals `{ text, values }`.

Code that runs `q.text` itself, instead of through an executor, calls
`mapRows(q, rows)` to apply the query's `rowKeys` to the driver's rows. `rowKeysOf(q)` returns the
option, and `camelCase(key)` is the key mapping. These come from `@typesql/core/adapter`, with
what driver adapters build on: `createTransactionalSql(client, driver, options?)`, the
`SqlDriver<C>` it takes, `runTransaction(run, fn, options?)` for drivers without a transaction
API, and `JsonParam`, the value `sql.json()` binds.

## Public types

| Type | Meaning |
|---|---|
| `Query<Row, Params, Text>` | runtime query object with phantom types and `execute*` methods |
| `Executor` | `(text, values) => PromiseLike<readonly unknown[] \| ExecutorResult>`, what `execute*` runs on |
| `ExecutorResult` | `{ rows, rowCount: number \| null }`: an executor result with the statement's row count |
| `NoResultError` | thrown by `executeTakeFirstOrThrow` on 0 rows; carries `text` |
| `Sql<DB, TM, Keys = "preserve">` | the `sql` function; `Keys` is the `rowKeys` option |
| `TransactionalSql<DB, TM, Keys = "preserve">` | an adapter's `sql`: `Sql` plus `transaction(fn)` |
| `SqlOptions`, `RowKeys` | `createSql`'s options; `"preserve" \| "camelCase"` |
| `Fragment<Text, Params>` | spliceable SQL piece |
| `RowType<Q>`, `ParamsType<Q>`, `TextType<Q>` | extract from a `Query`/`Fragment` type |
| `TableName<DB>` | writable tables: top-level names and `"schema.table"` |
| `RelationName<DB>` | top-level tables and views (what a generic `sql.id(name)` is widened to) |
| `TableOf<DB, T>` | the column descriptors of a `TableName` |
| `SetInput<DB, TM, T>`, `InsertInput<DB, TM, T>` | what `sql.set` / a `sql.values` row accepts |
| `RowOf<DB, TM, Q>` | row type of a statement literal |
| `ParamsOf<DB, TM, Q>` | positional parameter tuple |
| `Validate<DB, Q>` | `Q` when valid, else `SqlError<message, tokenIndex>` |
| `ApplyDdl<DB, Q>` | schema after a DDL statement or a `;`-separated script |
| `SqlError<Message, At>` | compile-time error carrier; `At` is the index of the offending token |
| `Migrations<DB>`, `SchemaOf<M>`, `MigrationClient` | a [migration list](./ddl), its schema, what `runMigrations` runs on |

The engine's other types (the markers `sql.param()` and `sql.json()` return, the
representative texts of `sql.join`, `sql.set` and `sql.values`, `Analyze`, the lexer, parser
and type cache types, …) are exported from `@typesql/core/engine`, so that a declaration file
or the [type cache](../guide/caching) can name them. They change with the engine and are not a
stable API.

## Schema types

```ts
Col<"text">                  // NOT NULL, no default
Nullable<"text">             // nullable
Generated<"int4">            // has a default / identity / serial → optional on INSERT
NullableGenerated<"text">
Arr<"int4">                  // int4[]
Enum<"mood">                 // values in DB["$types"]["mood"]
Json<Item[]>                 // jsonb holding Item[]; Json<T, { nullable: true }, "json"> for json
View<{ ...columns }>         // read-only relation
interface DB { users: {...}; auth: { sessions: {...} }; $types: { mood: "a" | "b" } }
type WithCatalog = DB & PgCatalog;  // opt-in pg_catalog / information_schema slice
```

`PgCatalog` is `{ pg_catalog: PgCatalogNamespace; information_schema: InformationSchemaNamespace }`.
Unqualified names that are not in the schema resolve against `DB["pg_catalog"]`, as Postgres
always searches `pg_catalog`; see [System catalogs](../guide/schema#system-catalogs).

Type names are Postgres names; spellings are normalized (`integer` → `int4`, `bigint` →
`int8`, `boolean` → `bool`, `timestamp with time zone` → `timestamptz`, `serial` → `int4`
with a default, …). Unknown names are kept as-is (user enums/domains) and resolve to
`DB["$types"]` or `unknown`.

## Type maps

A type map is `{ [pgTypeName]: TsType }`. Resolution order: exact entry (so a map may define
`"numeric[]": number[]`), then `T[]` element-wise, then `DB["$types"]`, then `unknown`.
Nullable columns add `| null`. `DefaultTypeMap` matches node-postgres defaults (`int8` and
`numeric` as `string`, dates as `Date`, `json/jsonb` as `unknown`). A `json` / `jsonb` value with
a known shape (`Json<T>` columns, JSON built in SQL) is typed from the shape, unless the map reads
that type as a `string`.

Parameters accept the row type plus the map's `$params` entry for the type
(`TsParamTypeOf<TM, DB, T>`); array elements also accept `null`. A map without `$params` uses
`DefaultParamTypeMap` (`int8`/`numeric`/`money`: `number | bigint | string`; dates and
timestamps: `Date | string`; `interval`: `string`; `bytea`: `Uint8Array`). `PgTypeMap` and
`PostgresJsTypeMap` set `$params` to `PgParamTypeMap` and `PostgresJsParamTypeMap`.
`ParamTypeMapOf<TM>` is the input map in effect. See
[parameter types](../guide/schema#parameter-types).

## Function catalog

A function call is looked up in, in order:

1. `FunctionCatalog`: the built-in signatures, plus your augmentations.
2. `DB["$functions"]`: functions declared on the schema (or by `CREATE FUNCTION` in migrations).
3. The other `pg_catalog` functions: return type only, arguments not checked (generated by
   `scripts/gen-pg-functions.ts`).

Schema qualification is ignored (`public.f(x)` is `f`). Any other name is an error:
`function f(int4) does not exist. Declare it in the schema's $functions or in FunctionCatalog`.
A known name whose overloads do not fit the arguments is `unknown` (nullable); a cast fixes it.

Declare app and extension functions on the schema:

```ts
interface DB {
  users: { … };
  $functions: {
    immutable_unaccent: Sig<["text"], "text">;
    my_count: Sig<["any"], "int8", { agg: true; nullable: false }>;
  };
}
```

or, for every schema, augment `FunctionCatalog`:

```ts
declare module "@typesql/core" {
  interface FunctionCatalog {
    my_func: Sig<["text", "int4"], "bool">;                 // strict: nullable if any arg is
    my_count: Sig<["any"], "int8", { agg: true; nullable: false }>;
  }
}
```

To review the catalog against a Postgres release, `scripts/catalog-from-pg.ts` prints every
`pg_proc` overload of each catalog function (argument and return types, strict / aggregate /
window / set-returning flags) and lists catalog names Postgres does not have:

```sh
TYPESQL_PG_URL=postgres://postgres:x@localhost:5432/postgres node scripts/catalog-from-pg.ts [names…]
```

Parameter patterns: exact type name, `any`, `anynumeric`, `anystring`, `anyarray`,
`anyjson`, `anydatetime`, `...` (variadic). Return patterns: exact name, `$1`..`$4`,
`$elem1`, `$arr1`, `$common`, `$sum1`, `$avg1`, and the typed-JSON patterns `$jval:json`
(`to_json`), `$jarr:json` (`json_agg`), `$jrec:json` (`json_object_agg`), `$jtup:json`
(`json_build_array`), `$jelem:json` (`json_array_elements`), with `jsonb` for the jsonb
variants. Flags: `strict`, `nullable`, `agg`, `window`, `srf`. An entry is one `Sig` or a
tuple of overloads.

## ORM packages

Each package wraps core's `createSql` with the schema converted from the ORM's types; see the
[Kysely](../adapters/kysely), [Drizzle](../adapters/drizzle) and [Prisma](../adapters/prisma)
adapter pages.

| Package | `createSql` | Schema type | Runs queries |
|---|---|---|---|
| `@typesql/kysely` | `createSql<DB, TM = DefaultTypeMap, Overrides = {}, Options = {}>(db?, { rowKeys? })` | `FromKysely<DB, Overrides, Options>` | on a `Kysely` or `Transaction`, plugins bypassed; `sql.transaction` in `db.transaction()` |
| `@typesql/drizzle` | `createSql<Schema, TM = DefaultTypeMap, Options = {}>(db?)` | `FromDrizzle<Schema, Options>`; `pgType(column, "type")` pins a column | on the driver client under a node-postgres or postgres.js Drizzle database or transaction; `sql.transaction` in `db.transaction` |
| `@typesql/prisma` | `createSql<S, TM = PrismaTypeMap>(prisma?)`; `S` is a generated `DB` or a `Prisma.TypeMap` | `FromPrisma<Prisma.TypeMap, Overrides>`; the `typesql-prisma` generator | `$queryRawUnsafe` / `$executeRawUnsafe` on Prisma Client or a transaction client; `sql.transaction` in `prisma.$transaction(fn)` |

Option and override types: `KyselyOverrides`, `KyselyOptions` (`camelCase`),
`FromDrizzleOptions` (`casing`, `timestamp`, `time`), `PrismaOverrides` (`$table`, `$schema`,
per-field `{ column, type, nullable, default }`). The generator's pieces are exported from
`@typesql/prisma/generator` (`generateSource(datamodel, options?)`).

## Introspection

`typesql introspect` (bin of `@typesql/pg`) writes the schema of a live database; see
[Introspection](../guide/introspect).

```sh
typesql introspect [--url <url>] [--out <file>] [--schema <name>]… [--exclude <pattern>]… [--type-name DB]
                   [--import-from @typesql/core] [--config <file>] [--no-comments]
```

`@typesql/pg/introspect` exports:

| Export | |
|---|---|
| `introspect(client, { schemas?, exclude?, viewNotNull? })` | `Promise<IntrospectedDatabase>`: `{ version, schemas, relations, enums }` |
| `generateSource(db, options?)` | the schema file's source; options `typeName`, `importFrom`, `imports`, `columnTypes` (map or function; json / jsonb columns become `Json<T>`), `column`, `comments` |
| `IntrospectConfig` | the default export of a `--config` module: `url`, `out` and every option above |


- Statement size: up to 4096 tokens (the generated `Next` table; regenerate with
  `node scripts/gen-next.ts <n>` for more). 8 KB statements check in about a second.
- Left-nested `||` or `+` chains of ~100 terms hit TypeScript's instantiation depth;
  `AND`/`OR` chains are balanced by the parser and are fine at 200+ terms.
- For anything the engine rejects, `sql.as<Row>()` is the documented escape hatch.
