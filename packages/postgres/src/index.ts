import type { RowKeys, SqlOptions, TransactionalSql } from "@typesql/core";
import { createTransactionalSql } from "@typesql/core/adapter";
import { driver, type PostgresJsQueryable } from "./client.js";
import type { PostgresJsBigIntTypeMap, PostgresJsTypeMap } from "./type-map.js";

export type { PostgresJsTypeMap, PostgresJsBigIntTypeMap, PostgresJsParamTypeMap } from "./type-map.js";
export {
  executor,
  migrate,
  type MigrationSource,
  type PostgresJsQueryable,
  type PostgresJsRows,
  type PostgresJsTransactable,
} from "./client.js";

/** What `createSql<DB>(sql)` returns: core's `Sql` under `PostgresJsTypeMap` (or `TM`), with `transaction(fn)`. */
export type PostgresJsSql<DB, Keys extends RowKeys = "preserve", TM = PostgresJsTypeMap> = TransactionalSql<DB, TM, Keys>;

/** `createSql`'s options: core's `rowKeys`, and `bigint: true` for a connection that parses `int8` as `bigint`. */
interface PostgresJsSqlOptions extends SqlOptions {
  readonly bigint?: boolean;
}

/**
 * `createSql<DB>()` from core, pre-bound to `PostgresJsTypeMap` (default parsers: `int8` and `count(*)` are `string`).
 * The queries' `execute*` methods run on the postgres.js `sql` instance (or a `TransactionSql`,
 * `ReservedSql`), and `sql.transaction(fn)` runs `fn` with a `sql` bound to one transaction.
 * `{ rowKeys: "camelCase" }` camelCases the rows' keys, in the types and at runtime.
 * `{ bigint: true }` is for `postgres({ types: { bigint: postgres.BigInt } })` connections:
 * `int8` and `count(*)` are `bigint` (`PostgresJsBigIntTypeMap`).
 */
export function createSql<DB>(sql: PostgresJsQueryable | undefined, options: { readonly rowKeys: "camelCase"; readonly bigint: true }): PostgresJsSql<DB, "camelCase", PostgresJsBigIntTypeMap>;
export function createSql<DB>(sql: PostgresJsQueryable | undefined, options: { readonly rowKeys?: "preserve"; readonly bigint: true }): PostgresJsSql<DB, "preserve", PostgresJsBigIntTypeMap>;
export function createSql<DB>(sql: PostgresJsQueryable | undefined, options: { readonly rowKeys: "camelCase"; readonly bigint?: false }): PostgresJsSql<DB, "camelCase">;
export function createSql<DB>(sql?: PostgresJsQueryable, options?: { readonly rowKeys?: "preserve"; readonly bigint?: false }): PostgresJsSql<DB>;
export function createSql<DB>(sql?: PostgresJsQueryable, options?: PostgresJsSqlOptions): PostgresJsSql<DB, RowKeys, PostgresJsTypeMap | PostgresJsBigIntTypeMap> {
  return createTransactionalSql<DB, PostgresJsTypeMap, PostgresJsQueryable>(sql, driver, options);
}
