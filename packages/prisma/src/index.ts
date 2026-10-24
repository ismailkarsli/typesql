import type { TransactionalSql } from "@typesql/core";
import { createTransactionalSql } from "@typesql/core/adapter";
import type { FromPrisma, PrismaTypeMapLike } from "./from-prisma.js";
import { driver, type PrismaRawClient } from "./client.js";
import type { PrismaTypeMap } from "./type-map.js";

export type { FromPrisma, PrismaOverrides, ModelOverride, FieldOverride, PrismaScalarToPg, PrismaTypeMapLike } from "./from-prisma.js";
export type { PrismaTypeMap } from "./type-map.js";
export { executor, type PrismaRawClient } from "./client.js";

/** A TypeSQL schema as is, or a generated `Prisma.TypeMap` converted with `FromPrisma`. */
export type PrismaSchema<S> = S extends PrismaTypeMapLike ? FromPrisma<S> : S;

/** What `createSql<S>(prisma)` returns: core's `Sql` under `PrismaTypeMap`, with `transaction(fn)`. */
export type PrismaSql<S, TM = PrismaTypeMap> = TransactionalSql<PrismaSchema<S>, TM>;

/**
 * `createSql` from core with `PrismaTypeMap` (what `$queryRaw` returns: `int8` is `bigint`,
 * `numeric` is `Decimal`). `S` is a generated `Prisma.TypeMap`, a `FromPrisma<...>` with
 * overrides, or the `DB` interface written by the `typesql-prisma` generator. The queries'
 * `execute*` methods run on `prisma` (a client or a transaction client), and `sql.transaction(fn)`
 * runs `fn` with a `sql` bound to an interactive transaction.
 */
export function createSql<S, TM = PrismaTypeMap>(prisma?: PrismaRawClient): PrismaSql<S, TM> {
  return createTransactionalSql<PrismaSchema<S>, TM, PrismaRawClient>(prisma, driver) as PrismaSql<S, TM>;
}
