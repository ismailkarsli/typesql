import type { Executor } from "@typesql/core";
import { runTransaction, type SqlDriver } from "@typesql/core/adapter";

/** The subset of a `pg` query result the adapter relies on. */
export interface PgResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

/**
 * Anything with node-postgres' `query(text, values)` method: `Pool`, `Client`, `PoolClient`,
 * or a fake in tests. Only the `(text, values?) → Promise<{ rows, rowCount }>` form is used.
 */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<PgResult>;
}

/** A client checked out of a pool (`pg.PoolClient`): queryable and releasable. */
export interface PgTransactionClient extends PgQueryable {
  release(err?: Error | boolean): void;
}

/** Anything with `pg.Pool`'s `connect()`. */
export interface PgPoolLike<C extends PgTransactionClient = PgTransactionClient> {
  connect(): Promise<C>;
}

/**
 * An `Executor` for core's `q.execute()`: runs queries on `client` and resolves to
 * `{ rows, rowCount }` (pg's `rowCount`, so `q.executeCount()` works).
 */
export function executor(client: PgQueryable): Executor {
  return async (text, values) => {
    // `pg` requires a mutable array (`QueryConfigValues<I>` matches `Array<U>` only).
    const { rows, rowCount } = await client.query(text, Array.from(values));
    return { rows, rowCount };
  };
}

function isPool(client: PgQueryable): client is PgQueryable & PgPoolLike {
  // `pg.Client` has `connect()` too (it opens the socket), and `processID`; a `PoolClient` has `release()`.
  return typeof (client as Partial<PgPoolLike>).connect === "function" && !("release" in client) && !("processID" in client);
}

function isConnection(client: PgQueryable): boolean {
  return "release" in client || "processID" in client;
}

const on = (c: PgQueryable) => (statement: string) => c.query(statement);

/**
 * Check out a client, run `fn` with it between `BEGIN` and `COMMIT`, and release it, with the
 * error when `ROLLBACK` fails so the pool discards the connection instead of reusing it.
 */
async function inPoolTransaction<C extends PgTransactionClient, T>(pool: PgPoolLike<C>, fn: (conn: C) => Promise<T>): Promise<T> {
  const conn = await pool.connect();
  let releaseWith: Error | undefined;
  try {
    return await runTransaction(on(conn), () => fn(conn), {
      onRollbackError: (err) => {
        releaseWith = err instanceof Error ? err : new Error(String(err));
      },
    });
  } finally {
    conn.release(releaseWith);
  }
}

/**
 * Run `fn` inside a transaction: on a pool, on a client checked out of it; on a `Client` or
 * `PoolClient`, on that connection. With `depth > 0` the client is already in a transaction,
 * and `fn` runs in a savepoint.
 */
function transaction<T>(client: PgQueryable, depth: number, fn: (tx: PgQueryable) => Promise<T>): Promise<T> {
  if (depth > 0) return runTransaction(on(client), () => fn(client), { savepoint: `typesql_${depth}` });
  if (isPool(client)) return inPoolTransaction(client, fn);
  if (!isConnection(client)) {
    return Promise.reject(new Error("typesql: sql.transaction() needs a pg Pool, Client or PoolClient, so that BEGIN and COMMIT reach one connection"));
  }
  return runTransaction(on(client), () => fn(client));
}

/** How `createSql(client)` runs queries and transactions. */
export const driver: SqlDriver<PgQueryable> = { executor, transaction };

/** Anything carrying an ordered list of DDL statements, e.g. a `migrations()` builder from core. */
export interface MigrationSource {
  readonly statements: readonly string[];
}

/**
 * Run a migration's statements in order on one connection, inside a single transaction
 * (all or nothing). Statements are sent as simple queries without parameters, so scripts
 * with `$$`-quoted function bodies work.
 */
export async function migrate<C extends PgTransactionClient>(pool: PgPoolLike<C>, m: MigrationSource): Promise<void> {
  await inPoolTransaction(pool, async (client) => {
    for (const statement of m.statements) await client.query(statement);
  });
}
