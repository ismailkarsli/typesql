import type { DefaultTypeMap, TransactionalSql } from "@typesql/core";
import { createTransactionalSql } from "@typesql/core/adapter";
import { driver, type DrizzleDatabase } from "./client.js";
import type { FromDrizzle, FromDrizzleOptions } from "./from-drizzle.js";

export type { FromDrizzle, FromDrizzleOptions, DrizzleColumnTypes } from "./from-drizzle.js";
export { pgType } from "./pg-type.js";
export { executor, type DrizzleDatabase } from "./client.js";

/** What `createSql<typeof schema>(db)` returns: core's `Sql` over `FromDrizzle<Schema, Opts>`, with `transaction(fn)`. */
export type DrizzleSql<Schema, TM = DefaultTypeMap, Opts extends FromDrizzleOptions = {}> = TransactionalSql<FromDrizzle<Schema, Opts>, TM>;

/**
 * `createSql` from core with the schema converted from Drizzle definitions:
 * `createSql<typeof schema>(db)`, or `createSql<typeof schema, PgTypeMap>(db)` for a driver's type map.
 * The queries' `execute*` methods run on `db` (a Drizzle database or transaction, on node-postgres
 * or postgres.js), and `sql.transaction(fn)` runs `fn` with a `sql` bound to `db.transaction`.
 */
export function createSql<Schema, TM = DefaultTypeMap, Opts extends FromDrizzleOptions = {}>(db?: DrizzleDatabase): DrizzleSql<Schema, TM, Opts> {
  return createTransactionalSql<FromDrizzle<Schema, Opts>, TM, DrizzleDatabase>(db, driver) as DrizzleSql<Schema, TM, Opts>;
}
