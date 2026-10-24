import type { Executor } from "@typesql/core";
import type { SqlDriver } from "@typesql/core/adapter";

/**
 * What the adapter uses from a Drizzle database (`drizzle(client)` from `drizzle-orm/node-postgres`,
 * `drizzle-orm/postgres-js`, ...) or a transaction from `db.transaction(fn)`.
 */
export interface DrizzleDatabase {
  readonly _: { readonly session: object };
  transaction<T>(fn: (tx: DrizzleDatabase) => Promise<T>): Promise<T>;
}

/** The driver client a Drizzle session holds: node-postgres' `query` or postgres.js' `unsafe`. */
interface DriverClient {
  query?(text: string, values: unknown[]): Promise<unknown>;
  unsafe?(text: string, values: unknown[]): PromiseLike<unknown>;
}

/**
 * The driver client under `db`: the `Pool`, `Client` or postgres.js `sql` given to `drizzle()`,
 * or, inside `db.transaction(fn)`, the connection the transaction runs on. Drizzle keeps it as
 * `session.client`.
 */
function clientOf(db: DrizzleDatabase): DriverClient {
  const client = (db._.session as { readonly client?: DriverClient }).client;
  if (client && (typeof client.unsafe === "function" || typeof client.query === "function")) return client;
  throw new Error("typesql: createSql(db) needs a Drizzle database on node-postgres or postgres.js (its session client has no query or unsafe method)");
}

/**
 * An `Executor` for core's `q.execute()`: runs queries on the driver client under `db`, so rows
 * come back as the driver parses them (Drizzle's column mappers are not involved), and resolves to
 * `{ rows, rowCount }` so `q.executeCount()` works.
 */
export function executor(db: DrizzleDatabase): Executor {
  return async (text, values) => {
    const client = clientOf(db);
    if (client.unsafe) {
      const result = (await client.unsafe(text, Array.from(values))) as unknown[] & { readonly count?: number | null };
      return { rows: Array.from(result), rowCount: result.count ?? null };
    }
    const result = (await client.query!(text, Array.from(values))) as { rows: unknown[]; rowCount?: number | null };
    return { rows: result.rows, rowCount: result.rowCount ?? null };
  };
}

/** Run `fn` inside `db.transaction(fn)`; Drizzle nests a transaction inside one with a savepoint. */
function transaction<T>(db: DrizzleDatabase, _depth: number, fn: (tx: DrizzleDatabase) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** How `createSql(db)` runs queries and transactions. */
export const driver: SqlDriver<DrizzleDatabase> = { executor, transaction };
