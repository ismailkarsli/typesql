import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type DefaultTypeMap, type Executor, type Generated, type Nullable, type RowType, type Sql } from "../../src/index.js";
import type { CamelCase, CamelCaseKeys, KeyedRow } from "../../src/engine/index.js";
import { camelCases } from "../runtime/camel-cases.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
    address_line_1: Nullable<"text">;
    user_id: Nullable<"int4">;
    userId: Nullable<"text">;
    settings: Nullable<"jsonb">;
  };
}

declare const executor: Executor;
const sql = createSql<DB>(executor, { rowKeys: "camelCase" });

test("CamelCase agrees with the runtime cases", () => {
  // each case where the type disagrees, as [input, CamelCase<input>]
  type Mismatch<P> = P extends readonly [infer A extends string, infer B extends string]
    ? [CamelCase<A>] extends [B] ? ([B] extends [CamelCase<A>] ? never : [A, CamelCase<A>]) : [A, CamelCase<A>]
    : never;
  expectTypeOf<Mismatch<(typeof camelCases)[number]>>().toEqualTypeOf<never>();
  expectTypeOf<CamelCase<"created_at">>().toEqualTypeOf<"createdAt">();
  expectTypeOf<CamelCase<string>>().toEqualTypeOf<string>();
});

test("rows get camelCase keys; values keep their types", () => {
  const q = sql("SELECT id, display_name, created_at, address_line_1, settings FROM users WHERE id = $1", 1);
  type Row = { id: number; displayName: string | null; createdAt: Date; addressLine1: string | null; settings: unknown };
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<Row>();
  expectTypeOf(q.execute()).toEqualTypeOf<Promise<Row[]>>();
  expectTypeOf(q.executeTakeFirst()).toEqualTypeOf<Promise<Row | undefined>>();
  expectTypeOf(q.executeTakeFirstOrThrow()).toEqualTypeOf<Promise<Row>>();
  expectTypeOf(q.executeCount()).toEqualTypeOf<Promise<number>>();
});

test("aliases, RETURNING, slots and DML without RETURNING", () => {
  expectTypeOf<RowType<ReturnType<typeof sql<"SELECT email AS email_address, count(*) AS n_total FROM users GROUP BY email">>>>()
    .toEqualTypeOf<{ emailAddress: string; nTotal: string }>();
  expectTypeOf<RowType<ReturnType<typeof sql<"INSERT INTO users (email) VALUES ($1) RETURNING id, created_at">>>>()
    .toEqualTypeOf<{ id: number; createdAt: Date }>();
  const where = sql.fragment("WHERE display_name IS NOT NULL");
  const slotted = sql("SELECT display_name FROM users {where}", { where });
  expectTypeOf<RowType<typeof slotted>>().toEqualTypeOf<{ displayName: string }>();
  expectTypeOf(sql("DELETE FROM users WHERE id = $1", 1).execute()).toEqualTypeOf<Promise<never[]>>();
});

test("keys that collide become one key typed as the union", () => {
  const q = sql("SELECT user_id, \"userId\" FROM users");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ userId: number | string | null }>();
});

test("sql.as asserts the row as returned", () => {
  expectTypeOf(sql.as<{ displayName: string }>("SELECT display_name FROM users").execute()).toEqualTypeOf<Promise<{ displayName: string }[]>>();
});

test("the default and rowKeys: \"preserve\" keep Postgres names", () => {
  const plain = createSql<DB>(executor);
  const preserved = createSql<DB>(executor, { rowKeys: "preserve" });
  const none = createSql<DB>(undefined, {});
  expectTypeOf(plain).toEqualTypeOf<Sql<DB, DefaultTypeMap>>();
  expectTypeOf(preserved).toEqualTypeOf(plain);
  expectTypeOf(none).toEqualTypeOf(plain);
  expectTypeOf<RowType<ReturnType<typeof plain<"SELECT display_name FROM users">>>>().toEqualTypeOf<{ display_name: string | null }>();
  expectTypeOf(createSql<DB>(undefined, { rowKeys: "camelCase" })).toEqualTypeOf<Sql<DB, DefaultTypeMap, "camelCase">>();
  // @ts-expect-error not a rowKeys option
  createSql<DB>(executor, { rowKeys: "snake_case" });
});

test("CamelCaseKeys and KeyedRow", () => {
  expectTypeOf<CamelCaseKeys<{ readonly a_b?: number; c: string }>>().toEqualTypeOf<{ readonly aB?: number; c: string }>();
  expectTypeOf<CamelCaseKeys<never>>().toEqualTypeOf<never>();
  expectTypeOf<CamelCaseKeys<{ a_b: 1 } | { c_d: 2 }>>().toEqualTypeOf<{ aB: 1 } | { cD: 2 }>();
  expectTypeOf<CamelCaseKeys<{ nested_json: { inner_key: 1 } }>>().toEqualTypeOf<{ nestedJson: { inner_key: 1 } }>();
  expectTypeOf<KeyedRow<{ a_b: 1 }, "preserve">>().toEqualTypeOf<{ a_b: 1 }>();
  expectTypeOf<KeyedRow<{ a_b: 1 }, "camelCase">>().toEqualTypeOf<{ aB: 1 }>();
});
