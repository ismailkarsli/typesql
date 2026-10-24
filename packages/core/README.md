# @typesql/core

Type-level Postgres SQL for TypeScript. You write a SQL string literal; the compiler parses it
**inside the type system** and gives you the exact row type, the parameter types, and (for DDL)
the resulting schema. No codegen, no database connection, no build step. Zero runtime
dependencies.

Tested against PostgreSQL's own regression suite: on all 49,999 statements of PostgreSQL 18's
regression tests that can be checked statically, the parser accepts exactly what Postgres accepts
and rejects its syntax errors ([how it is tested](https://typesql.karsli.net/guide/postgres-compatibility)).

```sh
pnpm add @typesql/core
```

[Open an example in the TypeScript Playground](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZAXKACgewM4BcBzAJ1h1CWQBpRoBDInWAE1ACNIIYEBjIgS2h4A5GTxdQOSPlgBbAHSgAokz55QeABaxyKULQB2LDVgBusIuq3quOVACgQoIlgDuZAyzpFaM2HnNkAGZYADYhrtQeoDJ8+LQA1qR6JKDcWDLQfCHa5s4MoFj6ltr4-PoEcnZ8GVhEagDeqSS0-vAAjiHUYnCgAMKhXeIA4rD65i3Mgz0AcgCuYbSs2VPaGPQ+OFBwK6AASq5b2gC+oIHOMqAARAAC3aQdwGkklwDcdlX6-kSBtNzaACIAIVA9TsoFAs0YDHQoPB4L4THQIzG3n8TAAPJc+J8ACyXAB8L1Ajg0tHcoCYsB+8zw6Cwgj4hVoIQKRQAktN4IpduAwXDZLQsuh+iFMf4AB54AlvOEU2LQEK0SAAfX0Plg6DmCyWsDFsEl0r54N4sAmTGVLSRo3GaLF1VIeB8ggAXobwUcZTRcHhbCCjaAEVaUWbMdi8AAON1w2izTS1ZWBvqhUO4qPgvCqbLC5OXCVSwn+1hYJiQTXzRU6vUGgvut5Hd5pfT4CQdUAAXiaptaHXRQPxAAoAJRvBxgZCKABi4FAACkAPIc6IJJKabT8AgaNQ4BHafTlxbZIkAEgAjOpl2RVKJxGd0hC5AjKo3m212y2Qv2AAZc8e9aezB8mGoACBSyahoDkDM8Gyf1ZTg8EJ12OcAFkIShMhZlAccp1nBdpi9fAyGgUA53wiCYzjIgExYDsAIRWD4NlAB1AAJblFHvBE31PT9qAAdmHOw7j2Vw332FxDnRO4sECUA2gLRxwQAPQAfiE8Q1m8GQyA7TSNkk6TZPkt5FNAVT3kcABBAhiFgAgJncQxUlCWYZCKNVfCCUJwhcTBvVs300lmT5+wAKkHANL0+cNIgkPAygICFDHMUB9GLWAAFpoH8kgcCfQpmziH03xwDovx-RQ-z0WNjCohFqCCkLwuoGRaHFfsoOyCLLPgUBFX8ZtEJQgjiqGJCAFUMFAQEAE1qso6jP0E4T4EdYqO3EgyuBkuKWhwBSwGUtTR1ANl9BCbFtBMZlZiSegSlGNQyVAI8ii8dUvkclhuC0bhEhYWh7OxZsXC0FJVw4e60OYfKmzUUCWQ7S5aCYWhrn1J1sjkNIZFeOxnzUE0zRKsrPw5LkeVO6ZwDnaH8n7BGIoANUs5BxsUXr+yPepSpCOR3pkBnWqyQcjgi3ZFHAcbdmmDkhgDIDOzNC08CWt5hN6Zo0TEg4uCk7bZKJtEDrhcyTuQ2JHUSdwUhxzJslAXJajIQpih0ZA4oShQJz4cVihkexefKxRf2nfRfFAIbUMhAI1eJMAnaIdA0hCVyikucPYEuCksCSNL4fFS27CDsnOW5acORpkayA6zNYGZ1n2c509B14q4WNgMIsEuYd48dog8nQCjauoyLQGmOdp2mcbkA9qJSTINKKSpGMQjwOwgA) <!-- playground:core --> to hover the types and edit the SQL, with nothing to install.

Add the adapter for your driver to run queries: [`@typesql/pg`](https://www.npmjs.com/package/@typesql/pg)
(node-postgres) or [`@typesql/postgres`](https://www.npmjs.com/package/@typesql/postgres)
(postgres.js). Already describing your database for an ORM? `@typesql/kysely`,
`@typesql/drizzle` and `@typesql/prisma` take the schema from it.

## Usage

```ts
import { createSql, type Col, type Generated, type Nullable } from "@typesql/core";

interface DB {
  users: {
    id: Generated<"int4">; // has a default → optional on INSERT
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    body: Nullable<"text">;
  };
}

const sql = createSql<DB>();

const q = sql(`SELECT u.id, u.email, p.title
               FROM users u LEFT JOIN posts p ON p.author_id = u.id
               WHERE u.id = $1`, 7);
//    ^? Query<{ id: number; email: string; title: string | null }, [number | null]>

q.text;   // the SQL, sent to Postgres as is
q.values; // [7]

sql("SELECT nme FROM users");
//   ~~~~~~~~~~~~~~~~~~~~~~  SqlError<"column \"nme\" does not exist", 1>
```

The SQL must be a string literal (tagged templates cannot be inferred by TypeScript). Values
can be passed positionally (`$1`), by name (`:email` with an object), or inline with
`${sql.param(value)}` (`${sql.json(value)}` for JSON); all are sent as bind parameters and
checked against their context.

## What you get

- **Rows and parameters** for `SELECT` (joins, subqueries, CTEs, set operations, aggregates,
  window functions) and `INSERT`/`UPDATE`/`DELETE … RETURNING`.
- **Nullability** from the schema, outer joins, `WHERE` filters and expressions (`COALESCE`,
  aggregates, `CASE`).
- **Typed JSON**: `json_build_object`, `json_agg`, `to_json(t)` and `->` / `#>` give the JSON's
  structure, typed as Postgres serializes it.
- **Postgres column naming** (`?column?`, `count`, `lower`) and Postgres-worded compile errors.
- **Fragments**: `sql.fragment`, `sql.id`, `sql.join` (also over runtime arrays of typed
  elements), `sql.raw`, spliced into inference with `$n` renumbering.
- **Write helpers**: `sql.param(x)` sends `DEFAULT` for `undefined`; `sql.set(table, partial)`
  and `sql.values(table, rows)` build typed `SET` lists and `VALUES` rows from objects.
- **DDL**: `ApplyDdl<DB, "ALTER TABLE …">` and the `migrations()` builder derive the schema from
  your migrations.
- **Running queries**: with `createSql(executor)` (or an adapter's `createSql(client)`), queries
  have `execute()`, `executeTakeFirst()`, `executeTakeFirstOrThrow()` and `executeCount()` (the
  affected row count). An `Executor` resolves to the rows or to `{ rows, rowCount }`. An
  adapter's `sql` also has `sql.transaction(fn)`, which runs `fn` with a `sql` bound to one
  transaction (`TransactionalSql`).
- **camelCase rows**: `createSql(executor, { rowKeys: "camelCase" })` renames the rows'
  top-level keys (`created_at` → `createdAt`, as Kysely's `CamelCasePlugin` does) in the types
  and at runtime, leaving JSON values alone.
- **Escape hatch**: `sql.as<Row>(…)` for SQL the engine cannot type.

## Schema

Columns are declared with Postgres type names; a type map turns them into TypeScript types
(`DefaultTypeMap` matches node-postgres: `int8` and `numeric` rows are `string`; their parameters
also take numbers and bigints, and date parameters take `Date | string`):

| Helper | Meaning |
|---|---|
| `Col<"text">` | `NOT NULL`, no default |
| `Nullable<"text">` | `NULL` allowed |
| `Generated<"int4">` | has a default: optional in `INSERT` |
| `NullableGenerated<"text">` | both |
| `Enum<"mood">` | values in `DB["$types"]["mood"]` |
| `Json<T>` | `jsonb` holding `T`: rows read `T`, `->` indexes into it, `${sql.json(v)}` writes it |
| `View<{ … }>` | read-only relation |

Other Postgres schemas nest (`DB["auth"]["sessions"]` is `auth.sessions`). For
`pg_stat_activity`, `pg_tables`, `information_schema.columns` and other system catalogs, add the
opt-in slice: `createSql<DB & PgCatalog>()`.

## Requirements

TypeScript 7.1 or later (the native compiler; `7.1.0-beta` works) and Node.js 26 or later.
PostgreSQL semantics only.

Optionally, a [type cache](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/caching.md)
file, which TypeScript 7.1's content mappers let this package serve and keep up to date, saves
recomputing query types on every `tsc` run and every edit.

## Documentation

[Guide](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/getting-started.md) ·
[API reference](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/reference/api.md) ·
[DDL support](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/reference/ddl.md) ·
[Errors and limits](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/errors-and-limits.md) ·
[Type cache](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/caching.md) ·
[Editor completions](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/editor.md)
