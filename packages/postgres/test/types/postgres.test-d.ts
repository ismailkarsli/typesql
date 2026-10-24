import { expectTypeOf, test } from "vitest";
import postgres from "postgres";
import type { Col, Generated, Nullable, ParamsType, RowType, SqlError } from "@typesql/core";
import type { TsTypeOf } from "@typesql/core/engine";
import {
  createSql,
  type PostgresJsBigIntTypeMap,
  type PostgresJsQueryable,
  type PostgresJsSql,
  type PostgresJsTransactable,
  type PostgresJsTypeMap,
} from "../../src/index.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
    birthday: Nullable<"date">;
    balance: Col<"numeric">;
    avatar: Nullable<"bytea">;
    session_length: Nullable<"interval">;
    location: Nullable<"point">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    tags: Col<"text[]">;
    view_counts: Col<"int8[]">;
    meta: Nullable<"jsonb">;
  };
}

declare const db: ReturnType<typeof postgres>;
const sql = createSql<DB>(db);
const big = createSql<DB>(db, { bigint: true });

type Row = { id: number; email: string; display_name: string | null };
const q = sql("SELECT id, email, display_name FROM users WHERE id = $1", 1);

test("PostgresJsTypeMap matches postgres.js' default parsers", () => {
  expectTypeOf<PostgresJsTypeMap["int2"]>().toEqualTypeOf<number>();
  expectTypeOf<PostgresJsTypeMap["int4"]>().toEqualTypeOf<number>();
  expectTypeOf<PostgresJsTypeMap["int8"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["oid"]>().toEqualTypeOf<number>();
  expectTypeOf<PostgresJsTypeMap["float8"]>().toEqualTypeOf<number>();
  expectTypeOf<PostgresJsTypeMap["numeric"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["bool"]>().toEqualTypeOf<boolean>();
  expectTypeOf<PostgresJsTypeMap["date"]>().toEqualTypeOf<Date>();
  expectTypeOf<PostgresJsTypeMap["timestamp"]>().toEqualTypeOf<Date>();
  expectTypeOf<PostgresJsTypeMap["timestamptz"]>().toEqualTypeOf<Date>();
  expectTypeOf<PostgresJsTypeMap["json"]>().toEqualTypeOf<unknown>();
  expectTypeOf<PostgresJsTypeMap["jsonb"]>().toEqualTypeOf<unknown>();
  expectTypeOf<PostgresJsTypeMap["bytea"]>().toEqualTypeOf<Buffer>();
  expectTypeOf<PostgresJsTypeMap["interval"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["point"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["circle"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["uuid"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsTypeMap["time"]>().toEqualTypeOf<string>();
  expectTypeOf<TsTypeOf<PostgresJsTypeMap, {}, "int8[]">>().toEqualTypeOf<string[]>();
  expectTypeOf<TsTypeOf<PostgresJsTypeMap, {}, "date[]">>().toEqualTypeOf<Date[]>();
});

test("PostgresJsBigIntTypeMap only changes int8", () => {
  expectTypeOf<PostgresJsBigIntTypeMap["int8"]>().toEqualTypeOf<bigint>();
  expectTypeOf<PostgresJsBigIntTypeMap["int4"]>().toEqualTypeOf<number>();
  expectTypeOf<PostgresJsBigIntTypeMap["numeric"]>().toEqualTypeOf<string>();
  expectTypeOf<PostgresJsBigIntTypeMap["date"]>().toEqualTypeOf<Date>();
  expectTypeOf<TsTypeOf<PostgresJsBigIntTypeMap, {}, "int8[]">>().toEqualTypeOf<bigint[]>();
  expectTypeOf<Omit<PostgresJsBigIntTypeMap, "int8">>().toEqualTypeOf<Omit<PostgresJsTypeMap, "int8">>();
});

test("parameters accept PostgresJsParamTypeMap on top of the row types", () => {
  const q = sql("SELECT id FROM users WHERE created_at > $1 AND id = $2", new Date(), 1);
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[Date | string | number | null, number | null]>();
  // epoch milliseconds: postgres.js serializes dates with new Date(x)
  sql("SELECT id FROM users WHERE created_at > $1", 0);
  big("SELECT id FROM posts WHERE id = $1", 1);
  // @ts-expect-error bool params take only booleans
  sql("SELECT id FROM users WHERE (created_at IS NOT NULL) = $1", "t");
});

test("postgres.js Sql, TransactionSql and ReservedSql satisfy the structural interfaces", () => {
  expectTypeOf<postgres.Sql>().toExtend<PostgresJsQueryable>();
  expectTypeOf<postgres.Sql>().toExtend<PostgresJsTransactable>();
  expectTypeOf<postgres.TransactionSql>().toExtend<PostgresJsQueryable>();
  expectTypeOf<postgres.ReservedSql>().toExtend<PostgresJsQueryable>();
  expectTypeOf<postgres.ReservedSql>().toExtend<PostgresJsTransactable>();
});

test("createSql accepts a Sql, TransactionSql or ReservedSql", () => {
  expectTypeOf(sql).toEqualTypeOf<PostgresJsSql<DB>>();
  expectTypeOf(big).toEqualTypeOf<PostgresJsSql<DB, "preserve", PostgresJsBigIntTypeMap>>();
  createSql<DB>({} as postgres.TransactionSql);
  createSql<DB>({} as postgres.ReservedSql);
});

test("row types flow from Query through execute*", () => {
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<Row>();
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[number | null]>();
  expectTypeOf(q.execute()).toEqualTypeOf<Promise<Row[]>>();
  expectTypeOf(q.executeTakeFirst()).toEqualTypeOf<Promise<Row | undefined>>();
  expectTypeOf(q.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<Row>>();
  expectTypeOf(q.executeCount()).toEqualTypeOf<Promise<number>>();
});

test("driver-specific result types: default map", () => {
  expectTypeOf(sql("SELECT count(*) FROM users").execute()).toEqualTypeOf<Promise<{ count: string }[]>>();
  expectTypeOf(sql("SELECT id, view_counts FROM posts").execute()).toEqualTypeOf<Promise<{ id: string; view_counts: string[] }[]>>();
  expectTypeOf(sql("SELECT created_at, birthday, balance, avatar, session_length, location FROM users").execute()).toEqualTypeOf<
    Promise<{ created_at: Date; birthday: Date | null; balance: string; avatar: Buffer | null; session_length: string | null; location: string | null }[]>
  >();
});

test("driver-specific result types: bigint map", () => {
  expectTypeOf(big("SELECT count(*) FROM users").execute()).toEqualTypeOf<Promise<{ count: bigint }[]>>();
  expectTypeOf(big("SELECT id, view_counts FROM posts").execute()).toEqualTypeOf<Promise<{ id: bigint; view_counts: bigint[] }[]>>();
  expectTypeOf(big("SELECT sum(author_id) AS s, max(id) AS m FROM posts").execute()).toEqualTypeOf<Promise<{ s: bigint | null; m: bigint | null }[]>>();
  expectTypeOf(big("SELECT id, created_at FROM users").execute()).toEqualTypeOf<Promise<{ id: number; created_at: Date }[]>>();
});

test("sql.transaction passes a sql bound to the transaction and returns the callback's result", () => {
  const result = sql.transaction(async (tx) => {
    expectTypeOf(tx).toEqualTypeOf<PostgresJsSql<DB>>();
    return tx("SELECT id, email, display_name FROM users WHERE id = $1", 1).executeTakeFirstOrThrow();
  });
  expectTypeOf(result).toEqualTypeOf<Promise<Row>>();
  big.transaction(async (tx) => {
    expectTypeOf(tx).toEqualTypeOf<PostgresJsSql<DB, "preserve", PostgresJsBigIntTypeMap>>();
  });
});

test("invalid SQL is rejected by both pre-bound sql functions", () => {
  expectTypeOf<Parameters<typeof sql<"SELECT nope FROM users">>[0]>().toEqualTypeOf<SqlError<'column "nope" does not exist', 1> & "SELECT nope FROM users">();
  expectTypeOf<Parameters<typeof big<"SELECT nope FROM users">>[0]>().toEqualTypeOf<SqlError<'column "nope" does not exist', 1> & "SELECT nope FROM users">();
  // @ts-expect-error wrong param type
  sql("SELECT id FROM users WHERE id = $1", "7");
});

test("DML: executeCount returns the row count; RETURNING rows follow the type map", () => {
  const upd = sql("UPDATE posts SET title = $1 WHERE id = $2", "t", "1");
  expectTypeOf<RowType<typeof upd>>().toEqualTypeOf<never>();
  expectTypeOf(upd.executeCount()).toEqualTypeOf<Promise<number>>();

  const ins = big("INSERT INTO posts (author_id, title, tags, view_counts) VALUES ($1, $2, $3, $4) RETURNING id, view_counts", 1, "t", ["a"], [1n]);
  expectTypeOf(ins.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<{ id: bigint; view_counts: bigint[] }>>();
  expectTypeOf<ParamsType<typeof ins>>().toEqualTypeOf<[number, string, (string | null)[], (bigint | number | string | null)[]]>();
});

test("rowKeys: camelCase renames the row keys", () => {
  const camel = createSql<DB>(db, { rowKeys: "camelCase" });
  const cq = camel("SELECT id, display_name FROM users WHERE id = $1", 1);
  type CamelRow = { id: number; displayName: string | null };
  expectTypeOf<RowType<typeof cq>>().toEqualTypeOf<CamelRow>();
  expectTypeOf(cq.execute()).toEqualTypeOf<Promise<CamelRow[]>>();
  expectTypeOf(cq.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<CamelRow>>();
  const bigCamel = createSql<DB>(db, { rowKeys: "camelCase", bigint: true });
  expectTypeOf<RowType<ReturnType<typeof bigCamel<"SELECT count(*) AS user_count FROM users">>>>().toEqualTypeOf<{ userCount: bigint }>();
  expectTypeOf(createSql<DB>(undefined, { bigint: true })).toEqualTypeOf(big);
  expectTypeOf(createSql<DB>(db, { bigint: false })).toEqualTypeOf(sql);
  expectTypeOf(createSql<DB>(db, { rowKeys: "camelCase", bigint: false })).toEqualTypeOf(camel);
  expectTypeOf(createSql<DB>(db, { rowKeys: "preserve" })).toEqualTypeOf(sql);
});
