import type { RowKeys, SqlOptions, TransactionalSql } from "@typesql/core";
import { createTransactionalSql } from "@typesql/core/adapter";
import { driver, type PgQueryable } from "./client.js";
import type { PgTypeMap } from "./type-map.js";

export type { PgInterval, PgParamTypeMap, PgTypeMap } from "./type-map.js";
export {
  executor,
  migrate,
  type MigrationSource,
  type PgQueryable,
  type PgResult,
  type PgTransactionClient,
  type PgPoolLike,
} from "./client.js";

/** What `createSql<DB>(client)` returns: core's `Sql` under `PgTypeMap`, with `transaction(fn)`. */
export type PgSql<DB, Keys extends RowKeys = "preserve"> = TransactionalSql<DB, PgTypeMap, Keys>;

/**
 * `createSql<DB>()` from core, pre-bound to `PgTypeMap` (`count(*)` is `string`, `int8` is `string`, dates are `Date`).
 * The queries' `execute*` methods run on `client` (a `Pool`, `Client` or `PoolClient`), and
 * `sql.transaction(fn)` runs `fn` with a `sql` bound to one transaction.
 * `{ rowKeys: "camelCase" }` camelCases the rows' keys, in the types and at runtime.
 */
export function createSql<DB>(client: PgQueryable | undefined, options: { readonly rowKeys: "camelCase" }): PgSql<DB, "camelCase">;
export function createSql<DB>(client?: PgQueryable, options?: { readonly rowKeys?: "preserve" }): PgSql<DB>;
export function createSql<DB>(client?: PgQueryable, options?: SqlOptions): PgSql<DB, RowKeys> {
  return createTransactionalSql<DB, PgTypeMap, PgQueryable>(client, driver, options);
}
