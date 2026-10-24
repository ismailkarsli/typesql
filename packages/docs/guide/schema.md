# Schema and type maps

The schema can be written by hand as shown here, generated from a live database
([Introspection](./introspect)), derived from DDL ([Migrations](./migrations)), or converted
from a Kysely, Drizzle or Prisma schema ([ORM schemas](../adapters/#orm-schemas)).

## Declaring tables

A schema is an interface whose keys are tables. Each column is declared with a helper:

| Helper | Meaning |
|---|---|
| `Col<"text">` | `NOT NULL`, no default |
| `Nullable<"text">` | `NULL` allowed |
| `Generated<"int4">` | has a default (serial, identity, `DEFAULT …`): optional in `INSERT` |
| `NullableGenerated<"text">` | both |
| `Arr<"int4">` | an array column, `int4[]` (same as `Col<"int4[]">`) |
| `Enum<"mood">` | a column of a user enum type, values listed under `$types` |
| `Json<T>` | a `jsonb` column holding `T` (`Json<T, {}, "json">` for `json`); see [below](#typed-json-columns) |
| `View<{ … }>` | a view: readable like a table, rejected as an `INSERT`/`UPDATE`/`DELETE` target |

<<< @/snippets/schema.ts#schema

Type names are Postgres names. Common spellings are normalized, so `integer`, `int` and `int4`
are the same, as are `bigint`/`int8`, `boolean`/`bool`, `character varying`/`varchar`,
`double precision`/`float8` and `timestamp with time zone`/`timestamptz`. A name TypeSQL does
not know (an extension type or a domain) is kept as is and maps to `unknown` unless the type
map or `$types` says otherwise.

## Typed JSON columns

`Json<T>` declares what a `jsonb` column holds. It takes the same flags as `Col` as its second
argument (`{ nullable: true }`, `{ hasDefault: true }`) and `"json"` as a third for a `json`
column:

<<< @/snippets/json.ts#schema

The column is still `jsonb` to the SQL: operators (`@>`, `?`) and functions
(`jsonb_array_length`) work as before. Rows read it as `T`, and `->`, `#>` and subscripts index
into `T` (an array index gives the element type, a key the property type; see
[JSON](./queries#json)):

<<< @/snippets/json.ts#read

Parameters written to the column take `T`. Pass JSON values with
[`sql.json()`](./parameters#json-values), which sends them as JSON text with either driver (also
as [`sql.set` / `sql.values`](./writing-data#json-columns) values):

<<< @/snippets/json.ts#write

`T` is trusted, not checked against the database: rows are typed `T` whatever the column holds.

## Enums

List enum values under `$types`; a column declared with `Enum<"mood">` then has the type
`"happy" | "neutral" | "sad"`, both in rows and as a parameter.

<<< @/snippets/queries.ts#enum

## Functions

App and extension functions that are not built in go under `$functions`, with a `Sig` per
function (`$functions: { slugify: Sig<["text"], "text"> }`). Calling a function that is
neither built in nor declared is an error; see [Expressions and functions](./queries#expressions-and-functions).

## Other schemas

Tables in a Postgres schema other than `public` go in a nested object:

```ts
interface DB {
  users: { … };                         // public.users, or just users
  auth: { sessions: { token: Col<"uuid">; user_id: Col<"int4"> } }; // auth.sessions
}
```

## System catalogs

`pg_catalog` and `information_schema` are not part of a schema by default. To query them,
intersect your schema with `PgCatalog`:

<<< @/snippets/schema.ts#pg-catalog

`PgCatalog` covers the relations applications and admin tools usually read, as of
PostgreSQL 18:

- **Statistics**: `pg_stat_activity`, `pg_stat_database`, `pg_stat_all_tables`,
  `pg_stat_user_tables`, `pg_stat_all_indexes`, `pg_stat_user_indexes`,
  `pg_statio_user_tables`, `pg_stat_replication`, `pg_locks`.
- **Catalog views**: `pg_tables`, `pg_views`, `pg_matviews`, `pg_indexes`, `pg_sequences`,
  `pg_roles`, `pg_settings`, `pg_replication_slots`, `pg_available_extensions`.
- **Catalog tables**: `pg_class`, `pg_namespace`, `pg_attribute`, `pg_type`, `pg_index`,
  `pg_constraint`, `pg_database`, `pg_proc`, `pg_enum`, `pg_attrdef`, `pg_description`,
  `pg_depend`, `pg_extension`, `pg_trigger`, `pg_inherits`, `pg_sequence`, `pg_am`.
- **`information_schema`**: `schemata`, `tables`, `columns`, `views`, `table_constraints`,
  `key_column_usage`, `constraint_column_usage`, `referential_constraints`,
  `check_constraints`, `routines`, `parameters`, `sequences`, `triggers`, `domains`.

How they resolve:

- `pg_catalog` relations work unqualified (`FROM pg_stat_activity`), as in Postgres, and
  qualified (`FROM pg_catalog.pg_class`). A relation of your own schema with the same name
  wins.
- `information_schema` relations need the prefix (`FROM information_schema.columns`).
- The whole slice is read-only: `UPDATE pg_settings …` is an error.

Column types are the ones Postgres reports. The `information_schema` domains are their base
types: `sql_identifier` is `name`, `cardinal_number` is `int4`, `character_data` and
`yes_or_no` are `varchar`, `time_stamp` is `timestamptz`. System types without a driver
parser (`xid`, `pg_lsn`, `oidvector`, `int2vector`, `aclitem`, `pg_node_tree`) are `string`.
Under node-postgres, `aclitem[]` and `"char"[]` columns (`relacl`, `proargmodes`) come back as
the raw `{…}` text, and `PgTypeMap` types them as `string`.

Postgres does not record whether a view column can be NULL. A view column is `NOT NULL` in
`PgCatalog` only when its definition proves it: for example `pg_tables.tablename` is
`string`, while `pg_tables.schemaname` (from a `LEFT JOIN`) is `string | null`. The slice is
generated from a live server by `scripts/pg-catalog-from-pg.ts`, and the test suite checks it
against Postgres with both drivers.

## Type maps

The schema says what Postgres returns; the **type map** says what the driver turns it into.
`int8` and `numeric`, for example, are strings under node-postgres because a JavaScript number
cannot hold every value. Pick the map that matches your driver by importing `createSql` from
its adapter:

| Postgres type | `@typesql/pg` | `@typesql/postgres` | `@typesql/postgres` (`{ bigint: true }`) |
|---|---|---|---|
| `int2`, `int4`, `float4`, `float8` | `number` | `number` | `number` |
| `int8` (also `count(*)`) | `string` | `string` | `bigint` |
| `numeric` | `string` | `string` | `string` |
| `text`, `varchar`, `uuid` | `string` | `string` | `string` |
| `bool` | `boolean` | `boolean` | `boolean` |
| `date`, `timestamp`, `timestamptz` | `Date` | `Date` | `Date` |
| `json`, `jsonb` | `unknown` (typed when its shape is known) | `unknown` | `unknown` |
| `bytea` | `Buffer` | `Buffer` | `Buffer` |
| `T[]` | element type `[]` | element type `[]` | element type `[]` |

`createSql` from `@typesql/core` itself uses `DefaultTypeMap`, which matches node-postgres. A custom
map is any object type from Postgres type names to TypeScript types:

<<< @/snippets/type-maps.ts#custom

The full mapping for each driver, including intervals, geometric types and arrays, is on its
adapter page: [node-postgres](../adapters/pg#pgtypemap),
[postgres.js](../adapters/postgres#postgresjstypemap-and-postgresjsbiginttypemap) and
[Prisma](../adapters/prisma#prismatypemap).

### Parameter types

A parameter accepts its type's row type and, on top of it, the entry of the map's `$params`
key: what the driver can serialize for that type. A map without `$params` gets
`DefaultParamTypeMap`, which both `pg` and postgres.js handle:

| Postgres type | Parameters also accept |
|---|---|
| `int8`, `numeric`, `money` | `number \| bigint \| string` |
| `date`, `timestamp`, `timestamptz` | `Date \| string` |
| `interval` | `string` |
| `bytea` | `Uint8Array` |

So a map that types rows with a custom parser keeps the driver's input types: with
`timestamptz: string` (a parser that formats timestamps) parameters still accept a `Date`.
`PgTypeMap` and `PostgresJsTypeMap` declare their own `$params` (`PgParamTypeMap`,
`PostgresJsParamTypeMap`; postgres.js also takes epoch milliseconds for dates). To change what
parameters accept, set `$params`; it replaces the default, so extend `DefaultParamTypeMap` (or
the adapter's) to keep the rest:

<<< @/snippets/type-maps.ts#params
