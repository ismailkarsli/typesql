import type { PrismaPromise } from "@prisma/client/runtime/client";
import type { Executor } from "@typesql/core";
import { runTransaction, type SqlDriver } from "@typesql/core/adapter";

/**
 * Anything with Prisma Client's raw methods: a `PrismaClient`, an extended client or a transaction
 * client. `$transaction` is there on the first two only.
 */
export interface PrismaRawClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): PrismaPromise<T>;
  $executeRawUnsafe(query: string, ...values: any[]): PrismaPromise<number>;
  $transaction?<R>(fn: (tx: PrismaRawClient) => Promise<R>): Promise<R>;
}

/**
 * An `Executor` for core's `q.execute()`: runs queries through `prisma.$queryRawUnsafe(text, ...values)`,
 * and `q.executeCount()` through `prisma.$executeRawUnsafe(text, ...values)`. Values are always
 * sent as bind parameters (`$n`), never interpolated.
 */
export function executor(prisma: PrismaRawClient): Executor {
  return Object.assign((text: string, values: readonly unknown[]) => prisma.$queryRawUnsafe<unknown[]>(text, ...values), {
    count: (text: string, values: readonly unknown[]) => prisma.$executeRawUnsafe(text, ...values),
  });
}

/**
 * Run `fn` inside an interactive `prisma.$transaction(fn)`. A transaction client cannot start
 * another one, so inside one `fn` runs in a savepoint.
 */
function transaction<T>(prisma: PrismaRawClient, depth: number, fn: (tx: PrismaRawClient) => Promise<T>): Promise<T> {
  if (prisma.$transaction) return prisma.$transaction(fn);
  return runTransaction((statement) => prisma.$executeRawUnsafe(statement), () => fn(prisma), { savepoint: `typesql_${depth + 1}` });
}

/** How `createSql(prisma)` runs queries and transactions. */
export const driver: SqlDriver<PrismaRawClient> = { executor, transaction };
