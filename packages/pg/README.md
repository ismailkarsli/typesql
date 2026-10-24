# @typesql/pg

[node-postgres](https://node-postgres.com) (`pg` 8.x) adapter for
[`@typesql/core`](https://www.npmjs.com/package/@typesql/core): a `createSql` bound to the type
map of `pg`'s default parsers, whose queries run on your pool and return rows typed from the SQL.

```sh
pnpm add @typesql/core @typesql/pg pg
```

[Open an example in the TypeScript Playground](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBagHYD2AJrALTSEDOWA5gE6xWgAUAAljEwI4A2w0WgEoAdKEQBXWPQxNQ9CflCElkQhPqgACoUK8ANKACG+YvMJpmRxqE5wzAI0jocRrACgQoQQHJmpADMjCV4sb2sqaWZGLA18AC5QDHwsAA5jUwIJAFtpDABjY2YaGXxaKkMsDFyaI2zoK2YAETdYMQAJQgA3aVscWHkmEKwqEXdqynowgG9tXV5QAF9QAPpCbNAAIkFNgG5x+sIp0Fn8xlb4PiWVtY3Nji4qPgFaPYPJsLsB2YBhPUMAOKwfDSVrEQwAORCvCMDl4A2Wq3WWwecCe-HyR1gb08YAA6jIsANcBhmE5QK5TIYjqBaMDQUSkmEkRs1BpQMQ3LCjJFEgADL7opIpNZUOD5MJkMgaBaAMgJQFL1GEqPl+tkjCIRnzxilpEF8gMmgAhE7uUCgCSRehURLTM3mpLERJAkH0MEAHk2ySwABZNgA+fYO0CwdUYXiJP68T1EgAeWADQYdxFJ0BhkAA+vg6rBElDeDC4bAY7B44n7eaHEYYfgDZG9J78Dk8vly8GzrAwRm3M76W6icQY9UmFg6tAsAAvNtLJOUGg203BjBO0AuhmwQdelKpafm4K4I4Z5f16Nb3272zYeEnktlwMV7wSOGk-rEbtYPPQ2Hwoc1Uf1Sdp0WfZFncdxMXwGhvHmUAAF4CFgNA5j0FhThUEEJQwFR4CwUpaESbZqDoRgbRAXhCHyascCI4AjGgaBNiWIR9ggqChXgjsLj4d1jX9FhKD0ZiwNYsInAAQQkA9NHg9EWD5eAAFFkAUn5wG8ERl0MaBNSvWAtJEaAn14F8N3fQwJBEUMjHDB9gzs+yHQAMQAJQAeQAWWg+dvFAAApVyAEkIQtK1mAkUBXOCizlzg9T92o+gj2IWyHNS808XaBTnIUuLJISpLYoAEgARj5QwAHYhJEryRliow0Gs0TIAkqTLNjWB8kk2AWCErwHQAPQAfmElQoMtXp4PqxrQFk+SlJUtTNNAKsawNQxOIHd9QBcjyQqiUAMqynKrPDIrSsMTYjE5NhSzHeERExbJNlEUsOq68AjAAa1gRyMGtLBXPocAcDWNAev2PrzSGkbILCTFFFqyaGuwGa+DkxTlNU4w8sPJb4ZSFgACohFAMT4AIba3M8udaoBNyAFUtFAI0AE1sakpK+Re9rOqJcHcWDaGBawWMkmKK4HHUTIsEIZQQVsN1IKMTCVEjDz3ICtS0H6JRcAGAJFBVpQSL0HoKlANzkGQI0xJ+ABpFxgSZPpQdGcDRrCGmArMJHpvRTVFaoZWqhUFgeUgWtWBFknYP9RdQD66HzWq2YYuWX2UZFuSgsU5y1KC8BXL261WBOgxlurEwDRJgA1MTkHphTyZYErDEKgAmEnsvAennIhIKAUdMqtgYZXYBu2M7raR7NkMAAGbm3qJD7vt+-7AeB0H+eTj2arq5HPljbOIVz-OIULmrmDDnHEqWqosHhWv68b5vW9ADuu4Unu+4HofDCWzY7RYAFkIM9NqS9YArx+n9GgG8QYWG3oMWI9AlA0w0sQECQkBZaGsDmIkJdrADFVB1b6ZgjC0GsrDPosA-qgExLwHICR2b5RiqSYUvoxhTRRrNJo81wA5R2tTIizBDrZWYbjH279zpbHKmA16vNurMQTmAaQax6CJCMDNXCyRaBiwIIQMIJh2E+ncEAA) <!-- playground:pg --> to hover the types and edit the SQL, with nothing to install.

## Usage

```ts
import { Pool } from "pg";
import { createSql } from "@typesql/pg";
import type { DB } from "./schema";

const pool = new Pool();
const sql = createSql<DB>(pool);

const users = await sql("SELECT id, email FROM users").execute(); // { id: number; email: string }[]
const maybe = await sql("SELECT id FROM users WHERE email = $1", "x").executeTakeFirst(); // row | undefined
const user = await sql("SELECT id, email FROM users WHERE id = $1", 7).executeTakeFirstOrThrow(); // row, or NoResultError
const changed = await sql("UPDATE users SET display_name = NULL").executeCount(); // row count

const id = await sql.transaction(async (tx) => {
  const { id } = await tx("INSERT INTO users (email) VALUES ($1) RETURNING id", "a@b.c").executeTakeFirstOrThrow();
  await tx("INSERT INTO posts (author_id, title) VALUES ($1, $2)", id, "Hello").execute();
  return id;
});
```

## API

| Export | |
|---|---|
| `createSql<DB>(client, options?)` | core's `createSql<DB, PgTypeMap>()` with the queries running on `client` (a `Pool`, `Client` or `PoolClient`); `{ rowKeys: "camelCase" }` camelCases the row keys |
| `q.execute()`, `q.executeTakeFirst()`, `q.executeTakeFirstOrThrow()`, `q.executeCount()` | `Promise<Row[]>`, `Promise<Row \| undefined>`, `Promise<Row>` (`NoResultError` on 0 rows), `Promise<number>` (`rowCount`) |
| `sql.transaction(fn)` | on a `Pool`: checks out a client, `BEGIN`, `fn(tx)`, `COMMIT`, releases it; `ROLLBACK` and rethrow on error. On a `Client` or `PoolClient`: the same on that connection. `tx` is `sql` bound to the transaction; `tx.transaction(fn)` uses a savepoint |
| `executor(client)` | an `Executor` for `q.execute(executor)` and core's `createSql(executor)` (reports `rowCount`) |
| `migrate(pool, m)` | runs `m.statements` (e.g. from core's `migrations()`) in one transaction |
| `PgSql<DB, Keys>` | the type `createSql` returns |
| `PgTypeMap`, `PgParamTypeMap`, `PgInterval` | the type map (rows), what parameters also accept, and the `postgres-interval` object type |
| `PgQueryable`, `PgPoolLike`, `PgTransactionClient`, `PgResult`, `MigrationSource` | parameter types |

`client` is anything with `query(text, values)`. The parameters are structural, so fakes work
in tests. If the `ROLLBACK` of a pool transaction fails, the client is released with the error
so the pool discards the connection.

## `typesql introspect`

Generates the schema from a live database: tables, views, materialized views and enums, with
the exact Postgres type of every column (domains as their base type), nullability, defaults,
identity and generated columns, other schemas nested, and TypeScript types for JSON columns
from a config file.

```sh
pnpm exec typesql introspect --url postgres://localhost/app --out src/db/schema.ts
pnpm exec typesql introspect --schema public,auth --config typesql.config.ts
```

The same is available from code as `introspect(client)` and `generateSource(db)` in
`@typesql/pg/introspect`. See the
[Introspection guide](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/guide/introspect.md).

## `PgTypeMap`

What `pg`'s default parsers return:

| Postgres | TypeScript |
|---|---|
| `int2`, `int4`, `oid`, `float4`, `float8` | `number` |
| `int8` (also `count(*)`), `numeric`, `money` | `string` |
| `bool` | `boolean` |
| `date`, `timestamp`, `timestamptz` | `Date` |
| `json`, `jsonb` | `unknown` |
| `bytea` | `Buffer` |
| `interval` | `PgInterval` |
| `point`, `circle` | `{ x, y }`, `{ x, y, radius }` |
| text-like and other types | `string` |

Arrays map element-wise. The full table, including the array types `pg` leaves as raw text, is
on the [node-postgres adapter page](https://github.com/ismailkarsli/typesql/blob/main/packages/docs/adapters/pg.md).

Parameters accept the row type and what `pg` serializes for the type (`PgParamTypeMap`):
`number | bigint | string` for `int8`, `numeric` and `money`, `Date | string` for dates and
timestamps, `string` for `interval`, `Uint8Array` for `bytea`.
