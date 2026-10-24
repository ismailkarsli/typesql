import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type View, type RowOf, type ParamsOf, type Validate, type SqlError, type DefaultTypeMap } from "../../src/index.js";
import type { KindOf } from "../../src/engine/index.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    body: Nullable<"text">;
  };
  active_users: View<{ id: Col<"int4">; email: Col<"text"> }>;
}

const sql = createSql<DB>();
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;

test("DELETE without RETURNING has no row type", () => {
  expectTypeOf<Row<"DELETE FROM users WHERE id = 1">>().toEqualTypeOf<never>();
  expectTypeOf<Row<"DELETE FROM users">>().toEqualTypeOf<never>();
  expectTypeOf<KindOf<DB, "DELETE FROM users">>().toEqualTypeOf<"delete">();
  expectTypeOf<V<"DELETE FROM ONLY users AS u WHERE u.id = 1">>().toEqualTypeOf<"DELETE FROM ONLY users AS u WHERE u.id = 1">();
});

test("DELETE ... RETURNING", () => {
  expectTypeOf<Row<"DELETE FROM users WHERE id = 1 RETURNING *">>().toEqualTypeOf<{ id: number; email: string; display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"DELETE FROM users u RETURNING u.id, u.display_name">>().toEqualTypeOf<{ id: number; display_name: string | null }>();
  expectTypeOf<Row<"DELETE FROM users RETURNING id::text, lower(email) AS e">>().toEqualTypeOf<{ id: string; e: string }>();
});

test("DELETE ... USING", () => {
  expectTypeOf<Row<"DELETE FROM users u USING posts p WHERE p.author_id = u.id AND p.title = 'x' RETURNING u.id, p.title, p.body">>().toEqualTypeOf<{ id: number; title: string; body: string | null }>();
  expectTypeOf<Row<"DELETE FROM posts USING users u LEFT JOIN users v ON v.id = u.id WHERE posts.author_id = u.id RETURNING v.email, u.email AS ue">>().toEqualTypeOf<{ email: string | null; ue: string }>();
  expectTypeOf<Params<"DELETE FROM users u USING posts p WHERE p.author_id = u.id AND p.title = $1 RETURNING u.id">>().toEqualTypeOf<[string | null]>();
  expectTypeOf<V<"DELETE FROM users u USING posts p WHERE p.author_id = u.id RETURNING p.nope">>().toEqualTypeOf<SqlError<"column p.nope does not exist", 18>>();
  expectTypeOf<V<"DELETE FROM users USING nope">>().toEqualTypeOf<SqlError<'relation "nope" does not exist', 4>>();
});

test("WHERE is type-checked", () => {
  expectTypeOf<V<"DELETE FROM users WHERE nope = 1">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 4>>();
  expectTypeOf<V<"DELETE FROM users u WHERE users.id = 1">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "users"', 2>>();
  expectTypeOf<V<"DELETE FROM users WHERE id IN (SELECT author_id FROM posts)">>().toEqualTypeOf<"DELETE FROM users WHERE id IN (SELECT author_id FROM posts)">();
  expectTypeOf<V<"DELETE FROM users WHERE EXISTS (SELECT 1 FROM posts p WHERE p.author_id = users.id)">>().toEqualTypeOf<"DELETE FROM users WHERE EXISTS (SELECT 1 FROM posts p WHERE p.author_id = users.id)">();
});

test("target table errors", () => {
  expectTypeOf<V<"DELETE FROM active_users">>().toEqualTypeOf<SqlError<'cannot delete from view "active_users"', 2>>();
  expectTypeOf<V<"DELETE FROM nope">>().toEqualTypeOf<SqlError<'relation "nope" does not exist', 2>>();
});

test("DELETE inside WITH", () => {
  expectTypeOf<Row<"WITH del AS (DELETE FROM posts WHERE id = 1 RETURNING author_id) UPDATE users SET display_name = NULL FROM del WHERE users.id = del.author_id RETURNING users.id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"WITH del AS (DELETE FROM posts RETURNING *) SELECT count(*) AS n, max(del.title) AS t FROM del">>().toEqualTypeOf<{ n: string; t: string | null }>();
  expectTypeOf<Row<"WITH gone AS (DELETE FROM users WHERE id = 1 RETURNING id) DELETE FROM posts USING gone WHERE posts.author_id = gone.id RETURNING posts.id">>().toEqualTypeOf<{ id: string }>();
});

test("unsupported / syntax errors", () => {
  expectTypeOf<V<"DELETE users">>().toEqualTypeOf<SqlError<"syntax error: expected FROM at or near users", 1>>();
  expectTypeOf<V<"DELETE FROM users WHERE CURRENT OF c">>().toEqualTypeOf<"DELETE FROM users WHERE CURRENT OF c">();
  expectTypeOf<Row<"DELETE FROM users WHERE CURRENT OF c RETURNING *">>().toEqualTypeOf<Row<"DELETE FROM users RETURNING *">>();
  expectTypeOf<V<"DELETE FROM users u USING">>().toEqualTypeOf<SqlError<"syntax error: expected table name, subquery or function at or near end of input", 5>>();
});

test("sql() call sites", () => {
  sql("DELETE FROM users WHERE id = $1", 1);
  const q = sql("DELETE FROM users WHERE email = $1 RETURNING id", "a");
  expectTypeOf(q.text).toEqualTypeOf<string>();
  // @ts-expect-error wrong param type
  sql("DELETE FROM users WHERE id = $1", "1");
  expectTypeOf<Validate<DB, "DELETE FROM users WHERE nope = 1">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 4>>();
  expectTypeOf<Validate<DB, "DELETE FROM active_users">>().toEqualTypeOf<SqlError<'cannot delete from view "active_users"', 2>>();
});
