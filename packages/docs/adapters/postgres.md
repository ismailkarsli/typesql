# postgres.js

`@typesql/postgres` runs queries on postgres.js 3.x and types rows with `PostgresJsTypeMap`, or
`PostgresJsBigIntTypeMap` for connections that parse `int8` to `bigint`.

```sh
pnpm add @typesql/core @typesql/postgres postgres
```

[Open an example in the TypeScript Playground](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBamgPYDOWA5gE6xEB0AVkaABQACWMVAjgDbCEkVUAlNVCIArrHIYqocmIB26bHiLdqCogEMAZrEZZYADywAaUADdNXCUUFnN8gCayCaIgCgQoTZVBs4zgBGkOg4mlj4xGSUNPT4PkRUAFygGPJYABypDJqgJFLypGYE5N6ggRikaRGYuKAAQpUAkunx5ERppKAE8tTuGAC2hOQR-rCgAN6g8NygAL6g2uQEA6AARHzRVGsA3P1DJRFTAMaU4bCNpC1YM1xmp7Dnt-OLy6trrOyqPJsCRLv7YajdiTUAAYQId1AAHFYPJJOdHGYAHJiLhcTSBLjjBZLFbrT5wb7AY4lWAA-rpSTaTTHcYAEXqk3coFAYkS7RSExZrNSjhSsPh5ERAB41tUACxrAB8e15oFgA00GC4KQhXDFBmMMrlvMcGCI0AxkAA+vJNANYClUejMdjNUYsDqeayHoiTeEBXCEQZHJrBlQsBboFgAF7O1lzXWbIhcl18r1C0Xi9IZCO8zRiXAlE0YfngyFiyXp1lYbDYtWFtZap2y+NB0ixgsa6uOgDaAF101H3HN3O5HLBjhjfKT5CRQI5AilbjtQF5fjFGBson8kiAuARjlYcFFgJpoNA1oJ3GOJ99QABeUBugy3EWM6WMKeCPannoTmNX7xoZURb6MAABvAACiyAgWC4B8mYZZYNiMGaI2oAAGIAEoAPIALKRCQDAAOoABIgahIGgAAJAAjN+ACCyIAJpMA2tiAWYazfMe1BGEOWZ6K+nhgLyAB6AD8-ZeOhii5GO8LHGWPRKHUgFjE2UwVFU6QpIuVDUJc1zzCxqSpt4Tg3gQChYIwABUgimZa5S0gA1t4DBqdUfSDsOPjjGeERTpcM7cCKqmVNUKSua0cx1j55SVN+t4XM06T3o+z6BJcfHRaS5kMNemi-tgMWkEBoHgZB3hZru5C5kipnmVZNnUfAoCKGhWE4VgDDQhhACqAAKDQMZm2ZVXmgHCFxxw8YwfFeEJon8XkahYMK460nJigGotXDUIEsDqXOWCGNQy0OFoskYPJm25Fo5iwIQbnuHlf5bcdK1netjCaEQkDyMcjGGDZl7SsyrJPQVh1AX19LUeApFfqBUGwdi35iIekj6OWsA2YRxGkUNlXVd+lEGQA7ONhjcQY026tFii5floyGEB9JgSBsMoRh2FfjjJE3j4+rmlw2CQPoiG2N+AAMY2cRTk0GBCdV8ays2siJvZ8e4AHAazZV5hzbXc0RvNMaAzDA8TrHsa+85gJIyzkCkJtm34mgOTIuQ1p27hAA) <!-- playground:postgres --> to hover the types and edit the SQL, with nothing to install.

<<< @/snippets/adapters.ts#postgresjs

- `PostgresJsQueryable` is anything with `unsafe(query, parameters?)`: the `Sql` instance,
  the `TransactionSql` passed by `begin`, and `ReservedSql` all satisfy it. Queries run with
  `sql.unsafe(text, values)`, so the text goes to the server untouched.
- `execute` returns a plain `Row[]` (postgres.js' result metadata — `count`, `command`,
  `columns` — is stripped by `Array.from`). `executeCount` returns the result's `.count` (0
  when postgres.js reports `null`, as for DDL).
- `sql.transaction(fn)` is `sql.begin(fn)`: postgres.js issues `BEGIN`, runs `fn(tx)`,
  `COMMIT`, or `ROLLBACK` and rethrows. On a `TransactionSql` it is `savepoint(fn)`.

See the [overview](./#running-queries) for the `execute*` methods, transactions and executors
that every adapter shares.

## `PostgresJsTypeMap` and `PostgresJsBigIntTypeMap`

Verified against `postgres@3.4.9/src/types.js`. The default parsers are only:

| OIDs | Postgres | TS |
|---|---|---|
| 21, 23, 26, 700, 701 | `int2`, `int4`, `oid`, `float4`, `float8` | `number` |
| 16 | `bool` | `boolean` |
| 1082, 1114, 1184 | `date`, `timestamp`, `timestamptz` | `Date` (`new Date(x)`) |
| 114, 3802 | `json`, `jsonb` | `unknown` (`JSON.parse`) |
| 17 | `bytea` | `Buffer` |

Everything else is the text Postgres sent, i.e. `string`: notably `int8`, `numeric`,
`interval`, `point`, `circle`, `record`, `void`. With
`postgres({ types: { bigint: postgres.BigInt } })` int8 (OID 20) is parsed to `bigint`;
pass `{ bigint: true }` to `createSql` for those connections (`PostgresJsBigIntTypeMap`;
`int8[]` becomes `bigint[]`).

Arrays: postgres.js fetches `pg_type` on connect (`fetch_types: true`, the default) and
registers an element-wise parser for every array type, so core's `T[]` mapping is exact.

### Parameters

Parameters accept the row type plus `PostgresJsParamTypeMap` (`PostgresJsTypeMap["$params"]`).
postgres.js serializes each value with the serializer of the parameter type the server
reports (`Bind` in `src/connection.js`), and with `'' + x` for types without one:

| Postgres | Parameters also accept |
|---|---|
| `int8`, `numeric`, `money` | `number \| bigint \| string` |
| `date`, `timestamp`, `timestamptz` | `Date \| string \| number`: sent as `new Date(x).toISOString()`, so a string must be one JS `Date` can parse and a number is epoch milliseconds |
| `interval` | `string` |
| `bytea` | `Uint8Array` |

`bool` parameters take only booleans: the serializer sends `'f'` for anything but `true`.

### Dates

`date` is not a string under postgres.js: `types.date.from` is
`[1082, 1114, 1184]`, so `date`, `timestamp` and `timestamptz` are all `Date` by default, the
same as `pg`. The remaining difference is how the text is parsed: postgres.js does
`new Date("1815-12-10")`, which is UTC midnight, whereas `pg`'s `postgres-date` yields local
midnight for a `date`. Both maps say `Date`.

## Migrations

`migrate(db, m)` runs `m.statements` in order inside one transaction (all or nothing). `m` is
anything with `statements: readonly string[]`; the `migrations()` builder from `@typesql/core`
fits, and its `schema` type is what you pass to `createSql`:

```ts
import { migrations, type SchemaOf } from "@typesql/core";
import { createSql, migrate } from "@typesql/postgres";

const m = migrations()
  .add("CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL)")
  .add("ALTER TABLE users ADD COLUMN display_name text");

await migrate(db, m);
const sql = createSql<SchemaOf<typeof m>>(db);
```

Statements are sent without parameters (simple query protocol), so `$$`-quoted function
bodies and multi-statement scripts work. `migrate` does not track which migrations have
already run; keep a `schema_migrations` table or use a dedicated tool for that and use
`migrations()` for the types. See [Migrations](../guide/migrations).
