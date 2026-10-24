import { CompiledQuery, type QueryResult } from "kysely";
import type { Executor } from "@typesql/core";
import { runTransaction, type SqlDriver } from "@typesql/core/adapter";

/**
 * What the adapter uses from a `Kysely<DB>` or `Transaction<DB>`. Queries run through
 * `withoutPlugins()`: TypeSQL's row types describe what the driver returns, so result
 * transformers such as `CamelCasePlugin` must not rename the columns (`createSql(db,
 * { rowKeys: "camelCase" })` renames the top-level keys instead, in the types too).
 */
export interface KyselyExecutor {
  withoutPlugins(): { executeQuery<R>(query: CompiledQuery<R>): Promise<QueryResult<R>> };
  transaction(): { execute<T>(fn: (trx: KyselyExecutor) => Promise<T>): Promise<T> };
  readonly isTransaction: boolean;
}

function run<R>(db: KyselyExecutor, text: string, values: readonly unknown[]): Promise<QueryResult<R>> {
  return db.withoutPlugins().executeQuery(CompiledQuery.raw(text, Array.from(values)) as CompiledQuery<R>);
}

/**
 * Kysely reports `numAffectedRows` for INSERT/UPDATE/DELETE/MERGE only; for other statements the
 * count is the rows returned (SELECT), or 0 (DDL), as Postgres' command tag says.
 */
function rowCount(result: QueryResult<unknown>): number {
  return result.numAffectedRows === undefined ? result.rows.length : Number(result.numAffectedRows);
}

/**
 * An `Executor` for core's `q.execute()`: runs queries on a Kysely instance (or transaction),
 * without its plugins, and resolves to `{ rows, rowCount }` so `q.executeCount()` works.
 */
export function executor(db: KyselyExecutor): Executor {
  return async (text, values) => {
    const result = await run<unknown>(db, text, values);
    return { rows: result.rows, rowCount: rowCount(result) };
  };
}

/**
 * Run `fn` inside `db.transaction().execute()`. A Kysely `Transaction` cannot start another one,
 * so inside one `fn` runs in a savepoint.
 */
function transaction<T>(db: KyselyExecutor, depth: number, fn: (trx: KyselyExecutor) => Promise<T>): Promise<T> {
  if (!db.isTransaction) return db.transaction().execute(fn);
  return runTransaction((statement) => run(db, statement, []), () => fn(db), { savepoint: `typesql_${depth + 1}` });
}

/** How `createSql(db)` runs queries and transactions. */
export const driver: SqlDriver<KyselyExecutor> = { executor, transaction };
