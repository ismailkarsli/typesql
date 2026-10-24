import type { Executor } from "@typesql/core";
import type { SqlDriver } from "@typesql/core/adapter";

/**
 * The shape of a resolved `sql.unsafe()` result the adapter relies on: an array with `count`
 * (`null` for statements without a count, such as DDL).
 */
export type PostgresJsRows = readonly unknown[] & { readonly count: number | null };

/**
 * Anything with postgres.js' `unsafe(query, parameters)` method: the `Sql` instance,
 * a `TransactionSql` inside `begin`, a `ReservedSql`, or a fake in tests.
 */
export interface PostgresJsQueryable {
  unsafe(query: string, parameters?: unknown[]): PromiseLike<PostgresJsRows>;
}

/** Anything with postgres.js' `begin(fn)`: the `Sql` instance or a `ReservedSql`. */
export interface PostgresJsTransactable<Tx extends PostgresJsQueryable = PostgresJsQueryable> {
  begin(fn: (tx: Tx) => Promise<unknown>): Promise<unknown>;
}

/** A `TransactionSql`'s `savepoint(fn)`. */
interface PostgresJsSavepointable {
  savepoint(fn: (tx: PostgresJsQueryable) => Promise<unknown>): Promise<unknown>;
}

/**
 * An `Executor` for core's `q.execute()`: runs queries through `sql.unsafe` and resolves to
 * `{ rows, rowCount }` (postgres.js' `.count`, so `q.executeCount()` works).
 */
export function executor(sql: PostgresJsQueryable): Executor {
  return async (text, values) => {
    const result = await sql.unsafe(text, Array.from(values));
    return { rows: Array.from(result), rowCount: result.count ?? null };
  };
}

/**
 * Run `fn` inside a transaction: `tx.savepoint(fn)` on a `TransactionSql` (only those have it),
 * otherwise `sql.begin(fn)`. postgres.js issues BEGIN (or SAVEPOINT), runs the callback with a
 * transaction-bound `sql`, then COMMIT, or ROLLBACK and rethrow when the callback throws.
 */
async function transaction<T>(sql: PostgresJsQueryable, _depth: number, fn: (tx: PostgresJsQueryable) => Promise<T>): Promise<T> {
  const { savepoint, begin } = sql as Partial<PostgresJsSavepointable & PostgresJsTransactable>;
  if (savepoint) return (await savepoint.call(sql, fn)) as T;
  if (begin) return (await begin.call(sql, fn)) as T;
  throw new Error("typesql: sql.transaction() needs a postgres.js Sql, ReservedSql or TransactionSql (with begin or savepoint)");
}

/** How `createSql(sql)` runs queries and transactions. */
export const driver: SqlDriver<PostgresJsQueryable> = { executor, transaction };

/** Anything carrying an ordered list of DDL statements, e.g. a `migrations()` builder from core. */
export interface MigrationSource {
  readonly statements: readonly string[];
}

/**
 * Run a migration's statements in order inside one transaction (`sql.begin`), all or nothing.
 * Each statement goes through `unsafe` without parameters (simple protocol), so scripts with
 * `$$`-quoted function bodies work.
 */
export async function migrate<Tx extends PostgresJsQueryable>(sql: PostgresJsTransactable<Tx>, m: MigrationSource): Promise<void> {
  await sql.begin(async (tx) => {
    for (const statement of m.statements) await tx.unsafe(statement);
  });
}
