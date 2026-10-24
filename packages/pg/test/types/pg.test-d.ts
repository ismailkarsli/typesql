import { expectTypeOf, test } from "vitest";
import type { Client, Pool, PoolClient } from "pg";
import type { Col, Generated, Nullable, ParamsType, PgCatalog, RowType, SqlError } from "@typesql/core";
import type { TsTypeOf } from "@typesql/core/engine";
import {
  createSql,
  type PgInterval,
  type PgPoolLike,
  type PgQueryable,
  type PgSql,
  type PgTransactionClient,
  type PgTypeMap,
} from "../../src/index.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
    balance: Col<"numeric">;
    avatar: Nullable<"bytea">;
    session_length: Nullable<"interval">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    tags: Col<"text[]">;
    meta: Nullable<"jsonb">;
  };
}

declare const pool: Pool;
const sql = createSql<DB>(pool);

type Row = { id: number; email: string; display_name: string | null };
const q = sql("SELECT id, email, display_name FROM users WHERE id = $1", 1);

test("PgTypeMap matches pg's default parsers", () => {
  expectTypeOf<PgTypeMap["int2"]>().toEqualTypeOf<number>();
  expectTypeOf<PgTypeMap["int4"]>().toEqualTypeOf<number>();
  expectTypeOf<PgTypeMap["int8"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["oid"]>().toEqualTypeOf<number>();
  expectTypeOf<PgTypeMap["float4"]>().toEqualTypeOf<number>();
  expectTypeOf<PgTypeMap["float8"]>().toEqualTypeOf<number>();
  expectTypeOf<PgTypeMap["numeric"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["bool"]>().toEqualTypeOf<boolean>();
  expectTypeOf<PgTypeMap["date"]>().toEqualTypeOf<Date>();
  expectTypeOf<PgTypeMap["timestamp"]>().toEqualTypeOf<Date>();
  expectTypeOf<PgTypeMap["timestamptz"]>().toEqualTypeOf<Date>();
  expectTypeOf<PgTypeMap["json"]>().toEqualTypeOf<unknown>();
  expectTypeOf<PgTypeMap["jsonb"]>().toEqualTypeOf<unknown>();
  expectTypeOf<PgTypeMap["bytea"]>().toEqualTypeOf<Buffer>();
  expectTypeOf<PgTypeMap["interval"]>().toEqualTypeOf<PgInterval>();
  expectTypeOf<PgTypeMap["uuid"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["text"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["time"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["money"]>().toEqualTypeOf<string>();
  expectTypeOf<PgTypeMap["point"]>().toEqualTypeOf<{ x: number; y: number }>();
  expectTypeOf<PgTypeMap["circle"]>().toEqualTypeOf<{ x: number; y: number; radius: number }>();
  expectTypeOf<PgTypeMap["record"]>().toEqualTypeOf<string>();
  expectTypeOf<TsTypeOf<PgTypeMap, {}, "int8[]">>().toEqualTypeOf<string[]>();
  expectTypeOf<TsTypeOf<PgTypeMap, {}, "timestamptz[]">>().toEqualTypeOf<Date[]>();
});

test("pg's Pool, Client and PoolClient satisfy the structural interfaces", () => {
  expectTypeOf<Pool>().toExtend<PgQueryable>();
  expectTypeOf<Client>().toExtend<PgQueryable>();
  expectTypeOf<PoolClient>().toExtend<PgQueryable>();
  expectTypeOf<PoolClient>().toExtend<PgTransactionClient>();
  expectTypeOf<Pool>().toExtend<PgPoolLike>();
});

test("createSql accepts a Pool, Client or PoolClient", () => {
  expectTypeOf(sql).toEqualTypeOf<PgSql<DB>>();
  createSql<DB>({} as Client);
  createSql<DB>({} as PoolClient);
});

test("row types flow from Query through execute*", () => {
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<Row>();
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[number | null]>();
  expectTypeOf(q.execute()).toEqualTypeOf<Promise<Row[]>>();
  expectTypeOf(q.executeTakeFirst()).toEqualTypeOf<Promise<Row | undefined>>();
  expectTypeOf(q.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<Row>>();
  expectTypeOf(q.executeCount()).toEqualTypeOf<Promise<number>>();
});

test("pg-specific result types", () => {
  expectTypeOf(sql("SELECT count(*) FROM users").execute()).toEqualTypeOf<Promise<{ count: string }[]>>();
  expectTypeOf(sql("SELECT count(*) AS n, max(created_at) AS latest FROM users").execute()).toEqualTypeOf<
    Promise<{ n: string; latest: Date | null }[]>
  >();
  expectTypeOf(sql("SELECT id, balance, avatar, session_length FROM users").execute()).toEqualTypeOf<
    Promise<{ id: number; balance: string; avatar: Buffer | null; session_length: PgInterval | null }[]>
  >();
  expectTypeOf(sql("SELECT p.id, p.tags, p.meta, u.created_at FROM posts p JOIN users u ON u.id = p.author_id").execute()).toEqualTypeOf<
    Promise<{ id: string; tags: string[]; meta: unknown; created_at: Date }[]>
  >();
  expectTypeOf(sql("SELECT u.email, p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id").execute()).toEqualTypeOf<
    Promise<{ email: string; title: string | null }[]>
  >();
});

test("sql.transaction passes a sql bound to the transaction and returns the callback's result", () => {
  const result = sql.transaction(async (tx) => {
    expectTypeOf(tx).toEqualTypeOf<PgSql<DB>>();
    return tx("SELECT id, email, display_name FROM users WHERE id = $1", 1).executeTakeFirstOrThrow();
  });
  expectTypeOf(result).toEqualTypeOf<Promise<Row>>();
});

test("invalid SQL is rejected by the pre-bound sql", () => {
  expectTypeOf<Parameters<typeof sql<"SELECT nope FROM users">>[0]>().toEqualTypeOf<SqlError<'column "nope" does not exist', 1> & "SELECT nope FROM users">();
  // @ts-expect-error wrong param type
  sql("SELECT id FROM users WHERE id = $1", "7");
  // @ts-expect-error missing param
  sql("SELECT id FROM users WHERE id = $1");
});

test("parameters accept PgParamTypeMap on top of the row types", () => {
  const q = sql("SELECT id FROM users WHERE created_at > $1 AND balance > $2", new Date(), 1.5);
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[Date | string | null, string | number | bigint | null]>();
  sql("SELECT id FROM users WHERE created_at > $1 AND balance > $2", "2024-01-01T00:00:00Z", 2n);
  // @ts-expect-error pg sends a number as its digits, which is not a timestamp
  sql("SELECT id FROM users WHERE created_at > $1", 0);
});

test("DML: executeCount returns the row count; RETURNING rows flow through execute*", () => {
  const upd = sql("UPDATE posts SET title = $1 WHERE id = $2", "t", "1");
  expectTypeOf<RowType<typeof upd>>().toEqualTypeOf<never>();
  expectTypeOf<ParamsType<typeof upd>>().toEqualTypeOf<[string, string | number | bigint | null]>();
  expectTypeOf(upd.executeCount()).toEqualTypeOf<Promise<number>>();

  const ins = sql("INSERT INTO users (email, balance) VALUES ($1, $2) RETURNING id, created_at", "a@b.c", "0");
  expectTypeOf(ins.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<{ id: number; created_at: Date }>>();

  const del = sql("DELETE FROM posts WHERE author_id = $1 RETURNING id, tags", 1);
  expectTypeOf(del.execute()).toEqualTypeOf<Promise<{ id: string; tags: string[] }[]>>();

  // @ts-expect-error email is NOT NULL without a default
  sql("INSERT INTO users (display_name) VALUES ($1)", "x");
});

test("rowKeys: camelCase renames the row keys, in transactions too", () => {
  const camel = createSql<DB>(pool, { rowKeys: "camelCase" });
  const cq = camel("SELECT id, display_name, created_at FROM users WHERE id = $1", 1);
  type CamelRow = { id: number; displayName: string | null; createdAt: Date };
  expectTypeOf<RowType<typeof cq>>().toEqualTypeOf<CamelRow>();
  expectTypeOf(cq.execute()).toEqualTypeOf<Promise<CamelRow[]>>();
  expectTypeOf(cq.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<CamelRow>>();
  camel.transaction(async (tx) => {
    expectTypeOf(tx).toEqualTypeOf<PgSql<DB, "camelCase">>();
  });
  expectTypeOf(createSql<DB>(undefined, { rowKeys: "preserve" })).toEqualTypeOf(sql);
  // @ts-expect-error not a rowKeys option
  createSql<DB>(pool, { rowKeys: "snake" });
});

test("PgCatalog columns under PgTypeMap: unparsed system arrays are raw text", () => {
  const sql = createSql<DB & PgCatalog>();
  const q = sql("SELECT relacl, relkind, reloptions FROM pg_class");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ relacl: string | null; relkind: string; reloptions: string[] | null }>();
  const p = sql("SELECT proargmodes, proargtypes, proallargtypes FROM pg_proc");
  expectTypeOf<RowType<typeof p>>().toEqualTypeOf<{ proargmodes: string | null; proargtypes: string; proallargtypes: number[] | null }>();
});
