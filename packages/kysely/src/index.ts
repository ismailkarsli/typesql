import type { DefaultTypeMap, RowKeys, SqlOptions, TransactionalSql } from "@typesql/core";
import { createTransactionalSql } from "@typesql/core/adapter";
import { driver, type KyselyExecutor } from "./client.js";
import type { FromKysely, KyselyOptions, KyselyOverrides } from "./from-kysely.js";

export type { FromKysely, KyselyOverrides, KyselyOptions, TableOverride, ColumnOverride, InferColumn, SnakeCase } from "./from-kysely.js";
export { executor, type KyselyExecutor } from "./client.js";

/** What `createSql<DB>(db)` returns: core's `Sql` over `FromKysely<DB, ...>`, with `transaction(fn)`. */
export type KyselySql<DB, TM = DefaultTypeMap, Overrides extends KyselyOverrides = {}, Options extends KyselyOptions = {}, Keys extends RowKeys = "preserve"> =
  TransactionalSql<FromKysely<DB, Overrides, Options>, TM, Keys>;

/**
 * `createSql` from core with a Kysely `DB` interface as the schema:
 * `createSql<DB>(db)` is `createSql<FromKysely<DB>, DefaultTypeMap>()` bound to `db`.
 *
 *   const sql = createSql<DB>(db);
 *   const sql = createSql<DB, PgTypeMap, { users: { id: "int8" } }>(db);
 *   const sql = createSql<DB, DefaultTypeMap, {}, { camelCase: true }>(db);
 *
 * The queries' `execute*` methods run on `db` (a `Kysely` instance or transaction), bypassing
 * its plugins, and `sql.transaction(fn)` runs `fn` with a `sql` bound to one transaction.
 * `{ rowKeys: "camelCase" }` camelCases the rows' top-level keys as `CamelCasePlugin` does, in
 * the types and at runtime, without touching JSON values:
 *
 *   const sql = createSql<DB, DefaultTypeMap, {}, { camelCase: true }>(db, { rowKeys: "camelCase" });
 */
export function createSql<DB, TM = DefaultTypeMap, Overrides extends KyselyOverrides = {}, Options extends KyselyOptions = {}>(
  db: KyselyExecutor | undefined,
  options: { readonly rowKeys: "camelCase" },
): KyselySql<DB, TM, Overrides, Options, "camelCase">;
export function createSql<DB, TM = DefaultTypeMap, Overrides extends KyselyOverrides = {}, Options extends KyselyOptions = {}>(
  db?: KyselyExecutor,
  options?: { readonly rowKeys?: "preserve" },
): KyselySql<DB, TM, Overrides, Options>;
export function createSql<DB, TM = DefaultTypeMap, Overrides extends KyselyOverrides = {}, Options extends KyselyOptions = {}>(
  db?: KyselyExecutor,
  options?: SqlOptions,
): KyselySql<DB, TM, Overrides, Options, RowKeys> {
  return createTransactionalSql<FromKysely<DB, Overrides, Options>, TM, KyselyExecutor>(db, driver, options);
}
